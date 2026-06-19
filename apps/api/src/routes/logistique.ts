import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { supabaseAdmin } from '@forge/db'
import { requireRole } from '../middleware/rbac'
import { checkPermission, writeAuditLog } from '../services/rbacService'
import type { HonoVariables } from '../types'

const db = supabaseAdmin!

// ── State machine ─────────────────────────────────────────────────────────────
// planifiee → en_route → livree | echec_livraison
// en_preparation est l'état initial auto-créé quand tous les bons sont prêts

const VALID_TRANSITIONS: Record<string, string[]> = {
  en_preparation:  ['planifiee'],
  planifiee:       ['en_route'],
  en_route:        ['livree', 'echec_livraison'],
  en_transit:      ['livree', 'echec_livraison'],  // backward-compat alias
  livree:          [],
  echec_livraison: [],
  annulee:         [],
}

// ── Schémas Zod ───────────────────────────────────────────────────────────────

const createLivraisonSchema = z.object({
  commande_id:           z.string().uuid(),
  client_id:             z.string().uuid().optional(),
  client_nom:            z.string().min(1),
  destination:           z.string().min(1),
  transporteur:          z.string().optional(),
  date_livraison_prevue: z.string().datetime({ offset: true }).optional(),
  date_depart:           z.string().datetime({ offset: true }).optional(),
  notes:                 z.string().optional(),
})

const patchStatutSchema = z.object({
  // 'planifiee' inclus pour la transition en_preparation → planifiee (logistique confirme)
  statut:      z.enum(['planifiee', 'en_route', 'livree', 'echec_livraison']),
  commentaire: z.string().optional(),
  geoloc:      z.string().optional(),
})

const assignerSchema = z.object({
  livreur_id:   z.string().uuid(),
  transporteur: z.string().optional(),
})

const livraisonsQuerySchema = z.object({
  statut:       z.string().optional(),
  transporteur: z.string().optional(),
  client_id:    z.string().uuid().optional(),
  date_debut:   z.string().optional(),
  date_fin:     z.string().optional(),
  page:         z.coerce.number().int().min(1).default(1),
  per_page:     z.coerce.number().int().min(1).max(100).default(20),
})

// ── Helper numéro ─────────────────────────────────────────────────────────────

async function genererNumeroLivraison(): Promise<string> {
  const today = new Date()
  const yyyymmdd = today.toISOString().slice(0, 10).replace(/-/g, '')
  const startOfDay = `${today.toISOString().slice(0, 10)}T00:00:00.000Z`
  const { count } = await db
    .from('livraisons')
    .select('*', { count: 'exact', head: true })
    .gte('created_at', startOfDay)
  return `LIV-${yyyymmdd}-${String((count ?? 0) + 1).padStart(4, '0')}`
}

// ── Router ────────────────────────────────────────────────────────────────────

export const logistiqueRouter = new Hono<{ Variables: HonoVariables }>()

// ── GET /preparation/resume — dashboard préparation 4 compteurs ───────────────
// Doit être avant /:id pour ne pas être capturé par le wildcard

logistiqueRouter.get(
  '/preparation/resume',
  requireRole(['admin', 'superviseur', 'operateur', 'livreur']),
  async (c) => {
    const [aPreparer, enCours, pret, planifiee] = await Promise.all([
      db.from('bons_sortie').select('*', { count: 'exact', head: true }).eq('statut_preparation', 'a_preparer'),
      db.from('bons_sortie').select('*', { count: 'exact', head: true }).eq('statut_preparation', 'en_cours'),
      db.from('bons_sortie').select('*', { count: 'exact', head: true }).eq('statut_preparation', 'pret'),
      db.from('livraisons').select('*', { count: 'exact', head: true }).eq('statut', 'planifiee'),
    ])

    return c.json({
      a_preparer:    aPreparer.count ?? 0,
      en_cours:      enCours.count ?? 0,
      pret_a_livrer: pret.count ?? 0,
      planifiee:     planifiee.count ?? 0,
    })
  },
)

// ── GET /livraisons/mes-livraisons — DOIT être avant /livraisons/:id ──────────

logistiqueRouter.get(
  '/livraisons/mes-livraisons',
  requireRole(['admin', 'superviseur', 'operateur', 'livreur']),
  async (c) => {
    const user    = c.get('user')
    const page    = Math.max(1, parseInt(c.req.query('page')     ?? '1'))
    const perPage = Math.min(100, Math.max(1, parseInt(c.req.query('per_page') ?? '20')))
    const from = (page - 1) * perPage
    const to   = from + perPage - 1

    const { data, count, error } = await db
      .from('livraisons')
      .select('*, commandes(numero, statut), clients(nom, telephone)', { count: 'exact' })
      .eq('livreur_id', user.id)
      .order('date_livraison_prevue', { ascending: true, nullsFirst: false })
      .range(from, to)

    if (error) {
      console.error('[logistique] GET /mes-livraisons:', error.message)
      return c.json({ error: error.message }, 500)
    }

    return c.json({
      data:        data ?? [],
      total:       count ?? 0,
      page,
      per_page:    perPage,
      total_pages: Math.ceil((count ?? 0) / perPage),
    })
  },
)

// ── GET /livraisons — liste paginée + filtres ─────────────────────────────────

logistiqueRouter.get(
  '/livraisons',
  requireRole(['admin', 'superviseur', 'operateur', 'livreur']),
  zValidator('query', livraisonsQuerySchema),
  async (c) => {
    const { statut, transporteur, client_id, date_debut, date_fin, page, per_page } = c.req.valid('query')
    const from = (page - 1) * per_page
    const to   = from + per_page - 1

    let query = db
      .from('livraisons')
      .select('*, commandes(numero, statut), clients(nom, telephone)', { count: 'exact' })

    if (statut)      query = query.eq('statut', statut)
    if (transporteur) query = query.ilike('transporteur', `%${transporteur}%`)
    if (client_id)   query = query.eq('client_id', client_id)
    if (date_debut)  query = query.gte('date_livraison_prevue', date_debut)
    if (date_fin)    query = query.lte('date_livraison_prevue', `${date_fin}T23:59:59.999Z`)

    const { data, count, error } = await query
      .order('created_at', { ascending: false })
      .range(from, to)

    if (error) {
      console.error('[logistique] GET /livraisons:', error.message)
      return c.json({ error: error.message }, 500)
    }

    return c.json({
      data:        data ?? [],
      total:       count ?? 0,
      page,
      per_page,
      total_pages: Math.ceil((count ?? 0) / per_page),
    })
  },
)

// ── GET /livraisons/:id — détail avec historique ──────────────────────────────

logistiqueRouter.get(
  '/livraisons/:id',
  requireRole(['admin', 'superviseur', 'operateur', 'livreur']),
  async (c) => {
    const { id } = c.req.param()

    const { data, error } = await db
      .from('livraisons')
      .select(`
        *,
        commandes(id, numero, statut, montant_ttc),
        clients(id, nom, telephone, email),
        livraisons_historique(
          id, ancien_statut, nouveau_statut, commentaire, geoloc, changed_by, changed_at,
          profiles!changed_by(full_name)
        )
      `)
      .eq('id', id)
      .single()

    if (error) {
      if (error.code === 'PGRST116') {
        return c.json({ error: 'Livraison introuvable', code: 'NOT_FOUND' }, 404)
      }
      console.error('[logistique] GET /livraisons/:id:', error.message)
      return c.json({ error: error.message }, 500)
    }

    return c.json(data)
  },
)

// ── POST /livraisons — création liée à une commande ───────────────────────────

logistiqueRouter.post(
  '/livraisons',
  requireRole(['admin', 'superviseur']),
  zValidator('json', createLivraisonSchema),
  async (c) => {
    const user = c.get('user')
    const body = c.req.valid('json')

    // Vérifier que la commande existe (avant de générer le numéro)
    const { data: commande, error: cmdErr } = await db
      .from('commandes')
      .select('id, numero')
      .eq('id', body.commande_id)
      .single()

    if (cmdErr || !commande) {
      return c.json({ error: 'Commande introuvable', code: 'COMMANDE_NOT_FOUND' }, 422)
    }

    const numero = await genererNumeroLivraison()

    const { data: livraison, error } = await db
      .from('livraisons')
      .insert({
        numero,
        commande_id:           body.commande_id,
        client_id:             body.client_id ?? null,
        client_nom:            body.client_nom,
        destination:           body.destination,
        transporteur:          body.transporteur ?? null,
        statut:                'planifiee',
        date_livraison_prevue: body.date_livraison_prevue ?? null,
        date_depart:           body.date_depart ?? null,
        notes:                 body.notes ?? null,
        created_by:            user.id,
        sync_status:           'pending',
      })
      .select()
      .single()

    if (error) {
      console.error('[logistique] POST /livraisons:', error.message)
      return c.json({ error: error.message }, 500)
    }

    const lv = livraison as { id: string }

    await db.from('livraisons_historique').insert({
      livraison_id:   lv.id,
      ancien_statut:  null,
      nouveau_statut: 'planifiee',
      commentaire:    'Livraison créée',
      changed_by:     user.id,
    })

    return c.json(livraison, 201)
  },
)

// ── PATCH /livraisons/:id/statut — transition de statut ──────────────────────

logistiqueRouter.patch(
  '/livraisons/:id/statut',
  requireRole(['admin', 'superviseur', 'operateur', 'livreur']),
  zValidator('json', patchStatutSchema),
  async (c) => {
    const user = c.get('user')
    const { id } = c.req.param()
    const body = c.req.valid('json')

    const { data: livraison, error: fetchErr } = await db
      .from('livraisons')
      .select('id, statut, livreur_id, created_by')
      .eq('id', id)
      .single()

    if (fetchErr || !livraison) {
      return c.json({ error: 'Livraison introuvable', code: 'NOT_FOUND' }, 404)
    }

    const lv = livraison as {
      id: string; statut: string; livreur_id: string | null; created_by: string | null
    }

    // Un operateur ne peut modifier que ses propres livraisons
    if (user.role === 'operateur') {
      const isOwner = lv.livreur_id === user.id || lv.created_by === user.id
      if (!isOwner) {
        writeAuditLog({
          userId:       user.id,
          actionType:   'ACCESS_DENIED',
          module:       'LOGISTICS',
          resourceType: 'livraison',
          resourceId:   id,
        })
        return c.json({ error: 'Accès refusé', code: 'FORBIDDEN' }, 403)
      }
    }

    // Valider la transition via la state machine
    const allowed = VALID_TRANSITIONS[lv.statut] ?? []
    if (!allowed.includes(body.statut)) {
      return c.json({
        error:   `Transition invalide : ${lv.statut} → ${body.statut}`,
        code:    'INVALID_TRANSITION',
        allowed,
      }, 422)
    }

    const updatePayload: Record<string, unknown> = {
      statut:     body.statut,
      updated_at: new Date().toISOString(),
    }

    if (body.statut === 'livree') {
      updatePayload.date_livraison_reelle = new Date().toISOString()
    }

    const { data: updated, error: updateErr } = await db
      .from('livraisons')
      .update(updatePayload)
      .eq('id', id)
      .select()
      .single()

    if (updateErr) {
      console.error('[logistique] PATCH statut:', updateErr.message)
      return c.json({ error: updateErr.message }, 500)
    }

    // Audit trail dans livraisons_historique
    await db.from('livraisons_historique').insert({
      livraison_id:   id,
      ancien_statut:  lv.statut,
      nouveau_statut: body.statut,
      commentaire:    body.commentaire ?? null,
      geoloc:         body.geoloc ?? null,
      changed_by:     user.id,
    })

    return c.json(updated)
  },
)

// ── PATCH /livraisons/:id/assigner — assigner un livreur ─────────────────────
// Réservé aux rôles MANAGER et SUPER_ADMIN (LOGISTICS:UPDATE)

logistiqueRouter.patch(
  '/livraisons/:id/assigner',
  requireRole(['admin', 'superviseur', 'operateur', 'livreur']),
  zValidator('json', assignerSchema),
  async (c) => {
    const user = c.get('user')
    const { id } = c.req.param()
    const body = c.req.valid('json')

    // Vérification RBAC : MANAGER ou SUPER_ADMIN uniquement
    const perm = await checkPermission(user.id, 'LOGISTICS', 'UPDATE', user.role)
    if (!perm.allowed) {
      writeAuditLog({
        userId:       user.id,
        actionType:   'ACCESS_DENIED',
        module:       'LOGISTICS',
        resourceType: 'livraison',
        resourceId:   id,
      })
      return c.json({
        error: `Accès refusé — MANAGER ou SUPER_ADMIN requis (rôle actuel : ${perm.roleName ?? user.role})`,
        code:  'FORBIDDEN',
      }, 403)
    }

    const { data: livraison, error: fetchErr } = await db
      .from('livraisons')
      .select('id, statut')
      .eq('id', id)
      .single()

    if (fetchErr || !livraison) {
      return c.json({ error: 'Livraison introuvable', code: 'NOT_FOUND' }, 404)
    }

    const { data: livreurProfile, error: profileErr } = await db
      .from('profiles')
      .select('id, nom')
      .eq('id', body.livreur_id)
      .single()

    if (profileErr || !livreurProfile) {
      return c.json({ error: 'Profil livreur introuvable', code: 'LIVREUR_NOT_FOUND' }, 422)
    }

    const updatePayload: Record<string, unknown> = {
      livreur_id: body.livreur_id,
      updated_at: new Date().toISOString(),
    }
    if (body.transporteur !== undefined) {
      updatePayload.transporteur = body.transporteur
    }

    const { data: updated, error: updateErr } = await db
      .from('livraisons')
      .update(updatePayload)
      .eq('id', id)
      .select()
      .single()

    if (updateErr) {
      console.error('[logistique] PATCH assigner:', updateErr.message)
      return c.json({ error: updateErr.message }, 500)
    }

    const lv = livraison as { statut: string }
    const lp = livreurProfile as { nom: string }

    await db.from('livraisons_historique').insert({
      livraison_id:   id,
      ancien_statut:  lv.statut,
      nouveau_statut: lv.statut,
      commentaire:    `Assigné à ${lp.nom}`,
      changed_by:     user.id,
    })

    return c.json(updated)
  },
)
