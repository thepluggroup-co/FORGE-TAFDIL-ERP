import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { supabaseAdmin } from '@forge/db'

const db = supabaseAdmin!
import { requireRole } from '../middleware/rbac'
import { localCreateBon, localValiderBon, getBonsSortieLocal } from '../services/db-local'
import { withOfflineFallback } from '../services/offline-fallback'
import type { HonoVariables } from '../types'

const router = new Hono<{ Variables: HonoVariables }>()

// ── Schémas Zod ────────────────────────────────────────────────────────────────

const ligneSchema = z.object({
  produit_id:        z.string().optional(),
  designation:       z.string().min(1),
  unite:             z.string().default('unité'),
  quantite_demandee: z.number().positive(),
})

const createBonSchema = z.object({
  demandeur: z.string().min(1),
  motif:     z.string().min(1),
  notes:     z.string().optional(),
  lignes:    z.array(ligneSchema).min(1),
})

const validerBonSchema = z.object({
  decision:    z.enum(['valide', 'refuse']),
  commentaire: z.string().optional(),
})

const executerBonSchema = z.object({
  code_unique:     z.string().min(1),
  quantites_reelles: z.array(z.object({
    ligne_id:        z.string(),
    quantite_servie: z.number().min(0),
  })).optional(),
})

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Génère un numéro bon : TAF-YYYYMMDD-XXXX */
async function genererNumeroBon(): Promise<string> {
  const today = new Date()
  const yyyymmdd = today.toISOString().slice(0, 10).replace(/-/g, '')
  const startOfDay = `${today.toISOString().slice(0, 10)}T00:00:00.000Z`

  const { count } = await db
    .from('bons_sortie')
    .select('*', { count: 'exact', head: true })
    .gte('created_at', startOfDay)

  const seq = String((count ?? 0) + 1).padStart(4, '0')
  return `TAF-${yyyymmdd}-${seq}`
}

/** Notifie via Supabase Realtime Broadcast */
async function broadcastBon(event: string, payload: Record<string, unknown>): Promise<void> {
  try {
    const channel = db.channel('forge-bons')
    await channel.send({ type: 'broadcast', event, payload })
    db.removeChannel(channel)
  } catch {
    // Realtime non critique — ne pas bloquer la réponse
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// ROUTES
// ══════════════════════════════════════════════════════════════════════════════

/** Liste des bons avec filtres */
router.get('/', async (c) => {
  const { statut, technicien, search } = c.req.query()
  const page    = Math.max(1, parseInt(c.req.query('page') ?? '1'))
  const perPage = Math.min(100, Math.max(1, parseInt(c.req.query('per_page') ?? '20')))
  const from    = (page - 1) * perPage
  const to      = from + perPage - 1

  // Filtre date
  const dateDebut = c.req.query('date_debut')
  const dateFin   = c.req.query('date_fin')

  let query = db
    .from('bons_sortie')
    .select('*, bons_sortie_lignes(*)', { count: 'exact' })

  if (statut)     query = query.eq('statut', statut)
  if (technicien) query = query.ilike('demandeur', `%${technicien}%`)
  if (search)     query = query.or(`numero.ilike.%${search}%,demandeur.ilike.%${search}%,motif.ilike.%${search}%`)
  if (dateDebut)  query = query.gte('created_at', `${dateDebut}T00:00:00.000Z`)
  if (dateFin)    query = query.lte('created_at', `${dateFin}T23:59:59.999Z`)

  const { data, count, error } = await query
    .order('created_at', { ascending: false })
    .range(from, to)

  if (error) {
    console.warn('[bons] GET / Supabase error — fallback SQLite:', error.message)
    const local = getBonsSortieLocal({ statut })
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

/** Créer un bon de sortie — avec fallback SQLite offline */
router.post(
  '/',
  requireRole(['admin', 'superviseur', 'operateur']),
  zValidator('json', createBonSchema),
  async (c) => {
    const user = c.get('user')
    const body = c.req.valid('json')

    const result = await withOfflineFallback(
      'POST /bons',

      // ── Online : Supabase ──────────────────────────────────────────────────
      async () => {
        const numero = await genererNumeroBon()

        const { data: bon, error: bonErr } = await db
          .from('bons_sortie')
          .insert({ numero, statut: 'soumis', demandeur: body.demandeur,
            motif: body.motif, notes: body.notes ?? null,
            created_by: user.id, sync_status: 'synced' })
          .select().single()

        if (bonErr || !bon) throw new Error(bonErr?.message ?? 'Erreur création bon')

        const bonId = (bon as { id: string }).id
        const lignes = body.lignes.map((l) => ({
          bon_id: bonId, produit_id: l.produit_id ?? null,
          designation: l.designation, unite: l.unite,
          quantite_demandee: l.quantite_demandee, quantite_servie: 0,
        }))

        const { data: lignesData, error: lignesErr } = await db
          .from('bons_sortie_lignes').insert(lignes).select()

        if (lignesErr) {
          await db.from('bons_sortie').delete().eq('id', bonId)
          throw new Error(lignesErr.message)
        }

        await broadcastBon('nouveau_bon', {
          bon_id: bonId, numero, demandeur: body.demandeur,
          motif: body.motif, nb_lignes: body.lignes.length,
        })

        return { ...bon, lignes: lignesData }
      },

      // ── Offline : SQLite local ─────────────────────────────────────────────
      () => localCreateBon({
        demandeur: body.demandeur,
        motif:     body.motif,
        notes:     body.notes,
        lignes:    body.lignes.map((l) => ({
          produit_id:        l.produit_id,
          designation:       l.designation,
          unite:             l.unite,
          quantite_demandee: l.quantite_demandee,
        })),
        user_id: user.id,
      }),
    )

    return c.json(result, 201)
  },
)

/** Détail bon + lignes + historique statuts */
router.get('/:id', async (c) => {
  const { id } = c.req.param()

  const { data, error } = await db
    .from('bons_sortie')
    .select(`
      *,
      bons_sortie_lignes (
        *,
        produits ( ref, designation, stock_actuel, unite )
      )
    `)
    .eq('id', id)
    .single()

  if (error || !data) {
    return c.json({ error: 'Bon introuvable', code: 'NOT_FOUND' }, 404)
  }

  return c.json(data)
})

/** Valider ou refuser un bon (secrétaire / directeur) — avec fallback SQLite offline */
router.put(
  '/:id/valider',
  requireRole(['admin', 'superviseur']),
  zValidator('json', validerBonSchema),
  async (c) => {
    const { id } = c.req.param()
    const user   = c.get('user')
    const body   = c.req.valid('json')

    const result = await withOfflineFallback(
      `PUT /bons/${id}/valider`,

      // ── Online : Supabase ──────────────────────────────────────────────────
      async () => {
        const { data: existing } = await db
          .from('bons_sortie').select('statut, demandeur, numero, created_by').eq('id', id).single()

        if (!existing) throw Object.assign(new Error('Bon introuvable'), { code: 'NOT_FOUND', httpStatus: 404 })
        if ((existing as { statut: string }).statut !== 'soumis')
          throw Object.assign(
            new Error(`Impossible de valider un bon en statut "${(existing as { statut: string }).statut}"`),
            { code: 'INVALID_TRANSITION', httpStatus: 422 },
          )

        const { data, error } = await db.from('bons_sortie')
          .update({ statut: body.decision, valide_par_id: user.id, updated_at: new Date().toISOString() })
          .eq('id', id).select().single()

        if (error) throw new Error(error.message)

        await broadcastBon('bon_valide', {
          bon_id:      id,
          numero:      (existing as { numero: string }).numero,
          decision:    body.decision,
          demandeur:   (existing as { demandeur: string }).demandeur,
          valide_par:  user.email,
          commentaire: body.commentaire ?? null,
        })

        return data
      },

      // ── Offline : SQLite local ─────────────────────────────────────────────
      () => {
        localValiderBon({
          bon_id:      id,
          decision:    body.decision as 'valide' | 'refuse',
          commentaire: body.commentaire,
          user_id:     user.id,
        })
        return { id, statut: body.decision, offline: true }
      },
    )

    return c.json(result)
  },
)

/** Exécuter un bon (magasin) — transaction atomique ALL-or-NOTHING */
router.put(
  '/:id/executer',
  requireRole(['admin', 'superviseur', 'operateur']),
  zValidator('json', executerBonSchema),
  async (c) => {
    const { id } = c.req.param()
    const user   = c.get('user')
    const body   = c.req.valid('json')

    // Récupérer le bon avec ses lignes
    const { data: bon, error: fetchErr } = await db
      .from('bons_sortie')
      .select('*, bons_sortie_lignes(*)')
      .eq('id', id)
      .single()

    if (fetchErr || !bon) return c.json({ error: 'Bon introuvable', code: 'NOT_FOUND' }, 404)

    const b = bon as {
      id: string; numero: string; statut: string
      bons_sortie_lignes: Array<{
        id: string; produit_id: string | null
        designation: string; quantite_demandee: number
      }>
    }

    // Vérifier le code unique
    if (b.numero !== body.code_unique) {
      return c.json({ error: 'Code unique invalide', code: 'INVALID_CODE' }, 422)
    }

    // Vérifier la transition de statut
    if (b.statut !== 'valide') {
      return c.json({
        error: `Impossible d'exécuter un bon en statut "${b.statut}" (statut requis : valide)`,
        code: 'INVALID_TRANSITION',
      }, 422)
    }

    // Essayer la fonction PostgreSQL atomique
    const { data: rpcData, error: rpcError } = await (db as never as {
      rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { code: string; message: string } | null }>
    }).rpc('fn_executer_bon', {
      p_bon_id:  id,
      p_user_id: user.id,
      p_quantites_reelles: body.quantites_reelles ?? null,
    })

    if (!rpcError) {
      return c.json(rpcData ?? { success: true, bon_id: id })
    }

    // Fonction absente — migration non appliquée
    if (rpcError.code === '42883' || rpcError.message.includes('does not exist')) {
      return c.json({
        error: 'Configuration base de données incomplète : fn_executer_bon est manquante.',
        code:  'RPC_MISSING',
        fix:   'Appliquer packages/db/migrations/0001_fn_executer_bon.sql dans Supabase SQL Editor.',
      }, 503)
    }

    // Erreurs métier renvoyées par la fonction PG
    const msg = rpcError.message ?? ''
    if (msg.includes('INSUFFICIENT_STOCK')) {
      return c.json({ error: msg.replace('INSUFFICIENT_STOCK: ', ''), code: 'INSUFFICIENT_STOCK' }, 422)
    }
    if (msg.includes('INVALID_TRANSITION')) {
      return c.json({ error: msg.replace('INVALID_TRANSITION: ', ''), code: 'INVALID_TRANSITION' }, 422)
    }
    if (msg.includes('BON_NOT_FOUND')) {
      return c.json({ error: 'Bon introuvable', code: 'NOT_FOUND' }, 404)
    }

    return c.json({ error: msg }, 400)
  },
)

export { router as bonsRouter }
