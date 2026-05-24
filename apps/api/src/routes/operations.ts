import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { supabaseAdmin } from '@forge/db'

const db = supabaseAdmin!
import { requireRole } from '../middleware/rbac'
import type { HonoVariables } from '../types'

const router = new Hono<{ Variables: HonoVariables }>()

// ══════════════════════════════════════════════════════════════════════════════
// PRODUCTION — JOBS
// ══════════════════════════════════════════════════════════════════════════════

const jobSchema = z.object({
  produit_designation: z.string().min(1),
  machine_nom:         z.string().optional(),
  technicien_nom:      z.string().optional(),
  date_debut:          z.string().optional(),
  date_fin_prevue:     z.string().optional(),
  notes:               z.string().optional(),
})

const jobStatutSchema = z.object({
  statut:          z.enum(['confirmed', 'in_production', 'pret', 'delivered', 'cancelled']),
  avancement_pct:  z.number().int().min(0).max(100).optional(),
  date_fin_reelle: z.string().optional(),
  notes:           z.string().optional(),
})

router.get('/production/jobs', async (c) => {
  const { statut, search } = c.req.query()
  const page    = Math.max(1, parseInt(c.req.query('page') ?? '1'))
  const perPage = Math.min(100, parseInt(c.req.query('per_page') ?? '20'))
  const from    = (page - 1) * perPage

  let q = db.from('jobs_production').select('*', { count: 'exact' })
  if (statut) q = q.eq('statut', statut)
  if (search) q = q.ilike('produit_designation', `%${search}%`)

  const { data, count, error } = await q.order('created_at', { ascending: false }).range(from, from + perPage - 1)
  if (error) return c.json({ error: error.message }, 500)

  return c.json({ data, total: count ?? 0, page, per_page: perPage })
})

router.post('/production/jobs', requireRole(['directeur', 'admin', 'operateur']), zValidator('json', jobSchema), async (c) => {
  const user = c.get('user')
  const body = c.req.valid('json')

  // Generate sequential job number
  const { count } = await db.from('jobs_production').select('*', { count: 'exact', head: true })
  const year = new Date().getFullYear()
  const num  = String((count ?? 0) + 1).padStart(3, '0')
  const numero = `JOB-${year}-${num}`

  const { data, error } = await db
    .from('jobs_production')
    .insert({ ...body, numero, created_by: user.id, sync_status: 'synced' })
    .select().single()

  if (error) return c.json({ error: error.message, code: error.code }, 400)
  return c.json(data, 201)
})

router.patch('/production/jobs/:id/statut', requireRole(['directeur', 'admin', 'operateur']), zValidator('json', jobStatutSchema), async (c) => {
  const { id } = c.req.param()
  const body   = c.req.valid('json')
  const { data, error } = await db
    .from('jobs_production')
    .update({ ...body, updated_at: new Date().toISOString() })
    .eq('id', id).select().single()
  if (error) return c.json({ error: error.message }, 400)
  if (!data)  return c.json({ error: 'Job introuvable', code: 'NOT_FOUND' }, 404)
  return c.json(data)
})

// ══════════════════════════════════════════════════════════════════════════════
// PROJETS
// ══════════════════════════════════════════════════════════════════════════════

const projetSchema = z.object({
  nom:             z.string().min(1),
  description:     z.string().optional(),
  client_nom:      z.string().optional(),
  chef_projet_nom: z.string().optional(),
  budget_xaf:      z.number().min(0).default(0),
  date_debut:      z.string().optional(),
  deadline:        z.string().optional(),
})

const projetStatutSchema = z.object({
  statut:         z.enum(['planifie', 'en_cours', 'suspendu', 'livre', 'annule']),
  avancement_pct: z.number().int().min(0).max(100).optional(),
  depense_xaf:    z.number().min(0).optional(),
})

router.get('/projets', async (c) => {
  const { statut, search } = c.req.query()
  const page    = Math.max(1, parseInt(c.req.query('page') ?? '1'))
  const perPage = Math.min(100, parseInt(c.req.query('per_page') ?? '20'))
  const from    = (page - 1) * perPage

  let q = db.from('projets').select('*', { count: 'exact' })
  if (statut) q = q.eq('statut', statut)
  if (search) q = q.ilike('nom', `%${search}%`)

  const { data, count, error } = await q.order('created_at', { ascending: false }).range(from, from + perPage - 1)
  if (error) return c.json({ error: error.message }, 500)

  return c.json({ data, total: count ?? 0, page, per_page: perPage })
})

router.post('/projets', requireRole(['directeur', 'admin']), zValidator('json', projetSchema), async (c) => {
  const user = c.get('user')
  const body = c.req.valid('json')
  const { data, error } = await db
    .from('projets')
    .insert({ ...body, created_by: user.id, sync_status: 'synced' })
    .select().single()
  if (error) return c.json({ error: error.message, code: error.code }, 400)
  return c.json(data, 201)
})

router.patch('/projets/:id/statut', requireRole(['directeur', 'admin']), zValidator('json', projetStatutSchema), async (c) => {
  const { id } = c.req.param()
  const body   = c.req.valid('json')
  const { data, error } = await db
    .from('projets')
    .update({ ...body, updated_at: new Date().toISOString() })
    .eq('id', id).select().single()
  if (error) return c.json({ error: error.message }, 400)
  if (!data)  return c.json({ error: 'Projet introuvable', code: 'NOT_FOUND' }, 404)
  return c.json(data)
})

// ══════════════════════════════════════════════════════════════════════════════
// LOGISTIQUE — LIVRAISONS
// ══════════════════════════════════════════════════════════════════════════════

const livraisonSchema = z.object({
  client_nom:              z.string().min(1),
  destination:             z.string().min(1),
  transporteur:            z.string().optional(),
  date_depart:             z.string().optional(),
  date_livraison_prevue:   z.string().optional(),
  notes:                   z.string().optional(),
})

const livraisonStatutSchema = z.object({
  statut:                z.enum(['confirmed', 'in_production', 'pret', 'delivered', 'cancelled']),
  date_livraison_reelle: z.string().optional(),
  notes:                 z.string().optional(),
})

router.get('/logistique/livraisons', async (c) => {
  const { statut, search } = c.req.query()
  const page    = Math.max(1, parseInt(c.req.query('page') ?? '1'))
  const perPage = Math.min(100, parseInt(c.req.query('per_page') ?? '20'))
  const from    = (page - 1) * perPage

  let q = db.from('livraisons').select('*', { count: 'exact' })
  if (statut) q = q.eq('statut', statut)
  if (search) q = q.ilike('client_nom', `%${search}%`)

  const { data, count, error } = await q.order('created_at', { ascending: false }).range(from, from + perPage - 1)
  if (error) return c.json({ error: error.message }, 500)

  return c.json({ data, total: count ?? 0, page, per_page: perPage })
})

router.post('/logistique/livraisons', requireRole(['directeur', 'admin', 'operateur']), zValidator('json', livraisonSchema), async (c) => {
  const user = c.get('user')
  const body = c.req.valid('json')

  const { count } = await db.from('livraisons').select('*', { count: 'exact', head: true })
  const year = new Date().getFullYear()
  const num  = String((count ?? 0) + 1).padStart(3, '0')
  const numero = `LIV-${year}-${num}`

  const { data, error } = await db
    .from('livraisons')
    .insert({ ...body, numero, created_by: user.id, sync_status: 'synced' })
    .select().single()

  if (error) return c.json({ error: error.message, code: error.code }, 400)
  return c.json(data, 201)
})

router.patch('/logistique/livraisons/:id/statut', requireRole(['directeur', 'admin', 'operateur']), zValidator('json', livraisonStatutSchema), async (c) => {
  const { id } = c.req.param()
  const body   = c.req.valid('json')
  const { data, error } = await db
    .from('livraisons')
    .update({ ...body, updated_at: new Date().toISOString() })
    .eq('id', id).select().single()
  if (error) return c.json({ error: error.message }, 400)
  if (!data)  return c.json({ error: 'Livraison introuvable', code: 'NOT_FOUND' }, 404)
  return c.json(data)
})

// ══════════════════════════════════════════════════════════════════════════════
// MARKETING — CAMPAGNES
// ══════════════════════════════════════════════════════════════════════════════

const campagneSchema = z.object({
  nom:         z.string().min(1),
  description: z.string().optional(),
  canal:       z.string().min(1),
  budget_xaf:  z.number().min(0).default(0),
  date_debut:  z.string(),
  date_fin:    z.string(),
})

const campagneStatutSchema = z.object({
  statut:              z.enum(['planifie', 'active', 'pause', 'termine', 'annule']),
  reach:               z.number().int().min(0).optional(),
  leads_count:         z.number().int().min(0).optional(),
  conversions_count:   z.number().int().min(0).optional(),
})

router.get('/marketing/campagnes', async (c) => {
  const { statut, search } = c.req.query()
  const page    = Math.max(1, parseInt(c.req.query('page') ?? '1'))
  const perPage = Math.min(100, parseInt(c.req.query('per_page') ?? '20'))
  const from    = (page - 1) * perPage

  let q = db.from('campagnes_marketing').select('*', { count: 'exact' })
  if (statut) q = q.eq('statut', statut)
  if (search) q = q.ilike('nom', `%${search}%`)

  const { data, count, error } = await q.order('created_at', { ascending: false }).range(from, from + perPage - 1)
  if (error) return c.json({ error: error.message }, 500)

  return c.json({ data, total: count ?? 0, page, per_page: perPage })
})

router.post('/marketing/campagnes', requireRole(['directeur', 'admin']), zValidator('json', campagneSchema), async (c) => {
  const user = c.get('user')
  const body = c.req.valid('json')
  const { data, error } = await db
    .from('campagnes_marketing')
    .insert({ ...body, created_by: user.id, sync_status: 'synced' })
    .select().single()
  if (error) return c.json({ error: error.message, code: error.code }, 400)
  return c.json(data, 201)
})

router.patch('/marketing/campagnes/:id/statut', requireRole(['directeur', 'admin']), zValidator('json', campagneStatutSchema), async (c) => {
  const { id } = c.req.param()
  const body   = c.req.valid('json')
  const { data, error } = await db
    .from('campagnes_marketing')
    .update({ ...body, updated_at: new Date().toISOString() })
    .eq('id', id).select().single()
  if (error) return c.json({ error: error.message }, 400)
  if (!data)  return c.json({ error: 'Campagne introuvable', code: 'NOT_FOUND' }, 404)
  return c.json(data)
})

// ══════════════════════════════════════════════════════════════════════════════
// SÉCURITÉ — INCIDENTS
// ══════════════════════════════════════════════════════════════════════════════

const incidentSchema = z.object({
  type:           z.string().min(1),
  description:    z.string().min(1),
  zone:           z.string().min(1),
  signale_par:    z.string().min(1),
  date_incident:  z.string(),
})

const incidentStatutSchema = z.object({
  statut:               z.enum(['ouvert', 'traite', 'corrige', 'resolu']),
  date_resolution:      z.string().optional(),
  actions_correctrices: z.string().optional(),
})

router.get('/securite/incidents', async (c) => {
  const { statut, search } = c.req.query()
  const page    = Math.max(1, parseInt(c.req.query('page') ?? '1'))
  const perPage = Math.min(100, parseInt(c.req.query('per_page') ?? '20'))
  const from    = (page - 1) * perPage

  let q = db.from('incidents_securite').select('*', { count: 'exact' })
  if (statut) q = q.eq('statut', statut)
  if (search) q = q.ilike('description', `%${search}%`)

  const { data, count, error } = await q.order('created_at', { ascending: false }).range(from, from + perPage - 1)
  if (error) return c.json({ error: error.message }, 500)

  return c.json({ data, total: count ?? 0, page, per_page: perPage })
})

router.post('/securite/incidents', requireRole(['directeur', 'admin', 'operateur']), zValidator('json', incidentSchema), async (c) => {
  const user = c.get('user')
  const body = c.req.valid('json')
  const { data, error } = await db
    .from('incidents_securite')
    .insert({ ...body, created_by: user.id, sync_status: 'synced' })
    .select().single()
  if (error) return c.json({ error: error.message, code: error.code }, 400)
  return c.json(data, 201)
})

router.patch('/securite/incidents/:id/statut', requireRole(['directeur', 'admin']), zValidator('json', incidentStatutSchema), async (c) => {
  const { id } = c.req.param()
  const body   = c.req.valid('json')
  const { data, error } = await db
    .from('incidents_securite')
    .update({ ...body, updated_at: new Date().toISOString() })
    .eq('id', id).select().single()
  if (error) return c.json({ error: error.message }, 400)
  if (!data)  return c.json({ error: 'Incident introuvable', code: 'NOT_FOUND' }, 404)
  return c.json(data)
})

export { router as operationsRouter }
