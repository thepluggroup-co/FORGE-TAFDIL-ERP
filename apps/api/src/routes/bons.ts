import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { supabase } from '@forge/db/supabase'
import { requireRole } from '../middleware/rbac'
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

  const { count } = await supabase
    .from('bons_sortie')
    .select('*', { count: 'exact', head: true })
    .gte('created_at', startOfDay)

  const seq = String((count ?? 0) + 1).padStart(4, '0')
  return `TAF-${yyyymmdd}-${seq}`
}

/** Notifie via Supabase Realtime Broadcast */
async function broadcastBon(event: string, payload: Record<string, unknown>): Promise<void> {
  try {
    const channel = supabase.channel('forge-bons')
    await channel.send({ type: 'broadcast', event, payload })
    supabase.removeChannel(channel)
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

  let query = supabase
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

  if (error) return c.json({ error: error.message }, 500)

  return c.json({
    data,
    total: count ?? 0,
    page,
    per_page: perPage,
    total_pages: Math.ceil((count ?? 0) / perPage),
  })
})

/** Créer un bon de sortie */
router.post(
  '/',
  requireRole(['directeur', 'admin', 'operateur']),
  zValidator('json', createBonSchema),
  async (c) => {
    const user = c.get('user')
    const body = c.req.valid('json')

    const numero = await genererNumeroBon()

    // Insérer le bon
    const { data: bon, error: bonErr } = await supabase
      .from('bons_sortie')
      .insert({
        numero,
        statut:     'soumis',
        demandeur:  body.demandeur,
        motif:      body.motif,
        notes:      body.notes ?? null,
        created_by: user.id,
        sync_status: 'synced',
      })
      .select()
      .single()

    if (bonErr || !bon) {
      return c.json({ error: bonErr?.message ?? 'Erreur création bon', code: bonErr?.code }, 400)
    }

    // Insérer les lignes
    const lignes = body.lignes.map((l) => ({
      bon_id:            (bon as { id: string }).id,
      produit_id:        l.produit_id ?? null,
      designation:       l.designation,
      unite:             l.unite,
      quantite_demandee: l.quantite_demandee,
      quantite_servie:   0,
    }))

    const { data: lignesData, error: lignesErr } = await supabase
      .from('bons_sortie_lignes')
      .insert(lignes)
      .select()

    if (lignesErr) {
      // Nettoyer le bon si les lignes échouent
      await supabase.from('bons_sortie').delete().eq('id', (bon as { id: string }).id)
      return c.json({ error: lignesErr.message }, 400)
    }

    // Notifier les secrétaires/admins via Realtime
    await broadcastBon('nouveau_bon', {
      bon_id:    (bon as { id: string }).id,
      numero,
      demandeur: body.demandeur,
      motif:     body.motif,
      nb_lignes: body.lignes.length,
    })

    return c.json({ ...bon, lignes: lignesData }, 201)
  },
)

/** Détail bon + lignes + historique statuts */
router.get('/:id', async (c) => {
  const { id } = c.req.param()

  const { data, error } = await supabase
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

/** Valider ou refuser un bon (secrétaire / directeur) */
router.put(
  '/:id/valider',
  requireRole(['directeur', 'admin']),
  zValidator('json', validerBonSchema),
  async (c) => {
    const { id } = c.req.param()
    const user   = c.get('user')
    const body   = c.req.valid('json')

    // Vérifier que le bon est bien en statut 'soumis'
    const { data: existing } = await supabase
      .from('bons_sortie')
      .select('statut, demandeur, numero, created_by')
      .eq('id', id)
      .single()

    if (!existing) return c.json({ error: 'Bon introuvable', code: 'NOT_FOUND' }, 404)
    if ((existing as { statut: string }).statut !== 'soumis') {
      return c.json({
        error: `Impossible de valider un bon en statut "${(existing as { statut: string }).statut}"`,
        code: 'INVALID_TRANSITION',
      }, 422)
    }

    const { data, error } = await supabase
      .from('bons_sortie')
      .update({
        statut:       body.decision,
        valide_par_id: user.id,
        updated_at:   new Date().toISOString(),
      })
      .eq('id', id)
      .select()
      .single()

    if (error) return c.json({ error: error.message }, 400)

    // Notifier le technicien demandeur
    await broadcastBon('bon_valide', {
      bon_id:      id,
      numero:      (existing as { numero: string }).numero,
      decision:    body.decision,
      demandeur:   (existing as { demandeur: string }).demandeur,
      valide_par:  user.email,
      commentaire: body.commentaire ?? null,
    })

    return c.json(data)
  },
)

/** Exécuter un bon (magasin) — transaction atomique ALL-or-NOTHING */
router.put(
  '/:id/executer',
  requireRole(['directeur', 'admin', 'operateur']),
  zValidator('json', executerBonSchema),
  async (c) => {
    const { id } = c.req.param()
    const user   = c.get('user')
    const body   = c.req.valid('json')

    // Récupérer le bon avec ses lignes
    const { data: bon, error: fetchErr } = await supabase
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
    const { data: rpcData, error: rpcError } = await (supabase as never as {
      rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { code: string; message: string } | null }>
    }).rpc('fn_executer_bon', {
      p_bon_id:  id,
      p_user_id: user.id,
      p_quantites_reelles: body.quantites_reelles ?? null,
    })

    if (!rpcError) {
      return c.json(rpcData ?? { success: true, bon_id: id })
    }

    // Fallback JS si la fonction PG n'existe pas (best-effort, non atomique)
    if (rpcError.code !== '42883' && !rpcError.message.includes('does not exist')) {
      return c.json({ error: rpcError.message }, 400)
    }

    // 1. Vérifier le stock disponible pour TOUS les items avant toute modification
    const lignesAvecProduit = b.bons_sortie_lignes.filter((l) => l.produit_id !== null)
    const produitIds = [...new Set(lignesAvecProduit.map((l) => l.produit_id as string))]

    if (produitIds.length > 0) {
      const { data: stocks } = await supabase
        .from('produits')
        .select('id, stock_actuel, designation')
        .in('id', produitIds)

      const stockMap = new Map(
        (stocks ?? []).map((p: { id: string; stock_actuel: number; designation: string }) => [p.id, p]),
      )

      const insuffisants: string[] = []
      for (const ligne of lignesAvecProduit) {
        const stock = stockMap.get(ligne.produit_id as string) as { stock_actuel: number; designation: string } | undefined
        if (!stock || stock.stock_actuel < ligne.quantite_demandee) {
          insuffisants.push(
            `${ligne.designation} : ${stock?.stock_actuel ?? 0} disponible, ${ligne.quantite_demandee} demandé`,
          )
        }
      }

      if (insuffisants.length > 0) {
        return c.json({
          error: 'Stock insuffisant — aucune déduction effectuée (rollback)',
          code: 'INSUFFICIENT_STOCK',
          details: insuffisants,
        }, 422)
      }
    }

    // 2. Déduire le stock et créer les mouvements (toutes les lignes valides)
    const errors: string[] = []

    for (const ligne of b.bons_sortie_lignes) {
      const qteServie = body.quantites_reelles?.find((q) => q.ligne_id === ligne.id)?.quantite_servie
        ?? ligne.quantite_demandee

      // Mettre à jour quantite_servie sur la ligne
      await supabase
        .from('bons_sortie_lignes')
        .update({ quantite_servie: qteServie })
        .eq('id', ligne.id)

      // Déduire du stock si produit référencé
      if (ligne.produit_id && qteServie > 0) {
        const { error: mvtErr } = await supabase
          .from('mouvements_stock')
          .insert({
            produit_id: ligne.produit_id,
            type:       'sortie',
            quantite:   qteServie,
            reference:  b.numero,
            notes:      `Exécution bon ${b.numero}`,
            created_by: user.id,
          })

        if (mvtErr) {
          errors.push(`Mouvement stock ${ligne.designation}: ${mvtErr.message}`)
          continue
        }

        // Recalculer et mettre à jour le statut du produit
        const { data: produit } = await supabase
          .from('produits')
          .select('stock_actuel, stock_min, stock_critique')
          .eq('id', ligne.produit_id)
          .single()

        if (produit) {
          const p = produit as { stock_actuel: number; stock_min: number; stock_critique: number }
          const nouvelleQte = Math.max(0, p.stock_actuel - qteServie)
          const statut = nouvelleQte === 0 ? 'rupture'
            : nouvelleQte <= p.stock_critique ? 'critique'
            : nouvelleQte <= p.stock_min ? 'alerte'
            : 'normal'

          await supabase
            .from('produits')
            .update({ stock_actuel: nouvelleQte, statut, updated_at: new Date().toISOString() })
            .eq('id', ligne.produit_id)
        }
      }
    }

    // 3. Marquer le bon comme exécuté
    const { data: bonFinal, error: updateErr } = await supabase
      .from('bons_sortie')
      .update({ statut: 'execute', updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single()

    if (updateErr) return c.json({ error: updateErr.message }, 500)

    return c.json({
      ...bonFinal,
      warnings: errors.length > 0 ? errors : undefined,
    })
  },
)

export { router as bonsRouter }
