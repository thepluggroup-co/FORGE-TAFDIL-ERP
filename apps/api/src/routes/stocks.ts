import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { supabaseAdmin } from '@forge/db'
import { requireRole } from '../middleware/rbac'
import { getProduitsLocal, localMouvement } from '../services/db-local'
import { withOfflineFallback } from '../services/offline-fallback'
import type { HonoVariables } from '../types'

// auth middleware already rejects requests when supabaseAdmin is null
const db = supabaseAdmin!

const router = new Hono<{ Variables: HonoVariables }>()

// ── Helpers ────────────────────────────────────────────────────────────────────

function calcStatut(
  stock: number,
  min: number,
  critique: number,
): 'normal' | 'alerte' | 'critique' | 'rupture' {
  if (stock === 0) return 'rupture'
  if (stock <= critique) return 'critique'
  if (stock <= min) return 'alerte'
  return 'normal'
}

// ── Schémas Zod ────────────────────────────────────────────────────────────────

const createProduitSchema = z.object({
  ref:              z.string().min(1).max(50),
  designation:      z.string().min(1).max(200),
  description:      z.string().optional(),
  categorie:        z.string().min(1).max(100),
  unite:            z.string().default('unité'),
  stock_actuel:     z.number().min(0).default(0),
  stock_min:        z.number().min(0).default(5),
  stock_critique:   z.number().min(0).default(2),
  prix_unitaire_xaf: z.number().min(0).default(0),
  emplacement:      z.string().optional(),
  fournisseur:      z.string().optional(),
})

const updateProduitSchema = createProduitSchema.partial()

const mouvementSchema = z.object({
  type:      z.enum(['entree', 'sortie', 'ajustement', 'transfert']),
  quantite:  z.number().positive(),
  reference: z.string().optional(),
  motif:     z.string().optional(),  // frontend field
  notes:     z.string().optional(),  // legacy alias
})

// ══════════════════════════════════════════════════════════════════════════════
// ROUTES STATIQUES (doivent être avant /:id)
// ══════════════════════════════════════════════════════════════════════════════

/** Produits sous seuil critique — triés du plus urgent au moins urgent */
router.get('/alertes', async (c) => {
  const { data, error } = await db
    .from('produits')
    .select('*')
    .in('statut', ['alerte', 'critique', 'rupture'])
    .order('stock_actuel', { ascending: true })

  if (error) {
    console.error('[stocks] GET /alertes error:', error.message, '| code:', error.code)
    return c.json({ error: error.message }, 500)
  }

  return c.json({
    data,
    total: data.length,
    urgence: {
      rupture: data.filter((p: { statut: string }) => p.statut === 'rupture').length,
      critique: data.filter((p: { statut: string }) => p.statut === 'critique').length,
      alerte: data.filter((p: { statut: string }) => p.statut === 'alerte').length,
    },
  })
})

/** Rapport d'inventaire journalier complet */
router.get('/inventaire/journalier', requireRole(['directeur', 'admin']), async (c) => {
  const today = new Date().toISOString().slice(0, 10)
  const startOfDay = `${today}T00:00:00.000Z`

  const [produitsRes, mouvementsRes] = await Promise.all([
    db.from('produits').select('*').order('categorie').order('designation'),
    db.from('mouvements_stock').select('*').gte('created_at', startOfDay),
  ])

  if (produitsRes.error) {
    console.error('[stocks] GET /inventaire error:', produitsRes.error.message)
    return c.json({ error: produitsRes.error.message }, 500)
  }

  const produits = produitsRes.data ?? []
  const mouvements = mouvementsRes.data ?? []

  const valeurTotale = produits.reduce(
    (acc: number, p: { stock_actuel: number; prix_unitaire_xaf: number }) =>
      acc + p.stock_actuel * p.prix_unitaire_xaf,
    0,
  )

  const categoriesMap = new Map<string, { count: number; valeur_xaf: number; stock_total: number }>()
  for (const p of produits as Array<{ categorie: string; stock_actuel: number; prix_unitaire_xaf: number }>) {
    const entry = categoriesMap.get(p.categorie) ?? { count: 0, valeur_xaf: 0, stock_total: 0 }
    entry.count++
    entry.stock_total += p.stock_actuel
    entry.valeur_xaf += p.stock_actuel * p.prix_unitaire_xaf
    categoriesMap.set(p.categorie, entry)
  }

  return c.json({
    date: today,
    total_references: produits.length,
    valeur_totale_xaf: Math.round(valeurTotale),
    alertes_count: produits.filter((p: { statut: string }) => p.statut === 'alerte').length,
    critiques_count: produits.filter((p: { statut: string }) => p.statut === 'critique').length,
    ruptures_count: produits.filter((p: { statut: string }) => p.statut === 'rupture').length,
    mouvements_du_jour: mouvements.length,
    categories: Array.from(categoriesMap.entries()).map(([categorie, stats]) => ({
      categorie,
      ...stats,
      valeur_xaf: Math.round(stats.valeur_xaf),
    })),
    produits,
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// CRUD PRODUITS
// ══════════════════════════════════════════════════════════════════════════════

/** Liste paginée avec filtres */
router.get('/', async (c) => {
  const { categorie, statut, search } = c.req.query()
  const page = Math.max(1, parseInt(c.req.query('page') ?? '1'))
  const perPage = Math.min(100, Math.max(1, parseInt(c.req.query('per_page') ?? '20')))
  const from = (page - 1) * perPage
  const to = from + perPage - 1

  let query = db
    .from('produits')
    .select('*', { count: 'exact' })

  if (categorie) query = query.eq('categorie', categorie)
  if (statut)    query = query.eq('statut', statut)
  if (search)    query = query.or(`designation.ilike.%${search}%,ref.ilike.%${search}%,fournisseur.ilike.%${search}%`)

  const { data, count, error } = await query
    .order('designation')
    .range(from, to)

  if (error) {
    console.warn('[stocks] GET / Supabase error — tentative fallback SQLite:', error.message)
    const local = getProduitsLocal({ search, statut })
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

/** Créer un produit */
router.post(
  '/',
  requireRole(['directeur', 'admin']),
  zValidator('json', createProduitSchema),
  async (c) => {
    const user = c.get('user')
    const body = c.req.valid('json')
    const statut = calcStatut(body.stock_actuel, body.stock_min, body.stock_critique)

    const { data, error } = await db
      .from('produits')
      .insert({ ...body, statut, created_by: user.id, sync_status: 'synced' })
      .select()
      .single()

    if (error) return c.json({ error: error.message, code: error.code }, 400)
    return c.json(data, 201)
  },
)

/** Détail produit + historique 30 jours */
router.get('/:id', async (c) => {
  const { id } = c.req.param()
  const since30j = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()

  const [produitRes, mouvementsRes] = await Promise.all([
    db.from('produits').select('*').eq('id', id).single(),
    db
      .from('mouvements_stock')
      .select('*')
      .eq('produit_id', id)
      .gte('created_at', since30j)
      .order('created_at', { ascending: false }),
  ])

  if (produitRes.error || !produitRes.data) {
    return c.json({ error: 'Produit introuvable', code: 'NOT_FOUND' }, 404)
  }

  const mouvements = mouvementsRes.data ?? []
  const entrees = mouvements
    .filter((m: { type: string; quantite: number }) => m.type === 'entree')
    .reduce((s: number, m: { quantite: number }) => s + m.quantite, 0)
  const sorties = mouvements
    .filter((m: { type: string; quantite: number }) => m.type === 'sortie')
    .reduce((s: number, m: { quantite: number }) => s + m.quantite, 0)

  return c.json({
    ...produitRes.data,
    historique_30j: mouvements,
    stats_30j: { entrees, sorties, mouvements: mouvements.length },
  })
})

/** Modifier un produit */
router.put(
  '/:id',
  requireRole(['directeur', 'admin']),
  zValidator('json', updateProduitSchema),
  async (c) => {
    const { id } = c.req.param()
    const body = c.req.valid('json')

    const updates: Record<string, unknown> = { ...body, updated_at: new Date().toISOString() }
    if (body.stock_actuel !== undefined) {
      let min = body.stock_min
      let critique = body.stock_critique
      if (min === undefined || critique === undefined) {
        const { data: existing } = await db
          .from('produits')
          .select('stock_min, stock_critique')
          .eq('id', id)
          .single()
        min = body.stock_min ?? (existing as { stock_min: number } | null)?.stock_min ?? 5
        critique = body.stock_critique ?? (existing as { stock_critique: number } | null)?.stock_critique ?? 2
      }
      updates.statut = calcStatut(body.stock_actuel, min, critique)
    }

    const { data, error } = await db
      .from('produits')
      .update(updates)
      .eq('id', id)
      .select()
      .single()

    if (error) return c.json({ error: error.message }, 400)
    if (!data) return c.json({ error: 'Produit introuvable', code: 'NOT_FOUND' }, 404)
    return c.json(data)
  },
)

/** Mouvement de stock — appelle fn_mouvement_stock (atomique PostgreSQL) avec fallback SQLite */
router.post(
  '/:id/mouvement',
  requireRole(['directeur', 'admin', 'operateur']),
  zValidator('json', mouvementSchema),
  async (c) => {
    const { id } = c.req.param()
    const user = c.get('user')
    const body = c.req.valid('json')

    const result = await withOfflineFallback(
      `POST /stocks/${id}/mouvement`,

      // ── Chemin online : RPC PostgreSQL ──────────────────────────────────────
      async () => {
        const { data: rpcData, error: rpcError } = await (db as never as {
          rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { code: string; message: string } | null }>
        }).rpc('fn_mouvement_stock', {
          p_produit_id: id,
          p_type:       body.type,
          p_quantite:   body.quantite,
          p_reference:  body.reference ?? null,
          p_notes:      body.motif ?? body.notes ?? null,
          p_user_id:    user.id,
        })

        // Fallback JS si la fonction PG n'existe pas encore
        if (rpcError && (rpcError.code === '42883' || rpcError.message.includes('does not exist'))) {
          const { data: produit, error: fetchErr } = await db
            .from('produits').select('stock_actuel, stock_min, stock_critique').eq('id', id).single()
          if (fetchErr || !produit) throw new Error('Produit introuvable')

          const p = produit as { stock_actuel: number; stock_min: number; stock_critique: number }
          let nouvelleQte: number
          if (body.type === 'ajustement')     nouvelleQte = body.quantite
          else if (body.type === 'entree')    nouvelleQte = p.stock_actuel + body.quantite
          else {
            if (p.stock_actuel < body.quantite)
              throw Object.assign(new Error(`Stock insuffisant : ${p.stock_actuel} disponible`), { code: 'INSUFFICIENT_STOCK' })
            nouvelleQte = p.stock_actuel - body.quantite
          }
          const statut = calcStatut(nouvelleQte, p.stock_min, p.stock_critique)
          const [mvtRes, updRes] = await Promise.all([
            db.from('mouvements_stock').insert({ produit_id: id, type: body.type, quantite: body.quantite,
              reference: body.reference ?? null, notes: body.motif ?? body.notes ?? null, created_by: user.id,
            }).select().single(),
            db.from('produits').update({ stock_actuel: nouvelleQte, statut, updated_at: new Date().toISOString() })
              .eq('id', id).select().single(),
          ])
          if (mvtRes.error) throw new Error(mvtRes.error.message)
          return { mouvement: mvtRes.data, produit: updRes.data }
        }

        if (rpcError) throw new Error(rpcError.message)
        return rpcData ?? { success: true }
      },

      // ── Chemin offline : SQLite local ────────────────────────────────────────
      () => localMouvement({
        produit_id: id,
        type:       body.type as 'entree' | 'sortie' | 'ajustement',
        quantite:   body.quantite,
        reference:  body.reference,
        notes:      body.motif ?? body.notes,
        user_id:    user.id,
      }),
    )

    return c.json(result, 201)
  },
)

export { router as stocksRouter }
