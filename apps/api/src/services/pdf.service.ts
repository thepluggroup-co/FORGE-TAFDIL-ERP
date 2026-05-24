import PDFDocument from 'pdfkit'
import { supabaseAdmin } from '@forge/db'

const db = supabaseAdmin!

// ── Company info ───────────────────────────────────────────────────────────────
const CO = {
  nom:     'TAFDIL SARL',
  activite:'Microusine Métallurgique & BTP',
  adresse: 'Bassa Industrie, Douala, Cameroun',
  tel:     '+237 699 000 000',
  email:   'info@tafdil.cm',
  niu:     'M0820000123456A',
  rccm:    'RC/DLA/2020/B/1234',
  capital: '10 000 000 XAF',
} as const

// ── Design tokens ──────────────────────────────────────────────────────────────
const C = {
  red:      '#C62828',
  redLight: '#FFEBEE',
  redMid:   '#EF9A9A',
  gray:     '#F3F4F6',
  grayRow:  '#F9FAFB',
  dark:     '#111827',
  mid:      '#374151',
  muted:    '#6B7280',
  light:    '#9CA3AF',
  white:    '#FFFFFF',
  border:   '#E5E7EB',
  blue:     '#EFF6FF',
  blueMid:  '#1D4ED8',
} as const

// ── Layout ─────────────────────────────────────────────────────────────────────
const ML       = 40       // margin left
const PW       = 595      // A4 width pts
const W        = 515      // usable width (595 - 40*2 + 5)
const ROW_H    = 18
const FOOTER_Y = 758      // footer separator Y
const PAGE_END = 740      // max Y before page break

// ── Table column X positions (absolute) ────────────────────────────────────────
const COL = {
  num: ML,          // w=28  →  68
  des: ML + 28,     // w=205 → 273
  qty: ML + 233,    // w=40  → 313
  uni: ML + 273,    // w=50  → 363
  pu:  ML + 323,    // w=90  → 413
  tot: ML + 413,    // w=102 → end=555
}

// ── Interfaces ─────────────────────────────────────────────────────────────────

export interface PdfLigne {
  designation:          string
  unite:                string
  quantite:             number
  prix_unitaire_ht_xaf: number
  total_ht_xaf:         number
}

export interface PdfClient {
  nom:        string
  adresse?:   string | null
  telephone?: string | null
  email?:     string | null
  niu?:       string | null
  type?:      string | null
}

export interface PdfFacture {
  numero:        string
  date_emission: string
  date_echeance: string
  total_ht_xaf:  number
  tva_xaf:       number
  total_ttc_xaf: number
}

export interface PdfDevis {
  numero:          string
  date_emission:   string
  date_validite:   string
  validite_jours?: number
  total_ht_xaf:    number
  tva_xaf:         number
  total_ttc_xaf:   number
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function xaf(n: number): string {
  return n.toLocaleString('fr-FR') + ' XAF'
}

function montantEnLettres(montant: number): string {
  const n = Math.round(Math.abs(montant))
  if (n === 0) return 'zéro franc CFA'

  const UNITES = ['', 'un', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit',
    'neuf', 'dix', 'onze', 'douze', 'treize', 'quatorze', 'quinze', 'seize',
    'dix-sept', 'dix-huit', 'dix-neuf']
  const DIZ = ['', '', 'vingt', 'trente', 'quarante', 'cinquante', 'soixante']

  function s100(x: number): string {
    if (x === 0) return ''
    if (x < 20)  return UNITES[x]
    const d = Math.floor(x / 10), u = x % 10
    if (d === 7) return 'soixante-' + UNITES[10 + u]
    if (d === 8) return u === 0 ? 'quatre-vingts' : `quatre-vingt-${UNITES[u]}`
    if (d === 9) return u === 0 ? 'quatre-vingt-dix' : `quatre-vingt-${UNITES[10 + u]}`
    return DIZ[d] + (u === 0 ? '' : u === 1 ? '-et-un' : `-${UNITES[u]}`)
  }

  function s1000(x: number): string {
    const c = Math.floor(x / 100), r = x % 100
    const cent = c === 0 ? '' : c === 1 ? 'cent' : `${UNITES[c]} cent${r === 0 ? 's' : ''}`
    return [cent, s100(r)].filter(Boolean).join(' ')
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
  return parts.join(' ') + (n > 1 ? ' francs CFA' : ' franc CFA')
}

// ── Drawing helpers ────────────────────────────────────────────────────────────

function drawFooter(doc: InstanceType<typeof PDFDocument>, page: number) {
  doc.save()
  doc.moveTo(ML, FOOTER_Y).lineTo(ML + W, FOOTER_Y)
    .strokeColor(C.border).lineWidth(0.5).stroke()
  doc.font('Helvetica').fontSize(6.5).fillColor(C.light)
  doc.text(
    `${CO.nom} — Capital : ${CO.capital} — NIU : ${CO.niu} — RCCM : ${CO.rccm}`,
    ML, FOOTER_Y + 5, { align: 'center', width: W },
  )
  doc.text(
    `${CO.adresse} — ${CO.tel} — ${CO.email}`,
    ML, FOOTER_Y + 14, { align: 'center', width: W },
  )
  doc.font('Helvetica-Bold').fontSize(7).fillColor(C.muted)
    .text(`Page ${page}`, ML, FOOTER_Y + 14, { align: 'right', width: W })
  doc.restore()
}

function drawHeader(
  doc:      InstanceType<typeof PDFDocument>,
  docType:  'FACTURE' | 'DEVIS',
  numero:   string,
  dateLeft: string,
  dateRight:string,
  labelLeft: string,
  labelRight: string,
) {
  // Background band
  doc.rect(0, 0, PW, 118).fill(C.red)

  // ── Left: company identity ──────────────────────────────────────────────────
  // Logo placeholder box
  doc.rect(ML, 14, 44, 44).fill('rgba(255,255,255,0.15)').stroke()
  doc.font('Helvetica-Bold').fontSize(9).fillColor('white')
    .text('FORGE', ML + 3, 28, { width: 44, align: 'center' })
  doc.font('Helvetica-Bold').fontSize(4.5).fillColor('rgba(255,255,255,0.7)')
    .text('TAFDIL', ML + 3, 39, { width: 44, align: 'center' })

  doc.font('Helvetica-Bold').fontSize(16).fillColor('white')
    .text(CO.nom, ML + 52, 16)
  doc.font('Helvetica').fontSize(7.5).fillColor('rgba(255,255,255,0.85)')
    .text(CO.activite, ML + 52, 36)
    .text(CO.adresse, ML + 52, 47)
    .text(`Tél : ${CO.tel}  |  ${CO.email}`, ML + 52, 57)
    .text(`NIU : ${CO.niu}  |  RCCM : ${CO.rccm}`, ML + 52, 67)

  // ── Right: document identity ────────────────────────────────────────────────
  const RX = ML + W  // right edge

  doc.font('Helvetica-Bold').fontSize(26).fillColor('white')
    .text(docType, 0, 14, { align: 'right', width: RX })
  doc.font('Helvetica-Bold').fontSize(12).fillColor(C.redMid)
    .text(numero, 0, 46, { align: 'right', width: RX })
  doc.font('Helvetica').fontSize(7.5).fillColor('rgba(255,255,255,0.85)')
    .text(`${labelLeft} : ${dateLeft}`,  0, 64, { align: 'right', width: RX })
    .text(`${labelRight} : ${dateRight}`, 0, 74, { align: 'right', width: RX })
}

function drawClientBox(doc: InstanceType<typeof PDFDocument>, client: PdfClient) {
  doc.rect(ML, 126, W, 52).fill(C.gray)
  doc.rect(ML, 126, 3, 52).fill(C.red)

  doc.font('Helvetica-Bold').fontSize(7).fillColor(C.muted)
    .text('FACTURÉ À', ML + 12, 133)

  doc.font('Helvetica-Bold').fontSize(11).fillColor(C.dark)
    .text(client.nom, ML + 12, 144)

  const details = [
    client.adresse,
    client.telephone,
    client.email,
    client.niu && client.type === 'entreprise' ? `NIU : ${client.niu}` : null,
  ].filter(Boolean).join('  ·  ')

  if (details) {
    doc.font('Helvetica').fontSize(7.5).fillColor(C.mid)
      .text(details, ML + 12, 158, { width: W - 20 })
  }
}

function drawTableHeader(doc: InstanceType<typeof PDFDocument>, y: number) {
  doc.rect(ML, y, W, 20).fill(C.red)
  doc.font('Helvetica-Bold').fontSize(7.5).fillColor('white')
  doc.text('N°',           COL.num + 2,  y + 6)
  doc.text('DÉSIGNATION',  COL.des + 2,  y + 6)
  doc.text('QTÉ',          COL.qty + 2,  y + 6)
  doc.text('UNITÉ',        COL.uni + 2,  y + 6)
  doc.text('P.U. HT',      COL.pu + 2,   y + 6)
  doc.text('TOTAL HT',     COL.tot + 2,  y + 6)
  return y + 20
}

function drawTableRow(
  doc:   InstanceType<typeof PDFDocument>,
  ligne: PdfLigne,
  idx:   number,
  y:     number,
) {
  doc.rect(ML, y, W, ROW_H).fill(idx % 2 === 0 ? C.grayRow : C.white)
  doc.font('Helvetica').fontSize(8).fillColor(C.dark)
  doc.text(String(idx + 1),                         COL.num + 2, y + 5)
  doc.text(ligne.designation,                        COL.des + 2, y + 5, { width: 200, ellipsis: true })
  doc.text(String(ligne.quantite),                   COL.qty + 2, y + 5)
  doc.text(ligne.unite,                              COL.uni + 2, y + 5)
  doc.text(ligne.prix_unitaire_ht_xaf.toLocaleString('fr-FR'), COL.pu + 2, y + 5, { width: 85, align: 'right' })
  doc.text(ligne.total_ht_xaf.toLocaleString('fr-FR'),         COL.tot + 2, y + 5, { width: 97, align: 'right' })
  // bottom border
  doc.moveTo(ML, y + ROW_H).lineTo(ML + W, y + ROW_H)
    .strokeColor(C.border).lineWidth(0.3).stroke()
  return y + ROW_H
}

function drawTotals(
  doc:    InstanceType<typeof PDFDocument>,
  y:      number,
  ht:     number,
  tva:    number,
  ttc:    number,
): number {
  const TX = COL.pu   // left of totals block
  const TW = W - (TX - ML)  // width of totals block

  y += 10

  // HT
  doc.font('Helvetica').fontSize(9).fillColor(C.mid)
  doc.text('Sous-total HT :',        TX, y,      { width: 84 })
  doc.font('Helvetica-Bold').fontSize(9).fillColor(C.dark)
  doc.text(xaf(ht), TX + 84, y, { width: TW - 84, align: 'right' })
  y += 16

  // TVA
  doc.font('Helvetica').fontSize(9).fillColor(C.mid)
  doc.text('TVA (19,25%) :',         TX, y,      { width: 84 })
  doc.font('Helvetica-Bold').fontSize(9).fillColor(C.dark)
  doc.text(xaf(tva), TX + 84, y, { width: TW - 84, align: 'right' })
  y += 8

  // TTC box
  doc.rect(TX, y, TW, 26).fill(C.red)
  doc.font('Helvetica-Bold').fontSize(10).fillColor('white')
  doc.text('TOTAL TTC :',           TX + 6, y + 8, { width: 84 })
  doc.font('Helvetica-Bold').fontSize(11).fillColor('white')
  doc.text(xaf(ttc), TX + 84, y + 7, { width: TW - 90, align: 'right' })
  y += 34

  // Amount in words
  const lettres = montantEnLettres(ttc)
  doc.rect(ML, y, W, 28).fill(C.blue)
  doc.rect(ML, y, 3, 28).fill(C.blueMid)
  doc.font('Helvetica').fontSize(7.5).fillColor(C.muted)
    .text('Arrêté à la somme de :', ML + 10, y + 6)
  doc.font('Helvetica-Bold').fontSize(8).fillColor(C.blueMid)
    .text(lettres.toUpperCase(), ML + 10, y + 16, { width: W - 20 })
  y += 36

  return y
}

function drawLegalMentions(doc: InstanceType<typeof PDFDocument>, y: number, tva: number): number {
  y += 8
  doc.font('Helvetica-Bold').fontSize(7).fillColor(C.muted)
    .text('MENTIONS LÉGALES ET FISCALES (DGI Cameroun)', ML, y)
  y += 10
  doc.font('Helvetica').fontSize(7).fillColor(C.muted)
  const mentions = [
    `• TVA collectée : ${xaf(tva)} au taux de 19,25% — CGI Cameroun Art. 125.`,
    '• Facture assujettie à la TVA. Droit à déduction pour les assujettis — CGI Art. 145.',
    '• Toute facture fictive ou falsifiée est passible de sanctions pénales — CGI Art. 538.',
    '• Document à conserver 10 ans conformément à la réglementation camerounaise.',
  ]
  for (const m of mentions) {
    doc.text(m, ML, y, { width: W })
    y += 10
  }
  return y
}

function drawPaymentTerms(doc: InstanceType<typeof PDFDocument>, y: number): number {
  y += 10
  doc.font('Helvetica-Bold').fontSize(7.5).fillColor(C.mid)
    .text('CONDITIONS DE PAIEMENT', ML, y)
  y += 10
  doc.font('Helvetica').fontSize(7.5).fillColor(C.muted)
  doc.text('• Mode de règlement : Virement bancaire / Chèque certifié / Espèces', ML, y); y += 10
  doc.text('• Délai de paiement : 30 jours à compter de la date de facturation', ML, y); y += 10
  doc.text('• Pénalités de retard : 1,5% par mois sur le montant TTC impayé', ML, y); y += 10
  return y
}

function drawSignatureZone(doc: InstanceType<typeof PDFDocument>, y: number) {
  y += 16
  // Client signature
  doc.rect(ML, y, 220, 56).stroke()
  doc.font('Helvetica-Bold').fontSize(7).fillColor(C.muted)
    .text('BON POUR ACCORD — Signature & Cachet Client', ML + 6, y + 5)
  // Company signature
  doc.rect(ML + W - 220, y, 220, 56).stroke()
  doc.font('Helvetica-Bold').fontSize(7).fillColor(C.muted)
    .text('Signature & Cachet TAFDIL', ML + W - 214, y + 5)
  doc.font('Helvetica').fontSize(7).fillColor(C.muted)
    .text(CO.nom, ML + W - 214, y + 44)
}

function drawBtpConditions(doc: InstanceType<typeof PDFDocument>, y: number): number {
  y += 10
  doc.rect(ML, y, W, 8).fill(C.red)
  doc.font('Helvetica-Bold').fontSize(7).fillColor('white')
    .text('CONDITIONS GÉNÉRALES BTP — TAFDIL SARL', ML + 6, y + 1)
  y += 12
  doc.font('Helvetica').fontSize(7).fillColor(C.muted)
  const cg = [
    '• Les prix sont établis sur base des métrés et plans fournis. Toute modification entraîne un avenant tarifé.',
    '• Les travaux débutent après versement d\'un acompte de 30% du montant TTC du devis accepté.',
    '• TAFDIL SARL garantit ses travaux 2 ans (garantie décennale sur gros œuvre conformément au CCAG-BTP).',
    '• Ce devis est valable pour la durée indiquée. Passé ce délai, les prix pourront être révisés.',
    '• Tout arrêt de chantier imputable au client sera facturé selon le coût des immobilisations journalières.',
  ]
  for (const line of cg) {
    doc.text(line, ML, y, { width: W }); y += 10
  }
  return y
}

// ── PDF builder (shared core) ──────────────────────────────────────────────────

function buildPdf(
  meta: {
    title:      string
    docType:    'FACTURE' | 'DEVIS'
    numero:     string
    labelLeft:  string
    dateLeft:   string
    labelRight: string
    dateRight:  string
    extraFn?:   (doc: InstanceType<typeof PDFDocument>, y: number) => number
  },
  client:  PdfClient,
  lignes:  PdfLigne[],
  totaux:  { ht: number; tva: number; ttc: number },
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margin: 0,
      info: { Title: meta.title, Author: CO.nom, Subject: meta.docType },
      bufferPages: true,
    })

    const chunks: Buffer[] = []
    doc.on('data',  (c: Buffer) => chunks.push(c))
    doc.on('end',   () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)

    let page = 1

    // ── Page 1: header + client box ──────────────────────────────────────────
    drawHeader(doc, meta.docType, meta.numero, meta.dateLeft, meta.dateRight, meta.labelLeft, meta.labelRight)
    drawClientBox(doc, client)

    // ── Table ────────────────────────────────────────────────────────────────
    let y = drawTableHeader(doc, 186)

    for (let i = 0; i < lignes.length; i++) {
      // Page break before row overflows footer
      if (y + ROW_H > PAGE_END) {
        drawFooter(doc, page)
        doc.addPage()
        page++
        // Continuation mini-header
        doc.rect(0, 0, PW, 32).fill(C.red)
        doc.font('Helvetica-Bold').fontSize(9).fillColor('white')
          .text(`${CO.nom} — ${meta.docType} ${meta.numero} (suite)`, ML, 11, { width: W })
        y = drawTableHeader(doc, 38)
      }
      y = drawTableRow(doc, lignes[i], i, y)
    }

    // ── Totals ───────────────────────────────────────────────────────────────
    const totalsHeight = 130
    if (y + totalsHeight > PAGE_END) {
      drawFooter(doc, page)
      doc.addPage()
      page++
      doc.rect(0, 0, PW, 32).fill(C.red)
      doc.font('Helvetica-Bold').fontSize(9).fillColor('white')
        .text(`${CO.nom} — ${meta.docType} ${meta.numero} (suite)`, ML, 11, { width: W })
      y = 40
    }

    y = drawTotals(doc, y, totaux.ht, totaux.tva, totaux.ttc)

    // ── Extra section (BTP conditions for devis) ─────────────────────────────
    if (meta.extraFn) {
      if (y + 100 > PAGE_END) {
        drawFooter(doc, page)
        doc.addPage()
        page++
        y = 40
      }
      y = meta.extraFn(doc, y)
    }

    // ── Legal mentions ───────────────────────────────────────────────────────
    if (y + 80 > PAGE_END) {
      drawFooter(doc, page)
      doc.addPage()
      page++
      y = 40
    }
    y = drawLegalMentions(doc, y, totaux.tva)
    y = drawPaymentTerms(doc, y)

    // ── Signature zone ───────────────────────────────────────────────────────
    if (y + 90 > PAGE_END) {
      drawFooter(doc, page)
      doc.addPage()
      page++
      y = 40
    }
    drawSignatureZone(doc, y)

    // ── Footer on last page ──────────────────────────────────────────────────
    drawFooter(doc, page)

    doc.end()
  })
}

// ── Public API ─────────────────────────────────────────────────────────────────

export async function generateFacturePDF(
  facture: PdfFacture,
  client:  PdfClient,
  lignes:  PdfLigne[],
): Promise<Buffer> {
  return buildPdf(
    {
      title:      facture.numero,
      docType:    'FACTURE',
      numero:     facture.numero,
      labelLeft:  'Émission',
      dateLeft:   facture.date_emission,
      labelRight: 'Échéance',
      dateRight:  facture.date_echeance,
    },
    client,
    lignes,
    { ht: facture.total_ht_xaf, tva: facture.tva_xaf, ttc: facture.total_ttc_xaf },
  )
}

export async function generateDevisPDF(
  devis:  PdfDevis,
  client: PdfClient,
  lignes: PdfLigne[],
): Promise<Buffer> {
  return buildPdf(
    {
      title:      devis.numero,
      docType:    'DEVIS',
      numero:     devis.numero,
      labelLeft:  'Émission',
      dateLeft:   devis.date_emission,
      labelRight: `Validité (${devis.validite_jours ?? 30}j)`,
      dateRight:  devis.date_validite,
      extraFn:    drawBtpConditions,
    },
    client,
    lignes,
    { ht: devis.total_ht_xaf, tva: devis.tva_xaf, ttc: devis.total_ttc_xaf },
  )
}

// ── Supabase Storage upload ────────────────────────────────────────────────────

const SIGNED_URL_TTL = 7 * 24 * 3600  // 7 days in seconds

export async function uploadPDF(
  buffer:   Buffer,
  bucket:   string,
  filename: string,
): Promise<string> {
  // supabaseAdmin has storage.createSignedUrl privileges; fall back to anon client
  const client = db

  const { error: upErr } = await client.storage
    .from(bucket)
    .upload(filename, buffer, { contentType: 'application/pdf', upsert: true })

  if (upErr) {
    console.error(`[pdf] storage upload error (${bucket}/${filename}):`, upErr.message)
    // Return public URL as fallback (works if bucket is public)
    return db.storage.from(bucket).getPublicUrl(filename).data.publicUrl
  }

  const { data } = await client.storage
    .from(bucket)
    .createSignedUrl(filename, SIGNED_URL_TTL)

  return data?.signedUrl ?? db.storage.from(bucket).getPublicUrl(filename).data.publicUrl
}
