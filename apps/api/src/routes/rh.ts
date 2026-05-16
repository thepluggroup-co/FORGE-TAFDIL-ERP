import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import PDFDocument from 'pdfkit'
import { supabase, supabaseAdmin } from '@forge/db'
import { requireRole } from '../middleware/rbac'
import type { HonoVariables } from '../types'

const router = new Hono<{ Variables: HonoVariables }>()

// ── Constantes paie Cameroun ────────────────────────────────────────────────────

const CNPS_PLAFOND      = 750_000   // XAF/mois — plafond cotisation vieillesse
const CNPS_SALARIE      = 0.042
const CNPS_EMPLOYEUR    = 0.112

// Barème IRPP Cameroun annuel (CGI approximatif)
const IRPP_TRANCHES = [
  { plafond: 2_000_000,  taux: 0 },
  { plafond: 3_000_000,  taux: 0.11 },
  { plafond: 5_000_000,  taux: 0.165 },
  { plafond: 10_000_000, taux: 0.275 },
  { plafond: Infinity,   taux: 0.385 },
]

// ── Calcul paie ─────────────────────────────────────────────────────────────────

function calculerCNPS(brut: number) {
  const base = Math.min(brut, CNPS_PLAFOND)
  return { salarie: Math.round(base * CNPS_SALARIE), employeur: Math.round(base * CNPS_EMPLOYEUR) }
}

function calculerIRPPMensuel(revenuImposableMensuel: number): number {
  const annuel = revenuImposableMensuel * 12
  let impot = 0, dejaImpose = 0

  for (const { plafond, taux } of IRPP_TRANCHES) {
    const cap = Math.min(annuel, plafond)
    impot += Math.max(0, cap - dejaImpose) * taux
    dejaImpose = cap
    if (dejaImpose >= annuel) break
  }

  return Math.round(impot / 12)
}

interface BulletinCalc {
  employe_id:         string
  employe_nom:        string
  poste:              string
  departement:        string
  type_contrat:       string
  cnps:               string
  mois:               string
  salaire_base_xaf:   number
  heures_sup_xaf:     number
  primes_xaf:         number
  deductions_xaf:     number
  cotisation_cnps_xaf: number
  cnps_employeur_xaf: number
  irpp_xaf:           number
  net_xaf:            number
  cout_employeur_xaf: number
}

function calculerBulletin(
  employe: { id: string; nom: string; poste: string; departement: string; type_contrat: string; cnps: string | null; salaire_base_xaf: number },
  mois: string,
  heures_sup_xaf = 0,
  primes_xaf = 0,
  deductions_xaf = 0,
): BulletinCalc {
  const brut   = employe.salaire_base_xaf + heures_sup_xaf + primes_xaf
  const cnps   = calculerCNPS(brut)
  const revImp = brut - cnps.salarie
  const irpp   = calculerIRPPMensuel(revImp)
  const net    = Math.max(0, brut - cnps.salarie - irpp - deductions_xaf)

  return {
    employe_id:          employe.id,
    employe_nom:         employe.nom,
    poste:               employe.poste,
    departement:         employe.departement,
    type_contrat:        employe.type_contrat,
    cnps:                employe.cnps ?? '',
    mois,
    salaire_base_xaf:    employe.salaire_base_xaf,
    heures_sup_xaf:      Math.round(heures_sup_xaf),
    primes_xaf:          Math.round(primes_xaf),
    deductions_xaf:      Math.round(deductions_xaf),
    cotisation_cnps_xaf: cnps.salarie,
    cnps_employeur_xaf:  cnps.employeur,
    irpp_xaf:            irpp,
    net_xaf:             Math.round(net),
    cout_employeur_xaf:  Math.round(brut + cnps.employeur),
  }
}

// ── Génération PDF bulletin de paie ────────────────────────────────────────────

async function genererBulletinPdf(b: BulletinCalc): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 0 })
    const chunks: Buffer[] = []
    doc.on('data', (c: Buffer) => chunks.push(c))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)

    const ML = 50, W = 495

    // En-tête
    doc.rect(0, 0, 595, 90).fill('#1e40af')
    doc.font('Helvetica-Bold').fontSize(16).fillColor('white').text('TAFDIL SARL', ML, 22)
    doc.font('Helvetica').fontSize(8).fillColor('#bfdbfe')
      .text('Microusine Métallurgique — Bassa Industrie, Douala', ML, 44)
      .text('NIU : M0820000123456A  |  CNPS Patron : 000000000', ML, 56)
    doc.font('Helvetica-Bold').fontSize(14).fillColor('white')
      .text('BULLETIN DE PAIE', 0, 28, { align: 'right', width: 545 })
    doc.font('Helvetica').fontSize(9).fillColor('#bfdbfe')
      .text(`Période : ${b.mois}`, 0, 50, { align: 'right', width: 545 })

    // Info employé
    doc.rect(ML, 105, W, 65).fill('#f3f4f6')
    doc.font('Helvetica-Bold').fontSize(7).fillColor('#6b7280').text('EMPLOYÉ', ML + 10, 113)
    doc.font('Helvetica-Bold').fontSize(12).fillColor('#111827').text(b.employe_nom, ML + 10, 124)
    doc.font('Helvetica').fontSize(9).fillColor('#374151')
      .text(`Poste : ${b.poste}  |  Département : ${b.departement}`, ML + 10, 140)
      .text(`Contrat : ${b.type_contrat}  |  N° CNPS : ${b.cnps || 'N/A'}`, ML + 10, 153)

    // Tableau éléments de paie
    let y = 185
    const col = [ML, ML + 300, ML + 420]

    doc.rect(ML, y, W, 18).fill('#1e40af')
    doc.font('Helvetica-Bold').fontSize(8).fillColor('white')
    doc.text('DÉSIGNATION', col[0] + 8, y + 5)
    doc.text('BASE (XAF)', col[1], y + 5)
    doc.text('MONTANT (XAF)', col[2], y + 5)
    y += 18

    type Ligne = [string, string, number]
    const gains: Ligne[] = [
      ['Salaire de base', `${b.salaire_base_xaf.toLocaleString('fr-FR')} XAF`, b.salaire_base_xaf],
      ['Heures supplémentaires', '', b.heures_sup_xaf],
      ['Primes et indemnités', '', b.primes_xaf],
    ]
    const retenues: Ligne[] = [
      ['Cotisation CNPS (salarié 4,2%)', `Base: ${Math.min(b.salaire_base_xaf + b.heures_sup_xaf + b.primes_xaf, 750000).toLocaleString('fr-FR')}`, b.cotisation_cnps_xaf],
      ['IRPP (barème progressif)', '', b.irpp_xaf],
      ['Autres déductions', '', b.deductions_xaf],
    ]

    const drawRow = (label: string, base: string, montant: number, i: number, color: string) => {
      doc.rect(ML, y, W, 18).fill(i % 2 === 0 ? '#f9fafb' : '#ffffff')
      doc.font('Helvetica').fontSize(8).fillColor('#111827')
      doc.text(label, col[0] + 8, y + 5, { width: 285 })
      doc.text(base, col[1], y + 5)
      doc.text(montant.toLocaleString('fr-FR'), col[2], y + 5)
      y += 18
    }

    // Section gains
    doc.rect(ML, y, W, 14).fill('#dcfce7')
    doc.font('Helvetica-Bold').fontSize(7).fillColor('#166534').text('ÉLÉMENTS DE RÉMUNÉRATION', col[0] + 8, y + 4)
    y += 14
    gains.forEach(([l, b_, m], i) => drawRow(l, b_, m, i, '#dcfce7'))

    const totalBrut = b.salaire_base_xaf + b.heures_sup_xaf + b.primes_xaf
    doc.rect(ML, y, W, 18).fill('#d1fae5')
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#065f46')
    doc.text('SALAIRE BRUT', col[0] + 8, y + 5)
    doc.text(totalBrut.toLocaleString('fr-FR') + ' XAF', col[2], y + 5)
    y += 24

    // Section retenues
    doc.rect(ML, y, W, 14).fill('#fee2e2')
    doc.font('Helvetica-Bold').fontSize(7).fillColor('#991b1b').text('RETENUES ET COTISATIONS', col[0] + 8, y + 4)
    y += 14
    retenues.forEach(([l, b_, m], i) => drawRow(l, b_, m, i, '#fee2e2'))

    const totalRet = b.cotisation_cnps_xaf + b.irpp_xaf + b.deductions_xaf
    doc.rect(ML, y, W, 18).fill('#fecaca')
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#7f1d1d')
    doc.text('TOTAL RETENUES', col[0] + 8, y + 5)
    doc.text(totalRet.toLocaleString('fr-FR') + ' XAF', col[2], y + 5)
    y += 24

    // Net à payer
    doc.rect(ML, y, W, 26).fill('#1e40af')
    doc.font('Helvetica-Bold').fontSize(12).fillColor('white')
    doc.text('NET À PAYER', col[0] + 8, y + 7)
    doc.text(b.net_xaf.toLocaleString('fr-FR') + ' XAF', col[0] + 8, y + 7, { width: W - 16, align: 'right' })
    y += 35

    // Info employeur
    doc.font('Helvetica').fontSize(8).fillColor('#6b7280')
    doc.text(`Charge patronale CNPS (11,2%) : ${b.cnps_employeur_xaf.toLocaleString('fr-FR')} XAF  |  Coût total employeur : ${b.cout_employeur_xaf.toLocaleString('fr-FR')} XAF`, ML, y)
    y += 30

    // Signatures
    doc.font('Helvetica').fontSize(8).fillColor('#374151')
    doc.text("L'employeur", ML + 20, y + 15)
    doc.text("L'employé(e)", ML + 350, y + 15)
    doc.moveTo(ML + 10, y + 55).lineTo(ML + 180, y + 55).strokeColor('#9ca3af').lineWidth(0.5).stroke()
    doc.moveTo(ML + 340, y + 55).lineTo(ML + W - 10, y + 55).stroke()

    // Footer
    doc.font('Helvetica').fontSize(7).fillColor('#9ca3af')
    doc.text('Document confidentiel — TAFDIL SARL — Conservation obligatoire 5 ans', ML, 780, { align: 'center', width: W })

    doc.end()
  })
}

// ── Schémas Zod ────────────────────────────────────────────────────────────────

const employeSchema = z.object({
  nom:             z.string().min(1),
  poste:           z.string().min(1),
  departement:     z.string().min(1),
  type_contrat:    z.enum(['CDI', 'CDD', 'stage', 'freelance']),
  date_entree:     z.string(),
  date_sortie:     z.string().optional(),
  salaire_base_xaf: z.number().min(0),
  telephone:       z.string().optional(),
  email:           z.string().email().optional(),
  cin:             z.string().optional(),
  cnps:            z.string().optional(),
  statut:          z.enum(['actif', 'inactif', 'conge', 'essai']).default('actif'),
})

const presenceSchema = z.object({
  employe_id: z.string(),
  date:       z.string(),
  arrivee:    z.string().optional(),
  depart:     z.string().optional(),
  heures:     z.number().min(0).default(0),
  statut:     z.enum(['present', 'absent', 'conge', 'retard', 'maladie']),
  notes:      z.string().optional(),
})

const apprenantSchema = z.object({
  nom:        z.string().min(1),
  specialite: z.string().min(1),
  niveau:     z.number().int().min(1).max(5).default(1),
  duree_mois: z.number().int().min(0).default(0),
  statut:     z.enum(['actif', 'suspendu', 'diplome', 'recrute']).default('actif'),
  notes:      z.string().optional(),
})

const progressionSchema = z.object({
  commentaire: z.string().optional(),
})

const recruterSchema = z.object({
  poste:            z.string().min(1),
  departement:      z.string().min(1),
  type_contrat:     z.enum(['CDI', 'CDD', 'stage', 'freelance']),
  date_entree:      z.string(),
  salaire_base_xaf: z.number().min(0),
  commentaire:      z.string().optional(),
})

// ══════════════════════════════════════════════════════════════════════════════
// EMPLOYÉS
// ══════════════════════════════════════════════════════════════════════════════

router.get('/rh/employes', async (c) => {
  const { statut, departement, search } = c.req.query()
  const page    = Math.max(1, parseInt(c.req.query('page') ?? '1'))
  const perPage = Math.min(100, parseInt(c.req.query('per_page') ?? '20'))
  const from    = (page - 1) * perPage

  let q = supabase.from('employes').select('*', { count: 'exact' })
  if (statut)      q = q.eq('statut', statut)
  if (departement) q = q.eq('departement', departement)
  if (search)      q = q.ilike('nom', `%${search}%`)

  const { data, count, error } = await q.order('nom').range(from, from + perPage - 1)
  if (error) return c.json({ error: error.message }, 500)

  return c.json({ data, total: count ?? 0, page, per_page: perPage, total_pages: Math.ceil((count ?? 0) / perPage) })
})

router.get('/rh/employes/:id', async (c) => {
  const { id } = c.req.param()
  const { data, error } = await supabase.from('employes').select('*').eq('id', id).single()
  if (error || !data) return c.json({ error: 'Employé introuvable', code: 'NOT_FOUND' }, 404)
  return c.json(data)
})

router.post('/rh/employes', requireRole(['directeur', 'admin']), zValidator('json', employeSchema), async (c) => {
  const user = c.get('user')
  const body = c.req.valid('json')
  const { data, error } = await supabase
    .from('employes')
    .insert({ ...body, created_by: user.id, sync_status: 'synced' })
    .select().single()
  if (error) return c.json({ error: error.message, code: error.code }, 400)
  return c.json(data, 201)
})

router.put('/rh/employes/:id', requireRole(['directeur', 'admin']), zValidator('json', employeSchema.partial()), async (c) => {
  const { id } = c.req.param()
  const body   = c.req.valid('json')
  const { data, error } = await supabase.from('employes')
    .update({ ...body, updated_at: new Date().toISOString() }).eq('id', id).select().single()
  if (error) return c.json({ error: error.message }, 400)
  if (!data)  return c.json({ error: 'Employé introuvable', code: 'NOT_FOUND' }, 404)
  return c.json(data)
})

router.delete('/rh/employes/:id', requireRole(['directeur']), async (c) => {
  const { id } = c.req.param()
  const { error } = await supabase.from('employes').update({ statut: 'inactif', updated_at: new Date().toISOString() }).eq('id', id)
  if (error) return c.json({ error: error.message }, 400)
  return c.body(null, 204)
})

// ══════════════════════════════════════════════════════════════════════════════
// PRÉSENCES
// ══════════════════════════════════════════════════════════════════════════════

router.get('/rh/presences', async (c) => {
  const { employe_id, date, statut } = c.req.query()
  const page    = Math.max(1, parseInt(c.req.query('page') ?? '1'))
  const perPage = Math.min(100, parseInt(c.req.query('per_page') ?? '30'))
  const from    = (page - 1) * perPage

  let q = supabase.from('presences').select('*, employes(nom, poste)', { count: 'exact' })
  if (employe_id) q = q.eq('employe_id', employe_id)
  if (date)       q = q.eq('date', date)
  if (statut)     q = q.eq('statut', statut)

  const { data, count, error } = await q.order('date', { ascending: false }).range(from, from + perPage - 1)
  if (error) return c.json({ error: error.message }, 500)

  return c.json({ data, total: count ?? 0, page, per_page: perPage, total_pages: Math.ceil((count ?? 0) / perPage) })
})

router.post('/rh/presences', requireRole(['directeur', 'admin', 'operateur']), zValidator('json', presenceSchema), async (c) => {
  const user = c.get('user')
  const body = c.req.valid('json')

  // Calculer les heures si arrivée et départ fournis
  let heures = body.heures
  if (body.arrivee && body.depart) {
    const [ah, am] = body.arrivee.split(':').map(Number)
    const [dh, dm] = body.depart.split(':').map(Number)
    heures = Math.max(0, (dh * 60 + dm - ah * 60 - am) / 60)
  }

  const { data, error } = await supabase
    .from('presences')
    .insert({ ...body, heures: Math.round(heures * 100) / 100, created_by: user.id, sync_status: 'synced' })
    .select().single()

  if (error) return c.json({ error: error.message, code: error.code }, 400)
  return c.json(data, 201)
})

router.put('/rh/presences/:id', requireRole(['directeur', 'admin']), zValidator('json', presenceSchema.partial()), async (c) => {
  const { id } = c.req.param()
  const body   = c.req.valid('json')
  const { data, error } = await supabase.from('presences').update(body).eq('id', id).select().single()
  if (error) return c.json({ error: error.message }, 400)
  if (!data)  return c.json({ error: 'Présence introuvable', code: 'NOT_FOUND' }, 404)
  return c.json(data)
})

// ══════════════════════════════════════════════════════════════════════════════
// APPRENANTS
// ══════════════════════════════════════════════════════════════════════════════

router.get('/rh/apprenants', async (c) => {
  const { statut, specialite } = c.req.query()
  const page    = Math.max(1, parseInt(c.req.query('page') ?? '1'))
  const perPage = Math.min(100, parseInt(c.req.query('per_page') ?? '20'))
  const from    = (page - 1) * perPage

  let q = supabase.from('apprenants').select('*', { count: 'exact' })
  if (statut)     q = q.eq('statut', statut)
  if (specialite) q = q.eq('specialite', specialite)

  const { data, count, error } = await q.order('nom').range(from, from + perPage - 1)
  if (error) return c.json({ error: error.message }, 500)

  return c.json({ data, total: count ?? 0, page, per_page: perPage, total_pages: Math.ceil((count ?? 0) / perPage) })
})

router.post('/rh/apprenants', requireRole(['directeur', 'admin']), zValidator('json', apprenantSchema), async (c) => {
  const user = c.get('user')
  const body = c.req.valid('json')
  const { data, error } = await supabase
    .from('apprenants')
    .insert({ ...body, created_by: user.id, sync_status: 'synced' })
    .select().single()
  if (error) return c.json({ error: error.message, code: error.code }, 400)
  return c.json(data, 201)
})

router.post('/rh/apprenants/:id/progression', requireRole(['directeur']), zValidator('json', progressionSchema), async (c) => {
  const { id }  = c.req.param()
  const user    = c.get('user')
  const body    = c.req.valid('json')

  const { data: apprenant } = await supabase.from('apprenants').select('niveau, duree_mois, statut').eq('id', id).single()
  if (!apprenant) return c.json({ error: 'Apprenant introuvable', code: 'NOT_FOUND' }, 404)

  const a = apprenant as { niveau: number; duree_mois: number; statut: string }
  if (a.statut !== 'actif') return c.json({ error: `Apprenant en statut "${a.statut}" — progression impossible`, code: 'INVALID_STATUS' }, 422)
  if (a.niveau >= 5)        return c.json({ error: 'Niveau maximum atteint (5/5)', code: 'MAX_LEVEL' }, 422)

  const nouveauNiveau = a.niveau + 1

  // Enregistrer la validation dans la table dédiée
  await supabase.from('validations_niveau').insert({
    apprenant_id:    id,
    niveau:          nouveauNiveau,
    valide_by:       user.id,
    date_validation: new Date().toISOString().slice(0, 10),
    commentaire:     body.commentaire ?? null,
  })

  const { data, error } = await supabase
    .from('apprenants')
    .update({ niveau: nouveauNiveau, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select().single()

  if (error) return c.json({ error: error.message }, 400)
  return c.json({ ...data, niveau_precedent: a.niveau, nouveau_niveau: nouveauNiveau })
})

router.post('/rh/apprenants/:id/recruter', requireRole(['directeur']), zValidator('json', recruterSchema), async (c) => {
  const { id }  = c.req.param()
  const user    = c.get('user')
  const body    = c.req.valid('json')

  const { data: apprenant } = await supabase.from('apprenants').select('*').eq('id', id).single()
  if (!apprenant) return c.json({ error: 'Apprenant introuvable', code: 'NOT_FOUND' }, 404)

  const a = apprenant as { id: string; nom: string; niveau: number; duree_mois: number; statut: string; specialite: string }

  if (a.statut === 'recrute') return c.json({ error: 'Apprenant déjà recruté', code: 'ALREADY_RECRUITED' }, 422)
  if (a.niveau < 5)           return c.json({ error: `Niveau insuffisant : ${a.niveau}/5 (niveau 5 requis)`, code: 'LEVEL_TOO_LOW' }, 422)
  if (a.duree_mois < 6)       return c.json({ error: `Durée insuffisante : ${a.duree_mois} mois (6 mois minimum)`, code: 'DURATION_TOO_SHORT' }, 422)

  // Créer l'employé
  const { data: employe, error: empErr } = await supabase
    .from('employes')
    .insert({
      nom:             a.nom,
      poste:           body.poste,
      departement:     body.departement,
      type_contrat:    body.type_contrat,
      date_entree:     body.date_entree,
      salaire_base_xaf: body.salaire_base_xaf,
      statut:          'actif',
      created_by:      user.id,
      sync_status:     'synced',
    })
    .select().single()

  if (empErr || !employe) return c.json({ error: empErr?.message, code: 'CREATE_FAILED' }, 400)

  const empId = (employe as { id: string }).id

  // Mettre à jour l'apprenant
  await supabase.from('apprenants').update({
    statut:     'recrute',
    employe_id: empId,
    updated_at: new Date().toISOString(),
  }).eq('id', id)

  return c.json({ employe, apprenant_id: id, message: `${a.nom} recruté avec succès en tant que ${body.poste}` }, 201)
})

// ══════════════════════════════════════════════════════════════════════════════
// PAIE MENSUELLE
// ══════════════════════════════════════════════════════════════════════════════

router.get('/rh/paie/:annee/:mois', requireRole(['directeur', 'admin']), async (c) => {
  const { annee, mois } = c.req.param()
  const genererPdf      = c.req.query('generer_pdf') === 'true'
  const moisStr         = `${annee}-${mois.padStart(2, '0')}`

  // Vérifier si les bulletins existent déjà
  const { data: existants } = await supabase
    .from('bulletins_paie')
    .select('*, employes(nom, poste, departement, type_contrat, cnps)')
    .eq('mois', moisStr)

  if (existants && existants.length > 0 && !c.req.query('recalculer')) {
    return c.json({
      mois:              moisStr,
      bulletins:         existants,
      total_masse_salariale_xaf: existants.reduce((s, b) => s + (b as { net_xaf: number }).net_xaf, 0),
      deja_genere:       true,
    })
  }

  // Récupérer tous les employés actifs
  const { data: employes, error } = await supabase
    .from('employes')
    .select('id, nom, poste, departement, type_contrat, cnps, salaire_base_xaf')
    .eq('statut', 'actif')
    .lte('date_entree', `${moisStr}-31`)

  if (error) return c.json({ error: error.message }, 500)

  const bulletins: BulletinCalc[] = []
  const pdfs: Array<{ employe_nom: string; pdf_url: string | null }> = []

  for (const emp of (employes ?? []) as Array<{ id: string; nom: string; poste: string; departement: string; type_contrat: string; cnps: string | null; salaire_base_xaf: number }>) {
    // Récupérer les heures sup du mois depuis les présences
    const { data: presences } = await supabase
      .from('presences')
      .select('heures')
      .eq('employe_id', emp.id)
      .gte('date', `${moisStr}-01`)
      .lte('date', `${moisStr}-31`)
      .eq('statut', 'present')

    const totalHeures    = (presences ?? []).reduce((s: number, p: { heures: number }) => s + p.heures, 0)
    const heuresBase     = 173.33  // 40h/semaine * 52 / 12
    const heuresSup      = Math.max(0, totalHeures - heuresBase)
    const txHeureSup     = (emp.salaire_base_xaf / heuresBase) * 1.5
    const heures_sup_xaf = Math.round(heuresSup * txHeureSup)

    const bulletin = calculerBulletin(emp, moisStr, heures_sup_xaf)
    bulletins.push(bulletin)

    // Upsert le bulletin en DB
    await supabase.from('bulletins_paie').upsert({
      employe_id:          emp.id,
      mois:                moisStr,
      salaire_base_xaf:    emp.salaire_base_xaf,
      heures_sup_xaf:      bulletin.heures_sup_xaf,
      primes_xaf:          bulletin.primes_xaf,
      deductions_xaf:      bulletin.deductions_xaf,
      cotisation_cnps_xaf: bulletin.cotisation_cnps_xaf,
      net_xaf:             bulletin.net_xaf,
      statut:              'en_attente',
      sync_status:         'synced',
    }, { onConflict: 'employe_id,mois' })

    // Générer PDF si demandé
    if (genererPdf) {
      try {
        const buf = await genererBulletinPdf(bulletin)
        const path = `bulletins/${moisStr}/${emp.id}.pdf`
        await (supabaseAdmin ?? supabase).storage.from('paie').upload(path, buf, { contentType: 'application/pdf', upsert: true })
        const { data: { publicUrl } } = supabase.storage.from('paie').getPublicUrl(path)
        pdfs.push({ employe_nom: emp.nom, pdf_url: publicUrl })
      } catch {
        pdfs.push({ employe_nom: emp.nom, pdf_url: null })
      }
    }
  }

  const totalNet       = bulletins.reduce((s, b) => s + b.net_xaf, 0)
  const totalEmployeur = bulletins.reduce((s, b) => s + b.cout_employeur_xaf, 0)
  const totalIRPP      = bulletins.reduce((s, b) => s + b.irpp_xaf, 0)
  const totalCNPS      = bulletins.reduce((s, b) => s + b.cotisation_cnps_xaf + b.cnps_employeur_xaf, 0)

  return c.json({
    mois:                      moisStr,
    nb_employes:               bulletins.length,
    bulletins,
    pdfs:                      genererPdf ? pdfs : undefined,
    recapitulatif: {
      masse_salariale_nette_xaf: Math.round(totalNet),
      cout_total_employeur_xaf:  Math.round(totalEmployeur),
      total_irpp_xaf:            Math.round(totalIRPP),
      total_cnps_xaf:            Math.round(totalCNPS),
    },
  })
})

export { router as rhRouter }
