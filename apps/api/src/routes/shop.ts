import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { supabaseAdmin } from '@forge/db'

const db = supabaseAdmin!
import type { HonoVariables } from '../types'

// ── Constantes ─────────────────────────────────────────────────────────────────

const TVA_RATE = 0.1925

const TARIFS_LIVRAISON: Record<string, { tarif: number; delaiJours: number }> = {
  'douala':         { tarif: 2000,  delaiJours: 1 },
  'douala_banlieue':{ tarif: 3500,  delaiJours: 1 },
  'yaounde':        { tarif: 8000,  delaiJours: 2 },
  'bafoussam':      { tarif: 10000, delaiJours: 3 },
  'autre':          { tarif: 15000, delaiJours: 5 },
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function genRef(): string {
  const year = new Date().getFullYear()
  const seq  = String(Math.floor(Math.random() * 9000) + 1000) // simplifié — voir note ci-dessous
  return `WEB-${year}-${seq}`
}

function disponibilite(stock: number, seuil: number): 'disponible' | 'stock_faible' | 'indisponible' {
  if (stock <= 0)      return 'indisponible'
  if (stock <= seuil)  return 'stock_faible'
  return 'disponible'
}

// ── Schémas Zod ────────────────────────────────────────────────────────────────

const ligneCommandeSchema = z.object({
  product_id:      z.string().uuid(),
  designation:     z.string().min(1),
  quantite:        z.number().positive(),
  prix_unitaire:   z.number().min(0),
})

const commandeShopSchema = z.object({
  client_nom:       z.string().min(2).max(200),
  client_telephone: z.string().min(8).max(20),
  client_email:     z.string().email().optional(),
  client_adresse:   z.string().min(5),
  client_ville:     z.string().optional(),
  lignes:           z.array(ligneCommandeSchema).min(1),
  mode_paiement:    z.enum(['mtn_momo', 'orange_money', 'livraison']),
  notes_client:     z.string().max(500).optional(),
  frais_livraison:  z.number().min(0).default(0),
})

const devisWebSchema = z.object({
  nom:          z.string().min(2).max(200),
  telephone:    z.string().min(8).max(20),
  email:        z.string().email().optional(),
  description:  z.string().min(10).max(2000),
  type_projet:  z.string().max(100).optional(),
  produit_ref:  z.string().max(50).optional(),
})

// ── Router ─────────────────────────────────────────────────────────────────────

export const shopRouter = new Hono()

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/shop/catalogue
// Liste des produits visibles — cache 60s
// ══════════════════════════════════════════════════════════════════════════════

shopRouter.get('/catalogue', async (c) => {
  const { categorie, q } = c.req.query()

  const client = db
  let query = client
    .from('produits_shop')
    .select(`
      product_id,
      prix_public,
      description_longue,
      images,
      tags,
      delai_fabrication_jours,
      min_commande,
      produits!inner (
        ref, designation, categorie, stock_actuel, stock_min, unite, statut
      )
    `)
    .eq('visible_shop', true)
    .order('updated_at', { ascending: false })

  if (categorie) {
    query = query.eq('produits.categorie', categorie)
  }
  if (q) {
    query = query.ilike('produits.designation', `%${q}%`)
  }

  const { data, error } = await query

  if (error) {
    console.error('[shop/catalogue] DB error:', JSON.stringify(error))
    return c.json({ error: 'Erreur catalogue', code: 'DB_ERROR', details: error.message }, 500)
  }

  const catalogue = (data ?? []).map((row: any) => {
    const p = row.produits
    return {
      id:                    row.product_id,
      ref:                   p.ref,
      nom:                   p.designation,
      categorie:             p.categorie,
      unite:                 p.unite,
      stock_actuel:          p.stock_actuel,
      seuil_alerte:          p.stock_min,
      prix_public:           row.prix_public,
      description_longue:    row.description_longue,
      images:                row.images ?? [],
      tags:                  row.tags ?? [],
      delai_fabrication_jours: row.delai_fabrication_jours,
      min_commande:          row.min_commande,
      disponibilite:         disponibilite(p.stock_actuel, p.stock_min),
    }
  })

  c.header('Cache-Control', 'public, max-age=60, stale-while-revalidate=30')
  return c.json({ data: catalogue, total: catalogue.length })
})

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/shop/catalogue/:id
// Détail d'un produit avec stock temps réel (pas de cache)
// ══════════════════════════════════════════════════════════════════════════════

shopRouter.get('/catalogue/:id', async (c) => {
  const id = c.req.param('id')

  const { data, error } = await db
    .from('produits_shop')
    .select(`
      product_id,
      prix_public,
      description_longue,
      images,
      tags,
      delai_fabrication_jours,
      min_commande,
      produits!inner (
        ref, designation, description, categorie, stock_actuel, stock_min, stock_critique, unite, statut, fournisseur
      )
    `)
    .eq('product_id', id)
    .eq('visible_shop', true)
    .single()

  if (error || !data) {
    return c.json({ error: 'Produit introuvable', code: 'NOT_FOUND' }, 404)
  }

  const p = (data as any).produits
  return c.json({
    data: {
      id:                    data.product_id,
      ref:                   p.ref,
      nom:                   p.designation,
      description:           p.description,
      categorie:             p.categorie,
      unite:                 p.unite,
      stock_actuel:          p.stock_actuel,
      seuil_alerte:          p.stock_min,
      prix_public:           data.prix_public,
      description_longue:    data.description_longue,
      images:                data.images ?? [],
      tags:                  data.tags ?? [],
      delai_fabrication_jours: data.delai_fabrication_jours,
      min_commande:          data.min_commande,
      disponibilite:         disponibilite(p.stock_actuel, p.stock_min),
    },
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/shop/categories
// Catégories ayant au moins 1 produit visible
// ══════════════════════════════════════════════════════════════════════════════

shopRouter.get('/categories', async (c) => {
  const { data, error } = await db
    .from('produits_shop')
    .select('produits!inner(categorie)')
    .eq('visible_shop', true)

  if (error) {
    return c.json({ error: 'Erreur catégories', code: 'DB_ERROR' }, 500)
  }

  const categories = [...new Set((data ?? []).map((r: any) => r.produits.categorie))].sort()

  c.header('Cache-Control', 'public, max-age=300')
  return c.json({ data: categories })
})

// ══════════════════════════════════════════════════════════════════════════════
// POST /api/shop/commandes
// Créer une commande web (sans auth)
// ══════════════════════════════════════════════════════════════════════════════

shopRouter.post('/commandes', zValidator('json', commandeShopSchema), async (c) => {
  const body = c.req.valid('json')

  // 1. Vérifier disponibilité stock pour chaque ligne
  for (const ligne of body.lignes) {
    const { data: produit } = await db
      .from('produits')
      .select('id, designation, stock_actuel, unite')
      .eq('id', ligne.product_id)
      .single()

    if (!produit) {
      return c.json({
        error: `Produit introuvable : ${ligne.product_id}`,
        code: 'PRODUCT_NOT_FOUND',
      }, 404)
    }

    if (produit.stock_actuel < ligne.quantite) {
      return c.json({
        error: 'Stock insuffisant',
        code: 'STOCK_INSUFFISANT',
        details: {
          product_id:   ligne.product_id,
          designation:  produit.designation,
          stock_actuel: produit.stock_actuel,
          demande:      ligne.quantite,
          unite:        produit.unite,
        },
      }, 409)
    }
  }

  // 2. Calculer montants
  const montant_ht  = body.lignes.reduce((s, l) => s + l.quantite * l.prix_unitaire, 0) + body.frais_livraison
  const tva         = Math.round(montant_ht * TVA_RATE)
  const montant_ttc = Math.round(montant_ht + tva)

  // 3. Générer référence unique
  const ref = genRef()

  // 4. Lignes JSONB
  const lignesJson = body.lignes.map((l) => ({
    product_id:     l.product_id,   // requis pour décréments stock webhook
    designation:    l.designation,
    quantite:       l.quantite,
    prix_unitaire:  l.prix_unitaire,
    total_ht:       Math.round(l.quantite * l.prix_unitaire),
  }))

  // 5. Insérer commande_shop
  const { data: commandeShop, error: errShop } = await db
    .from('commandes_shop')
    .insert({
      ref,
      client_nom:       body.client_nom,
      client_telephone: body.client_telephone,
      client_email:     body.client_email ?? null,
      client_adresse:   body.client_adresse,
      client_ville:     body.client_ville ?? null,
      lignes:           lignesJson,
      montant_ht,
      tva,
      montant_ttc,
      frais_livraison:  body.frais_livraison,
      mode_paiement:    body.mode_paiement,
      notes_client:     body.notes_client ?? null,
      statut_commande:  'recue',
      statut_paiement:  'en_attente',
    })
    .select('id, ref')
    .single()

  if (errShop || !commandeShop) {
    console.error('[shop] insert commandes_shop:', errShop)
    return c.json({ error: 'Erreur création commande', code: 'DB_ERROR' }, 500)
  }

  // 6. Créer la commande ERP en miroir (source web)
  const today = new Date().toISOString().split('T')[0]
  const { data: erpCommande } = await db
    .from('commandes')
    .insert({
      numero:              ref,
      client_nom:          body.client_nom,
      statut:              'confirmed',
      date_commande:       today,
      total_ht_xaf:        montant_ht,
      tva_xaf:             tva,
      total_ttc_xaf:       montant_ttc,
      notes:               `[SOURCE WEB] ${body.notes_client ?? ''}`.trim(),
    })
    .select('id')
    .single()

  // 7. Lier commande_shop → commande ERP
  if (erpCommande?.id) {
    await db
      .from('commandes_shop')
      .update({ erp_commande_id: erpCommande.id })
      .eq('id', commandeShop.id)

    // Insérer les lignes ERP
    const lignesErp = body.lignes.map((l, i) => ({
      commande_id:          erpCommande.id,
      produit_id:           l.product_id,
      designation:          l.designation,
      quantite:             l.quantite,
      prix_unitaire_ht_xaf: l.prix_unitaire,
      total_ht_xaf:         Math.round(l.quantite * l.prix_unitaire),
      ordre:                i,
    }))
    await db.from('commandes_lignes').insert(lignesErp)
  }

  // 8. Notifier ERP via Realtime (broadcast sur canal dédié)
  await db.channel('commandes_web_nouvelles').send({
    type:    'broadcast',
    event:   'nouvelle_commande_web',
    payload: { ref, montant_ttc, client: body.client_nom },
  })

  return c.json({ ref, montant_ttc, statut: 'recue' }, 201)
})

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/shop/commandes/:ref
// Suivi public par référence (sans auth)
// ══════════════════════════════════════════════════════════════════════════════

shopRouter.get('/commandes/:ref', async (c) => {
  const ref = c.req.param('ref')

  const { data, error } = await db
    .from('commandes_shop')
    .select('ref, statut_commande, statut_paiement, mode_paiement, payment_reference, lignes, montant_ttc, frais_livraison, created_at, updated_at, client_ville, photos_livraison')
    .eq('ref', ref)
    .single()

  if (error || !data) {
    return c.json({ error: 'Commande introuvable', code: 'NOT_FOUND' }, 404)
  }

  return c.json({ data })
})

// ══════════════════════════════════════════════════════════════════════════════
// POST /api/shop/devis
// Soumettre une demande de devis web
// ══════════════════════════════════════════════════════════════════════════════

shopRouter.post('/devis', zValidator('json', devisWebSchema), async (c) => {
  const body = c.req.valid('json')

  const { data, error } = await db
    .from('demandes_devis_web')
    .insert({
      nom:          body.nom,
      telephone:    body.telephone,
      email:        body.email ?? null,
      description:  body.description,
      type_projet:  body.type_projet ?? null,
      produit_ref:  body.produit_ref ?? null,
      statut:       'nouvelle',
    })
    .select('id, created_at')
    .single()

  if (error || !data) {
    console.error('[shop] insert demandes_devis_web:', error)
    return c.json({ error: 'Erreur enregistrement devis', code: 'DB_ERROR' }, 500)
  }

  // Notifier l'ERP
  await db.channel('commandes_web_nouvelles').send({
    type:    'broadcast',
    event:   'nouvelle_demande_devis',
    payload: { id: data.id, nom: body.nom, telephone: body.telephone },
  })

  return c.json({ id: data.id, statut: 'nouvelle', created_at: data.created_at }, 201)
})

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/shop/livraison/tarifs?ville=douala
// Tarifs et délais de livraison par zone
// ══════════════════════════════════════════════════════════════════════════════

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/shop/realisations?limit=N
// Images du portfolio depuis Supabase Storage (bucket 'realisations')
// ══════════════════════════════════════════════════════════════════════════════

shopRouter.get('/realisations', async (c) => {
  const limit = Math.min(30, Math.max(1, parseInt(c.req.query('limit') ?? '10')))

  const { data, error } = await db.storage
    .from('realisations')
    .list('', { limit, sortBy: { column: 'created_at', order: 'desc' } })

  if (error) {
    return c.json({ data: [] })
  }

  const baseUrl = `${process.env.SUPABASE_URL}/storage/v1/object/public/realisations`

  const realisations = (data ?? [])
    .filter((f) => /\.(jpg|jpeg|png|webp|avif)$/i.test(f.name))
    .map((f) => ({
      id:        f.id ?? f.name,
      url:       `${baseUrl}/${f.name}`,
      alt:       f.name.replace(/[-_]/g, ' ').replace(/\.[^.]+$/, ''),
      categorie: null as string | null,
    }))

  c.header('Cache-Control', 'public, max-age=300')
  return c.json({ data: realisations, total: realisations.length })
})

shopRouter.get('/livraison/tarifs', (c) => {
  const villeRaw = (c.req.query('ville') ?? '').toLowerCase().trim()
  const zone     = TARIFS_LIVRAISON[villeRaw] ?? TARIFS_LIVRAISON['autre']

  c.header('Cache-Control', 'public, max-age=3600')
  return c.json({
    data: {
      ville:           villeRaw || null,
      tarif_xaf:       zone.tarif,
      delai_jours:     zone.delaiJours,
      zones_connues:   Object.keys(TARIFS_LIVRAISON),
    },
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// SHOP ERP ROUTER — protégé par authMiddleware (opérateurs ERP)
// Monté sur /api/shop-erp dans index.ts
// ══════════════════════════════════════════════════════════════════════════════

export const shopErpRouter = new Hono<{ Variables: HonoVariables }>()

// ── Helpers locaux ─────────────────────────────────────────────────────────────

async function genererNumeroDevis(): Promise<string> {
  const today     = new Date()
  const yyyymmdd  = today.toISOString().slice(0, 10).replace(/-/g, '')
  const startOfDay = `${today.toISOString().slice(0, 10)}T00:00:00.000Z`
  const { count } = await db
    .from('devis')
    .select('*', { count: 'exact', head: true })
    .gte('created_at', startOfDay)
  return `DEV-${yyyymmdd}-${String((count ?? 0) + 1).padStart(4, '0')}`
}

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/shop-erp/analytics
// KPIs + CA mensuel comparé ERP vs Shop (6 derniers mois)
// ══════════════════════════════════════════════════════════════════════════════

shopErpRouter.get('/analytics', async (c) => {
  const today     = new Date().toISOString().split('T')[0]
  const debutMois = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString()

  const [todayRes, monthRes] = await Promise.all([
    db.from('commandes_shop').select('montant_ttc, statut_commande')
      .gte('created_at', `${today}T00:00:00.000Z`)
      .neq('statut_commande', 'annulee'),
    db.from('commandes_shop').select('montant_ttc, statut_commande')
      .gte('created_at', debutMois)
      .neq('statut_commande', 'annulee'),
  ])

  const todayRows = (todayRes.data ?? [])
  const monthRows = (monthRes.data ?? [])
  const caMois    = monthRows.reduce((s, r) => s + (r.montant_ttc ?? 0), 0)

  const kpis = {
    commandes_aujourd_hui: todayRows.length,
    ca_aujourd_hui:        todayRows.reduce((s, r) => s + (r.montant_ttc ?? 0), 0),
    commandes_mois:        monthRows.length,
    ca_mois:               caMois,
    panier_moyen:          monthRows.length > 0 ? Math.round(caMois / monthRows.length) : 0,
  }

  // CA mensuel sur 6 mois — shop vs ERP classique
  const caMensuel: Array<{
    mois: string
    ca_shop: number
    ca_erp: number
    ca_total: number
  }> = []

  for (let i = 5; i >= 0; i--) {
    const d     = new Date()
    d.setMonth(d.getMonth() - i)
    const year  = d.getFullYear()
    const month = d.getMonth() + 1
    const debut = new Date(year, month - 1, 1).toISOString()
    const fin   = new Date(year, month, 0, 23, 59, 59, 999).toISOString()
    const dateDebut = debut.split('T')[0]
    const dateFin   = fin.split('T')[0]

    const [shopMonth, erpMonth] = await Promise.all([
      db.from('commandes_shop').select('montant_ttc')
        .gte('created_at', debut).lte('created_at', fin)
        .neq('statut_commande', 'annulee'),
      db.from('commandes').select('total_ttc_xaf')
        .gte('date_commande', dateDebut).lte('date_commande', dateFin)
        .neq('statut', 'cancelled'),
    ])

    const caShop  = (shopMonth.data ?? []).reduce((s, r) => s + (r.montant_ttc ?? 0), 0)
    const caTotal = (erpMonth.data ?? []).reduce((s, r) => s + (r.total_ttc_xaf ?? 0), 0)
    const caErpSeul = Math.max(0, caTotal - caShop)

    caMensuel.push({
      mois:     `${year}-${String(month).padStart(2, '0')}`,
      ca_shop:  Math.round(caShop),
      ca_erp:   Math.round(caErpSeul),
      ca_total: Math.round(caTotal),
    })
  }

  return c.json({ data: { kpis, ca_mensuel: caMensuel } })
})

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/shop-erp/produits
// Tous les produits avec visibilité shop + stock ERP
// ══════════════════════════════════════════════════════════════════════════════

shopErpRouter.get('/produits', async (c) => {
  const { data, error } = await db
    .from('produits_shop')
    .select(`
      product_id,
      visible_shop,
      prix_public,
      images,
      updated_at,
      produits!inner (
        ref, designation, categorie, stock_actuel, stock_min, stock_critique, unite, statut
      )
    `)
    .order('updated_at', { ascending: false })

  if (error) return c.json({ error: 'Erreur DB', code: 'DB_ERROR' }, 500)

  const produits = (data ?? []).map((r: any) => ({
    id:             r.product_id,
    ref:            r.produits.ref,
    nom:            r.produits.designation,
    categorie:      r.produits.categorie,
    unite:          r.produits.unite,
    stock_actuel:   r.produits.stock_actuel,
    stock_min:      r.produits.stock_min,
    stock_critique: r.produits.stock_critique,
    statut:         r.produits.statut,
    visible_shop:   r.visible_shop,
    prix_public:    r.prix_public,
    images:         r.images ?? [],
  }))

  return c.json({ data: produits, total: produits.length })
})

// ══════════════════════════════════════════════════════════════════════════════
// PUT /api/shop-erp/produits/:id/visibilite
// Activer/désactiver la visibilité shop d'un produit
// ══════════════════════════════════════════════════════════════════════════════

shopErpRouter.put('/produits/:id/visibilite',
  zValidator('json', z.object({ visible: z.boolean() })),
  async (c) => {
    const id      = c.req.param('id')
    const { visible } = c.req.valid('json')

    const { data, error } = await db
      .from('produits_shop')
      .update({ visible_shop: visible, updated_at: new Date().toISOString() })
      .eq('product_id', id)
      .select('product_id, visible_shop')
      .single()

    if (error || !data) return c.json({ error: 'Produit introuvable', code: 'NOT_FOUND' }, 404)

    return c.json({ data })
  }
)

// ══════════════════════════════════════════════════════════════════════════════
// PUT /api/shop-erp/produits/:id/prix
// Mettre à jour le prix public d'un produit
// ══════════════════════════════════════════════════════════════════════════════

shopErpRouter.put('/produits/:id/prix',
  zValidator('json', z.object({ prix: z.number().min(0) })),
  async (c) => {
    const id    = c.req.param('id')
    const { prix } = c.req.valid('json')

    const { data, error } = await db
      .from('produits_shop')
      .update({ prix_public: prix, updated_at: new Date().toISOString() })
      .eq('product_id', id)
      .select('product_id, prix_public')
      .single()

    if (error || !data) return c.json({ error: 'Produit introuvable', code: 'NOT_FOUND' }, 404)

    return c.json({ data })
  }
)

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/shop-erp/devis-web
// Demandes de devis web à traiter
// ══════════════════════════════════════════════════════════════════════════════

shopErpRouter.get('/devis-web', async (c) => {
  const { statut } = c.req.query()

  let query = db
    .from('demandes_devis_web')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(50)

  if (statut) {
    query = query.eq('statut', statut)
  }

  const { data, error } = await query

  if (error) return c.json({ error: 'Erreur DB', code: 'DB_ERROR' }, 500)

  return c.json({ data: data ?? [], total: (data ?? []).length })
})

// ══════════════════════════════════════════════════════════════════════════════
// POST /api/shop-erp/devis/:id/creer-erp
// Créer un devis ERP à partir d'une demande web
// ══════════════════════════════════════════════════════════════════════════════

shopErpRouter.post('/devis/:id/creer-erp', async (c) => {
  const id = c.req.param('id')

  const { data: devisWeb, error: errFetch } = await db
    .from('demandes_devis_web')
    .select('*')
    .eq('id', id)
    .single()

  if (errFetch || !devisWeb) {
    return c.json({ error: 'Demande introuvable', code: 'NOT_FOUND' }, 404)
  }

  if (devisWeb.erp_devis_id) {
    return c.json({ error: 'Devis ERP déjà créé', code: 'ALREADY_EXISTS', devis_id: devisWeb.erp_devis_id }, 409)
  }

  const numero  = await genererNumeroDevis()
  const today   = new Date().toISOString().split('T')[0]
  const validite = new Date(Date.now() + 30 * 86_400_000).toISOString().split('T')[0]

  const { data: erpDevis, error: errCreate } = await db
    .from('devis')
    .insert({
      numero,
      client_nom:          devisWeb.nom,
      statut:              'brouillon',
      date_emission:       today,
      date_validite:       validite,
      validite_jours:      30,
      conditions_paiement: 'Virement bancaire',
      notes:               `[SOURCE WEB] ${devisWeb.description}`,
      total_ht_xaf:        0,
      tva_xaf:             0,
      total_ttc_xaf:       0,
      sync_status:         'synced',
    })
    .select('id, numero')
    .single()

  if (errCreate || !erpDevis) {
    console.error('[shop-erp] create devis:', errCreate)
    return c.json({ error: 'Erreur création devis ERP', code: 'DB_ERROR' }, 500)
  }

  await db
    .from('demandes_devis_web')
    .update({ statut: 'traitee', erp_devis_id: erpDevis.id })
    .eq('id', id)

  return c.json({ data: erpDevis }, 201)
})
