import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { supabaseAdmin } from '@forge/db'
import { requireRole } from '../middleware/rbac'
import type { HonoVariables } from '../types'

const db     = supabaseAdmin!
const router = new Hono<{ Variables: HonoVariables }>()

// ── Schémas Zod ────────────────────────────────────────────────────────────────

const equipementSchema = z.object({
  code:                   z.string().min(1).max(20),
  designation:            z.string().min(1),
  categorie:              z.enum(['outil', 'machine_legere', 'instrument', 'epi', 'vehicule']).default('outil'),
  numero_serie:           z.string().optional(),
  fournisseur:            z.string().optional(),
  date_acquisition:       z.string().optional(),
  valeur_achat_xaf:       z.number().min(0).default(0),
  emplacement:            z.string().optional(),
  responsable_id:         z.string().optional(),
  prochaine_revision:     z.string().optional(),
  intervalle_revision_j:  z.number().int().min(1).default(365),
  notes:                  z.string().optional(),
})

const equipementStatutSchema = z.object({
  statut: z.enum(['disponible', 'en_service', 'maintenance', 'hors_service', 'cede']),
  notes:  z.string().optional(),
})

const maintenanceSchema = z.object({
  type:             z.enum(['preventive', 'corrective', 'calibrage', 'remplacement']).default('preventive'),
  date_maintenance: z.string(),
  technicien_id:    z.string().optional(),
  cout_xaf:         z.number().min(0).default(0),
  description:      z.string().optional(),
  prochaine_date:   z.string().optional(),
  statut:           z.enum(['planifie', 'en_cours', 'fait', 'annule']).default('planifie'),
})

// ══════════════════════════════════════════════════════════════════════════════
// ÉQUIPEMENTS
// ══════════════════════════════════════════════════════════════════════════════

/**
 * GET /api/equipements/alertes-revision
 * Équipements dont la révision est due dans les 30 prochains jours.
 */
router.get('/equipements/alertes-revision', async (c) => {
  const dans30j = new Date()
  dans30j.setDate(dans30j.getDate() + 30)
  const limitDate = dans30j.toISOString().slice(0, 10)

  const { data, error } = await db
    .from('equipements')
    .select('id, code, designation, prochaine_revision, statut, emplacement, employes(nom)')
    .lte('prochaine_revision', limitDate)
    .not('statut', 'eq', 'hors_service')
    .order('prochaine_revision')

  if (error) return c.json({ error: error.message }, 500)

  const today = new Date().toISOString().slice(0, 10)
  const enriched = (data ?? []).map((e: Record<string, unknown>) => ({
    ...e,
    revision_depassee: (e.prochaine_revision as string) < today,
    jours_restants:    Math.round(
      (new Date(e.prochaine_revision as string).getTime() - Date.now()) / 86400000
    ),
  }))

  return c.json({ data: enriched, total: enriched.length })
})

router.get('/equipements', async (c) => {
  const { categorie, statut, search } = c.req.query()
  const page    = Math.max(1, parseInt(c.req.query('page') ?? '1'))
  const perPage = Math.min(100, parseInt(c.req.query('per_page') ?? '20'))
  const from    = (page - 1) * perPage

  let q = db.from('equipements').select('*, employes(nom, poste)', { count: 'exact' })
  if (categorie) q = q.eq('categorie', categorie)
  if (statut)    q = q.eq('statut', statut)
  if (search)    q = q.or(`designation.ilike.%${search}%,code.ilike.%${search}%`)

  const { data, count, error } = await q
    .order('code')
    .range(from, from + perPage - 1)

  if (error) return c.json({ error: error.message }, 500)

  const today = new Date().toISOString().slice(0, 10)
  const enriched = (data ?? []).map((e: Record<string, unknown>) => ({
    ...e,
    revision_depassee: e.prochaine_revision
      ? (e.prochaine_revision as string) < today
      : false,
  }))

  return c.json({ data: enriched, total: count ?? 0, page, per_page: perPage })
})

router.get('/equipements/:id', async (c) => {
  const { id } = c.req.param()

  const [equipRes, maintRes] = await Promise.all([
    db.from('equipements')
      .select('*, employes(nom, poste)')
      .eq('id', id)
      .single(),
    db.from('maintenances_equipement')
      .select('*, employes(nom)')
      .eq('equipement_id', id)
      .order('date_maintenance', { ascending: false })
      .limit(20),
  ])

  if (equipRes.error || !equipRes.data) {
    return c.json({ error: 'Équipement introuvable', code: 'NOT_FOUND' }, 404)
  }

  const today = new Date().toISOString().slice(0, 10)
  const e = equipRes.data as Record<string, unknown>

  return c.json({
    ...e,
    revision_depassee: e.prochaine_revision ? (e.prochaine_revision as string) < today : false,
    maintenances:      maintRes.data ?? [],
    cout_maintenance_total: (maintRes.data ?? []).reduce(
      (s: number, m: Record<string, unknown>) => s + ((m.cout_xaf as number) ?? 0), 0
    ),
  })
})

router.post('/equipements', requireRole(['directeur', 'admin']), zValidator('json', equipementSchema), async (c) => {
  const user = c.get('user')
  const body = c.req.valid('json')

  // Vérifier unicité du code
  const { count } = await db.from('equipements')
    .select('*', { count: 'exact', head: true })
    .eq('code', body.code)

  if ((count ?? 0) > 0) {
    return c.json({ error: `Code équipement "${body.code}" déjà utilisé`, code: 'DUPLICATE_CODE' }, 422)
  }

  const { data, error } = await db
    .from('equipements')
    .insert({ ...body, created_by: user.id })
    .select().single()

  if (error) return c.json({ error: error.message, code: error.code }, 400)
  return c.json(data, 201)
})

router.put('/equipements/:id', requireRole(['directeur', 'admin']), zValidator('json', equipementSchema.partial()), async (c) => {
  const { id } = c.req.param()
  const body   = c.req.valid('json')

  const { data, error } = await db
    .from('equipements')
    .update({ ...body, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select().single()

  if (error) return c.json({ error: error.message }, 400)
  if (!data)  return c.json({ error: 'Équipement introuvable', code: 'NOT_FOUND' }, 404)
  return c.json(data)
})

router.patch('/equipements/:id/statut', requireRole(['directeur', 'admin', 'operateur']), zValidator('json', equipementStatutSchema), async (c) => {
  const { id } = c.req.param()
  const body   = c.req.valid('json')

  const updates: Record<string, unknown> = {
    statut:     body.statut,
    updated_at: new Date().toISOString(),
  }
  if (body.notes) updates.notes = body.notes

  const { data, error } = await db
    .from('equipements')
    .update(updates)
    .eq('id', id)
    .select().single()

  if (error) return c.json({ error: error.message }, 400)
  if (!data)  return c.json({ error: 'Équipement introuvable', code: 'NOT_FOUND' }, 404)
  return c.json(data)
})

// ══════════════════════════════════════════════════════════════════════════════
// MAINTENANCES
// ══════════════════════════════════════════════════════════════════════════════

router.get('/equipements/:id/maintenances', async (c) => {
  const { id } = c.req.param()

  const { data, error } = await db
    .from('maintenances_equipement')
    .select('*, employes(nom)')
    .eq('equipement_id', id)
    .order('date_maintenance', { ascending: false })

  if (error) return c.json({ error: error.message }, 500)
  return c.json({ data: data ?? [], total: (data ?? []).length })
})

router.post('/equipements/:id/maintenances', requireRole(['directeur', 'admin']), zValidator('json', maintenanceSchema), async (c) => {
  const { id } = c.req.param()
  const user   = c.get('user')
  const body   = c.req.valid('json')

  const { data: equip } = await db.from('equipements').select('id').eq('id', id).single()
  if (!equip) return c.json({ error: 'Équipement introuvable', code: 'NOT_FOUND' }, 404)

  const { data, error } = await db
    .from('maintenances_equipement')
    .insert({ ...body, equipement_id: id, created_by: user.id })
    .select().single()

  if (error) return c.json({ error: error.message, code: error.code }, 400)

  // Mettre à jour la prochaine révision sur l'équipement si fournie
  if (body.prochaine_date) {
    await db.from('equipements').update({
      prochaine_revision: body.prochaine_date,
      updated_at:         new Date().toISOString(),
      // Si maintenance → passer en disponible si statut = maintenance
      ...(body.statut === 'fait' ? { statut: 'disponible' } : {}),
    }).eq('id', id)
  }

  return c.json(data, 201)
})

router.patch('/equipements/:equipId/maintenances/:maintId/statut', requireRole(['directeur', 'admin', 'operateur']), async (c) => {
  const { equipId, maintId } = c.req.param()
  const body = await c.req.json<{ statut: string; prochaine_date?: string }>()

  const validStatuts = ['planifie', 'en_cours', 'fait', 'annule']
  if (!validStatuts.includes(body.statut)) {
    return c.json({ error: 'Statut invalide', code: 'INVALID_STATUS' }, 422)
  }

  const { data, error } = await db
    .from('maintenances_equipement')
    .update({ statut: body.statut })
    .eq('id', maintId)
    .eq('equipement_id', equipId)
    .select().single()

  if (error) return c.json({ error: error.message }, 400)
  if (!data)  return c.json({ error: 'Maintenance introuvable', code: 'NOT_FOUND' }, 404)

  // Si terminée → mettre à jour prochaine révision
  if (body.statut === 'fait') {
    const updates: Record<string, unknown> = {
      statut:     'disponible',
      updated_at: new Date().toISOString(),
    }
    if (body.prochaine_date) updates.prochaine_revision = body.prochaine_date
    await db.from('equipements').update(updates).eq('id', equipId)
  }

  return c.json(data)
})

export { router as equipementsRouter }
