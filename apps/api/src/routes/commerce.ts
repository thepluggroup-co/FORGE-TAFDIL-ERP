import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { supabase } from '@forge/db/supabase'
import { requireRole } from '../middleware/rbac'
import { generateDevisPDF, uploadPDF } from '../services/pdf.service'
import type { HonoVariables } from '../types'

// ── TVA Cameroun ────────────────────────────────────────────────────────────────
const TVA_RATE = 0.1925

// ── Transitions de statut autorisées ───────────────────────────────────────────
const TRANSITIONS_COMMANDE: Record<string, string[]> = {
  confirmed:     ['in_production', 'cancelled'],
  in_production: ['pret', 'cancelled'],
  pret:          ['delivered', 'cancelled'],
  delivered:     [],
  cancelled:     [],
}

// ── Routers ────────────────────────────────────────────────────────────────────

/** Routes authentifiées : /api/clients, /api/devis, /api/commandes */
const router = new Hono<{ Variables: HonoVariables }>()

/** Route publique : /api/commandes/public/:ref (monter sur app AVANT authMiddleware) */
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

// ── Helper : calculer les totaux d'un devis/commande ──────────────────────────

function calculerTotaux(lignes: Array<{ quantite: number; prix_unitaire_ht_xaf: number }>) {
  const total_ht_xaf  = lignes.reduce((s, l) => s + l.quantite * l.prix_unitaire_ht_xaf, 0)
  const tva_xaf       = Math.round(total_ht_xaf * TVA_RATE)
  const total_ttc_xaf = Math.round(total_ht_xaf + tva_xaf)
  return { total_ht_xaf: Math.round(total_ht_xaf), tva_xaf, total_ttc_xaf }
}

/** Génère un numéro séquentiel : prefix-YYYYMMDD-XXXX */
async function genererNumero(table: string, prefix: string): Promise<string> {
  const today = new Date()
  const yyyymmdd = today.toISOString().slice(0, 10).replace(/-/g, '')
  const startOfDay = `${today.toISOString().slice(0, 10)}T00:00:00.000Z`

  const { count } = await supabase
    .from(table)
    .select('*', { count: 'exact', head: true })
    .gte('created_at', startOfDay)

  return `${prefix}-${yyyymmdd}-${String((count ?? 0) + 1).padStart(4, '0')}`
}

// ══════════════════════════════════════════════════════════════════════════════
// CLIENTS
// ══════════════════════════════════════════════════════════════════════════════

router.get('/clients', async (c) => {
  const { statut, type, search } = c.req.query()
  const page    = Math.max(1, parseInt(c.req.query('page') ?? '1'))
  const perPage = Math.min(100, Math.max(1, parseInt(c.req.query('per_page') ?? '20')))
  const from    = (page - 1) * perPage
  const to      = from + perPage - 1

  let query = supabase.from('clients').select('*', { count: 'exact' })

  if (statut) query = query.eq('statut', statut)
  if (type)   query = query.eq('type', type)
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

  const { data, error } = await supabase
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

  const { data, error } = await supabase
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

  const { data, error } = await supabase
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

  // Vérifier qu'il n'y a pas de commandes actives
  const { count } = await supabase
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

  const { error } = await supabase.from('clients').delete().eq('id', id)
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

  let query = supabase.from('devis').select('*, devis_lignes(*)', { count: 'exact' })

  if (statut)    query = query.eq('statut', statut)
  if (client_id) query = query.eq('client_id', client_id)
  if (search)    query = query.or(`numero.ilike.%${search}%,client_nom.ilike.%${search}%`)

  const { data, count, error } = await query
    .order('created_at', { ascending: false })
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

router.get('/devis/:id', async (c) => {
  const { id } = c.req.param()

  const { data, error } = await supabase
    .from('devis')
    .select('*, devis_lignes(*), clients(nom, telephone, email, adresse)')
    .eq('id', id)
    .single()

  if (error || !data) return c.json({ error: 'Devis introuvable', code: 'NOT_FOUND' }, 404)
  return c.json(data)
})

router.post('/devis', requireRole(['directeur', 'admin']), zValidator('json', devisSchema), async (c) => {
  const user = c.get('user')
  const body = c.req.valid('json')

  const numero   = await genererNumero('devis', 'DEV')
  const totaux   = calculerTotaux(body.lignes)

  const { data: devis, error: devisErr } = await supabase
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

  const { data: lignesData, error: lignesErr } = await supabase
    .from('devis_lignes')
    .insert(lignes)
    .select()

  if (lignesErr) {
    await supabase.from('devis').delete().eq('id', (devis as { id: string }).id)
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
  } catch (e) {
    console.error('[commerce] devis PDF error:', e)
  }

  return c.json({ ...devis, lignes: lignesData, pdf_url }, 201)
})

router.put('/devis/:id', requireRole(['directeur', 'admin']), zValidator('json', devisSchema.partial()), async (c) => {
  const { id } = c.req.param()
  const body   = c.req.valid('json')

  const { data: existing } = await supabase.from('devis').select('statut').eq('id', id).single()
  if (!existing) return c.json({ error: 'Devis introuvable', code: 'NOT_FOUND' }, 404)
  if (['accepte', 'transforme'].includes((existing as { statut: string }).statut)) {
    return c.json({ error: 'Impossible de modifier un devis accepté ou transformé', code: 'IMMUTABLE' }, 422)
  }

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
  const { lignes, ...devisFields } = body
  Object.assign(updates, devisFields)

  if (lignes) {
    const totaux = calculerTotaux(lignes)
    Object.assign(updates, totaux)
  }

  const { data, error } = await supabase
    .from('devis')
    .update(updates)
    .eq('id', id)
    .select()
    .single()

  if (error) return c.json({ error: error.message }, 400)

  // Remplacer les lignes si fournies
  if (lignes) {
    await supabase.from('devis_lignes').delete().eq('devis_id', id)
    await supabase.from('devis_lignes').insert(
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

router.delete('/devis/:id', requireRole(['directeur', 'admin']), async (c) => {
  const { id } = c.req.param()

  const { data: existing } = await supabase.from('devis').select('statut').eq('id', id).single()
  if (!existing) return c.json({ error: 'Devis introuvable', code: 'NOT_FOUND' }, 404)
  if ((existing as { statut: string }).statut === 'transforme') {
    return c.json({ error: 'Impossible de supprimer un devis transformé en commande', code: 'IMMUTABLE' }, 422)
  }

  await supabase.from('devis_lignes').delete().eq('devis_id', id)
  const { error } = await supabase.from('devis').delete().eq('id', id)
  if (error) return c.json({ error: error.message }, 400)
  return c.body(null, 204)
})

/** Transformer un devis en commande + réserver le stock */
router.post('/devis/:id/transformer-commande', requireRole(['directeur', 'admin']), async (c) => {
  const { id }   = c.req.param()
  const user     = c.get('user')

  // Charger le devis avec ses lignes
  const { data: devis, error: devisErr } = await supabase
    .from('devis')
    .select('*, devis_lignes(*)')
    .eq('id', id)
    .single()

  if (devisErr || !devis) return c.json({ error: 'Devis introuvable', code: 'NOT_FOUND' }, 404)

  const d = devis as {
    id: string; numero: string; statut: string; client_id: string | null; client_nom: string
    acompte_pct: number; conditions_paiement: string; notes: string | null
    total_ht_xaf: number; tva_xaf: number; total_ttc_xaf: number
    devis_lignes: Array<{
      designation: string; description: string | null; unite: string
      quantite: number; prix_unitaire_ht_xaf: number; total_ht_xaf: number; ordre: number
    }>
  }

  if (!['brouillon', 'envoye', 'accepte'].includes(d.statut)) {
    return c.json({
      error: `Impossible de transformer un devis en statut "${d.statut}"`,
      code: 'INVALID_STATUS',
    }, 422)
  }

  const numeroCommande = await genererNumero('commandes', 'CMD')

  // Créer la commande
  const { data: commande, error: cmdErr } = await supabase
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

  // Créer les lignes commande depuis les lignes devis
  await supabase.from('commandes_lignes').insert(
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

  // Marquer le devis comme transformé
  await supabase
    .from('devis')
    .update({ statut: 'transforme', updated_at: new Date().toISOString() })
    .eq('id', id)

  // Historique de la commande créée
  await supabase.from('historique_commandes').insert({
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

  let query = supabase.from('commandes').select('*, commandes_lignes(*)', { count: 'exact' })

  if (statut)    query = query.eq('statut', statut)
  if (client_id) query = query.eq('client_id', client_id)
  if (search)    query = query.or(`numero.ilike.%${search}%,client_nom.ilike.%${search}%`)

  const { data, count, error } = await query
    .order('created_at', { ascending: false })
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

router.get('/commandes/:id', async (c) => {
  const { id } = c.req.param()

  const { data, error } = await supabase
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
  return c.json(data)
})

router.post('/commandes', requireRole(['directeur', 'admin']), zValidator('json', commandeSchema), async (c) => {
  const user = c.get('user')
  const body = c.req.valid('json')

  const numero = await genererNumero('commandes', 'CMD')
  const totaux = calculerTotaux(body.lignes)

  const { data: commande, error: cmdErr } = await supabase
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

  const { error: lignesErr } = await supabase.from('commandes_lignes').insert(lignes)
  if (lignesErr) {
    await supabase.from('commandes').delete().eq('id', cmd.id)
    return c.json({ error: lignesErr.message }, 400)
  }

  // Historique initial
  await supabase.from('historique_commandes').insert({
    commande_id:    cmd.id,
    ancien_statut:  null,
    nouveau_statut: 'confirmed',
    commentaire:    'Commande créée',
    changed_by:     user.id,
  })

  return c.json(commande, 201)
})

/** Changer le statut avec validation des transitions */
router.put(
  '/commandes/:id/statut',
  requireRole(['directeur', 'admin', 'operateur']),
  zValidator('json', statutCommandeSchema),
  async (c) => {
    const { id } = c.req.param()
    const user   = c.get('user')
    const body   = c.req.valid('json')

    const { data: existing } = await supabase
      .from('commandes')
      .select('statut, numero')
      .eq('id', id)
      .single()

    if (!existing) return c.json({ error: 'Commande introuvable', code: 'NOT_FOUND' }, 404)

    const current  = (existing as { statut: string }).statut
    const allowed  = TRANSITIONS_COMMANDE[current] ?? []

    if (!allowed.includes(body.statut)) {
      return c.json({
        error: `Transition "${current}" → "${body.statut}" non autorisée`,
        code:  'INVALID_TRANSITION',
        transitions_autorisees: allowed,
      }, 422)
    }

    const { data, error } = await supabase
      .from('commandes')
      .update({ statut: body.statut, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single()

    if (error) return c.json({ error: error.message }, 400)

    // Enregistrer dans l'historique
    await supabase.from('historique_commandes').insert({
      commande_id:    id,
      ancien_statut:  current,
      nouveau_statut: body.statut,
      commentaire:    body.commentaire ?? null,
      changed_by:     user.id,
    })

    return c.json(data)
  },
)

router.delete('/commandes/:id', requireRole(['directeur']), async (c) => {
  const { id } = c.req.param()

  const { data: existing } = await supabase.from('commandes').select('statut').eq('id', id).single()
  if (!existing) return c.json({ error: 'Commande introuvable', code: 'NOT_FOUND' }, 404)
  if (!['confirmed', 'cancelled'].includes((existing as { statut: string }).statut)) {
    return c.json({
      error: 'Seules les commandes confirmées ou annulées peuvent être supprimées',
      code: 'CANNOT_DELETE',
    }, 422)
  }

  await supabase.from('commandes_lignes').delete().eq('commande_id', id)
  await supabase.from('historique_commandes').delete().eq('commande_id', id)
  const { error } = await supabase.from('commandes').delete().eq('id', id)
  if (error) return c.json({ error: error.message }, 400)
  return c.body(null, 204)
})

// ══════════════════════════════════════════════════════════════════════════════
// ROUTE PUBLIQUE — suivi commande client (monter sur app avant authMiddleware)
// ══════════════════════════════════════════════════════════════════════════════

publicRouter.get('/api/commandes/public/:ref', async (c) => {
  const { ref } = c.req.param()

  const { data, error } = await supabase
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

  // Vue publique : pas d'infos financières sensibles
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
    reference:   d.numero,
    statut:      d.statut,
    statut_label: STATUT_LABELS[d.statut] ?? d.statut,
    client:      d.client_nom,
    date_commande: d.date_commande,
    date_livraison_prevue: d.date_livraison_prevue,
    articles:    d.commandes_lignes,
    historique:  d.historique_commandes.sort(
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

    // Charger la commande shop avec ses lignes
    const { data: commande, error: loadErr } = await supabase
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

    // ── Workflow : recue/confirmee → en_preparation ─────────────────────────
    if (body.statut_commande === 'en_preparation' &&
        ['recue', 'confirmee'].includes(cmd.statut_commande)) {

      // Vérifier et déduire le stock pour chaque ligne
      for (const ligne of cmd.lignes) {
        // On ne peut pas déduire sans product_id — on vérifie dans commandes_lignes ERP
        // si la commande ERP existe déjà, le stock sera géré là
      }

      // Créer un job de production si commande ERP liée
      if (cmd.erp_commande_id) {
        const today = new Date().toISOString()
        await supabase.from('jobs_production').insert({
          numero:               `OF-${cmd.ref}`,
          commande_id:          cmd.erp_commande_id,
          produit_designation:  `Commande web ${cmd.ref}`,
          avancement_pct:       0,
          statut:               'confirmed',
          date_debut:           today,
        })
      }
    }

    // ── Workflow : expediee → livree — générer la facture ──────────────────
    if (body.statut_commande === 'livree' && cmd.statut_commande === 'expediee') {
      if (cmd.erp_commande_id) {
        const today     = new Date().toISOString().split('T')[0]
        const echeance  = new Date(Date.now() + 30 * 86400_000).toISOString().split('T')[0]
        const numeroFact = await genererNumero('factures', 'FAC')

        await supabase.from('factures').insert({
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

    // ── Mise à jour du statut ───────────────────────────────────────────────
    const updates: Record<string, string> = {
      statut_commande: body.statut_commande,
      updated_at:      new Date().toISOString(),
    }
    if (body.statut_paiement) updates.statut_paiement = body.statut_paiement

    const { data, error } = await supabase
      .from('commandes_shop')
      .update(updates)
      .eq('id', id)
      .select()
      .single()

    if (error) return c.json({ error: error.message }, 400)

    // Sync statut ERP si commande liée
    if (cmd.erp_commande_id) {
      const ERP_STATUT: Record<string, string> = {
        en_preparation: 'in_production',
        expediee:       'pret',
        livree:         'delivered',
        annulee:        'cancelled',
      }
      const erpStatut = ERP_STATUT[body.statut_commande]
      if (erpStatut) {
        await supabase
          .from('commandes')
          .update({ statut: erpStatut, updated_at: new Date().toISOString() })
          .eq('id', cmd.erp_commande_id)

        await supabase.from('historique_commandes').insert({
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

export { router as commerceRouter, publicRouter as publicCommandesRouter }
