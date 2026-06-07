import { Hono, type Context } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { supabaseAdmin } from '@forge/db'

const db = supabaseAdmin!
import { requireRole } from '../middleware/rbac'
import { generateFacturePDF, generateRecuPDF, uploadPDF } from '../services/pdf.service'
import { genererEcritureVente, genererEcritureEncaissement, planComptable } from '../services/comptabilite.service'
import { getFacturesLocal, getCreditsLocal, localCreateFacture, localCreateCredit, localRembourser } from '../services/db-local'
import { withOfflineFallback } from '../services/offline-fallback'
import type { HonoVariables } from '../types'

const router = new Hono<{ Variables: HonoVariables }>()
type FinanceContext = Context<{ Variables: HonoVariables }>
const TVA_RATE = 0.1925

function xaf(n: number): string {
  return n.toLocaleString('fr-FR') + ' XAF'
}

interface FactureLignePdf {
  designation:          string
  unite:                string
  quantite:             number
  prix_unitaire_ht_xaf: number
  total_ht_xaf:         number
}

// ── Schémas Zod ────────────────────────────────────────────────────────────────

const factureSchema = z.object({
  client_id:     z.string().optional(),
  client_nom:    z.string().min(1),
  commande_id:   z.string().optional(),
  date_emission: z.string(),
  date_echeance: z.string(),
  notes:         z.string().optional(),
  lignes: z.array(z.object({
    designation:          z.string().min(1),
    unite:                z.string().default('unité'),
    quantite:             z.number().positive(),
    prix_unitaire_ht_xaf: z.number().min(0),
    ordre:                z.number().int().default(0),
  })).min(1),
})

const creditSchema = z.object({
  client_id:   z.string().optional(),
  client_nom:  z.string().min(1),
  commande_id: z.string().optional(),
  montant_xaf: z.number().positive(),
  date_debut:  z.string(),
  echeance:    z.string(),
  notes:       z.string().optional(),
})

const rembourserSchema = z.object({
  montant_xaf:   z.number().positive(),
  date_paiement: z.string(),
  type:          z.enum(['total', 'partiel']),
  notes:         z.string().optional(),
})

const ecritureSchema = z.object({
  date:             z.string(),
  libelle:          z.string().min(1),
  compte_syscohada: z.string().min(2),
  compte_label:     z.string().min(1),
  debit_xaf:        z.number().min(0).default(0),
  credit_xaf:       z.number().min(0).default(0),
  reference_doc:    z.string().optional(),
  facture_id:       z.string().optional(),
  commande_id:      z.string().optional(),
})

const journalSchema = z.object({
  date:          z.string(),
  journal:       z.enum(['VT', 'BQ', 'CA', 'AC', 'OD']).default('OD'),
  libelle:       z.string().min(1),
  reference_doc: z.string().optional(),
  facture_id:    z.string().optional(),
  commande_id:   z.string().optional(),
  lignes: z.array(z.object({
    compte_syscohada: z.string().min(2),
    debit_xaf:        z.number().min(0).default(0),
    credit_xaf:       z.number().min(0).default(0),
  })).min(2),
})

const whatsappSchema = z.object({
  phone:   z.string().min(8),
  message: z.string().optional(),
})

const relanceFactureSchema = z.object({
  message: z.string().optional(),
})

const declarationStatutSchema = z.object({
  statut: z.enum(['a_declarer', 'soumis', 'valide']),
  notes:  z.string().optional(),
})

const preparerTvaSchema = z.object({
  periode: z.string().regex(/^\d{4}-\d{2}$/),
  notes:   z.string().optional(),
})

// ── Helpers financiers ─────────────────────────────────────────────────────────

/**
 * Recalcule encours_credit_xaf du client = somme des soldes_restant_xaf
 * sur tous ses crédits non remboursés.
 * Appelé après toute création ou remboursement de crédit.
 */
async function syncEncoursClient(clientId: string): Promise<void> {
  if (!clientId) return

  const { data } = await db
    .from('credits')
    .select('solde_restant_xaf')
    .eq('client_id', clientId)
    .in('statut', ['en_cours', 'echu'])

  const encours = ((data ?? []) as { solde_restant_xaf: number }[])
    .reduce((sum, c) => sum + (c.solde_restant_xaf ?? 0), 0)

  await db
    .from('clients')
    .update({ encours_credit_xaf: Math.round(encours), updated_at: new Date().toISOString() })
    .eq('id', clientId)
}

/**
 * Vérifie tous les crédits d'un client dont l'échéance est dépassée
 * et les passe en statut 'echu'. Renvoie le nombre de crédits échus.
 * Appelé en lecture pour maintenir l'état sans cron externe.
 */
async function autoEchoirCredits(clientId?: string): Promise<number> {
  const today = new Date().toISOString().slice(0, 10)

  let query = db
    .from('credits')
    .select('id, client_id')
    .eq('statut', 'en_cours')
    .lt('echeance', today)

  if (clientId) query = query.eq('client_id', clientId)

  const { data: expires } = await query
  if (!expires || expires.length === 0) return 0

  const ids = (expires as { id: string; client_id: string }[]).map(c => c.id)
  await db
    .from('credits')
    .update({ statut: 'echu', updated_at: new Date().toISOString() })
    .in('id', ids)

  // Recalculer les encours pour chaque client concerné
  const clientIds = [...new Set((expires as { client_id: string }[]).map(c => c.client_id))]
  await Promise.all(clientIds.map(cid => syncEncoursClient(cid)))

  console.info(`[finance] ${ids.length} crédit(s) passé(s) en statut 'echu'`)
  return ids.length
}

/**
 * Ajoute solde_restant_xaf calculé à chaque facture.
 * solde_restant = total_ttc - montant_paye (minimum 0).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function enrichirFacture(f: any): any {
  const solde = Math.max(0, (f.total_ttc_xaf ?? 0) - (f.montant_paye_xaf ?? 0))
  return { ...f, solde_restant_xaf: Math.round(solde) }
}

type PlanEntry = { compte: string; libelle: string; classe: number }
const PLAN_COMPTABLE = planComptable as PlanEntry[]

function findCompte(compte: string) {
  return PLAN_COMPTABLE.find((p) => p.compte === compte)
}

function validateDebitCredit(debit: number, credit: number) {
  return !((debit <= 0 && credit <= 0) || (debit > 0 && credit > 0))
}

function periodeRange(periode: string) {
  const [year, month] = periode.split('-').map(Number)
  const start = `${year}-${String(month).padStart(2, '0')}-01`
  const nextMonth = month === 12 ? 1 : month + 1
  const nextYear = month === 12 ? year + 1 : year
  const endDate = new Date(Date.UTC(nextYear, nextMonth - 1, 0)).toISOString().slice(0, 10)
  return { start, end: endDate, year, month }
}

function defaultDateRange(c: FinanceContext) {
  const now = new Date()
  const first = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString().slice(0, 10)
  const today = now.toISOString().slice(0, 10)
  return {
    from: c.req.query('from') ?? first,
    to:   c.req.query('to') ?? today,
  }
}

function escapeXml(value: unknown) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function xlsResponse(c: FinanceContext, filename: string, html: string) {
  c.header('Content-Type', 'application/vnd.ms-excel; charset=utf-8')
  c.header('Content-Disposition', `attachment; filename="${filename}"`)
  c.header('Cache-Control', 'no-store')
  return c.body('\ufeff' + html)
}

function tableHtml(title: string, headers: string[], rows: Array<Array<string | number>>) {
  return `
    <h2>${escapeXml(title)}</h2>
    <table border="1">
      <thead><tr>${headers.map((h) => `<th>${escapeXml(h)}</th>`).join('')}</tr></thead>
      <tbody>
        ${rows.map((row) => `<tr>${row.map((cell) => `<td>${escapeXml(cell)}</td>`).join('')}</tr>`).join('')}
      </tbody>
    </table>
  `
}

async function getFacturesPeriode(from: string, to: string) {
  const { data, error } = await db
    .from('factures')
    .select('id, numero, client_nom, statut, date_emission, date_echeance, total_ht_xaf, tva_xaf, frais_livraison_xaf, total_ttc_xaf, montant_paye_xaf')
    .neq('statut', 'annule')
    .gte('date_emission', from)
    .lte('date_emission', to)
    .order('date_emission', { ascending: true })

  if (error) throw new Error(error.message)
  return (data ?? []) as Array<{
    id: string
    numero: string
    client_nom: string
    statut: string
    date_emission: string
    date_echeance: string
    total_ht_xaf: number
    tva_xaf: number
    frais_livraison_xaf?: number | null
    total_ttc_xaf: number
    montant_paye_xaf: number
  }>
}

function calculerIndicateursFinance(factures: Awaited<ReturnType<typeof getFacturesPeriode>>) {
  const today = new Date().toISOString().slice(0, 10)
  const caFacture = factures.reduce((s, f) => s + Number(f.total_ttc_xaf ?? 0), 0)
  const encaisse = factures.reduce((s, f) => s + Number(f.montant_paye_xaf ?? 0), 0)
  const reste = factures.reduce((s, f) => s + Math.max(0, Number(f.total_ttc_xaf ?? 0) - Number(f.montant_paye_xaf ?? 0)), 0)
  const enRetard = factures.filter((f) =>
    !['paye', 'annule'].includes(f.statut) &&
    f.date_echeance < today &&
    Number(f.total_ttc_xaf ?? 0) > Number(f.montant_paye_xaf ?? 0),
  )

  return {
    ca_facture_xaf: Math.round(caFacture),
    encaisse_xaf:   Math.round(encaisse),
    reste_a_encaisser_xaf: Math.round(reste),
    factures_en_retard: enRetard.length,
    montant_retard_xaf: Math.round(enRetard.reduce((s, f) => s + Math.max(0, Number(f.total_ttc_xaf ?? 0) - Number(f.montant_paye_xaf ?? 0)), 0)),
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// FACTURES
// ══════════════════════════════════════════════════════════════════════════════

router.get('/finance/dashboard', requireRole(['admin', 'superviseur']), async (c) => {
  const [facturesRes, creditsRes, ecrituresRes] = await Promise.all([
    db.from('factures').select('id,numero,client_id,client_nom,statut,total_ttc_xaf,montant_paye_xaf,date_emission,date_echeance,created_at').neq('statut', 'annule'),
    db.from('credits').select('id,statut,solde_restant_xaf').neq('statut', 'rembourse'),
    db.from('ecritures_comptables').select('*').order('date', { ascending: false }).limit(200),
  ])

  if (facturesRes.error) return c.json({ error: facturesRes.error.message }, 500)
  if (creditsRes.error) return c.json({ error: creditsRes.error.message }, 500)
  if (ecrituresRes.error) return c.json({ error: ecrituresRes.error.message }, 500)

  type Fact = {
    id: string
    numero: string
    client_id?: string | null
    client_nom: string
    statut: string
    total_ttc_xaf: number
    montant_paye_xaf: number
    date_emission?: string | null
    date_echeance?: string | null
  }
  type Credit = { solde_restant_xaf: number }
  type Ecriture = { compte_syscohada: string; debit_xaf: number; credit_xaf: number }

  const factures = (facturesRes.data ?? []) as Fact[]
  const credits = (creditsRes.data ?? []) as Credit[]
  const ecritures = (ecrituresRes.data ?? []) as Ecriture[]
  const caFacture = factures.reduce((s, f) => s + Number(f.total_ttc_xaf ?? 0), 0)
  const encaisse = factures.reduce((s, f) => s + Number(f.montant_paye_xaf ?? 0), 0)
  const aRecevoir = factures.reduce((s, f) => s + Math.max(0, Number(f.total_ttc_xaf ?? 0) - Number(f.montant_paye_xaf ?? 0)), 0)
  const aRelancer = factures.filter((f) => ['valide', 'envoye'].includes(f.statut) && Number(f.total_ttc_xaf ?? 0) > Number(f.montant_paye_xaf ?? 0))
  const today = new Date().toISOString().slice(0, 10)
  const enRetard = factures.filter((f) =>
    !['paye', 'annule'].includes(f.statut) &&
    Boolean(f.date_echeance) &&
    String(f.date_echeance) < today &&
    Number(f.total_ttc_xaf ?? 0) > Number(f.montant_paye_xaf ?? 0),
  )
  const topClientsMap = new Map<string, { client_id: string | null; client_nom: string; solde_xaf: number; factures: number }>()
  for (const facture of factures) {
    const solde = Math.max(0, Number(facture.total_ttc_xaf ?? 0) - Number(facture.montant_paye_xaf ?? 0))
    if (solde <= 0) continue
    const key = facture.client_id ?? facture.client_nom
    const row = topClientsMap.get(key) ?? {
      client_id: facture.client_id ?? null,
      client_nom: facture.client_nom,
      solde_xaf: 0,
      factures: 0,
    }
    row.solde_xaf += solde
    row.factures += 1
    topClientsMap.set(key, row)
  }
  const brouillons = factures.filter((f) => f.statut === 'brouillon')
  const banqueCaisse = ecritures
    .filter((e) => ['521', '571'].includes(e.compte_syscohada))
    .reduce((s, e) => s + Number(e.debit_xaf ?? 0) - Number(e.credit_xaf ?? 0), 0)

  return c.json({
    kpis: {
      ca_facture_xaf:      Math.round(caFacture),
      encaisse_xaf:        Math.round(encaisse),
      a_recevoir_xaf:      Math.round(aRecevoir),
      banque_caisse_xaf:   Math.round(banqueCaisse),
      taux_encaissement:   caFacture > 0 ? Math.round((encaisse / caFacture) * 100) : 0,
      factures_total:      factures.length,
      factures_brouillon:  brouillons.length,
      factures_a_relancer: aRelancer.length,
      factures_en_retard:  enRetard.length,
      montant_retard_xaf:  Math.round(enRetard.reduce((s, f) => s + Math.max(0, Number(f.total_ttc_xaf ?? 0) - Number(f.montant_paye_xaf ?? 0)), 0)),
      credits_ouverts:     credits.length,
      credits_solde_xaf:   Math.round(credits.reduce((s, credit) => s + Number(credit.solde_restant_xaf ?? 0), 0)),
    },
    repartition_factures: ['brouillon', 'valide', 'envoye', 'paye'].map((statut) => ({
      statut,
      count: factures.filter((f) => f.statut === statut).length,
    })),
    factures_en_retard: enRetard
      .map((f) => ({
        id: f.id,
        numero: f.numero,
        client_nom: f.client_nom,
        date_echeance: f.date_echeance,
        solde_restant_xaf: Math.round(Math.max(0, Number(f.total_ttc_xaf ?? 0) - Number(f.montant_paye_xaf ?? 0))),
      }))
      .sort((a, b) => String(a.date_echeance).localeCompare(String(b.date_echeance)))
      .slice(0, 8),
    top_clients_debiteurs: Array.from(topClientsMap.values())
      .map((row) => ({ ...row, solde_xaf: Math.round(row.solde_xaf) }))
      .sort((a, b) => b.solde_xaf - a.solde_xaf)
      .slice(0, 8),
    dernieres_ecritures: ecrituresRes.data ?? [],
  })
})

router.get('/finance/indicateurs', requireRole(['admin', 'superviseur']), async (c) => {
  const { from, to } = defaultDateRange(c)
  try {
    const factures = await getFacturesPeriode(from, to)
    return c.json({ periode: { from, to }, ...calculerIndicateursFinance(factures) })
  } catch (error) {
    return c.json({ error: (error as Error).message }, 500)
  }
})

router.get('/declarations-fiscales', requireRole(['admin', 'superviseur']), async (c) => {
  const { type, statut } = c.req.query()
  let q = db.from('declarations_fiscales').select('*', { count: 'exact' })
  if (type) q = q.eq('type', type)
  if (statut) q = q.eq('statut', statut)

  const { data, count, error } = await q.order('periode', { ascending: false })
  if (error) return c.json({ error: error.message }, 500)
  return c.json({ data: data ?? [], total: count ?? 0 })
})

router.post('/declarations-fiscales/tva/preparer', requireRole(['admin']), zValidator('json', preparerTvaSchema), async (c) => {
  const body = c.req.valid('json')
  const { start, end, year, month } = periodeRange(body.periode)
  const echeance = new Date(Date.UTC(month === 12 ? year + 1 : year, month === 12 ? 0 : month, 15)).toISOString().slice(0, 10)

  try {
    const factures = await getFacturesPeriode(start, end)
    const montantTva = Math.round(factures.reduce((s, f) => s + Number(f.tva_xaf ?? 0), 0))
    const indicateurs = calculerIndicateursFinance(factures)

    const { data, error } = await db
      .from('declarations_fiscales')
      .upsert({
        type:        'TVA',
        periode:     body.periode,
        statut:      'a_declarer',
        montant_xaf: montantTva,
        echeance,
        notes:       body.notes ?? `TVA calculee sur ${factures.length} facture(s), du ${start} au ${end}.`,
        updated_at:  new Date().toISOString(),
        sync_status: 'synced',
      }, { onConflict: 'type,periode' })
      .select()
      .single()

    if (error) return c.json({ error: error.message }, 500)
    return c.json({ data, periode: { from: start, to: end }, indicateurs }, 201)
  } catch (error) {
    return c.json({ error: (error as Error).message }, 500)
  }
})

router.patch('/declarations-fiscales/:id/statut', requireRole(['admin']), zValidator('json', declarationStatutSchema), async (c) => {
  const { id } = c.req.param()
  const user = c.get('user')
  const body = c.req.valid('json')

  const updates: Record<string, unknown> = {
    statut:     body.statut,
    notes:      body.notes,
    updated_at: new Date().toISOString(),
  }
  if (body.statut === 'soumis') updates.soumis_le = new Date().toISOString()
  if (body.statut === 'valide') updates.valide_by = user.id

  const { data, error } = await db
    .from('declarations_fiscales')
    .update(updates)
    .eq('id', id)
    .select()
    .single()

  if (error) return c.json({ error: error.message }, 400)
  return c.json(data)
})

router.get('/finance/exports/indicateurs.xls', requireRole(['admin', 'superviseur']), async (c) => {
  const { from, to } = defaultDateRange(c)
  try {
    const factures = await getFacturesPeriode(from, to)
    const indicateurs = calculerIndicateursFinance(factures)
    const rows = factures.map((f) => {
      const solde = Math.max(0, Number(f.total_ttc_xaf ?? 0) - Number(f.montant_paye_xaf ?? 0))
      const retard = f.date_echeance < new Date().toISOString().slice(0, 10) && solde > 0 && f.statut !== 'paye'
      return [
        f.numero,
        f.client_nom,
        f.statut,
        f.date_emission,
        f.date_echeance,
        Math.round(Number(f.total_ht_xaf ?? 0)),
        Math.round(Number(f.tva_xaf ?? 0)),
        Math.round(Number(f.frais_livraison_xaf ?? 0)),
        Math.round(Number(f.total_ttc_xaf ?? 0)),
        Math.round(Number(f.montant_paye_xaf ?? 0)),
        Math.round(solde),
        retard ? 'Oui' : 'Non',
      ]
    })

    const html = `
      <html><head><meta charset="utf-8" /></head><body>
        <h1>Rapport Finance - Indicateurs</h1>
        <p>Periode : ${escapeXml(from)} au ${escapeXml(to)} | Devise : XAF | Genere le : ${escapeXml(new Date().toISOString().slice(0, 10))}</p>
        ${tableHtml('Resume', ['Indicateur', 'Description', 'Valeur'], [
          ['Chiffre d’affaires facture', 'Total TTC des factures non annulees sur la periode', indicateurs.ca_facture_xaf],
          ['Chiffre d’affaires encaisse', 'Somme des montants payes sur ces factures', indicateurs.encaisse_xaf],
          ['Reste a encaisser', 'Total TTC moins montant deja paye', indicateurs.reste_a_encaisser_xaf],
          ['Factures en retard', 'Factures non payees dont echeance depassee', indicateurs.factures_en_retard],
          ['Montant en retard', 'Solde restant des factures en retard', indicateurs.montant_retard_xaf],
        ])}
        ${tableHtml('Detail factures', ['Numero', 'Client', 'Statut', 'Emission', 'Echeance', 'HT produits', 'TVA', 'Livraison hors TVA', 'TTC', 'Encaisse', 'Reste', 'En retard'], rows)}
      </body></html>
    `
    return xlsResponse(c, `rapport-finance-${from}-${to}.xls`, html)
  } catch (error) {
    return c.json({ error: (error as Error).message }, 500)
  }
})

router.get('/finance/exports/tva.xls', requireRole(['admin', 'superviseur']), async (c) => {
  const periode = c.req.query('periode') ?? new Date().toISOString().slice(0, 7)
  const { start, end } = periodeRange(periode)
  try {
    const factures = await getFacturesPeriode(start, end)
    const totalHt = Math.round(factures.reduce((s, f) => s + Number(f.total_ht_xaf ?? 0), 0))
    const totalTva = Math.round(factures.reduce((s, f) => s + Number(f.tva_xaf ?? 0), 0))
    const totalLivraison = Math.round(factures.reduce((s, f) => s + Number(f.frais_livraison_xaf ?? 0), 0))
    const totalTtc = Math.round(factures.reduce((s, f) => s + Number(f.total_ttc_xaf ?? 0), 0))

    const html = `
      <html><head><meta charset="utf-8" /></head><body>
        <h1>Rapport TVA</h1>
        <p>Periode fiscale : ${escapeXml(periode)} | Du ${escapeXml(start)} au ${escapeXml(end)} | Taux : 19,25 %</p>
        ${tableHtml('Resume TVA', ['Rubrique', 'Annotation', 'Montant XAF'], [
          ['Base taxable HT', 'Somme des produits/prestations HT factures', totalHt],
          ['TVA collectee', 'TVA calculee uniquement sur la base taxable HT', totalTva],
          ['Livraison hors TVA', 'Frais de livraison ajoutes apres TVA', totalLivraison],
          ['Total TTC facture', 'HT + TVA + livraison', totalTtc],
        ])}
        ${tableHtml('Detail TVA par facture', ['Numero', 'Client', 'Emission', 'Statut', 'Base HT', 'TVA', 'Livraison hors TVA', 'TTC'], factures.map((f) => [
          f.numero,
          f.client_nom,
          f.date_emission,
          f.statut,
          Math.round(Number(f.total_ht_xaf ?? 0)),
          Math.round(Number(f.tva_xaf ?? 0)),
          Math.round(Number(f.frais_livraison_xaf ?? 0)),
          Math.round(Number(f.total_ttc_xaf ?? 0)),
        ]))}
      </body></html>
    `
    return xlsResponse(c, `rapport-tva-${periode}.xls`, html)
  } catch (error) {
    return c.json({ error: (error as Error).message }, 500)
  }
})

router.get('/factures', async (c) => {
  const { statut, client_id, search } = c.req.query()
  const page    = Math.max(1, parseInt(c.req.query('page') ?? '1'))
  const perPage = Math.min(100, parseInt(c.req.query('per_page') ?? '20'))
  const from    = (page - 1) * perPage

  let q = db.from('factures').select('*, factures_lignes(*)', { count: 'exact' })
  if (statut)    q = q.eq('statut', statut)
  if (client_id) q = q.eq('client_id', client_id)
  if (search)    q = q.or(`numero.ilike.%${search}%,client_nom.ilike.%${search}%`)

  const { data, count, error } = await q.order('created_at', { ascending: false }).range(from, from + perPage - 1)
  if (error) {
    console.warn('[finance] GET /factures Supabase error — tentative fallback SQLite:', error.message)
    const local = getFacturesLocal({ statut })
    if (local.data.length > 0) return c.json(local)
    return c.json({ error: error.message }, 500)
  }

  // Enrichir chaque facture avec solde_restant_xaf
  return c.json({
    data:        (data ?? []).map(enrichirFacture),
    total:       count ?? 0,
    page,
    per_page:    perPage,
    total_pages: Math.ceil((count ?? 0) / perPage),
  })
})

router.post('/factures', requireRole(['admin']), zValidator('json', factureSchema), async (c) => {
  const user = c.get('user')
  const body = c.req.valid('json')

  const result = await withOfflineFallback(
    'POST /factures',

    // ── Online : Supabase ──────────────────────────────────────────────────────
    async () => {
      if (body.commande_id) {
        const { count: existing } = await db.from('factures')
          .select('*', { count: 'exact', head: true })
          .eq('commande_id', body.commande_id).neq('statut', 'annule')
        if ((existing ?? 0) > 0)
          throw Object.assign(new Error('Une facture existe déjà pour cette commande'), { code: 'ALREADY_INVOICED', httpStatus: 422 })
      }

      const year = new Date().getFullYear()
      const { count } = await db.from('factures').select('*', { count: 'exact', head: true })
        .gte('created_at', `${year}-01-01T00:00:00.000Z`)
      const numero = `FAC-${year}-${String((count ?? 0) + 1).padStart(4, '0')}`

      const total_ht_xaf  = Math.round(body.lignes.reduce((s, l) => s + l.quantite * l.prix_unitaire_ht_xaf, 0))
      const tva_xaf       = Math.round(total_ht_xaf * TVA_RATE)
      const total_ttc_xaf = total_ht_xaf + tva_xaf

      const { data: facture, error: facErr } = await db.from('factures')
        .insert({ numero, client_id: body.client_id ?? null, client_nom: body.client_nom,
          commande_id: body.commande_id ?? null, statut: 'brouillon',
          date_emission: body.date_emission, date_echeance: body.date_echeance,
          total_ht_xaf, tva_xaf, total_ttc_xaf, montant_paye_xaf: 0,
          notes: body.notes ?? null, created_by: user.id, sync_status: 'synced' })
        .select().single()

      if (facErr || !facture) throw new Error(facErr?.message ?? 'Erreur création facture')
      const facId = (facture as { id: string }).id

      const { data: lignesData, error: lignesErr } = await db.from('factures_lignes')
        .insert(body.lignes.map((l, i) => ({
          facture_id: facId, designation: l.designation, unite: l.unite,
          quantite: l.quantite, prix_unitaire_ht_xaf: l.prix_unitaire_ht_xaf,
          total_ht_xaf: Math.round(l.quantite * l.prix_unitaire_ht_xaf),
          ordre: l.ordre !== 0 ? l.ordre : i,
        }))).select()

      if (lignesErr) {
        await db.from('factures').delete().eq('id', facId)
        throw new Error(lignesErr.message)
      }

      let pdf_url: string | null = null
      try {
        const pdfBuf = await generateFacturePDF(
          { numero, date_emission: body.date_emission, date_echeance: body.date_echeance, total_ht_xaf, tva_xaf, total_ttc_xaf },
          { nom: body.client_nom }, (lignesData ?? []) as FactureLignePdf[],
        )
        pdf_url = await uploadPDF(pdfBuf, 'factures', `${numero}.pdf`)
      } catch (e) { console.error('[finance] PDF error:', e) }

      const fRow = facture as { id: string; date_emission: string }
      genererEcritureVente({ id: fRow.id, numero, date_emission: fRow.date_emission,
        client_nom: body.client_nom, total_ht_xaf, tva_xaf, total_ttc_xaf, created_by: user.id,
      }).catch(e => console.error('[compta] vente:', e))

      return enrichirFacture({ ...facture, lignes: lignesData, pdf_url })
    },

    // ── Offline : SQLite local ─────────────────────────────────────────────────
    () => localCreateFacture({
      client_nom:    body.client_nom,
      client_id:     body.client_id,
      commande_id:   body.commande_id,
      date_emission: body.date_emission,
      date_echeance: body.date_echeance,
      lignes:        body.lignes,
      user_id:       user.id,
    }),
  )

  return c.json(result, 201)
})

router.get('/factures/:id', async (c) => {
  const { id } = c.req.param()
  const { data, error } = await db.from('factures').select('*, factures_lignes(*)').eq('id', id).single()
  if (error || !data) return c.json({ error: 'Facture introuvable', code: 'NOT_FOUND' }, 404)

  const f = data as { numero: string }
  const pdf_url = db.storage.from('factures').getPublicUrl(`${f.numero}.pdf`).data.publicUrl
  return c.json(enrichirFacture({ ...data, pdf_url }))
})

router.get('/factures/:id/pdf', async (c) => {
  const { id } = c.req.param()
  const { data: facture, error } = await db
    .from('factures').select('*, factures_lignes(*)').eq('id', id).single()
  if (error || !facture) return c.json({ error: 'Facture introuvable', code: 'NOT_FOUND' }, 404)

  const f = facture as { numero: string; client_nom: string; date_emission: string; date_echeance: string; total_ht_xaf: number; tva_xaf: number; total_ttc_xaf: number; factures_lignes: FactureLignePdf[] }

  // Essayer Supabase Storage d'abord
  try {
    const { data: blob } = await db.storage.from('factures').download(`${f.numero}.pdf`)
    if (blob) {
      c.header('Content-Type', 'application/pdf')
      c.header('Content-Disposition', `inline; filename="${f.numero}.pdf"`)
      c.header('Cache-Control', 'private, max-age=3600')
      return c.body(await blob.arrayBuffer())
    }
  } catch { /* PDF absent dans Storage — régénérer */ }

  // Régénération à la volée si absent dans Storage
  const buf = await generateFacturePDF(
    { numero: f.numero, date_emission: f.date_emission, date_echeance: f.date_echeance, total_ht_xaf: f.total_ht_xaf, tva_xaf: f.tva_xaf, total_ttc_xaf: f.total_ttc_xaf },
    { nom: f.client_nom },
    f.factures_lignes,
  )

  c.header('Content-Type', 'application/pdf')
  c.header('Content-Disposition', `inline; filename="${f.numero}.pdf"`)
  return c.body(buf.buffer as ArrayBuffer)
})

/**
 * PATCH /factures/:id/statut — transitions de statut avec validation.
 * Les factures annulées sont immuables : aucun changement de statut possible.
 * Quand une facture passe à 'paye', montant_paye_xaf est mis à jour.
 */
router.patch(
  '/factures/:id/statut',
  requireRole(['admin']),
  zValidator('json', z.object({
    statut: z.enum(['brouillon', 'valide', 'envoye', 'paye', 'annule']),
    montant_paye_xaf: z.number().min(0).optional(),
  })),
  async (c) => {
    const { id }  = c.req.param()
    const body    = c.req.valid('json')

    const { data: existing } = await db
      .from('factures')
      .select('statut, total_ttc_xaf, montant_paye_xaf, client_id')
      .eq('id', id)
      .single()

    if (!existing) return c.json({ error: 'Facture introuvable', code: 'NOT_FOUND' }, 404)

    const ex = existing as { statut: string; total_ttc_xaf: number; montant_paye_xaf: number; client_id: string | null }

    // Bloquer toute transition sur une facture annulée
    if (ex.statut === 'annule') {
      return c.json({
        error: 'Facture annulée — aucune modification de statut possible',
        code:  'ANNULE_IMMUTABLE',
      }, 422)
    }

    const updates: Record<string, unknown> = {
      statut:     body.statut,
      updated_at: new Date().toISOString(),
    }

    // Si la facture passe à 'paye', on met à jour montant_paye_xaf au total
    if (body.statut === 'paye') {
      updates.montant_paye_xaf = body.montant_paye_xaf ?? ex.total_ttc_xaf
    }

    const { data, error } = await db
      .from('factures')
      .update(updates)
      .eq('id', id)
      .select('*, factures_lignes(*)')
      .single()

    if (error) return c.json({ error: error.message }, 400)
    return c.json(enrichirFacture(data))
  }
)

/**
 * POST /factures/:id/paiement — Enregistrer un paiement partiel ou total.
 * Met à jour montant_paye_xaf et calcule le solde restant.
 * Génère l'écriture d'encaissement SYSCOHADA.
 */
router.post(
  '/factures/:id/paiement',
  requireRole(['admin']),
  zValidator('json', z.object({
    montant_xaf:   z.number().positive(),
    date_paiement: z.string(),
    mode:          z.enum(['banque', 'caisse']).default('banque'),
    notes:         z.string().optional(),
  })),
  async (c) => {
    const { id } = c.req.param()
    const user   = c.get('user')
    const body   = c.req.valid('json')

    const { data: facture } = await db
      .from('factures')
      .select('statut, total_ttc_xaf, montant_paye_xaf, numero, client_nom, client_id')
      .eq('id', id)
      .single()

    if (!facture) return c.json({ error: 'Facture introuvable', code: 'NOT_FOUND' }, 404)

    const f = facture as { statut: string; total_ttc_xaf: number; montant_paye_xaf: number; numero: string; client_nom: string; client_id: string | null }

    if (f.statut === 'annule') {
      return c.json({ error: 'Facture annulée — paiements bloqués', code: 'ANNULE_IMMUTABLE' }, 422)
    }

    const soldeActuel   = Math.max(0, f.total_ttc_xaf - f.montant_paye_xaf)
    if (body.montant_xaf > soldeActuel) {
      return c.json({
        error: `Montant (${xaf(body.montant_xaf)}) dépasse le solde restant (${xaf(soldeActuel)})`,
        code:  'AMOUNT_EXCEEDED',
      }, 422)
    }

    const nouveauPaye   = Math.round(f.montant_paye_xaf + body.montant_xaf)
    const nouveauSolde  = Math.max(0, f.total_ttc_xaf - nouveauPaye)
    const nouveauStatut = nouveauSolde <= 0 ? 'paye' : (f.statut === 'valide' || f.statut === 'envoye' ? f.statut : 'envoye')

    const { data, error } = await db
      .from('factures')
      .update({
        montant_paye_xaf: nouveauPaye,
        statut:           nouveauStatut,
        updated_at:       new Date().toISOString(),
      })
      .eq('id', id)
      .select()
      .single()

    if (error) return c.json({ error: error.message }, 400)

    // Écriture comptable Dr 521/571 Banque/Caisse / Cr 411 Clients
    genererEcritureEncaissement({
      facture_id:  id,
      reference:   f.numero,
      date:        body.date_paiement,
      montant_xaf: body.montant_xaf,
      client_nom:  f.client_nom,
      mode:        body.mode,
      created_by:  user.id,
    }).catch(e => console.error('[compta] encaissement facture:', e))

    return c.json(enrichirFacture({
      ...data,
      message:         `Paiement de ${xaf(body.montant_xaf)} enregistré`,
      solde_restant_xaf: nouveauSolde,
    }))
  }
)

router.post('/factures/:id/whatsapp', requireRole(['admin']), zValidator('json', whatsappSchema), async (c) => {
  const { id } = c.req.param()
  const body   = c.req.valid('json')

  const { data: facture } = await db.from('factures').select('numero, client_nom, total_ttc_xaf').eq('id', id).single()
  if (!facture) return c.json({ error: 'Facture introuvable', code: 'NOT_FOUND' }, 404)

  const f = facture as { numero: string; client_nom: string; total_ttc_xaf: number }
  const pdfUrl = db.storage.from('factures').getPublicUrl(`${f.numero}.pdf`).data.publicUrl

  const message = body.message ??
    `Bonjour,\nVeuillez trouver votre facture TAFDIL :\nN° ${f.numero}\nClient : ${f.client_nom}\nMontant TTC : ${xaf(f.total_ttc_xaf)}\nPDF : ${pdfUrl}`

  const apiKey = process.env.CALLMEBOT_APIKEY ?? ''
  if (!apiKey) return c.json({ error: 'CALLMEBOT_APIKEY non configuré', code: 'CONFIG_ERROR' }, 500)

  const waUrl = new URL('https://api.callmebot.com/whatsapp.php')
  waUrl.searchParams.set('phone', body.phone)
  waUrl.searchParams.set('text', message)
  waUrl.searchParams.set('apikey', apiKey)

  try {
    const res  = await fetch(waUrl.toString())
    const text = await res.text()
    if (!res.ok && !text.toLowerCase().includes('queued')) {
      return c.json({ error: 'Erreur CallMeBot', details: text }, 502)
    }
    return c.json({ success: true, phone: body.phone })
  } catch (err) {
    return c.json({ error: 'Erreur réseau WhatsApp', details: (err as Error).message }, 502)
  }
})

// ══════════════════════════════════════════════════════════════════════════════
// CRÉDITS
// ══════════════════════════════════════════════════════════════════════════════

router.post('/factures/:id/relance', requireRole(['admin', 'superviseur']), zValidator('json', relanceFactureSchema), async (c) => {
  const { id } = c.req.param()
  const user = c.get('user')
  const body = c.req.valid('json')

  const { data: facture, error } = await db
    .from('factures')
    .select('id, numero, client_id, client_nom, total_ttc_xaf, montant_paye_xaf, date_echeance, statut')
    .eq('id', id)
    .single()

  if (error || !facture) return c.json({ error: 'Facture introuvable', code: 'NOT_FOUND' }, 404)

  const f = facture as {
    id: string
    numero: string
    client_id: string | null
    client_nom: string
    total_ttc_xaf: number
    montant_paye_xaf: number
    date_echeance: string
    statut: string
  }

  if (['paye', 'annule'].includes(f.statut)) {
    return c.json({ error: 'Cette facture ne necessite pas de relance', code: 'RELANCE_NOT_ALLOWED' }, 422)
  }

  let telephone: string | null = null
  if (f.client_id) {
    const { data: client } = await db.from('clients').select('telephone').eq('id', f.client_id).maybeSingle()
    telephone = (client as { telephone?: string | null } | null)?.telephone ?? null
  }

  const solde = Math.max(0, Number(f.total_ttc_xaf ?? 0) - Number(f.montant_paye_xaf ?? 0))
  const message = body.message ??
    `Bonjour ${f.client_nom},\n\nNous vous relancons concernant la facture TAFDIL ${f.numero}.\nMontant restant a regler : ${xaf(solde)}.\nEcheance : ${f.date_echeance}.\n\nMerci de proceder au reglement ou de nous contacter en cas de besoin.\n\nTAFDIL SARL`

  const encoded = encodeURIComponent(message)
  const waUrl = telephone
    ? `https://wa.me/${telephone.replace(/\D/g, '')}?text=${encoded}`
    : `https://wa.me/?text=${encoded}`

  const { error: relanceError } = await db.from('relances_factures').insert({
    facture_id:  f.id,
    client_id:   f.client_id,
    canal:       'whatsapp',
    message,
    statut:      'preparee',
    relance_par: user.id,
  })
  if (relanceError) console.error('[finance] relance facture:', relanceError)

  return c.json({ url: waUrl, telephone, message, solde_restant_xaf: Math.round(solde) })
})

router.get('/credits/alertes', async (c) => {
  // Auto-échoir les crédits dépassés avant de renvoyer les alertes
  await autoEchoirCredits()

  const today  = new Date()
  const in7j   = new Date(today.getTime() + 7 * 86400000).toISOString().slice(0, 10)
  const todayS = today.toISOString().slice(0, 10)

  const { data, error } = await db
    .from('credits')
    .select('*')
    .or(`statut.eq.echu,and(statut.eq.en_cours,echeance.lte.${in7j})`)
    .order('echeance')

  if (error) return c.json({ error: error.message }, 500)

  type CR = { statut: string; echeance: string; solde_restant_xaf: number }
  const cr = (data ?? []) as CR[]

  return c.json({
    data,
    total:              cr.length,
    echus:              cr.filter(x => x.statut === 'echu').length,
    expires_bientot:    cr.filter(x => x.statut === 'en_cours' && x.echeance <= in7j && x.echeance > todayS).length,
    montant_total_xaf:  Math.round(cr.reduce((s, x) => s + x.solde_restant_xaf, 0)),
  })
})

router.get('/credits', async (c) => {
  // Auto-échoir en arrière-plan avant de lire
  autoEchoirCredits().catch(e => console.error('[finance] autoEchoirCredits:', e))

  const { statut, client_id } = c.req.query()
  const page    = Math.max(1, parseInt(c.req.query('page') ?? '1'))
  const perPage = Math.min(100, parseInt(c.req.query('per_page') ?? '20'))
  const from    = (page - 1) * perPage

  let q = db.from('credits').select('*', { count: 'exact' })
  if (statut)    q = q.eq('statut', statut)
  if (client_id) q = q.eq('client_id', client_id)

  const { data, count, error } = await q.order('echeance').range(from, from + perPage - 1)
  if (error) {
    console.warn('[finance] GET /credits Supabase error — tentative fallback SQLite:', error.message)
    const local = getCreditsLocal({ statut })
    if (local.data.length > 0) return c.json(local)
    return c.json({ error: error.message }, 500)
  }

  return c.json({ data, total: count ?? 0, page, per_page: perPage, total_pages: Math.ceil((count ?? 0) / perPage) })
})

router.post('/credits', requireRole(['admin']), zValidator('json', creditSchema), async (c) => {
  const user = c.get('user')
  const body = c.req.valid('json')

  const result = await withOfflineFallback(
    'POST /credits',

    // ── Online : Supabase ──────────────────────────────────────────────────────
    async () => {
      const year = new Date().getFullYear()
      const { count } = await db.from('credits').select('*', { count: 'exact', head: true })
        .gte('created_at', `${year}-01-01T00:00:00.000Z`)
      const numero = `CRD-${year}-${String((count ?? 0) + 1).padStart(4, '0')}`

      const { data, error } = await db.from('credits')
        .insert({ numero, client_id: body.client_id ?? null, client_nom: body.client_nom,
          commande_id: body.commande_id ?? null, montant_xaf: body.montant_xaf,
          solde_restant_xaf: body.montant_xaf, date_debut: body.date_debut,
          echeance: body.echeance, statut: 'en_cours',
          notes: body.notes ?? null, created_by: user.id, sync_status: 'synced' })
        .select().single()

      if (error) throw new Error(error.message)

      if (body.client_id)
        syncEncoursClient(body.client_id).catch(e => console.error('[finance] syncEncoursClient:', e))

      return data
    },

    // ── Offline : SQLite local ─────────────────────────────────────────────────
    () => localCreateCredit({
      client_nom:  body.client_nom,
      client_id:   body.client_id,
      commande_id: body.commande_id,
      montant_xaf: body.montant_xaf,
      date_debut:  body.date_debut,
      echeance:    body.echeance,
      notes:       body.notes,
      user_id:     user.id,
    }),
  )

  return c.json(result, 201)
})

router.get('/credits/:id', async (c) => {
  const { id } = c.req.param()
  const { data, error } = await db.from('credits').select('*, remboursements_credit(*)').eq('id', id).single()
  if (error || !data) return c.json({ error: 'Crédit introuvable', code: 'NOT_FOUND' }, 404)

  // Auto-échoir si expiré
  const cr = data as { id: string; statut: string; echeance: string; client_id: string }
  const today = new Date().toISOString().slice(0, 10)
  if (cr.statut === 'en_cours' && cr.echeance < today) {
    await db.from('credits').update({ statut: 'echu', updated_at: new Date().toISOString() }).eq('id', id)
    ;(data as { statut: string }).statut = 'echu'
    await syncEncoursClient(cr.client_id)
  }

  return c.json(data)
})

router.put('/credits/:id', requireRole(['admin']), zValidator('json', creditSchema.partial()), async (c) => {
  const { id } = c.req.param()
  const body   = c.req.valid('json')

  const { data: existing } = await db.from('credits').select('statut, client_id').eq('id', id).single()
  if (!existing) return c.json({ error: 'Crédit introuvable', code: 'NOT_FOUND' }, 404)
  const ex = existing as { statut: string; client_id: string | null }
  if (ex.statut === 'rembourse') {
    return c.json({ error: 'Crédit remboursé — modification impossible', code: 'REMBOURSE_IMMUTABLE' }, 422)
  }

  const { data, error } = await db.from('credits')
    .update({ ...body, updated_at: new Date().toISOString() }).eq('id', id).select().single()
  if (error) return c.json({ error: error.message }, 400)
  if (!data)  return c.json({ error: 'Crédit introuvable', code: 'NOT_FOUND' }, 404)
  return c.json(data)
})

router.post('/credits/:id/rembourser', requireRole(['admin']), zValidator('json', rembourserSchema), async (c) => {
  const { id } = c.req.param()
  const user   = c.get('user')
  const body   = c.req.valid('json')

  const result = await withOfflineFallback(
    `POST /credits/${id}/rembourser`,

    // ── Online : Supabase ──────────────────────────────────────────────────────
    async () => {
      const { data: credit } = await db.from('credits')
        .select('solde_restant_xaf, statut, client_nom, client_id, numero').eq('id', id).single()

      if (!credit) throw Object.assign(new Error('Crédit introuvable'), { code: 'NOT_FOUND', httpStatus: 404 })
      const cr = credit as { solde_restant_xaf: number; statut: string; client_nom: string; client_id: string | null; numero: string }
      if (cr.statut === 'rembourse') throw Object.assign(new Error('Crédit déjà remboursé'), { code: 'ALREADY_DONE', httpStatus: 422 })
      if (body.montant_xaf > cr.solde_restant_xaf)
        throw Object.assign(new Error(`Montant dépasse le solde restant (${xaf(cr.solde_restant_xaf)})`), { code: 'AMOUNT_EXCEEDED', httpStatus: 422 })

      const { data: remb, error: rembErr } = await db.from('remboursements_credit')
        .insert({ credit_id: id, montant_xaf: body.montant_xaf, date_paiement: body.date_paiement,
          type: body.type, notes: body.notes ?? null, created_by: user.id })
        .select().single()

      if (rembErr) throw new Error(rembErr.message)

      const nouveauSolde  = Math.max(0, cr.solde_restant_xaf - body.montant_xaf)
      const nouveauStatut = nouveauSolde <= 0 ? 'rembourse' : 'en_cours'

      await db.from('credits').update({
        solde_restant_xaf: nouveauSolde, statut: nouveauStatut,
        updated_at: new Date().toISOString(),
      }).eq('id', id)

      if (cr.client_id) await syncEncoursClient(cr.client_id)

      genererEcritureEncaissement({ credit_id: id, reference: cr.numero,
        date: body.date_paiement, montant_xaf: body.montant_xaf,
        client_nom: cr.client_nom, created_by: user.id,
      }).catch(e => console.error('[compta] encaissement:', e))

      return { remboursement: remb, nouveau_solde_xaf: nouveauSolde, statut: nouveauStatut }
    },

    // ── Offline : SQLite local ─────────────────────────────────────────────────
    () => localRembourser({
      credit_id:     id,
      montant_xaf:   body.montant_xaf,
      date_paiement: body.date_paiement,
      type:          body.type,
      notes:         body.notes,
      user_id:       user.id,
    }),
  )

  return c.json(result)
})

// ── Reçu PDF après remboursement (Gap 3 CDC MOD-04) ──────────────────────────

router.get('/credits/:id/recu', async (c) => {
  const { id } = c.req.param()
  const rembId  = c.req.query('remboursement_id')

  const { data: credit } = await db
    .from('credits')
    .select('*, remboursements_credit(*)')
    .eq('id', id)
    .single()

  if (!credit) return c.json({ error: 'Crédit introuvable', code: 'NOT_FOUND' }, 404)

  type CR = { numero: string; client_nom: string; solde_restant_xaf: number; remboursements_credit: Array<{ id: string; montant_xaf: number; date_paiement: string; type: string; notes: string | null }> }
  const cr = credit as CR

  // Dernier remboursement ou celui spécifié
  const rembs = cr.remboursements_credit ?? []
  const remb  = rembId ? rembs.find(r => r.id === rembId) : rembs.at(-1)
  if (!remb) return c.json({ error: 'Aucun remboursement trouvé', code: 'NOT_FOUND' }, 404)

  const year  = new Date().getFullYear()
  const { count } = await db.from('remboursements_credit').select('*', { count: 'exact', head: true })
    .gte('created_at', `${year}-01-01T00:00:00.000Z`)
  const numero = `REC-${year}-${String((count ?? 1)).padStart(4, '0')}`

  const buf = await generateRecuPDF({
    numero,
    credit_numero:     cr.numero,
    client_nom:        cr.client_nom,
    date_paiement:     remb.date_paiement,
    montant_xaf:       remb.montant_xaf,
    solde_restant_xaf: cr.solde_restant_xaf,
    type:              remb.type as 'total' | 'partiel',
    notes:             remb.notes ?? undefined,
  })

  c.header('Content-Type', 'application/pdf')
  c.header('Content-Disposition', `inline; filename="${numero}.pdf"`)
  return c.body(buf.buffer as ArrayBuffer)
})

// ── Lien de relance WhatsApp wa.me (Gap 2 CDC MOD-04) ────────────────────────

router.get('/credits/:id/relance-url', async (c) => {
  const { id } = c.req.param()

  const { data: credit } = await db
    .from('credits')
    .select('numero, client_nom, client_id, solde_restant_xaf, echeance, statut')
    .eq('id', id).single()

  if (!credit) return c.json({ error: 'Crédit introuvable', code: 'NOT_FOUND' }, 404)

  type CR = { numero: string; client_nom: string; client_id: string | null; solde_restant_xaf: number; echeance: string; statut: string }
  const cr = credit as CR

  // Récupérer le téléphone du client si disponible
  let telephone: string | null = null
  if (cr.client_id) {
    const { data: client } = await db.from('clients').select('telephone').eq('id', cr.client_id).single()
    telephone = (client as { telephone?: string } | null)?.telephone ?? null
  }

  const solde = xaf(cr.solde_restant_xaf)
  const msg   = `Bonjour ${cr.client_nom},\n\nNous vous contactons concernant votre crédit TAFDIL n° ${cr.numero}.\n\nMontant restant dû : *${solde}*\nÉchéance : ${cr.echeance}\n\nMerci de procéder au règlement dans les meilleurs délais.\n\nCordialement,\nTAFDIL SARL — +237 695 884 528`

  const encoded = encodeURIComponent(msg)
  const waUrl   = telephone
    ? `https://wa.me/${telephone.replace(/\D/g, '')}?text=${encoded}`
    : `https://wa.me/?text=${encoded}`

  return c.json({ url: waUrl, telephone, message: msg })
})

// ── Upload / liste documents justificatifs d'un crédit (Gap 5 CDC MOD-04) ────

router.get('/credits/:id/documents', async (c) => {
  const { id } = c.req.param()
  const { data: docs, error } = await db
    .from('credit_documents')
    .select('*')
    .eq('credit_id', id)
    .order('created_at', { ascending: false })

  if (error) return c.json({ error: error.message }, 500)

  // Générer les URLs publiques
  type DocRow = { storage_path: string; [k: string]: unknown }
  const enriched = (docs ?? []).map((d: DocRow) => ({
    ...d,
    url: db.storage.from('credit-documents').getPublicUrl(d.storage_path).data.publicUrl,
  }))

  return c.json({ data: enriched })
})

router.post('/credits/:id/documents', requireRole(['admin']), async (c) => {
  const { id } = c.req.param()
  const user   = c.get('user')

  const formData = await c.req.formData()
  const file     = formData.get('file') as File | null
  if (!file) return c.json({ error: 'Fichier requis', code: 'MISSING_FILE' }, 400)

  const ext       = file.name.split('.').pop() ?? 'bin'
  const path      = `${id}/${Date.now()}.${ext}`
  const arrayBuf  = await file.arrayBuffer()
  const buf       = Buffer.from(arrayBuf)

  const { error: upErr } = await db.storage
    .from('credit-documents')
    .upload(path, buf, { contentType: file.type, upsert: false })

  if (upErr) return c.json({ error: upErr.message }, 500)

  const { data: doc, error: dbErr } = await db
    .from('credit_documents')
    .insert({
      credit_id:    id,
      nom_fichier:  file.name,
      storage_path: path,
      taille_bytes: buf.length,
      created_by:   user.id,
    })
    .select().single()

  if (dbErr) return c.json({ error: dbErr.message }, 500)

  const url = db.storage.from('credit-documents').getPublicUrl(path).data.publicUrl
  return c.json({ ...doc, url }, 201)
})

// ══════════════════════════════════════════════════════════════════════════════
// ÉCRITURES SYSCOHADA (saisie manuelle)
// ══════════════════════════════════════════════════════════════════════════════

router.get('/ecritures', requireRole(['admin', 'superviseur']), async (c) => {
  const { compte, mois, facture_id, commande_id } = c.req.query()
  const page    = Math.max(1, parseInt(c.req.query('page') ?? '1'))
  const perPage = Math.min(200, parseInt(c.req.query('per_page') ?? '100'))
  const from    = (page - 1) * perPage

  let q = db.from('ecritures_comptables').select('*', { count: 'exact' })
  if (compte)      q = q.eq('compte_syscohada', compte)
  if (facture_id)  q = q.eq('facture_id', facture_id)
  if (commande_id) q = q.eq('commande_id', commande_id)
  if (mois) {
    q = q.gte('date', `${mois}-01`)
    const end = new Date(`${mois}-01T00:00:00.000Z`)
    end.setUTCMonth(end.getUTCMonth() + 1)
    q = q.lt('date', end.toISOString().slice(0, 10))
  }

  const { data, count, error } = await q.order('date', { ascending: false }).range(from, from + perPage - 1)
  if (error) return c.json({ error: error.message }, 500)

  return c.json({
    data: (data ?? []).map((e) => ({
      ...e,
      compte:    (e as { compte_syscohada?: string }).compte_syscohada,
      solde_xaf: Number((e as { debit_xaf?: number }).debit_xaf ?? 0) - Number((e as { credit_xaf?: number }).credit_xaf ?? 0),
    })),
    total:       count ?? 0,
    page,
    per_page:    perPage,
    total_pages: Math.ceil((count ?? 0) / perPage),
  })
})

router.post('/ecritures', requireRole(['admin']), zValidator('json', ecritureSchema), async (c) => {
  const user = c.get('user')
  const body = c.req.valid('json')

  if (body.debit_xaf === 0 && body.credit_xaf === 0) {
    return c.json({ error: 'Débit ou crédit requis', code: 'INVALID_ENTRY' }, 422)
  }

  // Vérification équilibre débit/crédit non requise ici (écriture unique)
  // L'équilibre est vérifié au niveau du journal comptable (rapport bilan)

  if (!validateDebitCredit(body.debit_xaf, body.credit_xaf)) {
    return c.json({ error: 'Une ligne doit porter soit un debit soit un credit, pas les deux', code: 'INVALID_ENTRY' }, 422)
  }

  const compte = findCompte(body.compte_syscohada)
  if (!compte) return c.json({ error: 'Compte inexistant dans le plan comptable', code: 'UNKNOWN_ACCOUNT' }, 422)

  const { data, error } = await db
    .from('ecritures_comptables')
    .insert({ ...body, compte_label: compte.libelle, created_by: user.id, sync_status: 'synced' })
    .select().single()

  if (error) return c.json({ error: error.message, code: error.code }, 400)
  return c.json(data, 201)
})

// ══════════════════════════════════════════════════════════════════════════════
// RAPPORTS SYSCOHADA
// ══════════════════════════════════════════════════════════════════════════════

router.post('/ecritures/journal', requireRole(['admin']), zValidator('json', journalSchema), async (c) => {
  const user = c.get('user')
  const body = c.req.valid('json')
  const totalDebit = body.lignes.reduce((sum, ligne) => sum + Number(ligne.debit_xaf ?? 0), 0)
  const totalCredit = body.lignes.reduce((sum, ligne) => sum + Number(ligne.credit_xaf ?? 0), 0)

  if (Math.abs(totalDebit - totalCredit) > 1) {
    return c.json({
      error: 'Piece comptable non equilibree : total debit different du total credit',
      code: 'UNBALANCED_ENTRY',
      total_debit_xaf: Math.round(totalDebit),
      total_credit_xaf: Math.round(totalCredit),
    }, 422)
  }

  const reference = body.reference_doc ?? `${body.journal}-${Date.now()}`
  const lignes: Array<Record<string, unknown>> = []

  for (const ligne of body.lignes) {
    if (!validateDebitCredit(ligne.debit_xaf, ligne.credit_xaf)) {
      return c.json({ error: 'Chaque ligne doit porter soit un debit soit un credit, pas les deux', code: 'INVALID_ENTRY' }, 422)
    }

    const compte = findCompte(ligne.compte_syscohada)
    if (!compte) {
      return c.json({
        error: `Compte ${ligne.compte_syscohada} inexistant dans le plan comptable`,
        code: 'UNKNOWN_ACCOUNT',
      }, 422)
    }

    lignes.push({
      date: body.date,
      libelle: `[${body.journal}] ${body.libelle}`,
      compte_syscohada: ligne.compte_syscohada,
      compte_label: compte.libelle,
      debit_xaf: ligne.debit_xaf,
      credit_xaf: ligne.credit_xaf,
      reference_doc: reference,
      facture_id: body.facture_id ?? null,
      commande_id: body.commande_id ?? null,
      created_by: user.id,
      sync_status: 'synced',
    })
  }

  const { data, error } = await db
    .from('ecritures_comptables')
    .insert(lignes)
    .select()

  if (error) return c.json({ error: error.message, code: error.code }, 400)

  return c.json({
    data: data ?? [],
    total_lignes: lignes.length,
    total_debit_xaf: Math.round(totalDebit),
    total_credit_xaf: Math.round(totalCredit),
    equilibre: true,
  }, 201)
})

router.get('/rapports/bilan', requireRole(['admin', 'superviseur']), async (c) => {
  const exercice = c.req.query('exercice') ?? String(new Date().getFullYear())

  const { data: ecritures, error } = await db
    .from('ecritures_comptables')
    .select('compte_syscohada, compte_label, debit_xaf, credit_xaf')
    .gte('date', `${exercice}-01-01`)
    .lte('date', `${exercice}-12-31`)

  if (error) return c.json({ error: error.message }, 500)

  type EC = { compte_syscohada: string; compte_label: string; debit_xaf: number; credit_xaf: number }
  const comptes = new Map<string, { label: string; debit: number; credit: number }>()
  for (const e of (ecritures ?? []) as EC[]) {
    const ex = comptes.get(e.compte_syscohada) ?? { label: e.compte_label, debit: 0, credit: 0 }
    ex.debit  += e.debit_xaf
    ex.credit += e.credit_xaf
    comptes.set(e.compte_syscohada, ex)
  }

  const actif: object[] = [], passif: object[] = []
  for (const [compte, { label, debit, credit }] of comptes) {
    const classe = compte[0]
    const solde  = debit - credit
    const entry  = { compte, label, debit: Math.round(debit), credit: Math.round(credit), solde: Math.round(Math.abs(solde)) }
    if (['2', '3'].includes(classe) || (['4', '5'].includes(classe) && solde >= 0)) actif.push(entry)
    else if (classe === '1' || (['4', '5'].includes(classe) && solde < 0)) passif.push(entry)
  }

  const totalActif  = actif.reduce((s, e) => s + (e as { solde: number }).solde, 0)
  const totalPassif = passif.reduce((s, e) => s + (e as { solde: number }).solde, 0)

  return c.json({
    exercice,
    actif:            actif.sort((a, b) => (a as { compte: string }).compte.localeCompare((b as { compte: string }).compte)),
    passif:           passif.sort((a, b) => (a as { compte: string }).compte.localeCompare((b as { compte: string }).compte)),
    total_actif_xaf:  Math.round(totalActif),
    total_passif_xaf: Math.round(totalPassif),
    equilibre:        Math.abs(totalActif - totalPassif) < 1,
  })
})

router.get('/rapports/resultat', requireRole(['admin', 'superviseur']), async (c) => {
  const exercice = c.req.query('exercice') ?? String(new Date().getFullYear())

  const { data: ecritures, error } = await db
    .from('ecritures_comptables')
    .select('compte_syscohada, compte_label, debit_xaf, credit_xaf')
    .gte('date', `${exercice}-01-01`)
    .lte('date', `${exercice}-12-31`)

  if (error) return c.json({ error: error.message }, 500)

  type EC = { compte_syscohada: string; compte_label: string; debit_xaf: number; credit_xaf: number }
  const comptes = new Map<string, { label: string; debit: number; credit: number }>()
  for (const e of (ecritures ?? []) as EC[]) {
    const classe = e.compte_syscohada[0]
    if (!['6', '7'].includes(classe)) continue
    const ex = comptes.get(e.compte_syscohada) ?? { label: e.compte_label, debit: 0, credit: 0 }
    ex.debit  += e.debit_xaf
    ex.credit += e.credit_xaf
    comptes.set(e.compte_syscohada, ex)
  }

  const produits: object[] = [], charges: object[] = []
  for (const [compte, { label, debit, credit }] of comptes) {
    const classe  = compte[0]
    const montant = classe === '7' ? Math.round(credit) : Math.round(debit)
    const entry   = { compte, label, montant }
    if (classe === '7') produits.push(entry)
    if (classe === '6') charges.push(entry)
  }

  const totalProduits = produits.reduce((s, e) => s + (e as { montant: number }).montant, 0)
  const totalCharges  = charges.reduce((s, e) => s + (e as { montant: number }).montant, 0)
  const resultat      = totalProduits - totalCharges

  return c.json({
    exercice,
    produits:            produits.sort((a, b) => (a as { compte: string }).compte.localeCompare((b as { compte: string }).compte)),
    charges:             charges.sort((a, b) => (a as { compte: string }).compte.localeCompare((b as { compte: string }).compte)),
    total_produits_xaf:  Math.round(totalProduits),
    total_charges_xaf:   Math.round(totalCharges),
    resultat_net_xaf:    Math.round(resultat),
    beneficiaire:        resultat >= 0,
  })
})

// ── Dashboard KPIs ────────────────────────────────────────────────────────────

router.get('/rapports/dashboard', requireRole(['admin', 'superviseur', 'operateur', 'apprenant']), async (c) => {
  const maintenant = new Date()

  const debut6Mois = new Date(maintenant)
  debut6Mois.setMonth(debut6Mois.getMonth() - 5)
  debut6Mois.setDate(1)
  const debut6MoisStr = debut6Mois.toISOString().slice(0, 10)

  const [
    commandesMoisRes,
    commandesActifRes,
    alertesStockRes,
    apprenantsRes,
    bonsRes,
    creditsRes,
    recentCommandesRes,
    recentMouvementsRes,
  ] = await Promise.all([
    db.from('commandes')
      .select('total_ttc_xaf, date_commande')
      .gte('date_commande', debut6MoisStr)
      .neq('statut', 'cancelled'),
    db.from('commandes')
      .select('id', { count: 'exact', head: true })
      .in('statut', ['confirmed', 'in_production', 'pret']),
    db.from('produits')
      .select('id', { count: 'exact', head: true })
      .in('statut', ['alerte', 'critique', 'rupture']),
    db.from('apprenants')
      .select('id', { count: 'exact', head: true })
      .eq('statut', 'actif'),
    db.from('bons_sortie')
      .select('id', { count: 'exact', head: true })
      .eq('statut', 'soumis'),
    db.from('credits')
      .select('id', { count: 'exact', head: true })
      .eq('statut', 'echu'),
    db.from('commandes')
      .select('id, numero, client_nom, total_ttc_xaf, statut, date_commande')
      .order('created_at', { ascending: false })
      .limit(5),
    db.from('mouvements_stock')
      .select('id, type, quantite, created_at, produits(designation, unite)')
      .order('created_at', { ascending: false })
      .limit(5),
  ])

  const MOIS_FR = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Jui', 'Juil', 'Aoû', 'Sep', 'Oct', 'Nov', 'Déc']
  const caParMois = new Map<string, { label: string; ca: number }>()

  for (let i = 5; i >= 0; i--) {
    const d = new Date(maintenant)
    d.setMonth(d.getMonth() - i)
    const cle = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    caParMois.set(cle, { label: MOIS_FR[d.getMonth()], ca: 0 })
  }

  type CmdRow = { total_ttc_xaf: number; date_commande: string }
  for (const cmd of (commandesMoisRes.data ?? []) as CmdRow[]) {
    const cle = cmd.date_commande.slice(0, 7)
    const existing = caParMois.get(cle)
    if (existing) existing.ca += cmd.total_ttc_xaf
  }

  const ca_mensuel = Array.from(caParMois.values()).map(({ label, ca }) => ({
    mois: label,
    ca:   Math.round(ca),
  }))

  return c.json({
    ca_mensuel,
    kpis: {
      commandes_actives: commandesActifRes.count ?? 0,
      stocks_en_alerte:  alertesStockRes.count   ?? 0,
      apprenants_actifs: apprenantsRes.count      ?? 0,
      bons_en_attente:   bonsRes.count            ?? 0,
      credits_echus:     creditsRes.count         ?? 0,
    },
    recent_commandes:  recentCommandesRes.data  ?? [],
    recent_mouvements: recentMouvementsRes.data ?? [],
  })
})

export { router as financeRouter }
