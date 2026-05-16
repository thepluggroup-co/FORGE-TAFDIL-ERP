import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import PDFDocument from 'pdfkit'
import { supabase, supabaseAdmin } from '@forge/db'
import { requireRole } from '../middleware/rbac'
import type { HonoVariables } from '../types'

const router = new Hono<{ Variables: HonoVariables }>()
const TVA_RATE = 0.1925

// ── Montant en lettres (français) ──────────────────────────────────────────────

function montantEnLettres(montant: number): string {
  const n = Math.round(Math.abs(montant))
  if (n === 0) return 'zéro franc CFA'

  const UNITES = ['', 'un', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit', 'neuf',
    'dix', 'onze', 'douze', 'treize', 'quatorze', 'quinze', 'seize', 'dix-sept', 'dix-huit', 'dix-neuf']
  const DIZ = ['', '', 'vingt', 'trente', 'quarante', 'cinquante', 'soixante']

  function s100(x: number): string {
    if (x === 0) return ''
    if (x < 20) return UNITES[x]
    const d = Math.floor(x / 10), u = x % 10
    if (d === 7) return 'soixante-' + UNITES[10 + u]
    if (d === 8) return u === 0 ? 'quatre-vingts' : `quatre-vingt-${UNITES[u]}`
    if (d === 9) return u === 0 ? 'quatre-vingt-dix' : `quatre-vingt-${UNITES[10 + u]}`
    if (u === 0) return DIZ[d]
    return DIZ[d] + (u === 1 ? '-et-un' : `-${UNITES[u]}`)
  }

  function s1000(x: number): string {
    const c = Math.floor(x / 100), r = x % 100
    const cent = c === 0 ? '' : c === 1 ? 'cent' : `${UNITES[c]} cent${r === 0 ? 's' : ''}`
    const bas = s100(r)
    return [cent, bas].filter(Boolean).join(' ')
  }

  const G = Math.floor(n / 1_000_000_000)
  const M = Math.floor((n % 1_000_000_000) / 1_000_000)
  const K = Math.floor((n % 1_000_000) / 1_000)
  const R = n % 1_000

  const parts: string[] = []
  if (G > 0) parts.push(`${s1000(G)} milliard${G > 1 ? 's' : ''}`)
  if (M > 0) parts.push(`${s1000(M)} million${M > 1 ? 's' : ''}`)
  if (K > 0) parts.push(K === 1 ? 'mille' : `${s1000(K)} mille`)
  if (R > 0) parts.push(s1000(R))

  return parts.join(' ') + ' francs CFA'
}

// ── Formatage XAF ──────────────────────────────────────────────────────────────

function xaf(n: number): string {
  return n.toLocaleString('fr-FR') + ' XAF'
}

// ── Génération PDF facture ─────────────────────────────────────────────────────

interface FactureLignePdf {
  designation: string
  unite: string
  quantite: number
  prix_unitaire_ht_xaf: number
  total_ht_xaf: number
}

interface FacturePdfData {
  numero: string
  date_emission: string
  date_echeance: string
  client_nom: string
  total_ht_xaf: number
  tva_xaf: number
  total_ttc_xaf: number
  lignes: FactureLignePdf[]
}

async function genererFacturePdf(data: FacturePdfData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 0, info: { Title: data.numero, Author: 'TAFDIL SARL' } })
    const chunks: Buffer[] = []
    doc.on('data', (c: Buffer) => chunks.push(c))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)

    const ML = 50   // margin left
    const W  = 495  // usable width (595 - 50*2)

    // ── En-tête bleu ────────────────────────────────────────────────
    doc.rect(0, 0, 595, 115).fill('#1e40af')

    doc.font('Helvetica-Bold').fontSize(22).fillColor('white')
      .text('TAFDIL SARL', ML, 28)
    doc.font('Helvetica').fontSize(8).fillColor('#bfdbfe')
      .text('Microusine Métallurgique — Bassa Industrie, Douala, Cameroun', ML, 56)
      .text('NIU : M0820000123456A  |  RCCM : RC/DLA/2020/B/1234', ML, 68)
      .text('Tél : +237 699 000 000  |  info@tafdil.cm', ML, 80)

    doc.font('Helvetica-Bold').fontSize(18).fillColor('white')
      .text('FACTURE', 0, 28, { align: 'right', width: 545 })
    doc.font('Helvetica-Bold').fontSize(12).fillColor('#93c5fd')
      .text(data.numero, 0, 54, { align: 'right', width: 545 })
    doc.font('Helvetica').fontSize(8).fillColor('#bfdbfe')
      .text(`Émission : ${data.date_emission}`, 0, 71, { align: 'right', width: 545 })
      .text(`Échéance : ${data.date_echeance}`, 0, 82, { align: 'right', width: 545 })

    // ── Bloc client ──────────────────────────────────────────────────
    doc.rect(ML, 130, W, 45).fill('#f3f4f6')
    doc.font('Helvetica-Bold').fontSize(7).fillColor('#6b7280')
      .text('FACTURÉ À', ML + 10, 138)
    doc.font('Helvetica-Bold').fontSize(12).fillColor('#111827')
      .text(data.client_nom, ML + 10, 150)

    // ── En-tête tableau ──────────────────────────────────────────────
    let y = 193
    doc.rect(ML, y, W, 20).fill('#1e40af')
    doc.font('Helvetica-Bold').fontSize(8).fillColor('white')
    doc.text('DÉSIGNATION', ML + 8, y + 6)
    doc.text('QTÉ', ML + 300, y + 6)
    doc.text('P.U. HT (XAF)', ML + 348, y + 6)
    doc.text('TOTAL HT (XAF)', ML + 425, y + 6)
    y += 20

    // ── Lignes ───────────────────────────────────────────────────────
    data.lignes.forEach((l, i) => {
      doc.rect(ML, y, W, 18).fill(i % 2 === 0 ? '#f9fafb' : '#ffffff')
      doc.font('Helvetica').fontSize(8).fillColor('#111827')
      doc.text(l.designation, ML + 8, y + 5, { width: 284 })
      doc.text(`${l.quantite} ${l.unite}`, ML + 300, y + 5)
      doc.text(l.prix_unitaire_ht_xaf.toLocaleString('fr-FR'), ML + 348, y + 5)
      doc.text(l.total_ht_xaf.toLocaleString('fr-FR'), ML + 430, y + 5)
      y += 18
    })

    // ── Totaux ───────────────────────────────────────────────────────
    y += 12
    doc.font('Helvetica').fontSize(9).fillColor('#374151')
    doc.text('Total HT :', ML + 310, y)
    doc.text(xaf(data.total_ht_xaf), ML + 390, y, { width: 155, align: 'right' })
    y += 15
    doc.text('TVA 19,25% :', ML + 310, y)
    doc.text(xaf(data.tva_xaf), ML + 390, y, { width: 155, align: 'right' })
    y += 5
    doc.rect(ML + 310, y + 8, 185, 22).fill('#1e40af')
    doc.font('Helvetica-Bold').fontSize(10).fillColor('white')
    doc.text('TOTAL TTC :', ML + 318, y + 14)
    doc.text(xaf(data.total_ttc_xaf), ML + 390, y + 14, { width: 97, align: 'right' })
    y += 38

    // ── Arrêté en lettres ────────────────────────────────────────────
    y += 8
    doc.rect(ML, y, W, 30).fill('#eff6ff')
    doc.font('Helvetica').fontSize(8).fillColor('#374151')
    doc.text('Arrêté à la somme de :', ML + 8, y + 6)
    doc.font('Helvetica-Bold').fontSize(8).fillColor('#1e40af')
    doc.text(montantEnLettres(data.total_ttc_xaf).toUpperCase(), ML + 8, y + 17, { width: W - 16 })
    y += 42

    // ── Mentions DGI ─────────────────────────────────────────────────
    y += 6
    doc.font('Helvetica-Bold').fontSize(7).fillColor('#6b7280')
    doc.text('MENTIONS LÉGALES ET FISCALES OBLIGATOIRES', ML, y)
    y += 10
    doc.font('Helvetica').fontSize(7).fillColor('#6b7280')
    const mentions = [
      `• TVA collectée : ${xaf(data.tva_xaf)} au taux de 19,25% — Loi de Finances du Cameroun, CGI Art. 125.`,
      '• Facture assujettie à la TVA. Droit à déduction pour les assujettis selon art. 145 CGI Cameroun.',
      '• Toute facture fictive ou falsifiée est passible de sanctions pénales (CGI Art. 538 et suivants).',
      '• Document à conserver 10 ans. Paiement par virement bancaire ou chèque certifié.',
    ]
    mentions.forEach((m) => { doc.text(m, ML, y); y += 10 })

    // ── Pied de page ─────────────────────────────────────────────────
    doc.moveTo(ML, 770).lineTo(ML + W, 770).strokeColor('#d1d5db').lineWidth(0.5).stroke()
    doc.font('Helvetica').fontSize(7).fillColor('#9ca3af')
    doc.text('TAFDIL SARL — Capital social : 10 000 000 XAF — NIU : M0820000123456A — RCCM : RC/DLA/2020/B/1234', ML, 775, { align: 'center', width: W })
    doc.text('Bassa Industrie, Douala, Cameroun — +237 699 000 000 — info@tafdil.cm', ML, 785, { align: 'center', width: W })

    doc.end()
  })
}

// ── Schémas Zod ────────────────────────────────────────────────────────────────

const factureSchema = z.object({
  client_id:     z.string().optional(),
  client_nom:    z.string().min(1),
  commande_id:   z.string().optional(),
  date_emission: z.string(),
  date_echeance: z.string(),
  notes:         z.string().optional(),
  lignes: z.array(z.object({
    designation:          z.string().min(1),
    unite:                z.string().default('unité'),
    quantite:             z.number().positive(),
    prix_unitaire_ht_xaf: z.number().min(0),
    ordre:                z.number().int().default(0),
  })).min(1),
})

const creditSchema = z.object({
  client_id:   z.string().optional(),
  client_nom:  z.string().min(1),
  commande_id: z.string().optional(),
  montant_xaf: z.number().positive(),
  date_debut:  z.string(),
  echeance:    z.string(),
  notes:       z.string().optional(),
})

const rembourserSchema = z.object({
  montant_xaf:   z.number().positive(),
  date_paiement: z.string(),
  type:          z.enum(['total', 'partiel']),
  notes:         z.string().optional(),
})

const ecritureSchema = z.object({
  date:             z.string(),
  libelle:          z.string().min(1),
  compte_syscohada: z.string().min(2),
  compte_label:     z.string().min(1),
  debit_xaf:        z.number().min(0).default(0),
  credit_xaf:       z.number().min(0).default(0),
  reference_doc:    z.string().optional(),
  facture_id:       z.string().optional(),
  commande_id:      z.string().optional(),
})

const whatsappSchema = z.object({
  phone:   z.string().min(8),
  message: z.string().optional(),
})

// ── Helper storage ─────────────────────────────────────────────────────────────

function storageFrom(bucket: string) {
  return (supabaseAdmin ?? supabase).storage.from(bucket)
}

// ══════════════════════════════════════════════════════════════════════════════
// FACTURES
// ══════════════════════════════════════════════════════════════════════════════

router.get('/factures', async (c) => {
  const { statut, client_id, search } = c.req.query()
  const page    = Math.max(1, parseInt(c.req.query('page') ?? '1'))
  const perPage = Math.min(100, parseInt(c.req.query('per_page') ?? '20'))
  const from    = (page - 1) * perPage

  let q = supabase.from('factures').select('*, factures_lignes(*)', { count: 'exact' })
  if (statut)    q = q.eq('statut', statut)
  if (client_id) q = q.eq('client_id', client_id)
  if (search)    q = q.or(`numero.ilike.%${search}%,client_nom.ilike.%${search}%`)

  const { data, count, error } = await q.order('created_at', { ascending: false }).range(from, from + perPage - 1)
  if (error) return c.json({ error: error.message }, 500)

  return c.json({ data, total: count ?? 0, page, per_page: perPage, total_pages: Math.ceil((count ?? 0) / perPage) })
})

router.post('/factures', requireRole(['directeur', 'admin']), zValidator('json', factureSchema), async (c) => {
  const user = c.get('user')
  const body = c.req.valid('json')

  const year = new Date().getFullYear()
  const { count } = await supabase.from('factures').select('*', { count: 'exact', head: true })
    .gte('created_at', `${year}-01-01T00:00:00.000Z`)
  const numero = `FAC-${year}-${String((count ?? 0) + 1).padStart(4, '0')}`

  const total_ht_xaf  = Math.round(body.lignes.reduce((s, l) => s + l.quantite * l.prix_unitaire_ht_xaf, 0))
  const tva_xaf       = Math.round(total_ht_xaf * TVA_RATE)
  const total_ttc_xaf = total_ht_xaf + tva_xaf

  const { data: facture, error: facErr } = await supabase
    .from('factures')
    .insert({
      numero, client_id: body.client_id ?? null, client_nom: body.client_nom,
      commande_id: body.commande_id ?? null, statut: 'brouillon',
      date_emission: body.date_emission, date_echeance: body.date_echeance,
      total_ht_xaf, tva_xaf, total_ttc_xaf,
      notes: body.notes ?? null, created_by: user.id, sync_status: 'synced',
    })
    .select().single()

  if (facErr || !facture) return c.json({ error: facErr?.message, code: facErr?.code }, 400)
  const facId = (facture as { id: string }).id

  const { data: lignesData, error: lignesErr } = await supabase
    .from('factures_lignes')
    .insert(body.lignes.map((l, i) => ({
      facture_id: facId, designation: l.designation, unite: l.unite,
      quantite: l.quantite, prix_unitaire_ht_xaf: l.prix_unitaire_ht_xaf,
      total_ht_xaf: Math.round(l.quantite * l.prix_unitaire_ht_xaf),
      ordre: l.ordre !== 0 ? l.ordre : i,
    })))
    .select()

  if (lignesErr) {
    await supabase.from('factures').delete().eq('id', facId)
    return c.json({ error: lignesErr.message }, 400)
  }

  // Générer et uploader le PDF
  let pdf_url: string | null = null
  try {
    const pdfBuf = await genererFacturePdf({
      numero, date_emission: body.date_emission, date_echeance: body.date_echeance,
      client_nom: body.client_nom, total_ht_xaf, tva_xaf, total_ttc_xaf,
      lignes: (lignesData ?? []) as FactureLignePdf[],
    })

    const { error: upErr } = await storageFrom('factures').upload(`${numero}.pdf`, pdfBuf, { contentType: 'application/pdf', upsert: true })
    if (!upErr) {
      pdf_url = supabase.storage.from('factures').getPublicUrl(`${numero}.pdf`).data.publicUrl
    }
  } catch (e) {
    console.error('[finance] PDF generation error:', e)
  }

  return c.json({ ...facture, lignes: lignesData, pdf_url }, 201)
})

router.get('/factures/:id', async (c) => {
  const { id } = c.req.param()
  const { data, error } = await supabase.from('factures').select('*, factures_lignes(*)').eq('id', id).single()
  if (error || !data) return c.json({ error: 'Facture introuvable', code: 'NOT_FOUND' }, 404)

  const f = data as { numero: string }
  const pdf_url = supabase.storage.from('factures').getPublicUrl(`${f.numero}.pdf`).data.publicUrl
  return c.json({ ...data, pdf_url })
})

router.get('/factures/:id/pdf', async (c) => {
  const { id } = c.req.param()
  const { data: facture, error } = await supabase
    .from('factures').select('*, factures_lignes(*)').eq('id', id).single()
  if (error || !facture) return c.json({ error: 'Facture introuvable', code: 'NOT_FOUND' }, 404)

  const f = facture as { numero: string; client_nom: string; date_emission: string; date_echeance: string; total_ht_xaf: number; tva_xaf: number; total_ttc_xaf: number; factures_lignes: FactureLignePdf[] }

  // Essayer Supabase Storage
  try {
    const { data: blob } = await storageFrom('factures').download(`${f.numero}.pdf`)
    if (blob) {
      c.header('Content-Type', 'application/pdf')
      c.header('Content-Disposition', `inline; filename="${f.numero}.pdf"`)
      c.header('Cache-Control', 'private, max-age=3600')
      return c.body(await blob.arrayBuffer())
    }
  } catch { /* régénérer */ }

  // Régénération à la volée
  const buf = await genererFacturePdf({
    numero: f.numero, date_emission: f.date_emission, date_echeance: f.date_echeance,
    client_nom: f.client_nom, total_ht_xaf: f.total_ht_xaf, tva_xaf: f.tva_xaf,
    total_ttc_xaf: f.total_ttc_xaf, lignes: f.factures_lignes,
  })

  c.header('Content-Type', 'application/pdf')
  c.header('Content-Disposition', `inline; filename="${f.numero}.pdf"`)
  return c.body(buf.buffer as ArrayBuffer)
})

router.post('/factures/:id/whatsapp', requireRole(['directeur', 'admin']), zValidator('json', whatsappSchema), async (c) => {
  const { id } = c.req.param()
  const body   = c.req.valid('json')

  const { data: facture } = await supabase.from('factures').select('numero, client_nom, total_ttc_xaf').eq('id', id).single()
  if (!facture) return c.json({ error: 'Facture introuvable', code: 'NOT_FOUND' }, 404)

  const f = facture as { numero: string; client_nom: string; total_ttc_xaf: number }
  const pdfUrl = supabase.storage.from('factures').getPublicUrl(`${f.numero}.pdf`).data.publicUrl

  const message = body.message ??
    `Bonjour,\nVeuillez trouver votre facture TAFDIL :\nN° ${f.numero}\nClient : ${f.client_nom}\nMontant TTC : ${xaf(f.total_ttc_xaf)}\nPDF : ${pdfUrl}`

  const apiKey = process.env.CALLMEBOT_APIKEY ?? ''
  if (!apiKey) return c.json({ error: 'CALLMEBOT_APIKEY non configuré', code: 'CONFIG_ERROR' }, 500)

  const waUrl = new URL('https://api.callmebot.com/whatsapp.php')
  waUrl.searchParams.set('phone', body.phone)
  waUrl.searchParams.set('text', message)
  waUrl.searchParams.set('apikey', apiKey)

  try {
    const res  = await fetch(waUrl.toString())
    const text = await res.text()
    if (!res.ok && !text.toLowerCase().includes('queued')) {
      return c.json({ error: 'Erreur CallMeBot', details: text }, 502)
    }
    return c.json({ success: true, phone: body.phone })
  } catch (err) {
    return c.json({ error: 'Erreur réseau WhatsApp', details: (err as Error).message }, 502)
  }
})

// ══════════════════════════════════════════════════════════════════════════════
// CRÉDITS — alertes avant /:id
// ══════════════════════════════════════════════════════════════════════════════

router.get('/credits/alertes', async (c) => {
  const today  = new Date()
  const in7j   = new Date(today.getTime() + 7 * 86400000).toISOString().slice(0, 10)
  const todayS = today.toISOString().slice(0, 10)

  const { data, error } = await supabase
    .from('credits')
    .select('*')
    .or(`statut.eq.echu,and(statut.eq.en_cours,echeance.lte.${in7j})`)
    .order('echeance')

  if (error) return c.json({ error: error.message }, 500)

  type CR = { statut: string; echeance: string; solde_restant_xaf: number }
  const cr = (data ?? []) as CR[]

  return c.json({
    data,
    total:              cr.length,
    echus:              cr.filter(x => x.statut === 'echu').length,
    expires_bientot:    cr.filter(x => x.statut === 'en_cours' && x.echeance <= in7j && x.echeance > todayS).length,
    montant_total_xaf:  Math.round(cr.reduce((s, x) => s + x.solde_restant_xaf, 0)),
  })
})

router.get('/credits', async (c) => {
  const { statut, client_id } = c.req.query()
  const page    = Math.max(1, parseInt(c.req.query('page') ?? '1'))
  const perPage = Math.min(100, parseInt(c.req.query('per_page') ?? '20'))
  const from    = (page - 1) * perPage

  let q = supabase.from('credits').select('*', { count: 'exact' })
  if (statut)    q = q.eq('statut', statut)
  if (client_id) q = q.eq('client_id', client_id)

  const { data, count, error } = await q.order('echeance').range(from, from + perPage - 1)
  if (error) return c.json({ error: error.message }, 500)

  return c.json({ data, total: count ?? 0, page, per_page: perPage, total_pages: Math.ceil((count ?? 0) / perPage) })
})

router.post('/credits', requireRole(['directeur', 'admin']), zValidator('json', creditSchema), async (c) => {
  const user = c.get('user')
  const body = c.req.valid('json')

  const year = new Date().getFullYear()
  const { count } = await supabase.from('credits').select('*', { count: 'exact', head: true })
    .gte('created_at', `${year}-01-01T00:00:00.000Z`)
  const numero = `CRD-${year}-${String((count ?? 0) + 1).padStart(4, '0')}`

  const { data, error } = await supabase
    .from('credits')
    .insert({
      numero, client_id: body.client_id ?? null, client_nom: body.client_nom,
      commande_id: body.commande_id ?? null, montant_xaf: body.montant_xaf,
      solde_restant_xaf: body.montant_xaf, date_debut: body.date_debut,
      echeance: body.echeance, statut: 'en_cours',
      notes: body.notes ?? null, created_by: user.id, sync_status: 'synced',
    })
    .select().single()

  if (error) return c.json({ error: error.message, code: error.code }, 400)
  return c.json(data, 201)
})

router.get('/credits/:id', async (c) => {
  const { id } = c.req.param()
  const { data, error } = await supabase.from('credits').select('*, remboursements_credit(*)').eq('id', id).single()
  if (error || !data) return c.json({ error: 'Crédit introuvable', code: 'NOT_FOUND' }, 404)
  return c.json(data)
})

router.put('/credits/:id', requireRole(['directeur', 'admin']), zValidator('json', creditSchema.partial()), async (c) => {
  const { id } = c.req.param()
  const body   = c.req.valid('json')
  const { data, error } = await supabase.from('credits')
    .update({ ...body, updated_at: new Date().toISOString() }).eq('id', id).select().single()
  if (error) return c.json({ error: error.message }, 400)
  if (!data)  return c.json({ error: 'Crédit introuvable', code: 'NOT_FOUND' }, 404)
  return c.json(data)
})

router.post('/credits/:id/rembourser', requireRole(['directeur', 'admin']), zValidator('json', rembourserSchema), async (c) => {
  const { id } = c.req.param()
  const user   = c.get('user')
  const body   = c.req.valid('json')

  const { data: credit } = await supabase.from('credits').select('solde_restant_xaf, statut').eq('id', id).single()
  if (!credit) return c.json({ error: 'Crédit introuvable', code: 'NOT_FOUND' }, 404)

  const cr = credit as { solde_restant_xaf: number; statut: string }
  if (cr.statut === 'rembourse') return c.json({ error: 'Crédit déjà remboursé', code: 'ALREADY_DONE' }, 422)
  if (body.montant_xaf > cr.solde_restant_xaf) {
    return c.json({ error: `Montant dépasse le solde restant (${xaf(cr.solde_restant_xaf)})`, code: 'AMOUNT_EXCEEDED' }, 422)
  }

  const { data: remb, error: rembErr } = await supabase
    .from('remboursements_credit')
    .insert({ credit_id: id, montant_xaf: body.montant_xaf, date_paiement: body.date_paiement, type: body.type, notes: body.notes ?? null, created_by: user.id })
    .select().single()

  if (rembErr) return c.json({ error: rembErr.message }, 400)

  const nouveauSolde  = Math.max(0, cr.solde_restant_xaf - body.montant_xaf)
  const nouveauStatut = nouveauSolde <= 0 ? 'rembourse' : 'en_cours'
  await supabase.from('credits').update({ solde_restant_xaf: nouveauSolde, statut: nouveauStatut, updated_at: new Date().toISOString() }).eq('id', id)

  return c.json({ remboursement: remb, nouveau_solde_xaf: nouveauSolde, statut: nouveauStatut })
})

// ══════════════════════════════════════════════════════════════════════════════
// ÉCRITURES SYSCOHADA
// ══════════════════════════════════════════════════════════════════════════════

router.post('/ecritures', requireRole(['directeur', 'admin']), zValidator('json', ecritureSchema), async (c) => {
  const user = c.get('user')
  const body = c.req.valid('json')

  if (body.debit_xaf === 0 && body.credit_xaf === 0) {
    return c.json({ error: 'Débit ou crédit requis', code: 'INVALID_ENTRY' }, 422)
  }

  const { data, error } = await supabase
    .from('ecritures_comptables')
    .insert({ ...body, created_by: user.id, sync_status: 'synced' })
    .select().single()

  if (error) return c.json({ error: error.message, code: error.code }, 400)
  return c.json(data, 201)
})

// ══════════════════════════════════════════════════════════════════════════════
// RAPPORTS SYSCOHADA
// ══════════════════════════════════════════════════════════════════════════════

router.get('/rapports/bilan', requireRole(['directeur', 'admin']), async (c) => {
  const exercice = c.req.query('exercice') ?? String(new Date().getFullYear())

  const { data: ecritures, error } = await supabase
    .from('ecritures_comptables')
    .select('compte_syscohada, compte_label, debit_xaf, credit_xaf')
    .gte('date', `${exercice}-01-01`)
    .lte('date', `${exercice}-12-31`)

  if (error) return c.json({ error: error.message }, 500)

  type EC = { compte_syscohada: string; compte_label: string; debit_xaf: number; credit_xaf: number }
  const comptes = new Map<string, { label: string; debit: number; credit: number }>()
  for (const e of (ecritures ?? []) as EC[]) {
    const ex = comptes.get(e.compte_syscohada) ?? { label: e.compte_label, debit: 0, credit: 0 }
    ex.debit  += e.debit_xaf
    ex.credit += e.credit_xaf
    comptes.set(e.compte_syscohada, ex)
  }

  const actif: object[] = [], passif: object[] = []
  for (const [compte, { label, debit, credit }] of comptes) {
    const classe = compte[0]
    const solde  = debit - credit
    const entry  = { compte, label, debit: Math.round(debit), credit: Math.round(credit), solde: Math.round(Math.abs(solde)) }
    if (['2', '3'].includes(classe) || (['4', '5'].includes(classe) && solde >= 0)) actif.push(entry)
    else if (classe === '1' || (['4', '5'].includes(classe) && solde < 0)) passif.push(entry)
  }

  const totalActif  = actif.reduce((s, e) => s + (e as { solde: number }).solde, 0)
  const totalPassif = passif.reduce((s, e) => s + (e as { solde: number }).solde, 0)

  return c.json({
    exercice,
    actif:            actif.sort((a, b) => (a as { compte: string }).compte.localeCompare((b as { compte: string }).compte)),
    passif:           passif.sort((a, b) => (a as { compte: string }).compte.localeCompare((b as { compte: string }).compte)),
    total_actif_xaf:  Math.round(totalActif),
    total_passif_xaf: Math.round(totalPassif),
    equilibre:        Math.abs(totalActif - totalPassif) < 1,
  })
})

router.get('/rapports/resultat', requireRole(['directeur', 'admin']), async (c) => {
  const exercice = c.req.query('exercice') ?? String(new Date().getFullYear())

  const { data: ecritures, error } = await supabase
    .from('ecritures_comptables')
    .select('compte_syscohada, compte_label, debit_xaf, credit_xaf')
    .gte('date', `${exercice}-01-01`)
    .lte('date', `${exercice}-12-31`)

  if (error) return c.json({ error: error.message }, 500)

  type EC = { compte_syscohada: string; compte_label: string; debit_xaf: number; credit_xaf: number }
  const comptes = new Map<string, { label: string; debit: number; credit: number }>()
  for (const e of (ecritures ?? []) as EC[]) {
    const classe = e.compte_syscohada[0]
    if (!['6', '7'].includes(classe)) continue
    const ex = comptes.get(e.compte_syscohada) ?? { label: e.compte_label, debit: 0, credit: 0 }
    ex.debit  += e.debit_xaf
    ex.credit += e.credit_xaf
    comptes.set(e.compte_syscohada, ex)
  }

  const produits: object[] = [], charges: object[] = []
  for (const [compte, { label, debit, credit }] of comptes) {
    const classe  = compte[0]
    const montant = classe === '7' ? Math.round(credit) : Math.round(debit)
    const entry   = { compte, label, montant }
    if (classe === '7') produits.push(entry)
    if (classe === '6') charges.push(entry)
  }

  const totalProduits = produits.reduce((s, e) => s + (e as { montant: number }).montant, 0)
  const totalCharges  = charges.reduce((s, e) => s + (e as { montant: number }).montant, 0)
  const resultat      = totalProduits - totalCharges

  return c.json({
    exercice,
    produits:            produits.sort((a, b) => (a as { compte: string }).compte.localeCompare((b as { compte: string }).compte)),
    charges:             charges.sort((a, b) => (a as { compte: string }).compte.localeCompare((b as { compte: string }).compte)),
    total_produits_xaf:  Math.round(totalProduits),
    total_charges_xaf:   Math.round(totalCharges),
    resultat_net_xaf:    Math.round(resultat),
    beneficiaire:        resultat >= 0,
  })
})

export { router as financeRouter }
