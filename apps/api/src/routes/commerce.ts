import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { supabaseAdmin } from '@forge/db'
import { randomUUID } from 'node:crypto'

const db = supabaseAdmin!
import { requireRole } from '../middleware/rbac'
import { generateDevisPDF, uploadPDF } from '../services/pdf.service'
import { notifyStatutChange } from '../services/notifications'
import { enqueueEmail, notifyWhatsApp } from '../services/email-queue.service'
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
  client_id:             z.string().optional(),
  client_nom:            z.string().min(1),
  devis_id:              z.string().optional(),
  date_commande:         z.string(),
  date_livraison_prevue: z.string().optional(),
  notes:                 z.string().optional(),
  acompte_recu_xaf:      z.number().min(0).default(0),
  lignes:                z.array(commandeLigneSchema).min(1),
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
  return {
    id:                    row.id,
    reference:             row.numero,
    statut:                row.statut,
    date_commande:         row.date_commande,
    date_livraison_prevue: row.date_livraison_prevue ?? null,
    montant_ttc_xaf:       totalTtc,
    acompte_recu_xaf:      montantPaye,
    solde_restant_xaf:     Math.max(0, totalTtc - montantPaye),
    notes:                 row.notes ?? null,
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
      _rank: (row.nom as string).toLowerCase() === ql         ? 0   // exact
           : (row.nom as string).toLowerCase().startsWith(ql) ? 1   // préfixe
           :                                                     2,  // contient
    }))
    .sort((a, b) => a._rank - b._rank || (a.nom as string).localeCompare(b.nom as string))
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

  if (error) return c.json({ error: error.message }, 500)

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

router.post('/clients', requireRole(['directeur', 'admin']), zValidator('json', clientSchema), async (c) => {
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

router.put('/clients/:id', requireRole(['directeur', 'admin']), zValidator('json', clientSchema.partial()), async (c) => {
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

router.delete('/clients/:id', requireRole(['directeur']), async (c) => {
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

router.post('/devis', requireRole(['directeur', 'admin']), zValidator('json', devisSchema), async (c) => {
  const user = c.get('user')
  const body = c.req.valid('json')

  const numero   = await genererNumero('devis', 'DEV')
  const totaux   = calculerTotaux(body.lignes)

  const { data: devis, error: devisErr } = await db
    .from('devis')
    .insert({
      numero,
      client_id:           body.client_id ?? null,
      client_nom:          body.client_nom,
      statut:              'brouillon',
      date_emission:       body.date_emission,
      date_validite:       body.date_validite,
      validite_jours:      body.validite_jours,
      acompte_pct:         body.acompte_pct,
      conditions_paiement: body.conditions_paiement,
      notes:               body.notes ?? null,
      created_by:          user.id,
      sync_status:         'synced',
      ...totaux,
    })
    .select()
    .single()

  if (devisErr || !devis) return c.json({ error: devisErr?.message, code: devisErr?.code }, 400)

  const lignes = body.lignes.map((l, i) => ({
    devis_id:             (devis as { id: string }).id,
    designation:          l.designation,
    description:          l.description ?? null,
    categorie:            l.categorie,
    unite:                l.unite,
    quantite:             l.quantite,
    prix_unitaire_ht_xaf: l.prix_unitaire_ht_xaf,
    total_ht_xaf:         Math.round(l.quantite * l.prix_unitaire_ht_xaf),
    ordre:                l.ordre !== 0 ? l.ordre : i,
  }))

  const { data: lignesData, error: lignesErr } = await db
    .from('devis_lignes')
    .insert(lignes)
    .select()

  if (lignesErr) {
    await db.from('devis').delete().eq('id', (devis as { id: string }).id)
    return c.json({ error: lignesErr.message }, 400)
  }

  // Générer et uploader le PDF devis
  let pdf_url: string | null = null
  try {
    const dv = devis as { total_ht_xaf: number; tva_xaf: number; total_ttc_xaf: number }
    const pdfBuf = await generateDevisPDF(
      { numero, date_emission: body.date_emission, date_validite: body.date_validite, validite_jours: body.validite_jours, total_ht_xaf: dv.total_ht_xaf, tva_xaf: dv.tva_xaf, total_ttc_xaf: dv.total_ttc_xaf },
      { nom: body.client_nom },
      (lignesData ?? []) as { designation: string; unite: string; quantite: number; prix_unitaire_ht_xaf: number; total_ht_xaf: number }[],
    )
    pdf_url = await uploadPDF(pdfBuf, 'devis', `${numero}.pdf`)
    // Stocker l'URL PDF dans le devis
    if (pdf_url) {
      await db.from('devis').update({ pdf_url }).eq('id', (devis as { id: string }).id)
    }
  } catch (e) {
    console.error('[commerce] devis PDF error:', e)
  }

  return c.json({ ...devis, lignes: lignesData, pdf_url }, 201)
})

router.put('/devis/:id', requireRole(['directeur', 'admin']), zValidator('json', devisSchema.partial()), async (c) => {
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

router.patch('/devis/:id/statut', requireRole(['directeur', 'admin']), zValidator('json', z.object({
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

router.delete('/devis/:id', requireRole(['directeur', 'admin']), async (c) => {
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
 * Génère un token d'approbation, envoie par email (queue) + WhatsApp immédiat.
 */
router.post('/devis/:id/envoyer-approbation', requireRole(['directeur', 'admin']), async (c) => {
  const { id } = c.req.param()

  const { data: devis } = await db
    .from('devis')
    .select('statut, numero, client_nom, total_ttc_xaf, client_id')
    .eq('id', id)
    .single()

  if (!devis) return c.json({ error: 'Devis introuvable', code: 'NOT_FOUND' }, 404)

  const d = devis as { statut: string; numero: string; client_nom: string; total_ttc_xaf: number; client_id: string | null }

  if (['transforme', 'expire'].includes(d.statut)) {
    return c.json({ error: `Devis "${d.statut}" — envoi d'approbation impossible`, code: 'INVALID_STATUS' }, 422)
  }

  const token     = randomUUID()
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString() // 7 jours

  await db.from('devis').update({
    token_approbation: token,
    token_expires_at:  expiresAt,
    statut:            'envoye',
    updated_at:        new Date().toISOString(),
  }).eq('id', id)

  const frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:5173'
  const approvalUrl = `${frontendUrl}/devis/approuver/${token}`

  // Récupérer email du client si lié
  let clientEmail: string | null = null
  if (d.client_id) {
    const { data: cli } = await db.from('clients').select('email').eq('id', d.client_id).single()
    clientEmail = (cli as { email: string | null } | null)?.email ?? null
  }

  if (clientEmail) {
    await enqueueEmail({
      destinataire:   clientEmail,
      sujet:          `Devis ${d.numero} — Votre approbation est requise`,
      corps_html:     `
        <p>Bonjour,</p>
        <p>Veuillez consulter et approuver le devis <strong>${d.numero}</strong>
        d'un montant de <strong>${d.total_ttc_xaf.toLocaleString('fr-FR')} XAF TTC</strong>.</p>
        <p><a href="${approvalUrl}" style="background:#C62828;color:white;padding:12px 24px;border-radius:6px;text-decoration:none;display:inline-block">
          Consulter et approuver le devis
        </a></p>
        <p>Ce lien est valable 7 jours.</p>
        <p>Cordialement,<br>TAFDIL SARL</p>
      `,
      priorite:       'haute',
      reference_type: 'devis',
      reference_id:   id,
    })
  }

  // WhatsApp immédiat au directeur (notification interne)
  await notifyWhatsApp(
    process.env.DIRECTEUR_WHATSAPP_PHONE ?? '',
    `📋 Devis ${d.numero} envoyé à ${d.client_nom} pour approbation.\nLien : ${approvalUrl}`,
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

  // Notifier le directeur
  await notifyWhatsApp(
    process.env.DIRECTEUR_WHATSAPP_PHONE ?? '',
    body.decision === 'accepte'
      ? `✅ Devis ${d.numero} APPROUVÉ par ${d.client_nom}`
      : `❌ Devis ${d.numero} REFUSÉ par ${d.client_nom}${body.commentaire ? `\nMotif: ${body.commentaire}` : ''}`,
  )

  return c.json({ succes: true, decision: body.decision })
})

/** Transformer un devis en commande + réserver le stock */
router.post('/devis/:id/transformer-commande', requireRole(['directeur', 'admin']), async (c) => {
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
// COMMANDES
// ══════════════════════════════════════════════════════════════════════════════

router.get('/commandes', async (c) => {
  const { statut, client_id, search } = c.req.query()
  const page    = Math.max(1, parseInt(c.req.query('page') ?? '1'))
  const perPage = Math.min(100, Math.max(1, parseInt(c.req.query('per_page') ?? '20')))
  const from    = (page - 1) * perPage
  const to      = from + perPage - 1

  let query = db.from('commandes').select(
    '*, commandes_lignes(*), historique_commandes(nouveau_statut, commentaire, changed_at), clients(id, nom, telephone)',
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
      clients (nom, telephone, email, adresse)
    `)
    .eq('id', id)
    .single()

  if (error || !data) return c.json({ error: 'Commande introuvable', code: 'NOT_FOUND' }, 404)
  return c.json(mapCommande(data))
})

router.post('/commandes', requireRole(['directeur', 'admin']), zValidator('json', commandeSchema), async (c) => {
  const user = c.get('user')
  const body = c.req.valid('json')

  // ── Vérifier blocage client (crédit échu ou statut bloqué) ────────────────
  const blocageMsg = await verifierBlocageClient(body.client_id)
  if (blocageMsg) {
    return c.json({ error: blocageMsg, code: 'CLIENT_BLOQUE' }, 422)
  }

  const numero = await genererNumero('commandes', 'CMD')
  const totaux = calculerTotaux(body.lignes)

  const { data: commande, error: cmdErr } = await db
    .from('commandes')
    .insert({
      numero,
      client_id:             body.client_id ?? null,
      client_nom:            body.client_nom,
      devis_id:              body.devis_id ?? null,
      statut:                'confirmed',
      date_commande:         body.date_commande,
      date_livraison_prevue: body.date_livraison_prevue ?? null,
      acompte_recu_xaf:      body.acompte_recu_xaf,
      notes:                 body.notes ?? null,
      created_by:            user.id,
      sync_status:           'synced',
      ...totaux,
    })
    .select()
    .single()

  if (cmdErr || !commande) return c.json({ error: cmdErr?.message, code: cmdErr?.code }, 400)

  const cmd = commande as { id: string }

  const lignes = body.lignes.map((l, i) => ({
    commande_id:          cmd.id,
    produit_id:           l.produit_id ?? null,
    designation:          l.designation,
    unite:                l.unite,
    quantite:             l.quantite,
    prix_unitaire_ht_xaf: l.prix_unitaire_ht_xaf,
    total_ht_xaf:         Math.round(l.quantite * l.prix_unitaire_ht_xaf),
    ordre:                l.ordre !== 0 ? l.ordre : i,
  }))

  const { error: lignesErr } = await db.from('commandes_lignes').insert(lignes)
  if (lignesErr) {
    await db.from('commandes').delete().eq('id', cmd.id)
    return c.json({ error: lignesErr.message }, 400)
  }

  await db.from('historique_commandes').insert({
    commande_id:    cmd.id,
    ancien_statut:  null,
    nouveau_statut: 'confirmed',
    commentaire:    'Commande créée',
    changed_by:     user.id,
  })

  const { data: full, error: fullErr } = await db
    .from('commandes')
    .select('*, commandes_lignes(*), historique_commandes(nouveau_statut, commentaire, changed_at), clients(id, nom, telephone)')
    .eq('id', cmd.id)
    .single()

  if (fullErr || !full) return c.json(commande, 201)
  return c.json(mapCommande(full), 201)
})

/** Changer le statut avec validation des transitions */
router.patch(
  '/commandes/:id/statut',
  requireRole(['directeur', 'admin', 'operateur']),
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

    // Recalculer le score fiabilité si livraison complète ou annulation
    if (ex.client_id && ['delivered', 'cancelled'].includes(body.statut)) {
      recalculerScoreFiabilite(ex.client_id).catch(e =>
        console.error('[commerce] score_fiabilite recalcul:', e)
      )
    }

    const { data: full } = await db
      .from('commandes')
      .select('*, commandes_lignes(*), historique_commandes(nouveau_statut, commentaire, changed_at), clients(id, nom, telephone)')
      .eq('id', id)
      .single()

    return c.json(full ? mapCommande(full) : { id, statut: body.statut })
  },
)

router.delete('/commandes/:id', requireRole(['directeur']), async (c) => {
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
  requireRole(['directeur', 'admin', 'operateur']),
  zValidator('json', paiementCommandeSchema),
  async (c) => {
    const { id } = c.req.param()
    const user   = c.get('user')
    const body   = c.req.valid('json')

    const { data: commande } = await db
      .from('commandes')
      .select('numero, client_id, client_nom, total_ttc_xaf, montant_paye_xaf, statut')
      .eq('id', id)
      .single()

    if (!commande) return c.json({ error: 'Commande introuvable', code: 'NOT_FOUND' }, 404)

    const cmd = commande as {
      numero: string; client_id: string | null; client_nom: string
      total_ttc_xaf: number; montant_paye_xaf: number; statut: string
    }

    const soldeRestant = Math.max(0, cmd.total_ttc_xaf - cmd.montant_paye_xaf)
    if (body.montant_xaf > soldeRestant + 1) {  // +1 tolérance arrondi
      return c.json({
        error: `Montant dépasse le solde restant (${soldeRestant.toLocaleString()} XAF)`,
        code: 'AMOUNT_EXCEEDED',
      }, 422)
    }

    const { data: paiement, error: pErr } = await db
      .from('paiements_commande')
      .insert({
        commande_id:    id,
        client_id:      cmd.client_id,
        montant_xaf:    body.montant_xaf,
        methode:        body.methode,
        reference_ext:  body.reference_ext ?? null,
        statut:         'confirme',
        date_paiement:  body.date_paiement,
        notes:          body.notes ?? null,
        enregistre_par: user.id,
      })
      .select().single()

    if (pErr) return c.json({ error: pErr.message }, 400)

    const nouveauMontantPaye = Math.min(cmd.total_ttc_xaf, cmd.montant_paye_xaf + body.montant_xaf)
    await db.from('commandes').update({
      montant_paye_xaf: nouveauMontantPaye,
      updated_at:       new Date().toISOString(),
    }).eq('id', id)

    const soldeApres = Math.max(0, cmd.total_ttc_xaf - nouveauMontantPaye)

    if (soldeApres <= 0) {
      await notifyWhatsApp(
        process.env.DIRECTEUR_WHATSAPP_PHONE ?? '',
        `✅ Commande ${cmd.numero} soldée intégralement par ${cmd.client_nom}`,
      )
    }

    return c.json({ paiement, montant_paye_xaf: nouveauMontantPaye, solde_restant_xaf: soldeApres }, 201)
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
  requireRole(['directeur', 'admin', 'operateur']),
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
      montant_ttc: number; erp_commande_id: string | null
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
          total_ht_xaf:    Math.round(cmd.montant_ttc / 1.1925),
          tva_xaf:         Math.round(cmd.montant_ttc - cmd.montant_ttc / 1.1925),
          total_ttc_xaf:   cmd.montant_ttc,
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
      }
    }

    return c.json(data)
  },
)

export { router as commerceRouter, publicRouter as publicCommandesRouter, publicDevisRouter }
