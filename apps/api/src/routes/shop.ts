import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { supabase } from '@forge/db/supabase'

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
  nom:         z.string().min(2).max(200),
  telephone:   z.string().min(8).max(20),
  email:       z.string().email().optional(),
  description: z.string().min(10).max(2000),
})

// ── Router ─────────────────────────────────────────────────────────────────────

export const shopRouter = new Hono()

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/shop/catalogue
// Liste des produits visibles — cache 60s
// ══════════════════════════════════════════════════════════════════════════════

shopRouter.get('/catalogue', async (c) => {
  const { categorie, q } = c.req.query()

  let query = supabase
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
    return c.json({ error: 'Erreur catalogue', code: 'DB_ERROR' }, 500)
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

  const { data, error } = await supabase
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
  const { data, error } = await supabase
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
    const { data: produit } = await supabase
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
    designation:    l.designation,
    quantite:       l.quantite,
    prix_unitaire:  l.prix_unitaire,
    total_ht:       Math.round(l.quantite * l.prix_unitaire),
  }))

  // 5. Insérer commande_shop
  const { data: commandeShop, error: errShop } = await supabase
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
  const { data: erpCommande } = await supabase
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
    await supabase
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
    await supabase.from('commandes_lignes').insert(lignesErp)
  }

  // 8. Notifier ERP via Realtime (broadcast sur canal dédié)
  await supabase.channel('commandes_web_nouvelles').send({
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

  const { data, error } = await supabase
    .from('commandes_shop')
    .select('ref, statut_commande, statut_paiement, lignes, montant_ttc, frais_livraison, created_at, updated_at, client_ville')
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

  const { data, error } = await supabase
    .from('demandes_devis_web')
    .insert({
      nom:         body.nom,
      telephone:   body.telephone,
      email:       body.email ?? null,
      description: body.description,
      statut:      'nouvelle',
    })
    .select('id, created_at')
    .single()

  if (error || !data) {
    console.error('[shop] insert demandes_devis_web:', error)
    return c.json({ error: 'Erreur enregistrement devis', code: 'DB_ERROR' }, 500)
  }

  // Notifier l'ERP
  await supabase.channel('commandes_web_nouvelles').send({
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

  const { data, error } = await supabase.storage
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
