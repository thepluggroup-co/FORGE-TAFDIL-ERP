import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { supabaseAdmin } from '@forge/db'

const db = supabaseAdmin!
import { requireRole } from '../middleware/rbac'
import { generateFacturePDF, generateRecuPDF, uploadPDF } from '../services/pdf.service'
import { genererEcritureVente, genererEcritureEncaissement } from '../services/comptabilite.service'
import { getFacturesLocal, getCreditsLocal, localCreateFacture, localCreateCredit, localRembourser } from '../services/db-local'
import { withOfflineFallback } from '../services/offline-fallback'
import type { HonoVariables } from '../types'

const router = new Hono<{ Variables: HonoVariables }>()
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

const whatsappSchema = z.object({
  phone:   z.string().min(8),
  message: z.string().optional(),
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

// ══════════════════════════════════════════════════════════════════════════════
// FACTURES
// ══════════════════════════════════════════════════════════════════════════════

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

router.post('/ecritures', requireRole(['admin']), zValidator('json', ecritureSchema), async (c) => {
  const user = c.get('user')
  const body = c.req.valid('json')

  if (body.debit_xaf === 0 && body.credit_xaf === 0) {
    return c.json({ error: 'Débit ou crédit requis', code: 'INVALID_ENTRY' }, 422)
  }

  // Vérification équilibre débit/crédit non requise ici (écriture unique)
  // L'équilibre est vérifié au niveau du journal comptable (rapport bilan)

  const { data, error } = await db
    .from('ecritures_comptables')
    .insert({ ...body, created_by: user.id, sync_status: 'synced' })
    .select().single()

  if (error) return c.json({ error: error.message, code: error.code }, 400)
  return c.json(data, 201)
})

// ══════════════════════════════════════════════════════════════════════════════
// RAPPORTS SYSCOHADA
// ══════════════════════════════════════════════════════════════════════════════

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
