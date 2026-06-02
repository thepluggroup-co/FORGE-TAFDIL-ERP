import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import PDFDocument from 'pdfkit'
import { supabaseAdmin } from '@forge/db'

const db = supabaseAdmin!
import { requireRole } from '../middleware/rbac'
import { generateAttestationPDF } from '../services/pdf.service'
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

// ── Mappers réponse → format frontend ──────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapPresence(row: any) {
  const emp = row.employes as { nom?: string; poste?: string } | null
  return {
    id:                 row.id,
    employe_id:         row.employe_id,
    employe_nom:        emp?.nom ?? '',
    poste:              emp?.poste ?? '',
    date:               row.date,
    heure_arrivee:      row.arrivee  ?? null,
    heure_depart:       row.depart   ?? null,
    heures_travaillees: row.heures   ?? 0,
    statut:             row.statut,
    notes:              row.notes    ?? null,
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapBulletinDb(row: any) {
  const emp  = row.employes as { nom?: string; poste?: string; departement?: string } | null
  const brut = (row.salaire_base_xaf ?? 0) + (row.heures_sup_xaf ?? 0) + (row.primes_xaf ?? 0)
  return {
    id:                  row.id,
    employe_id:          row.employe_id,
    employe_nom:         emp?.nom        ?? '',
    poste:               emp?.poste      ?? '',
    departement:         emp?.departement ?? '',
    mois:                row.mois,
    salaire_brut_xaf:    brut,
    cnps_salarie_xaf:    row.cotisation_cnps_xaf ?? 0,
    irpp_xaf:            row.irpp_xaf            ?? 0,
    salaire_net_xaf:     row.net_xaf             ?? 0,
    cout_employeur_xaf:  row.cout_employeur_xaf  ?? Math.round(brut + Math.round(Math.min(brut, CNPS_PLAFOND) * CNPS_EMPLOYEUR)),
    statut:              row.statut ?? 'en_attente',
  }
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

const formationSessionSchema = z.object({
  module:       z.string().min(1),
  niveau:       z.number().int().min(1).max(5),
  statut:       z.enum(['planifiee', 'en_cours', 'terminee', 'annulee']).default('planifiee'),
  date_debut:   z.string().optional(),
  date_fin:     z.string().optional(),
  formateur:    z.string().optional(),
  lieu:         z.string().optional(),
  capacite_max: z.number().int().min(1).default(10),
  horaires:     z.array(z.string()).default([]),
  description:  z.string().optional(),
})

const inscriptionSchema = z.object({
  session_id:     z.string().uuid(),
  disponibilites: z.array(z.string()).default([]),
  notes:          z.string().optional(),
})

const inscriptionUpdateSchema = z.object({
  statut:        z.enum(['inscrit', 'en_cours', 'termine', 'abandonne']).optional(),
  nb_seances:    z.number().int().min(0).optional(),
  evaluation:    z.number().min(0).max(20).optional(),
  notes:         z.string().optional(),
  disponibilites: z.array(z.string()).optional(),
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

  let q = db.from('employes').select('*', { count: 'exact' })
  if (statut)      q = q.eq('statut', statut)
  if (departement) q = q.eq('departement', departement)
  if (search)      q = q.ilike('nom', `%${search}%`)

  const { data, count, error } = await q.order('nom').range(from, from + perPage - 1)
  if (error) return c.json({ error: error.message }, 500)

  return c.json({ data, total: count ?? 0, page, per_page: perPage, total_pages: Math.ceil((count ?? 0) / perPage) })
})

router.get('/rh/employes/:id', async (c) => {
  const { id } = c.req.param()
  const { data, error } = await db.from('employes').select('*').eq('id', id).single()
  if (error || !data) return c.json({ error: 'Employé introuvable', code: 'NOT_FOUND' }, 404)
  return c.json(data)
})

router.post('/rh/employes', requireRole(['directeur', 'admin']), zValidator('json', employeSchema), async (c) => {
  const user = c.get('user')
  const body = c.req.valid('json')
  const { data, error } = await db
    .from('employes')
    .insert({ ...body, created_by: user.id, sync_status: 'synced' })
    .select().single()
  if (error) return c.json({ error: error.message, code: error.code }, 400)
  return c.json(data, 201)
})

router.put('/rh/employes/:id', requireRole(['directeur', 'admin']), zValidator('json', employeSchema.partial()), async (c) => {
  const { id } = c.req.param()
  const body   = c.req.valid('json')
  const { data, error } = await db.from('employes')
    .update({ ...body, updated_at: new Date().toISOString() }).eq('id', id).select().single()
  if (error) return c.json({ error: error.message }, 400)
  if (!data)  return c.json({ error: 'Employé introuvable', code: 'NOT_FOUND' }, 404)
  return c.json(data)
})

router.delete('/rh/employes/:id', requireRole(['directeur']), async (c) => {
  const { id } = c.req.param()
  const { error } = await db.from('employes').update({ statut: 'inactif', updated_at: new Date().toISOString() }).eq('id', id)
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

  let q = db.from('presences').select('*, employes(nom, poste)', { count: 'exact' })
  if (employe_id) q = q.eq('employe_id', employe_id)
  if (date)       q = q.eq('date', date)
  if (statut)     q = q.eq('statut', statut)

  const { data, count, error } = await q.order('date', { ascending: false }).range(from, from + perPage - 1)
  if (error) return c.json({ error: error.message }, 500)

  return c.json({
    data:        (data ?? []).map(mapPresence),
    total:       count ?? 0,
    page,
    per_page:    perPage,
    total_pages: Math.ceil((count ?? 0) / perPage),
  })
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

  const { data, error } = await db
    .from('presences')
    .insert({ ...body, heures: Math.round(heures * 100) / 100, created_by: user.id, sync_status: 'synced' })
    .select().single()

  if (error) return c.json({ error: error.message, code: error.code }, 400)
  return c.json(data, 201)
})

router.put('/rh/presences/:id', requireRole(['directeur', 'admin']), zValidator('json', presenceSchema.partial()), async (c) => {
  const { id } = c.req.param()
  const body   = c.req.valid('json')
  const { data, error } = await db.from('presences').update(body).eq('id', id).select().single()
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

  let q = db.from('apprenants').select('*', { count: 'exact' })
  if (statut)     q = q.eq('statut', statut)
  if (specialite) q = q.eq('specialite', specialite)

  const { data, count, error } = await q.order('nom').range(from, from + perPage - 1)
  if (error) return c.json({ error: error.message }, 500)

  return c.json({ data, total: count ?? 0, page, per_page: perPage, total_pages: Math.ceil((count ?? 0) / perPage) })
})

router.post('/rh/apprenants', requireRole(['directeur', 'admin']), zValidator('json', apprenantSchema), async (c) => {
  const user = c.get('user')
  const body = c.req.valid('json')
  const { data, error } = await db
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

  const { data: apprenant } = await db.from('apprenants').select('niveau, duree_mois, statut').eq('id', id).single()
  if (!apprenant) return c.json({ error: 'Apprenant introuvable', code: 'NOT_FOUND' }, 404)

  const a = apprenant as { niveau: number; duree_mois: number; statut: string }
  if (a.statut !== 'actif') return c.json({ error: `Apprenant en statut "${a.statut}" — progression impossible`, code: 'INVALID_STATUS' }, 422)
  if (a.niveau >= 5)        return c.json({ error: 'Niveau maximum atteint (5/5)', code: 'MAX_LEVEL' }, 422)

  const nouveauNiveau = a.niveau + 1

  // Enregistrer la validation dans la table dédiée
  await db.from('validations_niveau').insert({
    apprenant_id:    id,
    niveau:          nouveauNiveau,
    valide_by:       user.id,
    date_validation: new Date().toISOString().slice(0, 10),
    commentaire:     body.commentaire ?? null,
  })

  const { data, error } = await db
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

  const { data: apprenant } = await db.from('apprenants').select('*').eq('id', id).single()
  if (!apprenant) return c.json({ error: 'Apprenant introuvable', code: 'NOT_FOUND' }, 404)

  const a = apprenant as { id: string; nom: string; niveau: number; duree_mois: number; statut: string; specialite: string }

  if (a.statut === 'recrute') return c.json({ error: 'Apprenant déjà recruté', code: 'ALREADY_RECRUITED' }, 422)
  if (a.niveau < 5)           return c.json({ error: `Niveau insuffisant : ${a.niveau}/5 (niveau 5 requis)`, code: 'LEVEL_TOO_LOW' }, 422)
  if (a.duree_mois < 6)       return c.json({ error: `Durée insuffisante : ${a.duree_mois} mois (6 mois minimum)`, code: 'DURATION_TOO_SHORT' }, 422)

  // Créer l'employé
  const { data: employe, error: empErr } = await db
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
  await db.from('apprenants').update({
    statut:     'recrute',
    employe_id: empId,
    updated_at: new Date().toISOString(),
  }).eq('id', id)

  return c.json({ employe, apprenant_id: id, message: `${a.nom} recruté avec succès en tant que ${body.poste}` }, 201)
})

// ══════════════════════════════════════════════════════════════════════════════
// PAIE MENSUELLE
// ══════════════════════════════════════════════════════════════════════════════

// ── Schéma génération ──────────────────────────────────────────────────────────

const paieGenererSchema = z.object({
  mois:        z.string().regex(/^\d{4}-\d{2}$/, 'Format requis : YYYY-MM'),
  generer_pdf: z.boolean().optional().default(false),
  forcer:      z.boolean().optional().default(false),
})

// ── Logique partagée de génération ────────────────────────────────────────────

async function genererBulletinsMois(
  moisStr: string,
  userId: string,
  genererPdf = false,
): Promise<{
  bulletins:     ReturnType<typeof mapBulletinDb>[]
  pdfs?:         Array<{ employe_nom: string; pdf_url: string | null }>
  recapitulatif: { masse_salariale_nette_xaf: number; cout_total_employeur_xaf: number; total_irpp_xaf: number; total_cnps_xaf: number }
}> {
  // Employés actifs (ou en congé) entrés avant la fin du mois
  // Les employés 'inactif' sont exclus de la paie
  const { data: employes, error } = await db
    .from('employes')
    .select('id, nom, poste, departement, type_contrat, cnps, salaire_base_xaf, statut')
    .in('statut', ['actif', 'conge', 'essai'])
    .lte('date_entree', `${moisStr}-31`)

  if (error) throw new Error(error.message)

  const bulletinsCalc: BulletinCalc[] = []
  const pdfs: Array<{ employe_nom: string; pdf_url: string | null }> = []

  for (const emp of (employes ?? []) as Array<{ id: string; nom: string; poste: string; departement: string; type_contrat: string; cnps: string | null; salaire_base_xaf: number; statut: string }>) {
    // Charger toutes les présences du mois (tous statuts) pour le calcul d'impact
    const { data: presences } = await db
      .from('presences')
      .select('heures, statut')
      .eq('employe_id', emp.id)
      .gte('date', `${moisStr}-01`)
      .lte('date', `${moisStr}-31`)

    type PresenceRow = { heures: number; statut: string }
    const rows = (presences ?? []) as PresenceRow[]

    // Heures effectives = présents + retards seulement (pas absents/congé/maladie)
    const heuresEffectives = rows
      .filter(p => p.statut === 'present' || p.statut === 'retard')
      .reduce((s, p) => s + p.heures, 0)

    const heuresBase     = 173.33  // 40 h/semaine × 52 / 12
    const heuresSup      = Math.max(0, heuresEffectives - heuresBase)
    const txHeureSup     = (emp.salaire_base_xaf / heuresBase) * 1.5
    const heures_sup_xaf = Math.round(heuresSup * txHeureSup)

    // Déduction pour absences maladie non justifiées :
    // chaque jour maladie = 50% du salaire journalier déduit
    // (congé normal = maintien de salaire intégral → pas de déduction)
    const joursMaladie = rows.filter(p => p.statut === 'maladie').length
    const salaireJournalier = emp.salaire_base_xaf / 26  // ~26 jours ouvrables/mois
    const deduction_maladie = Math.round(joursMaladie * salaireJournalier * 0.5)

    const bulletin = calculerBulletin(emp, moisStr, heures_sup_xaf, 0, deduction_maladie)
    bulletinsCalc.push(bulletin)

    // Upsert en DB — seuls les bulletins en statut 'en_attente' peuvent être recalculés.
    // Les bulletins 'valide' ou 'vire' sont immuables.
    const { data: existant } = await db
      .from('bulletins_paie')
      .select('statut')
      .eq('employe_id', emp.id)
      .eq('mois', moisStr)
      .single()

    const existantStatut = (existant as { statut: string } | null)?.statut
    if (existantStatut && ['valide', 'vire'].includes(existantStatut)) {
      // Bulletin validé → immuable : on le lit sans écraser
      continue
    }

    await db.from('bulletins_paie').upsert({
      employe_id:          emp.id,
      mois:                moisStr,
      salaire_base_xaf:    emp.salaire_base_xaf,
      heures_sup_xaf:      bulletin.heures_sup_xaf,
      primes_xaf:          bulletin.primes_xaf,
      deductions_xaf:      bulletin.deductions_xaf,
      cotisation_cnps_xaf: bulletin.cotisation_cnps_xaf,
      cnps_employeur_xaf:  bulletin.cnps_employeur_xaf,
      irpp_xaf:            bulletin.irpp_xaf,
      net_xaf:             bulletin.net_xaf,
      cout_employeur_xaf:  bulletin.cout_employeur_xaf,
      statut:              'en_attente',
      sync_status:         'synced',
      generated_by:        userId,
    }, { onConflict: 'employe_id,mois' })

    // PDF optionnel
    if (genererPdf) {
      try {
        const buf  = await genererBulletinPdf(bulletin)
        const path = `bulletins/${moisStr}/${emp.id}.pdf`
        await db.storage.from('paie').upload(path, buf, { contentType: 'application/pdf', upsert: true })
        const { data: { publicUrl } } = db.storage.from('paie').getPublicUrl(path)
        pdfs.push({ employe_nom: emp.nom, pdf_url: publicUrl })
      } catch {
        pdfs.push({ employe_nom: emp.nom, pdf_url: null })
      }
    }
  }

  // Relire depuis la DB pour retourner le format mappé avec les IDs
  const { data: stored } = await db
    .from('bulletins_paie')
    .select('*, employes(nom, poste, departement)')
    .eq('mois', moisStr)

  const bulletins = (stored ?? []).map(mapBulletinDb)

  const totalNet       = bulletinsCalc.reduce((s, b) => s + b.net_xaf, 0)
  const totalEmployeur = bulletinsCalc.reduce((s, b) => s + b.cout_employeur_xaf, 0)
  const totalIRPP      = bulletinsCalc.reduce((s, b) => s + b.irpp_xaf, 0)
  const totalCNPS      = bulletinsCalc.reduce((s, b) => s + b.cotisation_cnps_xaf + b.cnps_employeur_xaf, 0)

  return {
    bulletins,
    pdfs: genererPdf ? pdfs : undefined,
    recapitulatif: {
      masse_salariale_nette_xaf: Math.round(totalNet),
      cout_total_employeur_xaf:  Math.round(totalEmployeur),
      total_irpp_xaf:            Math.round(totalIRPP),
      total_cnps_xaf:            Math.round(totalCNPS),
    },
  }
}

// ── GET /rh/paie?mois=YYYY-MM  — lecture des bulletins existants ───────────────

router.get('/rh/paie', requireRole(['directeur', 'admin']), async (c) => {
  const mois = c.req.query('mois')
  if (!mois || !/^\d{4}-\d{2}$/.test(mois)) {
    return c.json({ error: 'Paramètre mois requis (ex : 2024-05)', code: 'MISSING_MOIS' }, 400)
  }

  const { data, count, error } = await db
    .from('bulletins_paie')
    .select('*, employes(nom, poste, departement)', { count: 'exact' })
    .eq('mois', mois)
    .order('employe_id')

  if (error) return c.json({ error: error.message }, 500)

  const bulletins = (data ?? []).map(mapBulletinDb)

  return c.json({
    data:                      bulletins,
    total:                     count ?? 0,
    mois,
    masse_salariale_nette_xaf: bulletins.reduce((s, b) => s + b.salaire_net_xaf, 0),
    deja_genere:               (count ?? 0) > 0,
  })
})

// ── POST /rh/paie  — générer / recalculer les bulletins d'un mois ─────────────

router.post('/rh/paie', requireRole(['directeur', 'admin']), zValidator('json', paieGenererSchema), async (c) => {
  const user = c.get('user')
  const { mois, generer_pdf, forcer } = c.req.valid('json')

  // Si déjà générés et pas de forçage : renvoyer les existants
  if (!forcer) {
    const { count } = await db
      .from('bulletins_paie')
      .select('*', { count: 'exact', head: true })
      .eq('mois', mois)

    if ((count ?? 0) > 0) {
      const { data } = await db
        .from('bulletins_paie')
        .select('*, employes(nom, poste, departement)')
        .eq('mois', mois)

      const bulletins = (data ?? []).map(mapBulletinDb)
      return c.json({
        data:        bulletins,
        total:       count ?? 0,
        mois,
        deja_genere: true,
        message:     `Bulletins de ${mois} déjà générés. Passer forcer:true pour recalculer.`,
      })
    }
  }

  try {
    const result = await genererBulletinsMois(mois, user.id, generer_pdf)
    return c.json({
      data:        result.bulletins,
      total:       result.bulletins.length,
      mois,
      pdfs:        result.pdfs,
      recapitulatif: result.recapitulatif,
      deja_genere: false,
    }, 201)
  } catch (err) {
    return c.json({ error: (err as Error).message }, 500)
  }
})

// ── PATCH /rh/paie/:id/statut  — valider ou marquer comme viré ────────────────
// Un bulletin validé est IMMUABLE — il ne peut pas être recalculé.
// Transitions : en_attente → valide → vire

router.patch('/rh/paie/:id/statut', requireRole(['directeur', 'admin']), zValidator('json', z.object({
  statut: z.enum(['valide', 'vire']),
})), async (c) => {
  const { id }  = c.req.param()
  const { statut } = c.req.valid('json')

  const { data: existing } = await db
    .from('bulletins_paie')
    .select('statut')
    .eq('id', id)
    .single()

  if (!existing) return c.json({ error: 'Bulletin introuvable', code: 'NOT_FOUND' }, 404)

  const ex = existing as { statut: string }

  const TRANSITIONS_BULLETIN: Record<string, string[]> = {
    en_attente: ['valide'],
    valide:     ['vire'],
    vire:       [],
  }

  const allowed = TRANSITIONS_BULLETIN[ex.statut] ?? []
  if (!allowed.includes(statut)) {
    return c.json({
      error: `Transition "${ex.statut}" → "${statut}" non autorisée`,
      code:  'INVALID_TRANSITION',
      transitions_autorisees: allowed,
    }, 422)
  }

  const { data, error } = await db
    .from('bulletins_paie')
    .update({ statut, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select().single()

  if (error) return c.json({ error: error.message }, 400)
  return c.json(data)
})

// ── GET /rh/paie/:annee/:mois  — rétrocompatibilité (génère si besoin) ─────────

router.get('/rh/paie/:annee/:mois', requireRole(['directeur', 'admin']), async (c) => {
  const { annee, mois } = c.req.param()
  const genererPdf      = c.req.query('generer_pdf') === 'true'
  const recalculer      = c.req.query('recalculer') === 'true'
  const moisStr         = `${annee}-${mois.padStart(2, '0')}`
  const user            = c.get('user')

  // Bulletins déjà en DB ?
  const { data: existants, count } = await db
    .from('bulletins_paie')
    .select('*, employes(nom, poste, departement)', { count: 'exact' })
    .eq('mois', moisStr)

  if ((count ?? 0) > 0 && !recalculer) {
    const bulletins = (existants ?? []).map(mapBulletinDb)
    return c.json({
      mois:        moisStr,
      data:        bulletins,
      total:       count ?? 0,
      deja_genere: true,
    })
  }

  try {
    const result = await genererBulletinsMois(moisStr, user.id, genererPdf)
    return c.json({
      mois:        moisStr,
      data:        result.bulletins,
      total:       result.bulletins.length,
      pdfs:        result.pdfs,
      recapitulatif: result.recapitulatif,
      deja_genere: false,
    })
  } catch (err) {
    return c.json({ error: (err as Error).message }, 500)
  }
})

// ══════════════════════════════════════════════════════════════════════════════
// SESSIONS DE FORMATION
// ══════════════════════════════════════════════════════════════════════════════

// GET /rh/formation/sessions
router.get('/rh/formation/sessions', async (c) => {
  const { statut, niveau } = c.req.query()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let q: any = db
    .from('formation_sessions')
    .select('*, formation_inscriptions(id)', { count: 'exact' })

  if (statut) q = q.in('statut', statut.split(','))
  if (niveau) q = q.eq('niveau', parseInt(niveau))

  const { data, count, error } = await q
    .order('date_debut', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: true })

  if (error) return c.json({ error: error.message }, 500)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapped = (data ?? []).map((s: any) => ({
    ...s,
    nb_inscrits: Array.isArray(s.formation_inscriptions) ? s.formation_inscriptions.length : 0,
    formation_inscriptions: undefined,
  }))

  return c.json({ data: mapped, total: count ?? 0 })
})

// POST /rh/formation/sessions
router.post(
  '/rh/formation/sessions',
  requireRole(['directeur', 'admin']),
  zValidator('json', formationSessionSchema),
  async (c) => {
    const user = c.get('user')
    const body = c.req.valid('json')
    const { data, error } = await db
      .from('formation_sessions')
      .insert({ ...body, created_by: user.id })
      .select()
      .single()
    if (error) return c.json({ error: error.message, code: error.code }, 400)
    return c.json({ ...data, nb_inscrits: 0 }, 201)
  },
)

// GET /rh/formation/sessions/:id  — détail + inscrits
router.get('/rh/formation/sessions/:id', async (c) => {
  const { id } = c.req.param()
  const { data, error } = await db
    .from('formation_sessions')
    .select('*, formation_inscriptions(*, apprenants(id, nom, specialite, niveau, statut))')
    .eq('id', id)
    .single()
  if (error || !data) return c.json({ error: 'Session introuvable', code: 'NOT_FOUND' }, 404)
  return c.json(data)
})

// PUT /rh/formation/sessions/:id
router.put(
  '/rh/formation/sessions/:id',
  requireRole(['directeur', 'admin']),
  zValidator('json', formationSessionSchema.partial()),
  async (c) => {
    const { id } = c.req.param()
    const body   = c.req.valid('json')
    const { data, error } = await db
      .from('formation_sessions')
      .update({ ...body, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single()
    if (error)  return c.json({ error: error.message }, 400)
    if (!data)  return c.json({ error: 'Session introuvable', code: 'NOT_FOUND' }, 404)
    return c.json(data)
  },
)

// DELETE /rh/formation/sessions/:id
router.delete('/rh/formation/sessions/:id', requireRole(['directeur']), async (c) => {
  const { id } = c.req.param()
  const { error } = await db.from('formation_sessions').delete().eq('id', id)
  if (error) return c.json({ error: error.message }, 400)
  return c.body(null, 204)
})

// ══════════════════════════════════════════════════════════════════════════════
// INSCRIPTIONS  (POST /rh/apprenants/:id/inscrire)
// ══════════════════════════════════════════════════════════════════════════════

router.post(
  '/rh/apprenants/:id/inscrire',
  requireRole(['directeur', 'admin']),
  zValidator('json', inscriptionSchema),
  async (c) => {
    const { id } = c.req.param()
    const body   = c.req.valid('json')

    // Vérifier apprenant
    const { data: appr } = await db
      .from('apprenants').select('id, nom').eq('id', id).single()
    if (!appr) return c.json({ error: 'Apprenant introuvable', code: 'NOT_FOUND' }, 404)

    // Vérifier session
    const { data: sess } = await db
      .from('formation_sessions')
      .select('id, module, capacite_max, statut')
      .eq('id', body.session_id)
      .single()
    if (!sess) return c.json({ error: 'Session introuvable', code: 'NOT_FOUND' }, 404)
    if (sess.statut === 'terminee' || sess.statut === 'annulee')
      return c.json({ error: 'Session terminée ou annulée', code: 'INVALID_STATUS' }, 422)

    // Vérifier capacité
    const { count } = await db
      .from('formation_inscriptions')
      .select('*', { count: 'exact', head: true })
      .eq('session_id', body.session_id)
    if ((count ?? 0) >= sess.capacite_max)
      return c.json({ error: `Session complète (${sess.capacite_max} places max)`, code: 'SESSION_FULL' }, 422)

    const { data, error } = await db
      .from('formation_inscriptions')
      .insert({
        apprenant_id:    id,
        session_id:      body.session_id,
        disponibilites:  body.disponibilites ?? [],
        notes:           body.notes ?? null,
      })
      .select()
      .single()

    if (error) return c.json({ error: error.message, code: error.code }, 400)
    return c.json(data, 201)
  },
)

// PUT /rh/formation/inscriptions/:id  — MAJ statut / nb_seances / évaluation
router.put(
  '/rh/formation/inscriptions/:id',
  requireRole(['directeur', 'admin']),
  zValidator('json', inscriptionUpdateSchema),
  async (c) => {
    const { id } = c.req.param()
    const body   = c.req.valid('json')
    const { data, error } = await db
      .from('formation_inscriptions')
      .update({ ...body, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single()
    if (error) return c.json({ error: error.message }, 400)
    if (!data)  return c.json({ error: 'Inscription introuvable', code: 'NOT_FOUND' }, 404)
    return c.json(data)
  },
)

// ══════════════════════════════════════════════════════════════════════════════
// HISTORIQUE APPRENANT  (GET /rh/apprenants/:id/historique)
// ══════════════════════════════════════════════════════════════════════════════

router.get('/rh/apprenants/:id/historique', async (c) => {
  const { id } = c.req.param()

  const [{ data: appr }, { data: validations }, { data: inscriptions }] = await Promise.all([
    db.from('apprenants').select('*').eq('id', id).single(),
    db.from('validations_niveau')
      .select('*')
      .eq('apprenant_id', id)
      .order('date_validation', { ascending: true }),
    db.from('formation_inscriptions')
      .select('*, formation_sessions(module, niveau, date_debut, date_fin, formateur, lieu)')
      .eq('apprenant_id', id)
      .order('date_inscription', { ascending: true }),
  ])

  if (!appr) return c.json({ error: 'Apprenant introuvable', code: 'NOT_FOUND' }, 404)

  return c.json({
    apprenant:   appr,
    validations: validations ?? [],
    inscriptions: inscriptions ?? [],
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// CONGÉS & ABSENCES (RH02)
// ══════════════════════════════════════════════════════════════════════════════

const congeSchema = z.object({
  employe_id:  z.string(),
  type:        z.enum(['conge_paye', 'sans_solde', 'maladie', 'maternite', 'paternite', 'evenement_familial']).default('conge_paye'),
  date_debut:  z.string(),
  date_fin:    z.string(),
  jours_ouvres: z.number().int().min(1),
  motif:       z.string().optional(),
})

const congeStatutSchema = z.object({
  statut:         z.enum(['approuve', 'refuse', 'annule']),
  commentaire_rh: z.string().optional(),
})

router.get('/rh/conges', async (c) => {
  const { employe_id, statut, mois } = c.req.query()
  const page    = Math.max(1, parseInt(c.req.query('page') ?? '1'))
  const perPage = Math.min(100, parseInt(c.req.query('per_page') ?? '50'))
  const from    = (page - 1) * perPage

  let q = db.from('conges').select('*, employes(nom, poste, departement)', { count: 'exact' })
  if (employe_id) q = q.eq('employe_id', employe_id)
  if (statut)     q = q.eq('statut', statut)
  if (mois) {
    // Filtrer sur le mois de début
    const debut = `${mois}-01`
    const fin   = `${mois}-31`
    q = q.gte('date_debut', debut).lte('date_debut', fin)
  }

  const { data, count, error } = await q
    .order('date_debut', { ascending: false })
    .range(from, from + perPage - 1)

  if (error) return c.json({ error: error.message }, 500)
  return c.json({ data: data ?? [], total: count ?? 0, page, per_page: perPage })
})

router.get('/rh/conges/soldes', requireRole(['directeur', 'admin']), async (c) => {
  const { data, error } = await db.from('v_solde_conges').select('*').order('employe_nom')
  if (error) return c.json({ error: error.message }, 500)
  return c.json({ data: data ?? [] })
})

router.post('/rh/conges', requireRole(['directeur', 'admin', 'operateur']), zValidator('json', congeSchema), async (c) => {
  const user = c.get('user')
  const body = c.req.valid('json')

  if (body.date_debut > body.date_fin) {
    return c.json({ error: 'date_debut doit être antérieure à date_fin', code: 'INVALID_DATES' }, 422)
  }

  const { data, error } = await db
    .from('conges')
    .insert({ ...body, statut: 'en_attente', created_by: user.id })
    .select().single()

  if (error) return c.json({ error: error.message, code: error.code }, 400)
  return c.json(data, 201)
})

router.patch('/rh/conges/:id/statut', requireRole(['directeur', 'admin']), zValidator('json', congeStatutSchema), async (c) => {
  const { id }  = c.req.param()
  const body    = c.req.valid('json')
  const user    = c.get('user')

  const { data: existing } = await db.from('conges').select('statut, employe_id').eq('id', id).single()
  if (!existing) return c.json({ error: 'Congé introuvable', code: 'NOT_FOUND' }, 404)

  const ex = existing as { statut: string; employe_id: string }
  if (!['en_attente'].includes(ex.statut)) {
    return c.json({ error: `Congé déjà ${ex.statut} — modification impossible`, code: 'ALREADY_PROCESSED' }, 422)
  }

  const { data, error } = await db
    .from('conges')
    .update({
      statut:         body.statut,
      approuve_par:   body.statut === 'approuve' ? user.id : null,
      approuve_at:    body.statut === 'approuve' ? new Date().toISOString() : null,
      commentaire_rh: body.commentaire_rh ?? null,
      updated_at:     new Date().toISOString(),
    })
    .eq('id', id)
    .select().single()

  if (error) return c.json({ error: error.message }, 400)

  // Si approuvé → mettre à jour statut employé si c'est un congé payé
  if (body.statut === 'approuve') {
    const today = new Date().toISOString().slice(0, 10)
    const d = data as { date_debut: string; date_fin: string; type: string }
    if (d.type === 'conge_paye' && d.date_debut <= today && today <= d.date_fin) {
      await db.from('employes').update({ statut: 'conge', updated_at: new Date().toISOString() }).eq('id', ex.employe_id)
    }
  }

  return c.json(data)
})

router.delete('/rh/conges/:id', requireRole(['directeur', 'admin', 'operateur']), async (c) => {
  const { id } = c.req.param()
  const { data } = await db.from('conges').select('statut').eq('id', id).single()
  if (!data) return c.json({ error: 'Congé introuvable', code: 'NOT_FOUND' }, 404)
  if ((data as { statut: string }).statut !== 'en_attente') {
    return c.json({ error: 'Seuls les congés en attente peuvent être supprimés', code: 'CANNOT_DELETE' }, 422)
  }
  await db.from('conges').delete().eq('id', id)
  return c.body(null, 204)
})

// ══════════════════════════════════════════════════════════════════════════════
// RÉCAP PRÉSENCES PAR MOIS (RH02)
// ══════════════════════════════════════════════════════════════════════════════

router.get('/rh/presences/recap', requireRole(['directeur', 'admin']), async (c) => {
  const { mois, employe_id } = c.req.query()
  if (!mois) return c.json({ error: 'Paramètre mois requis (YYYY-MM)', code: 'MISSING_MOIS' }, 400)

  const debut = `${mois}-01`
  const fin   = `${mois}-31`

  let q = db.from('presences')
    .select('employe_id, statut, heures, employes(nom, poste)')
    .gte('date', debut)
    .lte('date', fin)

  if (employe_id) q = q.eq('employe_id', employe_id)

  const { data, error } = await q
  if (error) return c.json({ error: error.message }, 500)

  // Agréger par employé
  const byEmploye: Record<string, {
    employe_id: string; nom: string; poste: string
    nb_present: number; nb_absent: number; nb_conge: number
    nb_retard: number; nb_maladie: number; heures_total: number; heures_sup: number
  }> = {}

  for (const row of data ?? []) {
    const r = row as {
      employe_id: string; statut: string; heures: number
      employes: { nom: string; poste: string } | null
    }
    if (!byEmploye[r.employe_id]) {
      byEmploye[r.employe_id] = {
        employe_id:  r.employe_id,
        nom:         r.employes?.nom ?? '',
        poste:       r.employes?.poste ?? '',
        nb_present:  0, nb_absent: 0, nb_conge: 0, nb_retard: 0, nb_maladie: 0,
        heures_total: 0, heures_sup: 0,
      }
    }
    const e = byEmploye[r.employe_id]
    const h = r.heures ?? 0
    e.heures_total += h
    e.heures_sup   += Math.max(0, h - 8)

    if (r.statut === 'present')  e.nb_present++
    if (r.statut === 'absent')   e.nb_absent++
    if (r.statut === 'conge')    e.nb_conge++
    if (r.statut === 'retard')   e.nb_retard++
    if (r.statut === 'maladie')  e.nb_maladie++
  }

  return c.json({ mois, data: Object.values(byEmploye) })
})

// ══════════════════════════════════════════════════════════════════════════════
// RAPPORT CNPS MENSUEL (RH01)
// ══════════════════════════════════════════════════════════════════════════════

router.get('/rh/cnps/rapport', requireRole(['directeur', 'admin']), async (c) => {
  const mois = c.req.query('mois')
  if (!mois || !/^\d{4}-\d{2}$/.test(mois)) {
    return c.json({ error: 'Paramètre mois requis (YYYY-MM)', code: 'MISSING_MOIS' }, 400)
  }

  const { data: bulletins, error } = await db
    .from('bulletins_paie')
    .select('*, employes(nom, poste, cnps, departement)')
    .eq('mois', mois)
    .neq('statut', 'annule')

  if (error) return c.json({ error: error.message }, 500)

  type BulletinRow = {
    salaire_base_xaf: number; heures_sup_xaf: number; primes: number
    cotisation_cnps_xaf: number; cnps_employeur_xaf: number
    employes: { nom: string; poste: string; cnps: string | null; departement: string } | null
  }

  const lignes = (bulletins ?? []).map((b: BulletinRow) => {
    const brut      = b.salaire_base_xaf + (b.heures_sup_xaf ?? 0) + (b.primes ?? 0)
    const baseCnps  = Math.min(brut, CNPS_PLAFOND)
    return {
      employe_nom:              b.employes?.nom ?? '',
      poste:                    b.employes?.poste ?? '',
      departement:              b.employes?.departement ?? '',
      numero_cnps:              b.employes?.cnps ?? '',
      salaire_brut_xaf:         Math.round(brut),
      base_cotisable_xaf:       Math.round(baseCnps),
      cotisation_salarie_xaf:   b.cotisation_cnps_xaf ?? Math.round(baseCnps * CNPS_SALARIE),
      cotisation_employeur_xaf: b.cnps_employeur_xaf  ?? Math.round(baseCnps * CNPS_EMPLOYEUR),
      total_verser_xaf:         (b.cotisation_cnps_xaf ?? Math.round(baseCnps * CNPS_SALARIE)) +
                                (b.cnps_employeur_xaf  ?? Math.round(baseCnps * CNPS_EMPLOYEUR)),
    }
  })

  const totalSalarie   = lignes.reduce((s, l) => s + l.cotisation_salarie_xaf, 0)
  const totalEmployeur = lignes.reduce((s, l) => s + l.cotisation_employeur_xaf, 0)

  return c.json({
    mois,
    employeur_reference: 'TAFDIL SARL',
    periode:             mois,
    lignes,
    total_salarie_xaf:   Math.round(totalSalarie),
    total_employeur_xaf: Math.round(totalEmployeur),
    total_a_verser_xaf:  Math.round(totalSalarie + totalEmployeur),
  })
})

// ── Attestation de formation PDF (Gap 4 CDC MOD-05) ──────────────────────────

router.get('/apprenants/:id/attestation', async (c) => {
  const { id } = c.req.param()
  const { data: apprenant } = await db
    .from('apprenants')
    .select('nom, specialite, niveau, duree_mois, statut')
    .eq('id', id).single()

  if (!apprenant) return c.json({ error: 'Apprenant introuvable', code: 'NOT_FOUND' }, 404)

  type AP = { nom: string; specialite: string; niveau: number; duree_mois: number }
  const ap = apprenant as AP

  const date_delivrance = new Date().toLocaleDateString('fr-CM', {
    day: 'numeric', month: 'long', year: 'numeric',
  })

  const buf = await generateAttestationPDF({
    nom:             ap.nom,
    specialite:      ap.specialite ?? 'Menuiserie métallique',
    niveau:          ap.niveau,
    duree_mois:      ap.duree_mois,
    date_delivrance,
  })

  c.header('Content-Type', 'application/pdf')
  c.header('Content-Disposition', `inline; filename="Attestation-${ap.nom.replace(/\s+/g, '-')}.pdf"`)
  return c.body(buf.buffer as ArrayBuffer)
})

export { router as rhRouter }

// Export helper pour cron externe
export { genererBulletinsMois }
