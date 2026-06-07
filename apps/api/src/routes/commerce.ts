import { Hono } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { supabaseAdmin } from '@forge/db'
import { randomUUID } from 'node:crypto'

const db = supabaseAdmin!
import { requireRole } from '../middleware/rbac'
import { generateDevisPDF, uploadPDF } from '../services/pdf.service'
import { localCreateDevis, localCreateCommande, getClientsLocal, getCommandesLocal } from '../services/db-local'
import { withOfflineFallback } from '../services/offline-fallback'
import { notifyStatutChange } from '../services/notifications'
import { notifyCommandeSms } from '../services/sms.service'
import { enregistrerPaiementCommande } from '../services/finance-core.service'
import { enqueueEmail, notifyWhatsApp, sendEmailDirect } from '../services/email-queue.service'
import type { HonoVariables } from '../types'

// ── TVA Cameroun ────────────────────────────────────────────────────────────────
const TVA_RATE = 0.1925

// ── Machines d'état autorisées ──────────────────────────────────────────────────
const TRANSITIONS_COMMANDE: Record<string, string[]> = {
  confirmed:     ['in_production', 'cancelled'],
  in_production: ['pret', 'cancelled'],
  pret:          ['delivered', 'cancelled'],
  delivered:     [],
  cancelled:     [],
}

const TRANSITIONS_DEVIS: Record<string, string[]> = {
  brouillon: ['envoye', 'refuse', 'expire'],
  envoye:    ['accepte', 'refuse', 'expire'],
  accepte:   ['transforme'],
  refuse:    [],
  expire:    [],
  transforme:[],
}

// ── Routers ────────────────────────────────────────────────────────────────────
const router = new Hono<{ Variables: HonoVariables }>()
const publicRouter = new Hono()

// ══════════════════════════════════════════════════════════════════════════════
// SCHÉMAS ZOD
// ══════════════════════════════════════════════════════════════════════════════

const clientSchema = z.object({
  nom:              z.string().min(1).max(200),
  type:             z.enum(['entreprise', 'particulier', 'institution']),
  telephone:        z.string().optional(),
  email:            z.string().email().optional(),
  adresse:          z.string().optional(),
  ville:            z.string().optional(),
  pays:             z.string().default('Cameroun'),
  statut:           z.enum(['actif', 'inactif', 'bloque']).default('actif'),
  score_fiabilite:  z.number().int().min(0).max(100).default(50),
  notes:            z.string().optional(),
})

const devisLigneSchema = z.object({
  designation:          z.string().min(1),
  description:          z.string().optional(),
  categorie:            z.enum(['materiaux', 'main_oeuvre', 'equipement', 'autre']).default('materiaux'),
  unite:                z.string().default('unité'),
  quantite:             z.number().positive(),
  prix_unitaire_ht_xaf: z.number().min(0),
  ordre:                z.number().int().default(0),
})

const devisSchema = z.object({
  client_id:           z.string().optional(),
  client_nom:          z.string().min(1),
  date_emission:       z.string(),
  date_validite:       z.string(),
  validite_jours:      z.number().int().default(30),
  acompte_pct:         z.number().min(0).max(100).default(0),
  conditions_paiement: z.string().default('Virement bancaire'),
  notes:               z.string().optional(),
  lignes:              z.array(devisLigneSchema).min(1),
})

const commandeLigneSchema = z.object({
  produit_id:           z.string().optional(),
  designation:          z.string().min(1),
  unite:                z.string().default('unité'),
  quantite:             z.number().positive(),
  prix_unitaire_ht_xaf: z.number().min(0),
  ordre:                z.number().int().default(0),
})

const commandeSchema = z.object({
  client_id:              z.string().optional(),
  client_nom:             z.string().min(1),
  devis_id:               z.string().optional(),
  date_commande:          z.string(),
  date_livraison_prevue:  z.string().optional(),
  notes:                  z.string().optional(),
  acompte_recu_xaf:       z.number().min(0).default(0),
  condition_paiement_id:  z.string().uuid().optional(),
  lignes:                 z.array(commandeLigneSchema).min(1),
})

const statutCommandeSchema = z.object({
  statut:      z.enum(['confirmed', 'in_production', 'pret', 'delivered', 'cancelled']),
  commentaire: z.string().optional(),
})

// ── Helpers ────────────────────────────────────────────────────────────────────

function calculerTotaux(lignes: Array<{ quantite: number; prix_unitaire_ht_xaf: number }>) {
  const total_ht_xaf  = lignes.reduce((s, l) => s + l.quantite * l.prix_unitaire_ht_xaf, 0)
  const tva_xaf       = Math.round(total_ht_xaf * TVA_RATE)
  const total_ttc_xaf = Math.round(total_ht_xaf + tva_xaf)
  return { total_ht_xaf: Math.round(total_ht_xaf), tva_xaf, total_ttc_xaf }
}

/** Vérifie si un devis est expiré et le marque automatiquement. */
async function checkExpireDevis(devisId: string, dateValidite: string, statut: string): Promise<string> {
  if (['refuse', 'expire', 'transforme'].includes(statut)) return statut
  const today = new Date().toISOString().slice(0, 10)
  if (dateValidite < today && statut !== 'expire') {
    await db.from('devis').update({ statut: 'expire', updated_at: new Date().toISOString() }).eq('id', devisId)
    return 'expire'
  }
  return statut
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapDevis(row: any) {
  const cli   = row.clients as { id?: string; nom?: string; telephone?: string; email?: string } | null
  const today = new Date().toISOString().slice(0, 10)
  const jours_restants = row.date_validite
    ? Math.round((new Date(row.date_validite).getTime() - Date.now()) / 86400000)
    : null

  return {
    id:                   row.id,
    reference:            row.numero,
    statut:               row.statut,
    date_creation:        row.date_emission ?? row.created_at,
    date_validite:        row.date_validite,
    validite_jours:       row.validite_jours,
    acompte_pct:          row.acompte_pct,
    conditions_paiement:  row.conditions_paiement,
    total_ht_xaf:         row.total_ht_xaf ?? 0,
    tva_xaf:              row.tva_xaf ?? 0,
    montant_ttc_xaf:      row.total_ttc_xaf ?? 0,
    pdf_url:              row.pdf_url ?? null,
    notes:                row.notes ?? null,
    source_web:           typeof row.notes === 'string' && row.notes.startsWith('[SOURCE WEB]'),
    expire:               row.date_validite ? row.date_validite < today : false,
    jours_restants,
    approuve_par_client:  row.approuve_par_client ?? false,
    approuve_at:          row.approuve_at ?? null,
    commentaire_client:   row.commentaire_client ?? null,
    client: {
      id:        row.client_id ?? cli?.id ?? '',
      nom:       cli?.nom ?? row.client_nom ?? '',
      telephone: cli?.telephone ?? null,
      email:     cli?.email ?? null,
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    lignes: (row.devis_lignes ?? []).map((l: any) => ({
      id:                   l.id,
      designation:          l.designation,
      categorie:            (l.categorie as string).replace('_', '-'),
      quantite:             l.quantite,
      prix_unitaire_ht_xaf: l.prix_unitaire_ht_xaf,
      unite:                l.unite ?? 'unité',
    })),
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapCommande(row: any) {
  const cli = row.clients as { id?: string; nom?: string; telephone?: string } | null
  const totalTtc      = row.total_ttc_xaf ?? 0
  const montantPaye   = row.acompte_recu_xaf ?? 0
  const montantAcompte = row.montant_acompte ?? 0
  return {
    id:                      row.id,
    reference:               row.numero,
    statut:                  row.statut,
    date_commande:           row.date_commande,
    date_livraison_prevue:   row.date_livraison_prevue ?? null,
    montant_ttc_xaf:         totalTtc,
    acompte_recu_xaf:        montantPaye,
    solde_restant_xaf:       Math.max(0, totalTtc - montantPaye),
    condition_paiement_id:   row.condition_paiement_id ?? null,
    condition_paiement:      row.conditions_paiement ?? null,
    montant_acompte:         montantAcompte,
    date_echeance_solde:     row.date_echeance_solde ?? null,
    statut_paiement:         row.statut_paiement ?? 'non_paye',
    notes:                   row.notes ?? null,
    client: {
      id:        row.client_id ?? '',
      nom:       cli?.nom ?? row.client_nom ?? '',
      telephone: cli?.telephone ?? '',
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    lignes: (row.commandes_lignes ?? []).map((l: any) => ({
      designation:          l.designation,
      quantite:             l.quantite,
      prix_unitaire_ht_xaf: l.prix_unitaire_ht_xaf,
      unite:                l.unite ?? 'unité',
    })),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    historique: (row.historique_commandes ?? []).map((h: any) => ({
      statut:      h.nouveau_statut,
      created_at:  h.changed_at ?? h.created_at,
      commentaire: h.commentaire ?? null,
    })).sort((a: { created_at: string }, b: { created_at: string }) =>
      new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    ),
  }
}

async function genererNumero(table: string, prefix: string): Promise<string> {
  const today = new Date()
  const yyyymmdd = today.toISOString().slice(0, 10).replace(/-/g, '')
  const startOfDay = `${today.toISOString().slice(0, 10)}T00:00:00.000Z`

  const { count } = await db
    .from(table)
    .select('*', { count: 'exact', head: true })
    .gte('created_at', startOfDay)

  return `${prefix}-${yyyymmdd}-${String((count ?? 0) + 1).padStart(4, '0')}`
}

/**
 * Crée automatiquement un bon de sortie lors du passage d'une commande
 * en statut 'in_production'. Vérifie la disponibilité du stock pour chaque
 * ligne — le résultat est logué mais ne bloque pas la transition.
 */
async function creerBonSortieCommande(
  commandeId: string,
  commandeNumero: string,
  userId: string,
): Promise<boolean> {
  // 1. Récupérer les lignes de la commande
  const { data: lignes, error: lignesErr } = await db
    .from('commandes_lignes')
    .select('produit_id, designation, unite, quantite, total_ht_xaf')
    .eq('commande_id', commandeId)

  if (lignesErr || !lignes || lignes.length === 0) return false

  type Ligne = { produit_id: string | null; designation: string; unite: string; quantite: number; total_ht_xaf: number }

  const montantTotal = (lignes as Ligne[]).reduce((sum, l) => sum + (l.total_ht_xaf ?? 0), 0)

  // 2. Vérifier le stock pour les lignes avec produit_id — logguer les insuffisances
  const alertesStock: string[] = []
  for (const l of lignes as Ligne[]) {
    if (!l.produit_id) continue
    const { data: p } = await db
      .from('produits')
      .select('stock_actuel')
      .eq('id', l.produit_id)
      .single()
    if (p && (p as { stock_actuel: number }).stock_actuel < l.quantite) {
      alertesStock.push(
        `${l.designation} (dispo: ${(p as { stock_actuel: number }).stock_actuel}, demandé: ${l.quantite})`,
      )
    }
  }

  // 3. Générer un numéro de bon
  const today     = new Date()
  const yyyymmdd  = today.toISOString().slice(0, 10).replace(/-/g, '')
  const startDay  = `${today.toISOString().slice(0, 10)}T00:00:00.000Z`
  const { count } = await db
    .from('bons_sortie')
    .select('*', { count: 'exact', head: true })
    .gte('created_at', startDay)
  const numeroBon = `TAF-${yyyymmdd}-${String((count ?? 0) + 1).padStart(4, '0')}`

  // 4. Créer le bon de sortie
  const { data: bon, error: bonErr } = await db
    .from('bons_sortie')
    .insert({
      numero:             numeroBon,
      statut:             'en_attente',
      type:               'commande',
      commande_id:        commandeId,
      demandeur:          commandeNumero,
      motif:              `Préparation commande ${commandeNumero}`,
      montant_total_xaf:  montantTotal > 0 ? montantTotal : null,
      notes:              alertesStock.length > 0
        ? `⚠ Stock insuffisant : ${alertesStock.join(' | ')}`
        : null,
      created_by:         userId,
      sync_status:        'synced',
    })
    .select('id')
    .single()

  if (bonErr || !bon) {
    console.error('[commerce] creerBonSortieCommande — insert bon:', bonErr?.message)
    return false
  }

  // 5. Créer les lignes du bon
  const bonLignes = (lignes as Ligne[]).map((l) => ({
    bon_id:            (bon as { id: string }).id,
    produit_id:        l.produit_id ?? null,
    designation:       l.designation,
    unite:             l.unite,
    quantite_demandee: l.quantite,
    quantite_servie:   0,
  }))

  const { error: ligErr } = await db.from('bons_sortie_lignes').insert(bonLignes)
  if (ligErr) {
    console.error('[commerce] creerBonSortieCommande — insert lignes:', ligErr.message)
    await db.from('bons_sortie').delete().eq('id', (bon as { id: string }).id)
    return false
  }

  // 6. Broadcast Realtime pour notifier le magasinier en temps réel
  try {
    const ch = db.channel('forge-bons')
    await ch.send({
      type:    'broadcast',
      event:   'nouveau_bon_commande',
      payload: {
        bon_id:       (bon as { id: string }).id,
        numero:       numeroBon,
        commande_id:  commandeId,
        commande_ref: commandeNumero,
        nb_lignes:    bonLignes.length,
        alertes:      alertesStock,
      },
    })
    db.removeChannel(ch)
  } catch { /* Realtime non critique */ }

  return true
}

/**
 * Vérifie si un client est bloqué pour de nouvelles commandes :
 *  - statut = 'bloque'
 *  - ou crédit en statut 'echu'
 * Retourne null si OK, ou un message d'erreur.
 */
async function verifierBlocageClient(clientId: string | undefined | null): Promise<string | null> {
  if (!clientId) return null

  const { data: client } = await db
    .from('clients')
    .select('statut, nom')
    .eq('id', clientId)
    .single()

  if (!client) return null

  const c = client as { statut: string; nom: string }
  if (c.statut === 'bloque') {
    return `Client "${c.nom}" est bloqué — impossible de créer une commande`
  }

  // Vérifier crédits échus
  const { count: creditsEchus } = await db
    .from('credits')
    .select('*', { count: 'exact', head: true })
    .eq('client_id', clientId)
    .eq('statut', 'echu')

  if ((creditsEchus ?? 0) > 0) {
    return `Client "${c.nom}" a ${creditsEchus} crédit(s) échu(s) — commande bloquée jusqu'au remboursement`
  }

  return null
}

/**
 * Met à jour le score_fiabilite du client en fonction de ses paiements.
 * Score 0-100 : 50 de base, +1 par commande livrée, -5 par crédit échu.
 */
async function recalculerScoreFiabilite(clientId: string): Promise<void> {
  const [commandesRes, creditsRes] = await Promise.all([
    db.from('commandes')
      .select('id', { count: 'exact', head: true })
      .eq('client_id', clientId)
      .eq('statut', 'delivered'),
    db.from('credits')
      .select('statut')
      .eq('client_id', clientId),
  ])

  const livrees = commandesRes.count ?? 0
  type CR = { statut: string }
  const credits = (creditsRes.data ?? []) as CR[]
  const echues  = credits.filter(c => c.statut === 'echu').length
  const payes   = credits.filter(c => c.statut === 'rembourse').length

  const score = Math.max(0, Math.min(100,
    50 + livrees * 1 + payes * 2 - echues * 5
  ))

  await db.from('clients').update({ score_fiabilite: score }).eq('id', clientId)
}

// ══════════════════════════════════════════════════════════════════════════════
// CLIENTS
// ══════════════════════════════════════════════════════════════════════════════

/**
 * GET /api/clients/recherche?q=...&limit=10
 * Recherche clients par nom uniquement, résultats classés par pertinence :
 * exact → préfixe → contient.
 */
router.get('/clients/recherche', async (c) => {
  const q     = (c.req.query('q') ?? '').trim()
  const limit = Math.min(20, parseInt(c.req.query('limit') ?? '10'))

  if (q.length < 2) return c.json({ data: [] })

  const { data, error } = await db
    .from('clients')
    .select('id, nom, telephone, type, statut, score_fiabilite')
    .ilike('nom', `%${q}%`)
    .order('nom')
    .limit(limit * 3)

  if (error) return c.json({ error: error.message }, 500)

  const ql = q.toLowerCase()
  const ranked = (data ?? [])
    .map((row: Record<string, unknown>) => ({
      ...row,
      nom: row.nom as string,
      _rank: (row.nom as string).toLowerCase() === ql         ? 0   // exact
           : (row.nom as string).toLowerCase().startsWith(ql) ? 1   // préfixe
           :                                                     2,  // contient
    }))
    .sort((a, b) => a._rank - b._rank || a.nom.localeCompare(b.nom))
    .slice(0, limit)
    .map(({ _rank: _, ...rest }) => rest)

  return c.json({ data: ranked })
})

router.get('/clients', async (c) => {
  const { statut, type, search } = c.req.query()
  const page    = Math.max(1, parseInt(c.req.query('page') ?? '1'))
  const perPage = Math.min(100, Math.max(1, parseInt(c.req.query('per_page') ?? '20')))
  const from    = (page - 1) * perPage
  const to      = from + perPage - 1

  let query = db.from('clients').select('*', { count: 'exact' })

  if (statut) query = query.eq('statut', statut)
  if (type)   query = query.eq('type', type)
  // Recherche par nom, email ET téléphone
  if (search) query = query.or(`nom.ilike.%${search}%,email.ilike.%${search}%,telephone.ilike.%${search}%`)

  const { data, count, error } = await query
    .order('nom')
    .range(from, to)

  if (error) {
    console.warn('[commerce] GET /clients Supabase error — fallback SQLite:', error.message)
    const local = getClientsLocal({ search })
    if (local.data.length > 0) return c.json(local)
    return c.json({ error: error.message }, 500)
  }

  return c.json({
    data,
    total: count ?? 0,
    page,
    per_page: perPage,
    total_pages: Math.ceil((count ?? 0) / perPage),
  })
})

router.get('/clients/:id', async (c) => {
  const { id } = c.req.param()

  const { data, error } = await db
    .from('clients')
    .select('*, commandes(id, numero, statut, total_ttc_xaf, date_commande), credits(id, numero, montant_xaf, solde_restant_xaf, statut, echeance)')
    .eq('id', id)
    .single()

  if (error || !data) return c.json({ error: 'Client introuvable', code: 'NOT_FOUND' }, 404)
  return c.json(data)
})

router.post('/clients', requireRole(['admin', 'superviseur', 'operateur']), zValidator('json', clientSchema), async (c) => {
  const user = c.get('user')
  const body = c.req.valid('json')

  const { data, error } = await db
    .from('clients')
    .insert({ ...body, created_by: user.id, sync_status: 'synced' })
    .select()
    .single()

  if (error) return c.json({ error: error.message, code: error.code }, 400)
  return c.json(data, 201)
})

router.put('/clients/:id', requireRole(['admin', 'superviseur', 'operateur']), zValidator('json', clientSchema.partial()), async (c) => {
  const { id }  = c.req.param()
  const body    = c.req.valid('json')

  const { data, error } = await db
    .from('clients')
    .update({ ...body, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single()

  if (error) return c.json({ error: error.message }, 400)
  if (!data)  return c.json({ error: 'Client introuvable', code: 'NOT_FOUND' }, 404)
  return c.json(data)
})

router.delete('/clients/:id', requireRole(['admin']), async (c) => {
  const { id } = c.req.param()

  const { count } = await db
    .from('commandes')
    .select('*', { count: 'exact', head: true })
    .eq('client_id', id)
    .in('statut', ['confirmed', 'in_production', 'pret'])

  if ((count ?? 0) > 0) {
    return c.json({
      error: 'Client avec des commandes actives — archiver plutôt que supprimer',
      code: 'ACTIVE_ORDERS',
    }, 422)
  }

  const { error } = await db.from('clients').delete().eq('id', id)
  if (error) return c.json({ error: error.message }, 400)
  return c.body(null, 204)
})

// ══════════════════════════════════════════════════════════════════════════════
// DEVIS
// ══════════════════════════════════════════════════════════════════════════════

router.get('/devis', async (c) => {
  const { statut, client_id, search } = c.req.query()
  const page    = Math.max(1, parseInt(c.req.query('page') ?? '1'))
  const perPage = Math.min(100, Math.max(1, parseInt(c.req.query('per_page') ?? '20')))
  const from    = (page - 1) * perPage
  const to      = from + perPage - 1

  let query = db.from('devis').select('*, devis_lignes(*), clients(id, nom, telephone, email)', { count: 'exact' })

  if (statut)    query = query.eq('statut', statut)
  if (client_id) query = query.eq('client_id', client_id)
  if (search)    query = query.or(`numero.ilike.%${search}%,client_nom.ilike.%${search}%`)

  const { data, count, error } = await query
    .order('created_at', { ascending: false })
    .range(from, to)

  if (error) return c.json({ error: error.message }, 500)

  // Auto-expire les devis dont la date de validité est dépassée
  const today = new Date().toISOString().slice(0, 10)
  const toExpire = (data ?? []).filter(
    (d: { id: string; statut: string; date_validite: string }) =>
      !['expire', 'refuse', 'transforme'].includes(d.statut) && d.date_validite < today
  )
  if (toExpire.length > 0) {
    const ids = toExpire.map((d: { id: string }) => d.id)
    await db.from('devis')
      .update({ statut: 'expire', updated_at: new Date().toISOString() })
      .in('id', ids)
    // Mettre à jour les objets locaux pour la réponse
    for (const d of data ?? []) {
      if (ids.includes((d as { id: string }).id)) {
        (d as { statut: string }).statut = 'expire'
      }
    }
  }

  return c.json({
    data: (data ?? []).map(mapDevis),
    total: count ?? 0,
    page,
    per_page: perPage,
    total_pages: Math.ceil((count ?? 0) / perPage),
  })
})

router.get('/devis/:id', async (c) => {
  const { id } = c.req.param()

  const { data, error } = await db
    .from('devis')
    .select('*, devis_lignes(*), clients(id, nom, telephone, email, adresse)')
    .eq('id', id)
    .single()

  if (error || !data) return c.json({ error: 'Devis introuvable', code: 'NOT_FOUND' }, 404)

  // Auto-expire si date dépassée
  const d = data as { id: string; statut: string; date_validite: string; pdf_url: string | null; numero: string }
  const newStatut = await checkExpireDevis(d.id, d.date_validite, d.statut)
  if (newStatut !== d.statut) {
    (data as { statut: string }).statut = newStatut
  }

  // Régénérer une signed URL fraîche si le PDF existe (URLs Supabase Storage expirent)
  if (d.pdf_url) {
    try {
      const pathMatch = d.pdf_url.match(/\/object\/(?:public|sign)\/devis\/(.+)/)
      const storagePath = pathMatch?.[1] ?? `${d.numero}.pdf`
      const { data: signed } = await db.storage.from('devis').createSignedUrl(storagePath, 3600)
      if (signed?.signedUrl) {
        (data as { pdf_url: string }).pdf_url = signed.signedUrl
      }
    } catch {
      // URL originale conservée en cas d'erreur
    }
  }

  return c.json(mapDevis(data))
})

router.post('/devis', requireRole(['admin', 'superviseur', 'operateur']), zValidator('json', devisSchema), async (c) => {
  const user = c.get('user')
  const body = c.req.valid('json')

  const result = await withOfflineFallback(
    'POST /devis',

    // ── Online : Supabase ──────────────────────────────────────────────────────
    async () => {
      const numero = await genererNumero('devis', 'DEV')
      const totaux = calculerTotaux(body.lignes)

      const { data: devis, error: devisErr } = await db.from('devis')
        .insert({ numero, client_id: body.client_id ?? null, client_nom: body.client_nom,
          statut: 'brouillon', date_emission: body.date_emission, date_validite: body.date_validite,
          validite_jours: body.validite_jours, acompte_pct: body.acompte_pct,
          conditions_paiement: body.conditions_paiement, notes: body.notes ?? null,
          created_by: user.id, sync_status: 'synced', ...totaux })
        .select().single()

      if (devisErr || !devis) throw new Error(devisErr?.message ?? 'Erreur création devis')

      const devisId = (devis as { id: string }).id
      const lignes = body.lignes.map((l, i) => ({
        devis_id: devisId, designation: l.designation, description: l.description ?? null,
        categorie: l.categorie, unite: l.unite, quantite: l.quantite,
        prix_unitaire_ht_xaf: l.prix_unitaire_ht_xaf,
        total_ht_xaf: Math.round(l.quantite * l.prix_unitaire_ht_xaf),
        ordre: l.ordre !== 0 ? l.ordre : i,
      }))

      const { data: lignesData, error: lignesErr } = await db.from('devis_lignes').insert(lignes).select()
      if (lignesErr) { await db.from('devis').delete().eq('id', devisId); throw new Error(lignesErr.message) }

      let pdf_url: string | null = null
      try {
        const dv = devis as { total_ht_xaf: number; tva_xaf: number; total_ttc_xaf: number }
        const pdfBuf = await generateDevisPDF(
          { numero, date_emission: body.date_emission, date_validite: body.date_validite,
            validite_jours: body.validite_jours, total_ht_xaf: dv.total_ht_xaf,
            tva_xaf: dv.tva_xaf, total_ttc_xaf: dv.total_ttc_xaf },
          { nom: body.client_nom },
          (lignesData ?? []) as { designation: string; unite: string; quantite: number; prix_unitaire_ht_xaf: number; total_ht_xaf: number }[],
        )
        pdf_url = await uploadPDF(pdfBuf, 'devis', `${numero}.pdf`)
        if (pdf_url) await db.from('devis').update({ pdf_url }).eq('id', devisId)
      } catch (e) { console.error('[commerce] devis PDF error:', e) }

      return { ...devis, lignes: lignesData, pdf_url }
    },

    // ── Offline : SQLite local ─────────────────────────────────────────────────
    () => localCreateDevis({
      client_nom: body.client_nom, client_id: body.client_id,
      date_emission: body.date_emission, date_validite: body.date_validite,
      validite_jours: body.validite_jours, acompte_pct: body.acompte_pct,
      conditions_paiement: body.conditions_paiement, notes: body.notes,
      lignes: body.lignes, user_id: user.id,
    }),
  )

  return c.json(result, 201)
})

router.put('/devis/:id', requireRole(['admin', 'superviseur', 'operateur']), zValidator('json', devisSchema.partial()), async (c) => {
  const { id } = c.req.param()
  const body   = c.req.valid('json')

  const { data: existing } = await db.from('devis').select('statut').eq('id', id).single()
  if (!existing) return c.json({ error: 'Devis introuvable', code: 'NOT_FOUND' }, 404)

  const currentStatut = (existing as { statut: string }).statut
  // Bloquer modification si déjà transformé ou expiré/refusé définitif
  if (['transforme', 'expire'].includes(currentStatut)) {
    return c.json({
      error: `Impossible de modifier un devis en statut "${currentStatut}"`,
      code: 'IMMUTABLE',
    }, 422)
  }

  // Devis envoye ou refuse → remise en brouillon automatique pour correction
  const revertToBrouillon = ['envoye', 'refuse', 'accepte'].includes(currentStatut)

  const updates: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
    // Invalider approbation précédente si le devis est modifié
    ...(revertToBrouillon ? {
      statut:               'brouillon',
      approuve_par_client:  false,
      approuve_at:          null,
      token_approbation:    null,
      token_expires_at:     null,
      commentaire_client:   null,
    } : {}),
  }
  const { lignes, ...devisFields } = body
  Object.assign(updates, devisFields)

  if (lignes) {
    const totaux = calculerTotaux(lignes)
    Object.assign(updates, totaux)
  }

  const { data, error } = await db
    .from('devis')
    .update(updates)
    .eq('id', id)
    .select()
    .single()

  if (error) return c.json({ error: error.message }, 400)

  if (lignes) {
    await db.from('devis_lignes').delete().eq('devis_id', id)
    await db.from('devis_lignes').insert(
      lignes.map((l, i) => ({
        devis_id:             id,
        designation:          l.designation,
        description:          l.description ?? null,
        categorie:            l.categorie ?? 'materiaux',
        unite:                l.unite ?? 'unité',
        quantite:             l.quantite,
        prix_unitaire_ht_xaf: l.prix_unitaire_ht_xaf,
        total_ht_xaf:         Math.round(l.quantite * l.prix_unitaire_ht_xaf),
        ordre:                l.ordre !== undefined ? l.ordre : i,
      })),
    )
  }

  return c.json(data)
})

router.patch('/devis/:id/statut', requireRole(['admin', 'superviseur']), zValidator('json', z.object({
  statut: z.enum(['brouillon', 'envoye', 'accepte', 'refuse', 'expire']),
})), async (c) => {
  const { id }     = c.req.param()
  const { statut } = c.req.valid('json')

  const { data: existing } = await db.from('devis').select('statut, date_validite').eq('id', id).single()
  if (!existing) return c.json({ error: 'Devis introuvable', code: 'NOT_FOUND' }, 404)

  const ex = existing as { statut: string; date_validite: string }
  const allowed = TRANSITIONS_DEVIS[ex.statut] ?? []

  if (!allowed.includes(statut)) {
    return c.json({
      error: `Transition "${ex.statut}" → "${statut}" non autorisée`,
      code:  'INVALID_TRANSITION',
      transitions_autorisees: allowed,
    }, 422)
  }

  const { data, error } = await db
    .from('devis')
    .update({ statut, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('*, devis_lignes(*), clients(id, nom, telephone, email)')
    .single()

  if (error || !data) return c.json({ error: 'Devis introuvable', code: 'NOT_FOUND' }, 404)
  return c.json(mapDevis(data))
})

router.delete('/devis/:id', requireRole(['admin', 'superviseur']), async (c) => {
  const { id } = c.req.param()

  const { data: existing } = await db.from('devis').select('statut').eq('id', id).single()
  if (!existing) return c.json({ error: 'Devis introuvable', code: 'NOT_FOUND' }, 404)
  if ((existing as { statut: string }).statut === 'transforme') {
    return c.json({ error: 'Impossible de supprimer un devis transformé en commande', code: 'IMMUTABLE' }, 422)
  }

  await db.from('devis_lignes').delete().eq('devis_id', id)
  const { error } = await db.from('devis').delete().eq('id', id)
  if (error) return c.json({ error: error.message }, 400)
  return c.body(null, 204)
})

/**
 * POST /devis/:id/envoyer-approbation
 * Génère un token 30 jours, envoie email avec PDF joint + WhatsApp immédiat.
 */
router.post('/devis/:id/envoyer-approbation', requireRole(['admin', 'superviseur', 'operateur']), async (c) => {
  const { id } = c.req.param()

  // Fetch full devis data (needed for PDF and professional email)
  const { data: devis } = await db
    .from('devis')
    .select(`
      statut, numero, client_nom, client_id,
      date_emission, date_validite, validite_jours,
      acompte_pct, conditions_paiement,
      total_ht_xaf, tva_xaf, total_ttc_xaf,
      devis_lignes(designation, unite, quantite, prix_unitaire_ht_xaf, total_ht_xaf, ordre)
    `)
    .eq('id', id)
    .single()

  if (!devis) return c.json({ error: 'Devis introuvable', code: 'NOT_FOUND' }, 404)

  type LigneRow = { designation: string; unite: string; quantite: number; prix_unitaire_ht_xaf: number; total_ht_xaf: number; ordre: number }
  const d = devis as {
    statut: string; numero: string; client_nom: string; client_id: string | null
    date_emission: string; date_validite: string; validite_jours: number; acompte_pct: number
    conditions_paiement: string; total_ht_xaf: number; tva_xaf: number; total_ttc_xaf: number
    devis_lignes: LigneRow[]
  }

  if (['transforme', 'expire'].includes(d.statut)) {
    return c.json({ error: `Devis "${d.statut}" — envoi d'approbation impossible`, code: 'INVALID_STATUS' }, 422)
  }

  const token     = randomUUID()
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString() // 30 jours
  const expiryLabel = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
    .toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' })

  await db.from('devis').update({
    token_approbation: token,
    token_expires_at:  expiresAt,
    statut:            'envoye',
    updated_at:        new Date().toISOString(),
  }).eq('id', id)

  const frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:5173'
  const approvalUrl = `${frontendUrl}/devis/approuver/${token}`

  // Récupérer les détails du client pour le PDF et l'email
  let clientEmail:     string | null = null
  let clientAdresse:   string | null = null
  let clientTelephone: string | null = null
  let clientNiu:       string | null = null
  let clientType:      string | null = null

  if (d.client_id) {
    const { data: cli } = await db.from('clients')
      .select('email, adresse, telephone, niu, type')
      .eq('id', d.client_id).single()
    const cliRow = cli as { email?: string | null; adresse?: string | null; telephone?: string | null; niu?: string | null; type?: string | null } | null
    clientEmail    = cliRow?.email    ?? null
    clientAdresse  = cliRow?.adresse  ?? null
    clientTelephone = cliRow?.telephone ?? null
    clientNiu      = cliRow?.niu      ?? null
    clientType     = cliRow?.type     ?? null
  }

  // Générer le PDF pour la pièce jointe
  const lignesSorted = [...d.devis_lignes].sort((a, b) => (a.ordre ?? 0) - (b.ordre ?? 0))
  let pdfBuffer: Buffer | null = null
  try {
    pdfBuffer = await generateDevisPDF(
      {
        numero:         d.numero,
        date_emission:  d.date_emission,
        date_validite:  d.date_validite,
        validite_jours: d.validite_jours,
        total_ht_xaf:   d.total_ht_xaf,
        tva_xaf:        d.tva_xaf,
        total_ttc_xaf:  d.total_ttc_xaf,
      },
      { nom: d.client_nom, adresse: clientAdresse, telephone: clientTelephone, email: clientEmail, niu: clientNiu, type: clientType },
      lignesSorted,
    )
  } catch (e) {
    console.error('[commerce] Erreur génération PDF pour email:', e)
  }

  if (clientEmail) {
    const lignesHtml = lignesSorted.map((l, i) => `
      <tr style="background:${i % 2 === 0 ? '#F9FAFB' : '#ffffff'};">
        <td style="padding:9px 12px;color:#111827;font-size:13px;border-bottom:1px solid #F3F4F6;">${l.designation}</td>
        <td style="padding:9px 8px;color:#374151;font-size:13px;text-align:center;border-bottom:1px solid #F3F4F6;">${l.quantite}&nbsp;${l.unite}</td>
        <td style="padding:9px 8px;color:#374151;font-size:13px;text-align:right;border-bottom:1px solid #F3F4F6;">${l.prix_unitaire_ht_xaf.toLocaleString('fr-FR')}&nbsp;XAF</td>
        <td style="padding:9px 12px;color:#111827;font-size:13px;font-weight:600;text-align:right;border-bottom:1px solid #F3F4F6;">${l.total_ht_xaf.toLocaleString('fr-FR')}&nbsp;XAF</td>
      </tr>`).join('')

    const acompteXaf = Math.round(d.total_ttc_xaf * d.acompte_pct / 100)

    const emailHtml = `<!DOCTYPE html>
<html lang="fr">
<head><meta charset="utf-8"><title>Devis ${d.numero} — TAFDIL SARL</title></head>
<body style="margin:0;padding:0;background:#F3F4F6;font-family:Arial,Helvetica,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#F3F4F6;padding:32px 16px;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.09);">
<tr><td style="background:#C62828;padding:26px 36px;">
  <table width="100%" cellpadding="0" cellspacing="0"><tr>
    <td valign="middle">
      <p style="margin:0;color:#ffffff;font-size:22px;font-weight:bold;letter-spacing:.4px;">TAFDIL SARL</p>
      <p style="margin:5px 0 0;color:rgba(255,255,255,.82);font-size:12px;">Microusine Métallurgique &amp; BTP — Kotto Mairyvanas, Douala</p>
      <p style="margin:3px 0 0;color:rgba(255,255,255,.65);font-size:11px;">NIU&nbsp;: M052116085624A &nbsp;|&nbsp; RCCM&nbsp;: RC/DLA/2021/B/2624</p>
    </td>
    <td align="right" valign="middle" style="padding-left:20px;">
      <p style="margin:0;color:rgba(255,255,255,.55);font-size:10px;text-transform:uppercase;letter-spacing:1.5px;">DEVIS</p>
      <p style="margin:5px 0 0;color:#EF9A9A;font-size:22px;font-weight:bold;">${d.numero}</p>
      <p style="margin:4px 0 0;color:rgba(255,255,255,.7);font-size:11px;">Émis le ${d.date_emission}</p>
    </td>
  </tr></table>
</td></tr>
<tr><td style="padding:32px 36px;">
  <p style="margin:0 0 6px;color:#111827;font-size:16px;font-weight:700;">Bonjour ${d.client_nom},</p>
  <p style="margin:0 0 26px;color:#6B7280;font-size:14px;line-height:1.75;">
    TAFDIL SARL vous adresse le devis <strong>${d.numero}</strong> établi le <strong>${d.date_emission}</strong>.<br>
    Ce devis est valable jusqu'au <strong>${d.date_validite}</strong> (${d.validite_jours}&nbsp;jours).
  </p>
  <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #E5E7EB;border-radius:8px;overflow:hidden;margin-bottom:22px;">
    <tr style="background:#C62828;">
      <td style="padding:10px 12px;color:#fff;font-size:11px;font-weight:bold;text-transform:uppercase;">Désignation</td>
      <td style="padding:10px 8px;color:#fff;font-size:11px;font-weight:bold;text-align:center;white-space:nowrap;">Qté&nbsp;/&nbsp;Unité</td>
      <td style="padding:10px 8px;color:#fff;font-size:11px;font-weight:bold;text-align:right;white-space:nowrap;">P.U.&nbsp;HT</td>
      <td style="padding:10px 12px;color:#fff;font-size:11px;font-weight:bold;text-align:right;white-space:nowrap;">Total&nbsp;HT</td>
    </tr>
    ${lignesHtml}
  </table>
  <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
    <tr><td width="45%"></td><td>
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td style="padding:5px 0;color:#6B7280;font-size:13px;">Sous-total HT</td>
          <td style="padding:5px 0;color:#111827;font-size:13px;font-weight:600;text-align:right;">${d.total_ht_xaf.toLocaleString('fr-FR')}&nbsp;XAF</td>
        </tr>
        <tr>
          <td style="padding:5px 0;color:#6B7280;font-size:13px;">TVA (19,25&nbsp;%)</td>
          <td style="padding:5px 0;color:#111827;font-size:13px;font-weight:600;text-align:right;">${d.tva_xaf.toLocaleString('fr-FR')}&nbsp;XAF</td>
        </tr>
        <tr><td colspan="2" style="padding:6px 0;"><hr style="border:none;border-top:1px solid #E5E7EB;margin:0;"></td></tr>
        <tr><td colspan="2">
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#C62828;border-radius:6px;">
            <tr>
              <td style="padding:11px 14px;color:#fff;font-size:14px;font-weight:bold;">TOTAL TTC</td>
              <td style="padding:11px 14px;color:#fff;font-size:17px;font-weight:bold;text-align:right;">${d.total_ttc_xaf.toLocaleString('fr-FR')}&nbsp;XAF</td>
            </tr>
          </table>
        </td></tr>
      </table>
    </td></tr>
  </table>
  <div style="text-align:center;margin:30px 0 26px;">
    <a href="${approvalUrl}" style="display:inline-block;background:#C62828;color:#ffffff;font-size:15px;font-weight:bold;padding:15px 44px;border-radius:8px;text-decoration:none;letter-spacing:.3px;">
      Consulter &amp; Approuver le Devis
    </a>
    <p style="margin:12px 0 0;color:#9CA3AF;font-size:12px;">Lien sécurisé valable jusqu'au ${expiryLabel}</p>
  </div>
  <div style="background:#EFF6FF;border-left:4px solid #1D4ED8;border-radius:4px;padding:13px 16px;margin-bottom:22px;">
    <p style="margin:0;color:#1E40AF;font-size:13px;font-weight:600;">📎 Le devis complet en PDF est joint à cet email.</p>
  </div>
  <div style="background:#F9FAFB;border:1px solid #E5E7EB;border-radius:8px;padding:16px 20px;margin-bottom:24px;">
    <p style="margin:0 0 10px;color:#374151;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;">Conditions de paiement</p>
    <p style="margin:0;color:#6B7280;font-size:12px;line-height:1.85;">
      ${d.acompte_pct > 0 ? `• Acompte : ${d.acompte_pct}% à la commande — ${acompteXaf.toLocaleString('fr-FR')}&nbsp;XAF<br>` : ''}• Règlement : ${d.conditions_paiement}<br>
      • Devis valable ${d.validite_jours} jours à compter de la date d'émission
    </p>
  </div>
  <p style="margin:0 0 4px;color:#374151;font-size:13px;font-weight:600;">Une question ?</p>
  <p style="margin:0;color:#6B7280;font-size:13px;line-height:1.7;">Contactez-nous au <strong>+237 695 884 528</strong> ou à <strong>info@tafdil.cm</strong>.<br>
  Disponible du lundi au vendredi, 8h–17h.</p>
</td></tr>
<tr><td style="background:#F9FAFB;border-top:1px solid #E5E7EB;padding:18px 36px;text-align:center;">
  <p style="margin:0 0 3px;color:#6B7280;font-size:11px;font-weight:600;">TAFDIL SARL — Microusine Métallurgique &amp; BTP</p>
  <p style="margin:0;color:#9CA3AF;font-size:10px;">NIU : M052116085624A &nbsp;|&nbsp; RCCM : RC/DLA/2021/B/2624 &nbsp;|&nbsp; Kotto Mairyvanas, Douala &nbsp;|&nbsp; +237 695 884 528</p>
</td></tr>
</table>
</td></tr>
</table>
</body></html>`

    await sendEmailDirect({
      to:      clientEmail,
      subject: `Devis N°${d.numero} — TAFDIL SARL`,
      html:    emailHtml,
      attachments: pdfBuffer
        ? [{ filename: `${d.numero}.pdf`, content: pdfBuffer, contentType: 'application/pdf' }]
        : [],
    })
  }

  // WhatsApp immédiat au directeur
  await notifyWhatsApp(
    process.env.DIRECTEUR_WHATSAPP_PHONE ?? '',
    `📋 Devis ${d.numero} envoyé à ${d.client_nom} pour approbation (30j).\nLien : ${approvalUrl}`,
  )

  return c.json({ token, expires_at: expiresAt, approval_url: approvalUrl })
})

/**
 * GET /api/devis/approuver/:token  (PUBLIC — sans authentification)
 * Retourne les infos du devis pour la page d'approbation client.
 */
const publicDevisRouter = new Hono()

publicDevisRouter.get('/devis/approuver/:token', async (c) => {
  const { token } = c.req.param()

  const { data } = await db
    .from('devis')
    .select('id, numero, client_nom, total_ht_xaf, tva_xaf, total_ttc_xaf, date_validite, statut, token_expires_at, approuve_par_client, devis_lignes(designation, quantite, prix_unitaire_ht_xaf, unite)')
    .eq('token_approbation', token)
    .single()

  if (!data) return c.json({ error: 'Lien invalide ou expiré', code: 'INVALID_TOKEN' }, 404)

  const d = data as { token_expires_at: string; statut: string }
  if (new Date(d.token_expires_at) < new Date()) {
    return c.json({ error: 'Ce lien d\'approbation a expiré', code: 'TOKEN_EXPIRED' }, 410)
  }

  if (['transforme', 'expire'].includes(d.statut)) {
    return c.json({ error: 'Ce devis n\'est plus en attente d\'approbation', code: 'INVALID_STATUS' }, 410)
  }

  return c.json({ token_valide: true, devis: data })
})

publicDevisRouter.post('/devis/approuver/:token', async (c) => {
  const { token } = c.req.param()
  const body = await c.req.json<{ decision: 'accepte' | 'refuse'; commentaire?: string }>()

  if (!['accepte', 'refuse'].includes(body.decision)) {
    return c.json({ error: 'Décision invalide — accepte ou refuse', code: 'INVALID_DECISION' }, 422)
  }

  const { data } = await db
    .from('devis')
    .select('id, numero, client_nom, statut, token_expires_at')
    .eq('token_approbation', token)
    .single()

  if (!data) return c.json({ error: 'Lien invalide', code: 'INVALID_TOKEN' }, 404)

  const d = data as { id: string; numero: string; client_nom: string; statut: string; token_expires_at: string }

  if (new Date(d.token_expires_at) < new Date()) {
    return c.json({ error: 'Ce lien d\'approbation a expiré', code: 'TOKEN_EXPIRED' }, 410)
  }

  if (['transforme', 'expire'].includes(d.statut)) {
    return c.json({ error: 'Ce devis n\'est plus en attente d\'approbation', code: 'INVALID_STATUS' }, 410)
  }

  await db.from('devis').update({
    statut:              body.decision,   // 'accepte' ou 'refuse'
    approuve_par_client: body.decision === 'accepte',
    approuve_at:         new Date().toISOString(),
    commentaire_client:  body.commentaire ?? null,
    token_approbation:   null,    // invalider le token après usage
    updated_at:          new Date().toISOString(),
  }).eq('id', d.id)

  const isAccepted = body.decision === 'accepte'
  const decisionDate = new Date().toLocaleString('fr-FR')

  // WhatsApp immédiat au directeur
  await notifyWhatsApp(
    process.env.DIRECTEUR_WHATSAPP_PHONE ?? '',
    isAccepted
      ? `✅ Devis ${d.numero} APPROUVÉ par ${d.client_nom}`
      : `❌ Devis ${d.numero} REFUSÉ par ${d.client_nom}${body.commentaire ? `\nMotif: ${body.commentaire}` : ''}`,
  )

  // Email de notification à TAFDIL
  const directeurEmail = process.env.DIRECTEUR_EMAIL
  if (directeurEmail) {
    const accentColor = isAccepted ? '#15803d' : '#C62828'
    const decisionLabel = isAccepted ? '✅ APPROUVÉ' : '❌ REFUSÉ'
    await enqueueEmail({
      destinataire:   directeurEmail,
      sujet:          `${decisionLabel} — Devis ${d.numero} par ${d.client_nom}`,
      corps_html:     `<!DOCTYPE html>
<html lang="fr"><head><meta charset="utf-8"></head>
<body style="margin:0;padding:24px 16px;background:#F3F4F6;font-family:Arial,Helvetica,sans-serif;">
<table width="560" cellpadding="0" cellspacing="0" style="margin:0 auto;background:#ffffff;border-radius:10px;overflow:hidden;box-shadow:0 1px 8px rgba(0,0,0,.08);">
  <tr><td style="background:${accentColor};padding:22px 28px;">
    <p style="margin:0;color:#ffffff;font-size:20px;font-weight:bold;">${decisionLabel}</p>
    <p style="margin:6px 0 0;color:rgba(255,255,255,.8);font-size:13px;">Devis ${d.numero} — ${decisionDate}</p>
  </td></tr>
  <tr><td style="padding:26px 28px;">
    <p style="margin:0 0 16px;color:#374151;font-size:14px;line-height:1.7;">
      Le client <strong>${d.client_nom}</strong> a <strong>${isAccepted ? 'approuvé' : 'refusé'}</strong>
      le devis <strong>${d.numero}</strong> le ${decisionDate}.
    </p>
    ${body.commentaire ? `
    <div style="background:#F9FAFB;border-left:4px solid #E5E7EB;border-radius:4px;padding:12px 16px;margin-bottom:18px;">
      <p style="margin:0 0 4px;color:#6B7280;font-size:12px;font-weight:600;">Commentaire du client :</p>
      <p style="margin:0;color:#374151;font-size:13px;font-style:italic;">"${body.commentaire}"</p>
    </div>` : ''}
    ${isAccepted
      ? '<div style="background:#F0FDF4;border:1px solid #BBF7D0;border-radius:6px;padding:14px 18px;"><p style="margin:0;color:#15803d;font-size:14px;font-weight:600;">Action requise : transformez ce devis en commande dans l\'ERP.</p></div>'
      : '<p style="margin:0;color:#6B7280;font-size:13px;">Prenez contact avec le client pour comprendre ses objections et établir un nouveau devis si nécessaire.</p>'
    }
  </td></tr>
  <tr><td style="background:#F9FAFB;border-top:1px solid #E5E7EB;padding:14px 28px;text-align:center;">
    <p style="margin:0;color:#9CA3AF;font-size:11px;">TAFDIL SARL — ERP Interne — Notification automatique</p>
  </td></tr>
</table>
</body></html>`,
      priorite:       'haute',
      reference_type: 'devis',
      reference_id:   d.id,
    })
  }

  return c.json({ succes: true, decision: body.decision })
})

/** Transformer un devis en commande + réserver le stock */
router.post('/devis/:id/transformer-commande', requireRole(['admin', 'superviseur', 'operateur']), async (c) => {
  const { id }   = c.req.param()
  const user     = c.get('user')

  const { data: devis, error: devisErr } = await db
    .from('devis')
    .select('*, devis_lignes(*)')
    .eq('id', id)
    .single()

  if (devisErr || !devis) return c.json({ error: 'Devis introuvable', code: 'NOT_FOUND' }, 404)

  const d = devis as {
    id: string; numero: string; statut: string; client_id: string | null; client_nom: string
    date_validite: string; acompte_pct: number; conditions_paiement: string; notes: string | null
    total_ht_xaf: number; tva_xaf: number; total_ttc_xaf: number; approuve_par_client: boolean
    devis_lignes: Array<{
      designation: string; description: string | null; unite: string
      quantite: number; prix_unitaire_ht_xaf: number; total_ht_xaf: number; ordre: number
    }>
  }

  // Vérifier le statut — bloquer si expiré ou refusé
  const currentStatut = await checkExpireDevis(d.id, d.date_validite, d.statut)
  if (!['brouillon', 'envoye', 'accepte'].includes(currentStatut)) {
    return c.json({
      error: `Impossible de transformer un devis en statut "${currentStatut}"`,
      code: 'INVALID_STATUS',
    }, 422)
  }

  // CMD01 : vérifier approbation client avant création commande
  if (!d.approuve_par_client) {
    return c.json({
      error: 'Commande impossible — le client n\'a pas encore approuvé ce devis. Envoyez-lui le lien d\'approbation.',
      code:  'AWAITING_CLIENT_APPROVAL',
    }, 422)
  }

  // Bloquer si le client est bloqué
  const blocageMsg = await verifierBlocageClient(d.client_id)
  if (blocageMsg) {
    return c.json({ error: blocageMsg, code: 'CLIENT_BLOQUE' }, 422)
  }

  const numeroCommande = await genererNumero('commandes', 'CMD')

  const { data: commande, error: cmdErr } = await db
    .from('commandes')
    .insert({
      numero:           numeroCommande,
      client_id:        d.client_id,
      client_nom:       d.client_nom,
      devis_id:         d.id,
      statut:           'confirmed',
      date_commande:    new Date().toISOString().slice(0, 10),
      total_ht_xaf:     d.total_ht_xaf,
      tva_xaf:          d.tva_xaf,
      total_ttc_xaf:    d.total_ttc_xaf,
      acompte_recu_xaf: Math.round(d.total_ttc_xaf * (d.acompte_pct / 100)),
      notes:            d.notes,
      created_by:       user.id,
      sync_status:      'synced',
    })
    .select()
    .single()

  if (cmdErr || !commande) return c.json({ error: cmdErr?.message, code: 'CREATE_FAILED' }, 400)

  const cmd = commande as { id: string; numero: string }

  await db.from('commandes_lignes').insert(
    d.devis_lignes.map((l) => ({
      commande_id:          cmd.id,
      designation:          l.designation,
      unite:                l.unite,
      quantite:             l.quantite,
      prix_unitaire_ht_xaf: l.prix_unitaire_ht_xaf,
      total_ht_xaf:         l.total_ht_xaf,
      ordre:                l.ordre,
    })),
  )

  await db.from('devis')
    .update({ statut: 'transforme', updated_at: new Date().toISOString() })
    .eq('id', id)

  await db.from('historique_commandes').insert({
    commande_id:    cmd.id,
    ancien_statut:  null,
    nouveau_statut: 'confirmed',
    commentaire:    `Créée depuis devis ${d.numero}`,
    changed_by:     user.id,
  })

  return c.json({ commande, devis_numero: d.numero, commande_numero: cmd.numero }, 201)
})

// ══════════════════════════════════════════════════════════════════════════════
// CONDITIONS DE PAIEMENT
// ══════════════════════════════════════════════════════════════════════════════

router.get('/conditions-paiement', async (c) => {
  const { data, error } = await db
    .from('conditions_paiement')
    .select('id, code, libelle, acompte_pct, delai_solde_jours')
    .eq('actif', true)
    .order('code')
  if (error) return c.json({ error: error.message }, 500)
  return c.json({ data: data ?? [] })
})

// ══════════════════════════════════════════════════════════════════════════════
// COMMANDES
// ══════════════════════════════════════════════════════════════════════════════

router.get('/commandes', async (c) => {
  const { statut, client_id, search } = c.req.query()
  const page    = Math.max(1, parseInt(c.req.query('page') ?? '1'))
  const perPage = Math.min(100, Math.max(1, parseInt(c.req.query('per_page') ?? '20')))
  const from    = (page - 1) * perPage
  const to      = from + perPage - 1

  let query = db.from('commandes').select(
    '*, commandes_lignes(*), historique_commandes(nouveau_statut, commentaire, changed_at), clients(id, nom, telephone), conditions_paiement(code, libelle, acompte_pct, delai_solde_jours)',
    { count: 'exact' },
  )

  if (statut)    query = query.eq('statut', statut)
  if (client_id) query = query.eq('client_id', client_id)
  if (search)    query = query.or(`numero.ilike.%${search}%,client_nom.ilike.%${search}%`)

  const { data, count, error } = await query
    .order('created_at', { ascending: false })
    .range(from, to)

  if (error) return c.json({ error: error.message }, 500)

  return c.json({
    data:        (data ?? []).map(mapCommande),
    total:       count ?? 0,
    page,
    per_page:    perPage,
    total_pages: Math.ceil((count ?? 0) / perPage),
  })
})

router.get('/commandes/:id', async (c) => {
  const { id } = c.req.param()

  const { data, error } = await db
    .from('commandes')
    .select(`
      *,
      commandes_lignes (*),
      historique_commandes (*),
      clients (nom, telephone, email, adresse),
      conditions_paiement (code, libelle, acompte_pct, delai_solde_jours)
    `)
    .eq('id', id)
    .single()

  if (error || !data) return c.json({ error: 'Commande introuvable', code: 'NOT_FOUND' }, 404)
  return c.json(mapCommande(data))
})

router.post('/commandes', requireRole(['admin', 'superviseur', 'operateur']), zValidator('json', commandeSchema), async (c) => {
  const user = c.get('user')
  const body = c.req.valid('json')

  const result = await withOfflineFallback(
    'POST /commandes',

    // ── Online : Supabase ──────────────────────────────────────────────────────
    async () => {
      const blocageMsg = await verifierBlocageClient(body.client_id)
      if (blocageMsg) throw Object.assign(new Error(blocageMsg), { code: 'CLIENT_BLOQUE', httpStatus: 422 })

      const numero = await genererNumero('commandes', 'CMD')
      const totaux = calculerTotaux(body.lignes)

      // ── Résolution condition de paiement ──────────────────────────────────
      let montantAcompte    = 0
      let dateEcheanceSolde: string | null = null

      if (body.condition_paiement_id) {
        const { data: cp } = await db
          .from('conditions_paiement')
          .select('acompte_pct, delai_solde_jours')
          .eq('id', body.condition_paiement_id)
          .single()

        if (cp) {
          montantAcompte = Math.round(totaux.total_ttc_xaf * (cp.acompte_pct / 100))

          if (cp.delai_solde_jours > 0) {
            const base = new Date(body.date_commande)
            base.setDate(base.getDate() + cp.delai_solde_jours)
            dateEcheanceSolde = base.toISOString().slice(0, 10)
          } else if (cp.delai_solde_jours === 0 && cp.acompte_pct < 100) {
            // Paiement à la livraison — échéance = date livraison prévue si connue
            dateEcheanceSolde = body.date_livraison_prevue ?? null
          }
        }
      }

      const { data: commande, error: cmdErr } = await db.from('commandes')
        .insert({ numero, client_id: body.client_id ?? null, client_nom: body.client_nom,
          devis_id: body.devis_id ?? null, statut: 'confirmed',
          date_commande: body.date_commande, date_livraison_prevue: body.date_livraison_prevue ?? null,
          acompte_recu_xaf: body.acompte_recu_xaf, notes: body.notes ?? null,
          condition_paiement_id: body.condition_paiement_id ?? null,
          montant_acompte: montantAcompte,
          date_echeance_solde: dateEcheanceSolde,
          statut_paiement: 'non_paye',
          created_by: user.id, sync_status: 'synced', ...totaux })
        .select().single()

      if (cmdErr || !commande) throw new Error(cmdErr?.message ?? 'Erreur création commande')
      const cmd = commande as { id: string }

      const lignes = body.lignes.map((l, i) => ({
        commande_id: cmd.id, produit_id: l.produit_id ?? null,
        designation: l.designation, unite: l.unite, quantite: l.quantite,
        prix_unitaire_ht_xaf: l.prix_unitaire_ht_xaf,
        total_ht_xaf: Math.round(l.quantite * l.prix_unitaire_ht_xaf),
        ordre: l.ordre !== 0 ? l.ordre : i,
      }))

      const { error: lignesErr } = await db.from('commandes_lignes').insert(lignes)
      if (lignesErr) { await db.from('commandes').delete().eq('id', cmd.id); throw new Error(lignesErr.message) }

      await db.from('historique_commandes').insert({
        commande_id: cmd.id, ancien_statut: null,
        nouveau_statut: 'confirmed', commentaire: 'Commande créée', changed_by: user.id,
      })

      const { data: full, error: fullErr } = await db.from('commandes')
        .select('*, commandes_lignes(*), historique_commandes(nouveau_statut, commentaire, changed_at), clients(id, nom, telephone), conditions_paiement(code, libelle, acompte_pct, delai_solde_jours)')
        .eq('id', cmd.id).single()

      return fullErr || !full ? commande : mapCommande(full)
    },

    // ── Offline : SQLite local ─────────────────────────────────────────────────
    () => localCreateCommande({
      client_nom: body.client_nom, client_id: body.client_id,
      devis_id: body.devis_id, date_commande: body.date_commande,
      date_livraison_prevue: body.date_livraison_prevue,
      acompte_recu_xaf: body.acompte_recu_xaf, notes: body.notes,
      lignes: body.lignes, user_id: user.id,
    }),
  )

  return c.json(result, 201)
})

/** Changer le statut avec validation des transitions */
router.patch(
  '/commandes/:id/statut',
  requireRole(['admin', 'superviseur', 'operateur']),
  zValidator('json', statutCommandeSchema),
  async (c) => {
    const { id } = c.req.param()
    const user   = c.get('user')
    const body   = c.req.valid('json')

    const { data: existing } = await db
      .from('commandes')
      .select('statut, numero, client_id')
      .eq('id', id)
      .single()

    if (!existing) return c.json({ error: 'Commande introuvable', code: 'NOT_FOUND' }, 404)

    const ex = existing as { statut: string; numero: string; client_id: string | null }
    const allowed  = TRANSITIONS_COMMANDE[ex.statut] ?? []

    if (!allowed.includes(body.statut)) {
      return c.json({
        error: `Transition "${ex.statut}" → "${body.statut}" non autorisée`,
        code:  'INVALID_TRANSITION',
        transitions_autorisees: allowed,
      }, 422)
    }

    // Bloquer si le client a un crédit échu (sauf annulation)
    if (body.statut !== 'cancelled' && ex.client_id) {
      const blocageMsg = await verifierBlocageClient(ex.client_id)
      if (blocageMsg) {
        return c.json({ error: blocageMsg, code: 'CLIENT_BLOQUE' }, 422)
      }
    }

    const { error: updateErr } = await db
      .from('commandes')
      .update({ statut: body.statut, updated_at: new Date().toISOString() })
      .eq('id', id)

    if (updateErr) return c.json({ error: updateErr.message }, 400)

    await db.from('historique_commandes').insert({
      commande_id:    id,
      ancien_statut:  ex.statut,
      nouveau_statut: body.statut,
      commentaire:    body.commentaire ?? null,
      changed_by:     user.id,
    })

    // ── Auto-création bon de sortie sur passage en production ──────────────────
    if (body.statut === 'in_production') {
      await creerBonSortieCommande(id, ex.numero, user.id).catch((e) =>
        console.error('[commerce] auto-bon-sortie:', e)
      )
    }

    // Recalculer le score fiabilité si livraison complète ou annulation
    if (ex.client_id && ['delivered', 'cancelled'].includes(body.statut)) {
      recalculerScoreFiabilite(ex.client_id).catch(e =>
        console.error('[commerce] score_fiabilite recalcul:', e)
      )
    }

    const { data: full } = await db
      .from('commandes')
      .select('*, commandes_lignes(*), historique_commandes(nouveau_statut, commentaire, changed_at), clients(id, nom, telephone), conditions_paiement(code, libelle, acompte_pct, delai_solde_jours)')
      .eq('id', id)
      .single()

    const smsEvent: Record<string, Parameters<typeof notifyCommandeSms>[1]> = {
      in_production: 'commande_en_production',
      pret:          'commande_prete',
      delivered:     'commande_livree',
      cancelled:     'commande_annulee',
    }
    const event = smsEvent[body.statut]
    if (event && full) {
      const row = full as {
        numero: string
        client_nom: string
        total_ttc_xaf: number
        clients?: { telephone?: string | null } | null
      }
      void notifyCommandeSms({
        numero:        row.numero,
        client_nom:    row.client_nom,
        telephone:     row.clients?.telephone ?? null,
        total_ttc_xaf: row.total_ttc_xaf,
      }, event).catch((e) => console.error('[sms] statut commande ERP:', e))
    }

    return c.json(full ? mapCommande(full) : { id, statut: body.statut })
  },
)

router.delete('/commandes/:id', requireRole(['admin']), async (c) => {
  const { id } = c.req.param()

  const { data: existing } = await db.from('commandes').select('statut').eq('id', id).single()
  if (!existing) return c.json({ error: 'Commande introuvable', code: 'NOT_FOUND' }, 404)
  if (!['confirmed', 'cancelled'].includes((existing as { statut: string }).statut)) {
    return c.json({
      error: 'Seules les commandes confirmées ou annulées peuvent être supprimées',
      code: 'CANNOT_DELETE',
    }, 422)
  }

  await db.from('commandes_lignes').delete().eq('commande_id', id)
  await db.from('historique_commandes').delete().eq('commande_id', id)
  const { error } = await db.from('commandes').delete().eq('id', id)
  if (error) return c.json({ error: error.message }, 400)
  return c.body(null, 204)
})

// ══════════════════════════════════════════════════════════════════════════════
// PAIEMENTS COMMANDE (CMD05)
// ══════════════════════════════════════════════════════════════════════════════

const paiementCommandeSchema = z.object({
  montant_xaf:   z.number().positive(),
  methode:       z.enum(['mobile_money', 'virement', 'especes', 'cheque', 'notchpay']).default('mobile_money'),
  reference_ext: z.string().optional(),
  date_paiement: z.string(),
  notes:         z.string().optional(),
})

router.get('/commandes/:id/paiements', async (c) => {
  const { id } = c.req.param()
  const { data, error } = await db
    .from('paiements_commande')
    .select('*')
    .eq('commande_id', id)
    .order('date_paiement', { ascending: false })
  if (error) return c.json({ error: error.message }, 500)
  return c.json({ data: data ?? [], total: (data ?? []).length })
})

router.post(
  '/commandes/:id/paiements',
  requireRole(['admin', 'superviseur', 'operateur']),
  zValidator('json', paiementCommandeSchema),
  async (c) => {
    const { id } = c.req.param()
    const user   = c.get('user')
    const body   = c.req.valid('json')

    try {
      const result = await enregistrerPaiementCommande({
        commandeId:               id,
        montantXaf:               body.montant_xaf,
        methode:                  body.methode,
        referenceExt:             body.reference_ext ?? null,
        datePaiement:             body.date_paiement,
        notes:                    body.notes ?? null,
        userId:                   user.id,
        ensureFacture:            true,
        factureStatutSiCreation:  'envoye',
      })

      if (result.solde_restant_xaf <= 0) {
        const { data: commande } = await db
          .from('commandes')
          .select('numero, client_nom')
          .eq('id', id)
          .single()
        const cmd = commande as { numero?: string; client_nom?: string } | null

        await notifyWhatsApp(
          process.env.DIRECTEUR_WHATSAPP_PHONE ?? '',
          `✅ Commande ${cmd?.numero ?? id} soldée intégralement par ${cmd?.client_nom ?? 'client'}`,
        )
      }

      return c.json(result, 201)
    } catch (err) {
      const e = err as Error & { code?: string; httpStatus?: number }
      return c.json({ error: e.message, code: e.code ?? 'PAYMENT_ERROR' }, (e.httpStatus ?? 400) as ContentfulStatusCode)
    }
  },
)

// ══════════════════════════════════════════════════════════════════════════════
// ROUTE PUBLIQUE — suivi commande client
// ══════════════════════════════════════════════════════════════════════════════

publicRouter.get('/api/commandes/public/:ref', async (c) => {
  const { ref } = c.req.param()

  const { data, error } = await db
    .from('commandes')
    .select(`
      numero, statut, client_nom, date_commande, date_livraison_prevue,
      total_ttc_xaf, acompte_recu_xaf,
      commandes_lignes (designation, quantite, unite),
      historique_commandes (nouveau_statut, commentaire, changed_at)
    `)
    .eq('numero', ref)
    .single()

  if (error || !data) {
    return c.json({ error: 'Référence introuvable', code: 'NOT_FOUND' }, 404)
  }

  const d = data as {
    numero: string; statut: string; client_nom: string
    date_commande: string; date_livraison_prevue: string | null
    total_ttc_xaf: number; acompte_recu_xaf: number
    commandes_lignes: Array<{ designation: string; quantite: number; unite: string }>
    historique_commandes: Array<{ nouveau_statut: string; commentaire: string | null; changed_at: string }>
  }

  const STATUT_LABELS: Record<string, string> = {
    confirmed:     'Confirmée',
    in_production: 'En production',
    pret:          'Prête — en attente de livraison',
    delivered:     'Livrée',
    cancelled:     'Annulée',
  }

  return c.json({
    reference:             d.numero,
    statut:                d.statut,
    statut_label:          STATUT_LABELS[d.statut] ?? d.statut,
    client:                d.client_nom,
    date_commande:         d.date_commande,
    date_livraison_prevue: d.date_livraison_prevue,
    articles:              d.commandes_lignes,
    historique:            d.historique_commandes.sort(
      (a, b) => new Date(b.changed_at).getTime() - new Date(a.changed_at).getTime(),
    ),
    solde_restant_xaf: Math.max(0, d.total_ttc_xaf - d.acompte_recu_xaf),
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// COMMANDES WEB — Changement de statut avec workflow métier
// ══════════════════════════════════════════════════════════════════════════════

const statutCommandeWebSchema = z.object({
  statut_commande: z.enum(['recue', 'confirmee', 'en_preparation', 'expediee', 'livree', 'annulee']),
  statut_paiement: z.enum(['en_attente', 'paye', 'echec', 'rembourse']).optional(),
})

router.patch(
  '/commandes/web/:id/statut',
  requireRole(['admin', 'superviseur', 'operateur']),
  zValidator('json', statutCommandeWebSchema),
  async (c) => {
    const { id } = c.req.param()
    const user   = c.get('user')
    const body   = c.req.valid('json')

    const { data: commande, error: loadErr } = await db
      .from('commandes_shop')
      .select('*')
      .eq('id', id)
      .single()

    if (loadErr || !commande) {
      return c.json({ error: 'Commande web introuvable', code: 'NOT_FOUND' }, 404)
    }

    const cmd = commande as {
      id: string; ref: string; statut_commande: string; statut_paiement: string
      lignes: Array<{ designation: string; quantite: number; prix_unitaire: number }>
      client_nom: string; client_telephone: string
      montant_ht: number; tva: number; montant_ttc: number; frais_livraison: number
      erp_commande_id: string | null
    }

    if (body.statut_commande === 'en_preparation' &&
        ['recue', 'confirmee'].includes(cmd.statut_commande)) {
      if (cmd.erp_commande_id) {
        const today = new Date().toISOString()
        await db.from('jobs_production').insert({
          numero:               `OF-${cmd.ref}`,
          commande_id:          cmd.erp_commande_id,
          produit_designation:  `Commande web ${cmd.ref}`,
          avancement_pct:       0,
          statut:               'confirmed',
          date_debut:           today,
        })
      }
    }

    if (body.statut_commande === 'livree' && cmd.statut_commande === 'expediee') {
      if (cmd.erp_commande_id) {
        const today     = new Date().toISOString().split('T')[0]
        const echeance  = new Date(Date.now() + 30 * 86400_000).toISOString().split('T')[0]
        const numeroFact = await genererNumero('factures', 'FAC')

        await db.from('factures').insert({
          numero:          numeroFact,
          commande_id:     cmd.erp_commande_id,
          client_nom:      cmd.client_nom,
          statut:          'valide',
          date_emission:   today,
          date_echeance:   echeance,
          total_ht_xaf:    Math.round(cmd.montant_ht ?? 0),
          tva_xaf:         Math.round(cmd.tva ?? 0),
          frais_livraison_xaf: Math.round(cmd.frais_livraison ?? 0),
          total_ttc_xaf:   Math.round(cmd.montant_ttc ?? 0),
          montant_paye_xaf: cmd.statut_paiement === 'paye' ? cmd.montant_ttc : 0,
          created_by:      user.id,
        })
      }
    }

    const updates: Record<string, string> = {
      statut_commande: body.statut_commande,
      updated_at:      new Date().toISOString(),
    }
    if (body.statut_paiement) updates.statut_paiement = body.statut_paiement

    const { data, error } = await db
      .from('commandes_shop')
      .update(updates)
      .eq('id', id)
      .select()
      .single()

    if (error) return c.json({ error: error.message }, 400)

    void notifyStatutChange(
      {
        ref:              cmd.ref,
        client_nom:       cmd.client_nom,
        client_telephone: cmd.client_telephone,
        montant_ttc:      cmd.montant_ttc,
        erp_commande_id:  cmd.erp_commande_id,
      },
      cmd.statut_commande,
      body.statut_commande,
    )

    if (cmd.erp_commande_id) {
      const ERP_STATUT: Record<string, string> = {
        en_preparation: 'in_production',
        expediee:       'pret',
        livree:         'delivered',
        annulee:        'cancelled',
      }
      const erpStatut = ERP_STATUT[body.statut_commande]
if (erpStatut) {
  await db
    .from('commandes')
    .update({ statut: erpStatut, updated_at: new Date().toISOString() })
    .eq('id', cmd.erp_commande_id)

  await db.from('historique_commandes').insert({
    commande_id:    cmd.erp_commande_id,
    ancien_statut:  cmd.statut_commande,
    nouveau_statut: erpStatut,
    commentaire:    `[Shop Web] ${body.statut_commande}`,
    changed_by:     user.id,
  })

  // ── Auto-création bon de sortie quand la commande web passe en préparation ──
  if (erpStatut === 'in_production' && cmd.erp_commande_id) {
    const { data: erpCmd } = await db
      .from('commandes')
      .select('numero')
      .eq('id', cmd.erp_commande_id)
      .single()

    if (erpCmd) {
      await creerBonSortieCommande(
        cmd.erp_commande_id,
        (erpCmd as { numero: string }).numero,
        user.id,
      ).catch((e) => console.error('[commerce] auto-bon-sortie web:', e))
    }
        }
      }
    } else if (body.statut_commande === 'en_preparation') {
      // Fallback : erp_commande_id absent — créer le bon depuis les lignes JSONB
      console.warn('[commerce] commande web sans erp_commande_id — bon de sortie depuis lignes JSONB')
      const numeroBon = `WEB-${cmd.ref}`
      const { data: bonExist } = await db
        .from('bons_sortie')
        .select('id')
        .eq('demandeur', cmd.ref)
        .maybeSingle()

      if (!bonExist) {
        const { data: bon } = await db.from('bons_sortie').insert({
          numero:      numeroBon,
          statut:      'en_attente',
          type:        'commande',
          demandeur:   cmd.ref,
          motif:       `Préparation commande web ${cmd.ref}`,
          notes:       `Client : ${cmd.client_nom} — ${cmd.client_telephone}`,
          created_by:  user.id,
          sync_status: 'synced',
        }).select('id').single()

        if (bon) {
          const lignesJson = (cmd.lignes ?? []).map((l: { designation: string; quantite: number }) => ({
            bon_id:            (bon as { id: string }).id,
            produit_id:        null,
            designation:       l.designation,
            unite:             'unité',
            quantite_demandee: l.quantite,
              quantite_servie:   0,
          }))
          if (lignesJson.length > 0) {
            await db.from('bons_sortie_lignes').insert(lignesJson)
          }
        } 
      }
    }

    return c.json(data)
  },
)

// ── Diagnostic backfill ────────────────────────────────────────────────────────

router.get(
  '/commandes/backfill-bons/debug',
  requireRole(['admin', 'superviseur']),
  async (c) => {
    const userId = c.get('user').id

    // Compter les commandes ERP in_production
    const { count: erpCount, error: e1 } = await db
      .from('commandes').select('*', { count: 'exact', head: true }).eq('statut', 'in_production')

    // Compter les commandes shop en_preparation
    const { count: shopCount, error: e2 } = await db
      .from('commandes_shop').select('*', { count: 'exact', head: true }).eq('statut_commande', 'en_preparation')

    // Compter les bons existants
    const { count: bonsCount, error: e3 } = await db
      .from('bons_sortie').select('*', { count: 'exact', head: true })

    // Test insert avec statut en_attente (sans type ni commande_id pour isoler)
    const t1 = await db.from('bons_sortie').insert({
      numero: 'DBG-STATUT', statut: 'en_attente',
      demandeur: 'debug', motif: 'debug', created_by: userId, sync_status: 'synced',
    }).select('id').single()
    const statut_test = t1.error ? `ECHEC: ${t1.error.message}` : 'OK'
    if (!t1.error && t1.data) await db.from('bons_sortie').delete().eq('id', (t1.data as {id:string}).id)

    // Test insert avec colonne type
    const t2 = await db.from('bons_sortie').insert({
      numero: 'DBG-TYPE', statut: 'soumis', type: 'commande',
      demandeur: 'debug', motif: 'debug', created_by: userId, sync_status: 'synced',
    }).select('id').single()
    const type_test = t2.error ? `ECHEC: ${t2.error.message}` : 'OK'
    if (!t2.error && t2.data) await db.from('bons_sortie').delete().eq('id', (t2.data as {id:string}).id)

    // Test insert avec montant_total_xaf
    const t3 = await db.from('bons_sortie').insert({
      numero: 'DBG-MONTANT', statut: 'soumis', type: 'commande',
      montant_total_xaf: 1000, demandeur: 'debug', motif: 'debug', created_by: userId, sync_status: 'synced',
    }).select('id').single()
    const montant_test = t3.error ? `ECHEC: ${t3.error.message}` : 'OK'
    if (!t3.error && t3.data) await db.from('bons_sortie').delete().eq('id', (t3.data as {id:string}).id)

    // Structure réelle des lignes JSONB + statuts des commandes
    const { data: shopSample } = await db
      .from('commandes_shop')
      .select('ref, statut_commande, erp_commande_id, lignes, montant_ttc')
      .eq('statut_commande', 'en_preparation')
      .limit(3)

    // Bons existants avec commande_id pour voir les doublons potentiels
    const { data: bonsSample } = await db
      .from('bons_sortie')
      .select('id, numero, statut, type, commande_id, demandeur')
      .order('created_at', { ascending: false })
      .limit(10)

    return c.json({
      erp_in_production:   erpCount ?? 0,
      shop_en_preparation: shopCount ?? 0,
      bons_existants:      bonsCount ?? 0,
      query_errors:        [e1?.message, e2?.message, e3?.message].filter(Boolean),
      test_statut_en_attente: statut_test,
      test_colonne_type:      type_test,
      test_colonne_montant:   montant_test,
      shop_sample:         shopSample,
      bons_sample:         bonsSample,
    })
  },
)

// ── Backfill : bons de sortie pour commandes existantes en production ──────────

type ShopLigne = { designation: string; quantite: number }

async function creerBonDepuisLignesJsonb(params: {
  commandeErpId:    string | null
  ref:              string
  clientNom:        string
  clientTel:        string
  lignes:           ShopLigne[]
  userId:           string
  montantTotalXaf?: number | null
}): Promise<{ ok: boolean; error?: string }> {
  const { commandeErpId, ref, clientNom, clientTel, lignes, userId, montantTotalXaf } = params

  if (lignes.length === 0) return { ok: false, error: 'lignes JSONB vides' }

  const today    = new Date()
  const yyyymmdd = today.toISOString().slice(0, 10).replace(/-/g, '')
  const startDay = `${today.toISOString().slice(0, 10)}T00:00:00.000Z`
  const { count } = await db
    .from('bons_sortie')
    .select('*', { count: 'exact', head: true })
    .gte('created_at', startDay)
  const numeroBon = `TAF-${yyyymmdd}-${String((count ?? 0) + 1).padStart(4, '0')}`

  const { data: bon, error: bonErr } = await db.from('bons_sortie').insert({
    numero:            numeroBon,
    statut:            'en_attente',
    type:              'commande',
    ...(commandeErpId ? { commande_id: commandeErpId } : {}),
    demandeur:         ref,
    motif:             `Préparation commande ${ref}`,
    montant_total_xaf: montantTotalXaf ?? null,
    notes:             `Client : ${clientNom} — ${clientTel}`,
    created_by:        userId,
    sync_status:       'synced',
  }).select('id').single()

  if (bonErr || !bon) return { ok: false, error: bonErr?.message ?? 'insert bon null' }

  const bonId    = (bon as { id: string }).id
  const bonLignes = lignes.map((l) => ({
    bon_id:            bonId,
    produit_id:        null,
    designation:       l.designation,
    unite:             'unité',
    quantite_demandee: l.quantite,
    quantite_servie:   0,
  }))

  const { error: ligErr } = await db.from('bons_sortie_lignes').insert(bonLignes)
  if (ligErr) {
    await db.from('bons_sortie').delete().eq('id', bonId)
    return { ok: false, error: `insert lignes: ${ligErr.message}` }
  }

  return { ok: true }
}

router.post(
  '/commandes/backfill-bons',
  requireRole(['admin', 'superviseur']),
  async (c) => {
    const user   = c.get('user')
    let created  = 0
    const errors: string[] = []

    // ── Branche 1 : commandes ERP in_production ───────────────────────────────
    const { data: erpCommandes, error: erpErr } = await db
      .from('commandes')
      .select('id, numero')
      .eq('statut', 'in_production')

    if (erpErr) return c.json({ error: erpErr.message }, 500)

    const erpIds = (erpCommandes ?? []).map((cmd) => cmd.id)

    // Bons déjà liés
    const { data: bonsDeja } = erpIds.length > 0
      ? await db.from('bons_sortie').select('commande_id').in('commande_id', erpIds)
      : { data: [] }
    const dejaLiees = new Set((bonsDeja ?? []).map((b) => b.commande_id).filter(Boolean))
    const manquantes = (erpCommandes ?? [] as { id: string; numero: string }[]).filter(
      (cmd) => !dejaLiees.has(cmd.id),
    )

    for (const cmd of manquantes as { id: string; numero: string }[]) {
      // Essai 1 : via commandes_lignes
      const { data: cmdLignes } = await db
        .from('commandes_lignes')
        .select('id')
        .eq('commande_id', cmd.id)
      const hasLignes = (cmdLignes ?? []).length > 0
      errors.push(`TRACE ERP ${cmd.numero}: commandes_lignes=${hasLignes ? (cmdLignes ?? []).length : 0}`)

      const ok = await creerBonSortieCommande(cmd.id, cmd.numero, user.id).catch((e) => {
        errors.push(`ERP ${cmd.numero} (commandes_lignes): ${(e as Error).message}`)
        return false
      })
      if (ok) { created++; continue }

      // Essai 2 : via lignes JSONB de commandes_shop liée
      const { data: shopCmd, error: shopFindErr } = await db
        .from('commandes_shop')
        .select('ref, client_nom, client_telephone, lignes, montant_ttc')
        .eq('erp_commande_id', cmd.id)
        .maybeSingle()

      if (shopFindErr) errors.push(`ERP ${cmd.numero}: shop query error: ${shopFindErr.message}`)

      if (!shopCmd) {
        errors.push(`ERP ${cmd.numero}: pas de commande shop liée et commandes_lignes vides`)
        continue
      }

      type SC = { ref: string; client_nom: string; client_telephone: string; lignes: ShopLigne[]; montant_ttc: number | null }
      const sc = shopCmd as SC
      errors.push(`TRACE ERP ${cmd.numero}: shop trouvée ref=${sc.ref} lignes=${(sc.lignes ?? []).length}`)

      const result = await creerBonDepuisLignesJsonb({
        commandeErpId:    cmd.id,
        ref:              sc.ref,
        clientNom:        sc.client_nom,
        clientTel:        sc.client_telephone,
        lignes:           sc.lignes ?? [],
        userId:           user.id,
        montantTotalXaf:  sc.montant_ttc,
      })
      if (result.ok) created++
      else errors.push(`ERP ${cmd.numero} (jsonb fallback): ${result.error}`)
    }

    // ── Branche 2 : commandes shop sans erp_commande_id ──────────────────────
    const { data: shopCommandes, error: shopErr } = await db
      .from('commandes_shop')
      .select('ref, client_nom, client_telephone, lignes, montant_ttc')
      .eq('statut_commande', 'en_preparation')
      .is('erp_commande_id', null)

    if (shopErr) errors.push(`shop query: ${shopErr.message}`)

    for (const cmd of (shopCommandes ?? []) as Array<{ ref: string; client_nom: string; client_telephone: string; lignes: ShopLigne[]; montant_ttc: number | null }>) {
      // Vérifier si un bon existe déjà pour ce ref
      const { data: bonExist } = await db
        .from('bons_sortie')
        .select('id').eq('demandeur', cmd.ref).eq('type', 'commande').maybeSingle()
      if (bonExist) continue

      const result = await creerBonDepuisLignesJsonb({
        commandeErpId:   null,
        ref:             cmd.ref,
        clientNom:       cmd.client_nom,
        clientTel:       cmd.client_telephone,
        lignes:          cmd.lignes ?? [],
        userId:          user.id,
        montantTotalXaf: cmd.montant_ttc,
      })
      if (result.ok) created++
      else errors.push(`Shop ${cmd.ref}: ${result.error}`)
    }

    return c.json({
      created,
      errors,
      message: created > 0
        ? `${created} bon(s) créé(s)`
        : errors.length > 0
          ? `0 créé — voir errors pour diagnostic`
          : 'Tous les bons sont déjà à jour',
    })
  },
)

export { router as commerceRouter, publicRouter as publicCommandesRouter, publicDevisRouter }
