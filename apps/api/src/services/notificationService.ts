/**
 * FORGE ERP — Service Notifications — Module Crédit
 * SMS Africa's Talking pour les événements de crédit et plans de paiement.
 * S'appuie sur sms.service.ts pour le transport.
 */
import { sendSms, normalizePhone } from './sms.service'

const COMPANY = 'TAFDIL SARL'

function xaf(n: number): string {
  return new Intl.NumberFormat('fr-CM', {
    style:               'currency',
    currency:            'XAF',
    maximumFractionDigits: 0,
  }).format(n)
}

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || 'client'
}

// ── Plan créé ─────────────────────────────────────────────────────────────────

export interface CreditPlanCreatedPayload {
  planId:         string
  customerName:   string
  customerPhone?: string | null
  totalAmount:    number
  installments:   Array<{ dueDate: string; amount: number }>
}

export async function notifyCreditPlanCreated(payload: CreditPlanCreatedPayload) {
  if (!payload.customerPhone) return { ok: false, skipped: true }

  const prenom = firstName(payload.customerName)
  const lines  = payload.installments
    .slice(0, 4)
    .map((ins, i) => `${i + 1}) ${ins.dueDate.slice(0, 10)}: ${xaf(ins.amount)}`)
    .join(' | ')

  const message =
    `${COMPANY}: Bonjour ${prenom}, votre plan de paiement ${xaf(payload.totalAmount)} a ete cree. ` +
    `Echeances: ${lines}` +
    (payload.installments.length > 4 ? ` (+${payload.installments.length - 4} autres)` : '') +
    `. Ref: ${payload.planId.slice(0, 8)}`

  console.info('[notif:credit:plan_created]', {
    planId: payload.planId,
    phone:  normalizePhone(payload.customerPhone),
  })
  return sendSms(payload.customerPhone, message)
}

// ── Rappel J-3 ────────────────────────────────────────────────────────────────

export interface CreditReminderPayload {
  customerName:   string
  customerPhone?: string | null
  amountDue:      number
  dueDate:        string
  planId:         string
}

export async function notifyCreditReminder(payload: CreditReminderPayload) {
  if (!payload.customerPhone) return { ok: false, skipped: true }

  const prenom  = firstName(payload.customerName)
  const message =
    `${COMPANY}: Bonjour ${prenom}, rappel — une echeance de ${xaf(payload.amountDue)} ` +
    `est prevue le ${payload.dueDate.slice(0, 10)}. ` +
    `Ref plan: ${payload.planId.slice(0, 8)}. Merci de votre ponctualite.`

  console.info('[notif:credit:reminder]', {
    planId:  payload.planId,
    dueDate: payload.dueDate,
    phone:   normalizePhone(payload.customerPhone),
  })
  return sendSms(payload.customerPhone, message)
}

// ── Échéance en retard ────────────────────────────────────────────────────────

export interface OverdueInstallmentPayload {
  customerName:   string
  customerPhone?: string | null
  amountDue:      number
  daysLate:       number
  planId:         string
}

export async function notifyOverdueInstallment(payload: OverdueInstallmentPayload) {
  const prenom = firstName(payload.customerName)

  // SMS client
  if (payload.customerPhone) {
    const message =
      `${COMPANY}: Bonjour ${prenom}, votre echeance de ${xaf(payload.amountDue)} ` +
      `est en retard de ${payload.daysLate} jour(s). ` +
      `Veuillez regulariser rapidement. Contact: +237 6XX XXX XXX. ` +
      `Ref: ${payload.planId.slice(0, 8)}`

    console.warn('[notif:credit:overdue]', {
      planId:   payload.planId,
      daysLate: payload.daysLate,
      amount:   payload.amountDue,
      phone:    normalizePhone(payload.customerPhone),
    })
    await sendSms(payload.customerPhone, message)
  }

  // Notification interne (console ou webhook configurable)
  const webhookUrl = process.env.CREDIT_OVERDUE_WEBHOOK_URL
  if (webhookUrl) {
    try {
      await fetch(webhookUrl, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          event:       'credit.overdue',
          planId:      payload.planId,
          customer:    payload.customerName,
          amountDue:   payload.amountDue,
          daysLate:    payload.daysLate,
          timestamp:   new Date().toISOString(),
        }),
        signal: AbortSignal.timeout(5_000),
      })
    } catch (e) {
      console.warn('[notif:credit:overdue] webhook échec', { error: (e as Error).message })
    }
  } else {
    console.warn('[notif:credit:overdue] INTERNE', {
      customer: payload.customerName,
      planId:   payload.planId,
      amountDue: payload.amountDue,
      daysLate: payload.daysLate,
    })
  }

  return { ok: true }
}

// ── Paiement reçu ─────────────────────────────────────────────────────────────

export interface PaymentReceivedPayload {
  customerName:     string
  customerPhone?:   string | null
  amountPaid:       number
  remainingBalance: number
  planId:           string
}

export async function notifyPaymentReceived(payload: PaymentReceivedPayload) {
  if (!payload.customerPhone) return { ok: false, skipped: true }

  const prenom  = firstName(payload.customerName)
  const solde   = payload.remainingBalance > 0
    ? `Solde restant: ${xaf(payload.remainingBalance)}.`
    : 'Plan entierement solde. Merci!'

  const message =
    `${COMPANY}: Bonjour ${prenom}, paiement de ${xaf(payload.amountPaid)} bien recu. ` +
    `${solde} Ref: ${payload.planId.slice(0, 8)}`

  console.info('[notif:credit:payment_received]', {
    planId:    payload.planId,
    amount:    payload.amountPaid,
    remaining: payload.remainingBalance,
    phone:     normalizePhone(payload.customerPhone),
  })
  return sendSms(payload.customerPhone, message)
}

// ── Cron rappels J-3 (appelé par le scheduler) ────────────────────────────────

import { supabaseAdmin } from '@forge/db'

export async function sendUpcomingReminders(): Promise<{ sent: number; errors: string[] }> {
  const db     = supabaseAdmin!
  const errors: string[] = []
  let   sent   = 0

  const target = new Date()
  target.setDate(target.getDate() + 3)
  const targetDate = target.toISOString().slice(0, 10)

  const { data: upcoming, error } = await db
    .from('payment_installments')
    .select('id, due_date, amount_due, payment_plans(customer_id, clients(nom, telephone))')
    .eq('due_date', targetDate)
    .in('status', ['PENDING', 'PARTIAL'])

  if (error) {
    console.error('[notif:credit:cron:reminders] erreur', { error: error.message })
    return { sent: 0, errors: [error.message] }
  }

  for (const row of (upcoming ?? []) as Array<Record<string, unknown>>) {
    try {
      const plan   = (row.payment_plans as Record<string, unknown>)
      const client = (plan?.clients as Record<string, unknown>)
      if (!client) continue

      await notifyCreditReminder({
        customerName:  client.nom as string,
        customerPhone: client.telephone as string | undefined,
        amountDue:     row.amount_due as number,
        dueDate:       row.due_date   as string,
        planId:        plan.id as string ?? '',
      })
      sent++
    } catch (e) {
      errors.push((e as Error).message)
    }
  }

  console.info('[notif:credit:cron:reminders] ✅', { sent, errors: errors.length, date: targetDate })
  return { sent, errors }
}
