import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { supabaseAdmin } from '@forge/db'
import { requireRole } from '../middleware/rbac'
import { notifyWorkflow } from '../services/workflow-notifications.service'
import type { HonoVariables } from '../types'

const db     = supabaseAdmin!
const router = new Hono<{ Variables: HonoVariables }>()

// ── Schémas Zod ────────────────────────────────────────────────────────────────

const categorieEquipementSchema = z.enum([
  'machine_production', 'outillage', 'informatique', 'logiciel', 'vehicule',
  'securite', 'autre', 'outil', 'machine_legere', 'instrument', 'epi',
])

const statutEquipementSchema = z.enum([
  'disponible', 'en_service', 'maintenance', 'en_panne', 'hors_service', 'remplacement_prevu', 'cede',
])

const equipementSchema = z.object({
  code:                   z.string().min(1).max(20),
  designation:            z.string().min(1),
  categorie:              categorieEquipementSchema.default('outillage'),
  numero_serie:           z.string().optional(),
  fournisseur:            z.string().optional(),
  marque:                 z.string().optional(),
  modele:                 z.string().optional(),
  date_acquisition:       z.string().optional(),
  date_fin_garantie:      z.string().optional(),
  date_remplacement_prevue: z.string().optional(),
  valeur_achat_xaf:       z.number().min(0).default(0),
  valeur_residuelle_xaf:  z.number().min(0).default(0),
  criticite:              z.enum(['faible', 'moyenne', 'haute', 'critique']).default('moyenne'),
  emplacement:            z.string().optional(),
  responsable_id:         z.string().optional(),
  prochaine_revision:     z.string().optional(),
  intervalle_revision_j:  z.number().int().min(1).default(365),
  notes:                  z.string().optional(),
})

const equipementStatutSchema = z.object({
  statut: statutEquipementSchema,
  notes:  z.string().optional(),
})

const maintenanceSchema = z.object({
  type:             z.enum(['preventive', 'corrective', 'calibrage', 'remplacement', 'panne', 'reparation', 'installation', 'audit']).default('preventive'),
  date_maintenance: z.string(),
  technicien_id:    z.string().optional(),
  cout_xaf:         z.number().min(0).default(0),
  description:      z.string().optional(),
  prochaine_date:   z.string().optional(),
  statut:           z.enum(['planifie', 'en_cours', 'fait', 'annule']).default('planifie'),
  creer_charge:     z.boolean().optional(),
  fournisseur_nom:  z.string().optional(),
  compte_charge:    z.string().optional(),
  tva_xaf:          z.number().min(0).default(0),
  mode_paiement:    z.enum(['caisse', 'banque', 'mobile_money', 'credit_fournisseur']).optional(),
  compte_tresorerie:z.string().optional(),
  reference_paiement:z.string().optional(),
})

async function genererNumero(table: string, prefix: string) {
  const year = new Date().getFullYear()
  const { count } = await db
    .from(table)
    .select('*', { count: 'exact', head: true })
    .gte('created_at', `${year}-01-01T00:00:00.000Z`)
  return `${prefix}-${year}-${String((count ?? 0) + 1).padStart(4, '0')}`
}

function statutApresMaintenance(type: string, statut: string) {
  if (statut === 'annule') return null
  if (statut === 'fait') return 'disponible'
  if (['panne', 'reparation', 'corrective'].includes(type)) return 'en_panne'
  return 'maintenance'
}

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

router.get('/equipements/dashboard', async (c) => {
  const today = new Date().toISOString().slice(0, 10)
  const dans30j = new Date()
  dans30j.setDate(dans30j.getDate() + 30)
  const limitDate = dans30j.toISOString().slice(0, 10)

  const [equipRes, maintRes, chargesRes] = await Promise.all([
    db.from('equipements').select('id, statut, categorie, criticite, prochaine_revision, date_remplacement_prevue, valeur_achat_xaf'),
    db.from('maintenances_equipement').select('id, statut, cout_xaf, date_maintenance, type').gte('date_maintenance', `${new Date().getFullYear()}-01-01`),
    db.from('charges').select('montant_ttc_xaf, montant_paye_xaf, statut').not('equipement_id', 'is', null),
  ])

  if (equipRes.error) return c.json({ error: equipRes.error.message }, 500)

  const equipements = (equipRes.data ?? []) as Array<Record<string, unknown>>
  const maintenances = (maintRes.data ?? []) as Array<Record<string, unknown>>
  const charges = (chargesRes.data ?? []) as Array<Record<string, unknown>>
  const due = equipements.filter((e) => e.prochaine_revision && String(e.prochaine_revision) <= limitDate && !['hors_service', 'cede'].includes(String(e.statut)))
  const remplacement = equipements.filter((e) => e.date_remplacement_prevue && String(e.date_remplacement_prevue) <= limitDate && !['cede'].includes(String(e.statut)))

  return c.json({
    kpis: {
      total: equipements.length,
      operationnels: equipements.filter((e) => ['disponible', 'en_service'].includes(String(e.statut))).length,
      en_panne: equipements.filter((e) => e.statut === 'en_panne').length,
      maintenance: equipements.filter((e) => e.statut === 'maintenance').length,
      revisions_a_prevoir: due.length,
      revisions_en_retard: due.filter((e) => String(e.prochaine_revision) < today).length,
      remplacements_a_prevoir: remplacement.length,
      valeur_actifs_xaf: Math.round(equipements.reduce((s, e) => s + Number(e.valeur_achat_xaf ?? 0), 0)),
      cout_maintenance_annee_xaf: Math.round(maintenances.reduce((s, m) => s + Number(m.cout_xaf ?? 0), 0)),
      charges_liees_xaf: Math.round(charges.reduce((s, ch) => s + Number(ch.montant_ttc_xaf ?? 0), 0)),
      reste_charges_xaf: Math.round(charges.reduce((s, ch) => s + Math.max(0, Number(ch.montant_ttc_xaf ?? 0) - Number(ch.montant_paye_xaf ?? 0)), 0)),
    },
    repartition_statuts: Object.fromEntries(
      ['disponible', 'en_service', 'maintenance', 'en_panne', 'hors_service', 'remplacement_prevu', 'cede']
        .map((s) => [s, equipements.filter((e) => e.statut === s).length])
    ),
    alertes_revision: due.slice(0, 8),
    remplacements: remplacement.slice(0, 8),
  })
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

  const [equipRes, maintRes, chargesRes] = await Promise.all([
    db.from('equipements')
      .select('*, employes(nom, poste)')
      .eq('id', id)
      .single(),
    db.from('maintenances_equipement')
      .select('*, employes(nom), charges(id, numero, statut, montant_ttc_xaf, montant_paye_xaf)')
      .eq('equipement_id', id)
      .order('date_maintenance', { ascending: false })
      .limit(20),
    db.from('charges')
      .select('id, numero, fournisseur_nom, categorie, statut, montant_ttc_xaf, montant_paye_xaf, date_charge, description')
      .eq('equipement_id', id)
      .order('date_charge', { ascending: false })
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
    charges:           chargesRes.data ?? [],
    cout_maintenance_total: (maintRes.data ?? []).reduce(
      (s: number, m: Record<string, unknown>) => s + ((m.cout_xaf as number) ?? 0), 0
    ),
  })
})

router.post('/equipements', requireRole(['admin', 'superviseur']), zValidator('json', equipementSchema), async (c) => {
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
  await notifyWorkflow({
    event:   'equipements.equipement_cree',
    module:  'production',
    severite:'info',
    titre:   'Nouvel equipement',
    message: `${body.code} - ${body.designation} ajoute au registre des actifs.`,
    ref:     body.code,
    url:     '/equipements',
    data:    { equipement_id: (data as { id: string }).id, categorie: body.categorie },
  })
  return c.json(data, 201)
})

router.put('/equipements/:id', requireRole(['admin', 'superviseur']), zValidator('json', equipementSchema.partial()), async (c) => {
  const { id } = c.req.param()
  const body   = c.req.valid('json')

  const { data, error } = await db
    .from('equipements')
    .update({ ...body, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select().single()

  if (error) return c.json({ error: error.message }, 400)
  if (!data)  return c.json({ error: 'Équipement introuvable', code: 'NOT_FOUND' }, 404)
  await notifyWorkflow({
    event:   'equipements.equipement_modifie',
    module:  'production',
    severite:'info',
    titre:   'Equipement modifie',
    message: `La fiche ${(data as { code?: string }).code ?? ''} a ete mise a jour.`,
    ref:     (data as { code?: string }).code ?? id,
    url:     '/equipements',
    data:    { equipement_id: id },
  })
  return c.json(data)
})

router.patch('/equipements/:id/statut', requireRole(['admin', 'superviseur', 'operateur']), zValidator('json', equipementStatutSchema), async (c) => {
  const { id } = c.req.param()
  const body   = c.req.valid('json')
  const user   = c.get('user')

  const { data: existing } = await db.from('equipements').select('statut, code, designation').eq('id', id).single()
  if (!existing) return c.json({ error: 'Équipement introuvable', code: 'NOT_FOUND' }, 404)

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

  await db.from('maintenances_equipement').insert({
    equipement_id:     id,
    type:              body.statut === 'en_panne' ? 'panne' : body.statut === 'maintenance' ? 'preventive' : 'audit',
    date_maintenance:  new Date().toISOString().slice(0, 10),
    statut:            body.statut === 'maintenance' ? 'en_cours' : 'fait',
    cout_xaf:          0,
    description:       body.notes ?? `Changement statut ${(existing as { statut: string }).statut} -> ${body.statut}`,
    created_by:        user.id,
  }).catch((e) => console.error('[equipements] historique statut:', e))

  await notifyWorkflow({
    event:   body.statut === 'en_panne' ? 'equipements.panne_signalee' : 'equipements.statut_modifie',
    module:  'production',
    severite:body.statut === 'en_panne' || body.statut === 'hors_service' ? 'warning' : 'info',
    titre:   body.statut === 'en_panne' ? 'Panne equipement signalee' : 'Statut equipement modifie',
    message: `${(existing as { code: string }).code} - ${(existing as { designation: string }).designation} : ${body.statut}.`,
    ref:     (existing as { code: string }).code,
    url:     '/equipements',
    data:    { equipement_id: id, ancien_statut: (existing as { statut: string }).statut, nouveau_statut: body.statut },
  })
  return c.json(data)
})

// ══════════════════════════════════════════════════════════════════════════════
// MAINTENANCES
// ══════════════════════════════════════════════════════════════════════════════

router.get('/equipements/:id/maintenances', async (c) => {
  const { id } = c.req.param()

  const { data, error } = await db
    .from('maintenances_equipement')
    .select('*, employes(nom), charges(id, numero, statut, montant_ttc_xaf, montant_paye_xaf)')
    .eq('equipement_id', id)
    .order('date_maintenance', { ascending: false })

  if (error) return c.json({ error: error.message }, 500)
  return c.json({ data: data ?? [], total: (data ?? []).length })
})

router.post('/equipements/:id/maintenances', requireRole(['admin', 'superviseur']), zValidator('json', maintenanceSchema), async (c) => {
  const { id } = c.req.param()
  const user   = c.get('user')
  const body   = c.req.valid('json')

  const { data: equip } = await db.from('equipements').select('id, code, designation, fournisseur').eq('id', id).single()
  if (!equip) return c.json({ error: 'Équipement introuvable', code: 'NOT_FOUND' }, 404)

  let chargeId: string | null = null
  if (body.creer_charge && body.cout_xaf > 0) {
    const total = Math.round(Number(body.cout_xaf ?? 0) + Number(body.tva_xaf ?? 0))
    const numero = await genererNumero('charges', 'CHG')
    const fournisseurNom = body.fournisseur_nom ?? (equip as { fournisseur?: string | null }).fournisseur ?? 'Intervention equipement'
    const { data: charge, error: chargeError } = await db.from('charges').insert({
      numero,
      fournisseur_nom:      fournisseurNom,
      categorie:           'Maintenance equipement',
      compte_charge:       body.compte_charge ?? '624',
      compte_charge_label: 'Entretien, reparations et maintenance',
      date_charge:         body.date_maintenance,
      date_echeance:       body.date_maintenance,
      statut:              'a_valider',
      montant_ht_xaf:      Math.round(body.cout_xaf),
      tva_xaf:             Math.round(body.tva_xaf ?? 0),
      montant_ttc_xaf:     total,
      montant_paye_xaf:    0,
      mode_paiement:       body.mode_paiement ?? 'credit_fournisseur',
      compte_tresorerie:   body.compte_tresorerie ?? null,
      reference_paiement:  body.reference_paiement ?? null,
      justificatif_statut: 'manquant',
      description:         body.description ?? `Intervention sur ${(equip as { code: string }).code}`,
      equipement_id:       id,
      created_by:          user.id,
      validated_by:        null,
      validated_at:        null,
      sync_status:         'synced',
    }).select('id, numero').single()
    if (chargeError) return c.json({ error: chargeError.message, code: chargeError.code }, 400)
    chargeId = (charge as { id: string }).id
  }

  const { data, error } = await db
    .from('maintenances_equipement')
    .insert({
      type:             body.type,
      date_maintenance: body.date_maintenance,
      technicien_id:    body.technicien_id ?? null,
      cout_xaf:         body.cout_xaf,
      description:      body.description ?? null,
      prochaine_date:   body.prochaine_date ?? null,
      statut:           body.statut,
      charge_id:        chargeId,
      equipement_id:    id,
      created_by:       user.id,
    })
    .select().single()

  if (error) return c.json({ error: error.message, code: error.code }, 400)

  const nextStatut = statutApresMaintenance(body.type, body.statut)
  await db.from('equipements').update({
    ...(body.prochaine_date ? { prochaine_revision: body.prochaine_date } : {}),
    ...(nextStatut ? { statut: nextStatut } : {}),
    updated_at: new Date().toISOString(),
  }).eq('id', id)

  await notifyWorkflow({
    event:   body.type === 'panne' ? 'equipements.panne_enregistree' : 'equipements.intervention_enregistree',
    module:  'production',
    severite:body.type === 'panne' ? 'warning' : body.statut === 'fait' ? 'success' : 'info',
    titre:   body.type === 'panne' ? 'Panne enregistree' : 'Intervention equipement',
    message: `${(equip as { code: string }).code} - ${(equip as { designation: string }).designation} : ${body.type}.`,
    ref:     (equip as { code: string }).code,
    url:     '/equipements',
    data:    { equipement_id: id, maintenance_id: (data as { id: string }).id, charge_id: chargeId },
  })

  return c.json(data, 201)
})

router.patch('/equipements/:equipId/maintenances/:maintId/statut', requireRole(['admin', 'superviseur', 'operateur']), async (c) => {
  const { equipId, maintId } = c.req.param()
  const body = await c.req.json<{ statut: string; prochaine_date?: string }>()

  const validStatuts = ['planifie', 'en_cours', 'fait', 'annule']
  if (!validStatuts.includes(body.statut)) {
    return c.json({ error: 'Statut invalide', code: 'INVALID_STATUS' }, 422)
  }

  const { data, error } = await db
    .from('maintenances_equipement')
    .update({ statut: body.statut, updated_at: new Date().toISOString() })
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
  } else if (body.statut === 'en_cours') {
    await db.from('equipements').update({
      statut:     'maintenance',
      updated_at: new Date().toISOString(),
    }).eq('id', equipId)
  }

  await notifyWorkflow({
    event:   body.statut === 'fait' ? 'equipements.intervention_terminee' : 'equipements.intervention_statut',
    module:  'production',
    severite:body.statut === 'fait' ? 'success' : body.statut === 'annule' ? 'warning' : 'info',
    titre:   body.statut === 'fait' ? 'Intervention terminee' : 'Statut intervention modifie',
    message: `Intervention equipement ${body.statut}.`,
    ref:     maintId,
    url:     '/equipements',
    data:    { equipement_id: equipId, maintenance_id: maintId, statut: body.statut },
  })

  return c.json(data)
})

export { router as equipementsRouter }
