import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import PDFDocument from 'pdfkit'
import { supabaseAdmin } from '@forge/db'
import { requireRole } from '../middleware/rbac'
import { sendEmailDirect } from '../services/email-queue.service'
import type { HonoVariables } from '../types'

const db = supabaseAdmin!

const router = new Hono<{ Variables: HonoVariables }>()

// ── Schémas Zod ────────────────────────────────────────────────────────────────

const fournisseurSchema = z.object({
  nom:              z.string().min(2),
  telephone:        z.string().optional(),
  email:            z.string().email().optional().or(z.literal('')),
  whatsapp:         z.string().optional(),
  adresse:          z.string().optional(),
  produits_fournis: z.array(z.string()).default([]),
  notes:            z.string().optional(),
  actif:            z.boolean().default(true),
})

const envoyerBonSchema = z.object({
  bon_appro_id:         z.string().uuid(),
  canal:                z.enum(['email', 'whatsapp']),
  message_personnalise: z.string().optional(),
})

// ── Company info (même tokens que pdf.service.ts) ─────────────────────────────

const CO = {
  nom:      'TAFDIL SARL',
  activite: 'Microusine Métallurgique & BTP',
  adresse:  'Kotto Mairyvanas, Douala, Cameroun',
  tel:      '+237 695 884 528',
  email:    'info@tafdil.cm',
} as const

const C = {
  red:    '#C62828',
  dark:   '#111827',
  mid:    '#374151',
  muted:  '#6B7280',
  border: '#E5E7EB',
  gray:   '#F3F4F6',
  white:  '#FFFFFF',
} as const

function fmt(n: number) {
  return new Intl.NumberFormat('fr-CM', { style: 'currency', currency: 'XAF', maximumFractionDigits: 0 }).format(n)
}

// ── Génération PDF bon d'appro ─────────────────────────────────────────────────

interface BonApproLigne {
  designation:  string
  unite:        string
  quantite:     number
  quantite_a_commander?: number
  prix_unitaire_ht_xaf?: number | null
}

interface BonAppro {
  id:              string
  numero:          string
  statut:          string
  fournisseur_nom: string | null
  notes:           string | null
  created_at:      string
  lignes:          BonApproLigne[]
}

async function generateBonApproPdf(bon: BonAppro, fournisseurNom: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc    = new PDFDocument({ size: 'A4', margin: 40 })
    const chunks: Buffer[] = []
    doc.on('data',  (c: Buffer) => chunks.push(c))
    doc.on('end',   () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)

    const ML  = 40
    const PW  = 595
    const W   = 515
    const ROW = 18

    // ── En-tête ───────────────────────────────────────────────────────────────
    doc.rect(0, 0, PW, 72).fill(C.dark)
    doc.fillColor(C.white).fontSize(18).font('Helvetica-Bold')
       .text('TAFDIL SARL', ML, 18)
    doc.fillColor('#EF4444').fontSize(9).font('Helvetica')
       .text(CO.activite, ML, 38)
    doc.fillColor('rgba(255,255,255,0.6)').fontSize(8)
       .text(`${CO.adresse} · ${CO.tel} · ${CO.email}`, ML, 52)

    // Titre document
    doc.fillColor(C.white).fontSize(13).font('Helvetica-Bold')
       .text('BON DE COMMANDE', PW - 220, 22, { width: 180, align: 'right' })
    doc.fillColor('#EF9A9A').fontSize(9).font('Helvetica')
       .text(bon.numero, PW - 220, 40, { width: 180, align: 'right' })

    let y = 90

    // ── Bloc fournisseur ───────────────────────────────────────────────────────
    doc.fillColor(C.gray).rect(ML, y, W, 50).fill()
    doc.fillColor(C.muted).fontSize(8).font('Helvetica-Bold')
       .text('FOURNISSEUR', ML + 8, y + 8)
    doc.fillColor(C.dark).fontSize(10).font('Helvetica-Bold')
       .text(fournisseurNom, ML + 8, y + 20)
    doc.fillColor(C.mid).fontSize(8).font('Helvetica')
       .text(`Date : ${new Date(bon.created_at).toLocaleDateString('fr-FR')}`, PW - 200, y + 8, { width: 160, align: 'right' })
    doc.fillColor(C.mid).fontSize(8)
       .text(`Statut : ${bon.statut}`, PW - 200, y + 22, { width: 160, align: 'right' })

    y += 62

    // ── En-tête tableau ────────────────────────────────────────────────────────
    const COL = { des: ML, qty: ML + 280, uni: ML + 340, pu: ML + 390, tot: ML + 450 }
    doc.rect(ML, y, W, ROW).fill(C.red)
    doc.fillColor(C.white).fontSize(8).font('Helvetica-Bold')
    doc.text('Désignation',  COL.des + 4, y + 5, { width: 270 })
    doc.text('Qté',          COL.qty,     y + 5, { width: 50,  align: 'center' })
    doc.text('Unité',        COL.uni,     y + 5, { width: 48,  align: 'center' })
    doc.text('P.U. HT',      COL.pu,      y + 5, { width: 58,  align: 'right'  })
    doc.text('Total HT',     COL.tot,     y + 5, { width: 62,  align: 'right'  })
    y += ROW

    // ── Lignes ─────────────────────────────────────────────────────────────────
    let totalHt = 0
    bon.lignes.forEach((l, i) => {
      const pu    = l.prix_unitaire_ht_xaf ?? 0
      const quantite = l.quantite_a_commander ?? l.quantite ?? 0
      const total = pu * quantite
      totalHt    += total

      const bg = i % 2 === 0 ? C.white : '#F9FAFB'
      doc.rect(ML, y, W, ROW).fill(bg)
      doc.fillColor(C.dark).fontSize(8).font('Helvetica')
      doc.text(l.designation,                      COL.des + 4, y + 5, { width: 270 })
      doc.text(String(quantite),                   COL.qty,     y + 5, { width: 50,  align: 'center' })
      doc.text(l.unite,                            COL.uni,     y + 5, { width: 48,  align: 'center' })
      doc.text(pu > 0 ? fmt(pu)    : '—',          COL.pu,      y + 5, { width: 58,  align: 'right'  })
      doc.text(total > 0 ? fmt(total) : '—',       COL.tot,     y + 5, { width: 62,  align: 'right'  })

      doc.strokeColor(C.border).lineWidth(0.5)
         .moveTo(ML, y + ROW).lineTo(ML + W, y + ROW).stroke()
      y += ROW
    })

    // ── Total ──────────────────────────────────────────────────────────────────
    y += 6
    if (totalHt > 0) {
      doc.rect(ML + 360, y, W - 360, ROW + 2).fill(C.gray)
      doc.fillColor(C.dark).fontSize(9).font('Helvetica-Bold')
         .text('TOTAL HT :', ML + 360 + 4,  y + 5, { width: 80 })
         .text(fmt(totalHt),                ML + 450, y + 5, { width: 62, align: 'right' })
      y += ROW + 8
    }

    // ── Notes ──────────────────────────────────────────────────────────────────
    if (bon.notes) {
      doc.fillColor(C.muted).fontSize(8).font('Helvetica-Bold').text('Notes :', ML, y)
      doc.fillColor(C.mid).font('Helvetica').text(bon.notes, ML, y + 12, { width: W })
      y += 30
    }

    // ── Pied de page ───────────────────────────────────────────────────────────
    doc.strokeColor(C.border).lineWidth(0.5)
       .moveTo(ML, 758).lineTo(ML + W, 758).stroke()
    doc.fillColor(C.muted).fontSize(7).font('Helvetica')
       .text(`${CO.nom} — ${CO.adresse} — Généré le ${new Date().toLocaleString('fr-FR')}`,
             ML, 763, { width: W, align: 'center' })

    doc.end()
  })
}

// ══════════════════════════════════════════════════════════════════════════════
// ROUTES
// ══════════════════════════════════════════════════════════════════════════════

// GET /fournisseurs — liste des fournisseurs actifs
router.get('/', async (c) => {
  const search = c.req.query('search') ?? ''
  const actif  = c.req.query('actif') !== 'false' // par défaut actifs seulement

  let query = db
    .from('fournisseurs')
    .select('id, nom, telephone, email, whatsapp, adresse, produits_fournis, notes, actif, created_at')
    .order('nom')

  if (actif) query = query.eq('actif', true)
  if (search) {
    query = query.or(`nom.ilike.%${search}%,email.ilike.%${search}%,telephone.ilike.%${search}%`)
  }

  const { data, error } = await query
  if (error) return c.json({ error: error.message }, 500)

  return c.json({ data: data ?? [] })
})

// POST /fournisseurs — créer un fournisseur
router.post(
  '/',
  requireRole(['admin', 'superviseur']),
  zValidator('json', fournisseurSchema),
  async (c) => {
    const body = c.req.valid('json')

    const { data, error } = await db
      .from('fournisseurs')
      .insert({
        nom:              body.nom,
        telephone:        body.telephone ?? null,
        email:            body.email     || null,
        whatsapp:         body.whatsapp  ?? null,
        adresse:          body.adresse   ?? null,
        produits_fournis: body.produits_fournis,
        notes:            body.notes     ?? null,
        actif:            body.actif,
      })
      .select()
      .single()

    if (error) {
      if (error.code === '23505') return c.json({ error: 'Un fournisseur avec ce nom existe déjà', code: 'DUPLICATE' }, 409)
      return c.json({ error: error.message }, 500)
    }

    return c.json(data, 201)
  },
)

// PATCH /fournisseurs/:id — modifier un fournisseur
router.patch(
  '/:id',
  requireRole(['admin', 'superviseur']),
  zValidator('json', fournisseurSchema.partial()),
  async (c) => {
    const { id } = c.req.param()
    const body   = c.req.valid('json')

    const update: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (body.nom              !== undefined) update.nom              = body.nom
    if (body.telephone        !== undefined) update.telephone        = body.telephone
    if (body.email            !== undefined) update.email            = body.email || null
    if (body.whatsapp         !== undefined) update.whatsapp         = body.whatsapp
    if (body.adresse          !== undefined) update.adresse          = body.adresse
    if (body.produits_fournis !== undefined) update.produits_fournis = body.produits_fournis
    if (body.notes            !== undefined) update.notes            = body.notes
    if (body.actif            !== undefined) update.actif            = body.actif

    const { data, error } = await db
      .from('fournisseurs')
      .update(update)
      .eq('id', id)
      .select()
      .single()

    if (error) return c.json({ error: error.message }, 500)
    if (!data)  return c.json({ error: 'Fournisseur introuvable', code: 'NOT_FOUND' }, 404)

    return c.json(data)
  },
)

// DELETE /fournisseurs/:id — désactiver (soft delete)
router.delete(
  '/:id',
  requireRole(['admin']),
  async (c) => {
    const { id } = c.req.param()

    const { error } = await db
      .from('fournisseurs')
      .update({ actif: false, updated_at: new Date().toISOString() })
      .eq('id', id)

    if (error) return c.json({ error: error.message }, 500)

    return c.json({ success: true })
  },
)

// POST /fournisseurs/:id/envoyer-bon — envoyer bon d'appro par email ou WhatsApp
router.post(
  '/:id/envoyer-bon',
  requireRole(['admin', 'superviseur']),
  zValidator('json', envoyerBonSchema),
  async (c) => {
    const { id }  = c.req.param()
    const body    = c.req.valid('json')

    // ── 1. Charger le fournisseur ──────────────────────────────────────────────
    const { data: fournisseur, error: fErr } = await db
      .from('fournisseurs')
      .select('id, nom, email, whatsapp, telephone')
      .eq('id', id)
      .single()

    if (fErr || !fournisseur) return c.json({ error: 'Fournisseur introuvable', code: 'NOT_FOUND' }, 404)

    const f = fournisseur as {
      id: string; nom: string; email: string | null
      whatsapp: string | null; telephone: string | null
    }

    // ── 2. Charger le bon d'approvisionnement ──────────────────────────────────
    const { data: bonRaw, error: bErr } = await db
      .from('bons_approvisionnement')
      .select(`
        id, numero, statut, fournisseur_id, fournisseur_nom, notes, created_at,
        bons_approvisionnement_lignes (
          designation, unite, quantite_a_commander, prix_unitaire_ht_xaf
        )
      `)
      .eq('id', body.bon_appro_id)
      .single()

    if (bErr || !bonRaw) return c.json({ error: 'Bon introuvable', code: 'NOT_FOUND' }, 404)

    const bon = bonRaw as unknown as BonAppro & {
      bons_approvisionnement_lignes: BonApproLigne[]
    }
    bon.lignes = bon.bons_approvisionnement_lignes ?? []

    if (bon.statut !== 'valide') {
      return c.json({
        error: `Impossible d'envoyer un bon au statut "${bon.statut}" (statut requis : valide)`,
        code:  'INVALID_BON_STATUS',
      }, 422)
    }

    const nomFournisseur = f.nom

    // ── 3. Canal email ─────────────────────────────────────────────────────────
    if (body.canal === 'email') {
      if (!f.email) return c.json({ error: 'Ce fournisseur n\'a pas d\'adresse email', code: 'NO_EMAIL' }, 422)

      const pdfBuffer = await generateBonApproPdf(bon, nomFournisseur)

      const lignesResume = bon.lignes
        .map(l => `• ${l.designation} : ${l.quantite_a_commander ?? l.quantite ?? 0} ${l.unite}`)
        .join('<br>')

      const html = `
        <p>Bonjour,</p>
        <p>${body.message_personnalise ?? `Veuillez trouver ci-joint notre bon de commande <strong>${bon.numero}</strong>.`}</p>
        <hr/>
        <p><strong>Articles commandés :</strong><br>${lignesResume}</p>
        <hr/>
        <p>Cordialement,<br><strong>${CO.nom}</strong><br>${CO.tel} · ${CO.email}</p>
      `

      const result = await sendEmailDirect({
        to:      f.email,
        subject: `Bon de commande ${bon.numero} — ${CO.nom}`,
        html,
        attachments: [{
          filename:    `BC-${bon.numero}.pdf`,
          content:     pdfBuffer,
          contentType: 'application/pdf',
        }],
      })

      if (!result.success) {
        return c.json({ error: `Échec envoi email : ${result.error}`, code: 'EMAIL_ERROR' }, 500)
      }

      // Mettre à jour le statut du bon
      await db
        .from('bons_approvisionnement')
        .update({
          statut:          'envoye',
          fournisseur_id:  f.id,
          fournisseur_nom: f.nom,
          updated_at:      new Date().toISOString(),
        })
        .eq('id', body.bon_appro_id)

      return c.json({ success: true, canal: 'email', messageId: result.messageId })
    }

    // ── 4. Canal WhatsApp — lien wa.me ─────────────────────────────────────────
    const waNumber = f.whatsapp ?? f.telephone
    if (!waNumber) return c.json({ error: 'Ce fournisseur n\'a pas de numéro WhatsApp', code: 'NO_WHATSAPP' }, 422)

    const lignesTexte = bon.lignes
      .map(l => `• ${l.designation} : ${l.quantite_a_commander ?? l.quantite ?? 0} ${l.unite}`)
      .join('\n')

    const message = body.message_personnalise
      ?? `Bonjour,\n\nNous souhaitons passer la commande suivante (bon *${bon.numero}*) :\n\n${lignesTexte}\n\nMerci de nous confirmer votre disponibilité.\n\nCordialement,\n*${CO.nom}*`

    const digits  = waNumber.replace(/\D/g, '')
    const waLink  = `https://wa.me/${digits}?text=${encodeURIComponent(message)}`

    // Mettre à jour le statut
    await db
      .from('bons_approvisionnement')
      .update({
        statut:          'envoye',
        fournisseur_id:  f.id,
        fournisseur_nom: f.nom,
        updated_at:      new Date().toISOString(),
      })
      .eq('id', body.bon_appro_id)

    return c.json({ success: true, canal: 'whatsapp', wa_link: waLink })
  },
)

export { router as fournisseursRouter }
