import { supabaseAdmin } from '@forge/db'
import nodemailer from 'nodemailer'

const db = supabaseAdmin!

export interface EnqueueEmailPayload {
  destinataire:   string
  sujet:          string
  corps_html:     string
  priorite?:      'critique' | 'haute' | 'normale' | 'basse'
  scheduled_at?:  string      // ISO — défaut: maintenant
  reference_type?: string
  reference_id?:   string
}

/** Ajoute un email à la file d'attente. */
export async function enqueueEmail(payload: EnqueueEmailPayload): Promise<void> {
  await db.from('email_queue').insert({
    destinataire:   payload.destinataire,
    sujet:          payload.sujet,
    corps_html:     payload.corps_html,
    priorite:       payload.priorite ?? 'normale',
    scheduled_at:   payload.scheduled_at ?? new Date().toISOString(),
    reference_type: payload.reference_type ?? null,
    reference_id:   payload.reference_id   ?? null,
    statut:         'en_attente',
  })
}

/**
 * Traite le batch d'emails en attente.
 * Appelé par le cron toutes les 4h.
 * Priorité : critique → haute → normale → basse
 * Max 5 par batch (marge de sécurité Supabase / Nodemailer).
 */
export async function processBatchEmails(maxBatch = 5): Promise<{ sent: number; failed: number }> {
  const smtpHost = process.env.SMTP_HOST
  const smtpUser = process.env.SMTP_USER
  const smtpPass = process.env.SMTP_PASS

  if (!smtpHost || !smtpUser || !smtpPass) {
    console.warn('[email-queue] SMTP non configuré — batch ignoré')
    return { sent: 0, failed: 0 }
  }

  const transporter = nodemailer.createTransport({
    host:   smtpHost,
    port:   Number(process.env.SMTP_PORT ?? 587),
    secure: process.env.SMTP_SECURE === 'true',
    auth:   { user: smtpUser, pass: smtpPass },
  })

  const now = new Date().toISOString()
  const { data: pending } = await db
    .from('email_queue')
    .select('*')
    .eq('statut', 'en_attente')
    .lte('scheduled_at', now)
    .lt('tentatives', 3)
    .order('priorite', { ascending: true })   // critique < haute < normale < basse (alpha)
    .order('scheduled_at', { ascending: true })
    .limit(maxBatch)

  if (!pending?.length) return { sent: 0, failed: 0 }

  let sent = 0, failed = 0

  for (const email of pending) {
    const e = email as {
      id: string; destinataire: string; sujet: string
      corps_html: string; tentatives: number
    }
    try {
      await transporter.sendMail({
        from:    `FORGE ERP <${smtpUser}>`,
        to:      e.destinataire,
        subject: e.sujet,
        html:    e.corps_html,
      })
      await db.from('email_queue').update({
        statut:   'envoye',
        sent_at:  new Date().toISOString(),
        tentatives: e.tentatives + 1,
      }).eq('id', e.id)
      sent++
    } catch (err) {
      const newTentatives = e.tentatives + 1
      await db.from('email_queue').update({
        tentatives: newTentatives,
        statut:     newTentatives >= 3 ? 'echec' : 'en_attente',
        erreur:     String(err),
      }).eq('id', e.id)
      failed++
      console.error(`[email-queue] Échec envoi ${e.id}:`, err)
    }
  }

  console.info(`[email-queue] Batch terminé — envoyés: ${sent}, échecs: ${failed}`)
  return { sent, failed }
}

/** Notification WhatsApp de secours (CallMeBot). */
export async function notifyWhatsApp(phone: string, message: string): Promise<void> {
  const apiKey = process.env.CALLMEBOT_APIKEY
  if (!apiKey || !phone) return

  const url = `https://api.callmebot.com/whatsapp.php?phone=${phone}&text=${encodeURIComponent(message)}&apikey=${apiKey}`
  try {
    const res = await fetch(url)
    if (!res.ok) console.warn('[whatsapp] Réponse non-OK:', res.status)
  } catch (e) {
    console.error('[whatsapp] Erreur envoi:', e)
  }
}
