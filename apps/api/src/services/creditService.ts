/**
 * FORGE ERP — Service Crédit / Plans de paiement
 * Logique métier : éligibilité, création de plans, enregistrement de paiements,
 * détection des impayés (cron).
 *
 * Toutes les opérations financières sont loguées (console.info/warn/error JSON).
 * Montants toujours en entiers FCFA.
 */
import { supabaseAdmin } from '@forge/db'
import type { PaymentMethod, EligibilityType } from '@forge/db'
import { notifyCreditPlanCreated, notifyPaymentReceived, notifyOverdueInstallment } from './notificationService'

const db = supabaseAdmin!

// ── Types internes ────────────────────────────────────────────────────────────

export interface EligibilityResult {
  eligible: boolean
  availableCredit: number
  reason?: string
  details: {
    accountAgeMonths: number
    completedOrdersCount: number
    outstandingBalance: number
    creditLimit: number
    outstandingRatio: number
  }
}

export interface CreatePlanInput {
  orderId: string
  customerId: string
  totalAmount: number
  installmentsCount: 2 | 3 | 4 | 6
  firstPaymentPercent: number   // 0–100
  createdBy: string
}

export interface RecordPaymentInput {
  installmentId: string
  amount: number
  method: PaymentMethod
  notes?: string
}

// ── checkEligibility ──────────────────────────────────────────────────────────

export async function checkEligibility(customerId: string): Promise<EligibilityResult> {
  // 1. Récupérer le client
  const { data: client, error: clientErr } = await db
    .from('clients')
    .select('id, nom, type, statut, created_at, encours_credit_xaf, commandes_count')
    .eq('id', customerId)
    .single()

  if (clientErr || !client) {
    console.warn('[credit:eligibility] client introuvable', { customerId, error: clientErr?.message })
    return {
      eligible: false,
      availableCredit: 0,
      reason: 'Client introuvable',
      details: { accountAgeMonths: 0, completedOrdersCount: 0, outstandingBalance: 0, creditLimit: 0, outstandingRatio: 0 },
    }
  }

  if ((client as Record<string, unknown>).statut === 'bloque') {
    return {
      eligible: false,
      availableCredit: 0,
      reason: 'Compte client bloqué',
      details: { accountAgeMonths: 0, completedOrdersCount: 0, outstandingBalance: 0, creditLimit: 0, outstandingRatio: 0 },
    }
  }

  // 2. Ancienneté du compte (en mois)
  const createdAt = new Date((client as Record<string, unknown>).created_at as string)
  const accountAgeMonths = Math.floor(
    (Date.now() - createdAt.getTime()) / (1000 * 60 * 60 * 24 * 30),
  )

  // 3. Nombre de commandes livrées (completed)
  const { count: completedOrdersCount } = await db
    .from('commandes')
    .select('id', { count: 'exact', head: true })
    .eq('client_id', customerId)
    .eq('statut', 'delivered')

  // 4. Plafond crédit actif
  const { data: limitRow } = await db
    .from('customer_credit_limits')
    .select('max_credit_amount, min_order_history_months, min_past_orders_count, eligibility_type')
    .eq('customer_id', customerId)
    .eq('is_active', true)
    .maybeSingle()

  const creditLimit = (limitRow as Record<string, unknown> | null)?.max_credit_amount as number ?? 0
  if (creditLimit <= 0) {
    return {
      eligible: false,
      availableCredit: 0,
      reason: 'Aucun plafond de crédit actif configuré pour ce client',
      details: { accountAgeMonths, completedOrdersCount: completedOrdersCount ?? 0, outstandingBalance: 0, creditLimit: 0, outstandingRatio: 0 },
    }
  }

  // 5. Règles d'éligibilité
  const clientType = (client as Record<string, unknown>).type as string
  const appliesTo  = clientType === 'entreprise' ? 'PROFESSIONAL' : 'INDIVIDUAL'

  const { data: rules } = await db
    .from('credit_eligibility_rules')
    .select('*')
    .eq('is_active', true)
    .in('applies_to', ['ALL', appliesTo])
    .order('applies_to', { ascending: false }) // PROFESSIONAL/INDIVIDUAL priment sur ALL

  const rule = (rules as unknown[] | null)?.[0] as Record<string, unknown> | null

  const minAgeMonths    = (limitRow as Record<string, unknown> | null)?.min_order_history_months as number
                          ?? (rule?.min_account_age_months as number)
                          ?? 3
  const minOrders       = (limitRow as Record<string, unknown> | null)?.min_past_orders_count as number
                          ?? (rule?.min_completed_orders as number)
                          ?? 5
  const maxRatio        = parseFloat(String(rule?.max_outstanding_ratio ?? 0.5))

  // 6. Encours actuel (plans ACTIVE)
  const { data: activePlans } = await db
    .from('payment_plans')
    .select('outstanding_balance')
    .eq('customer_id', customerId)
    .eq('status', 'ACTIVE')

  const outstandingBalance = ((activePlans ?? []) as Array<Record<string, unknown>>)
    .reduce((s, p) => s + (p.outstanding_balance as number), 0)

  const outstandingRatio = creditLimit > 0 ? outstandingBalance / creditLimit : 1

  // 7. Vérifications
  if (accountAgeMonths < minAgeMonths) {
    return {
      eligible: false,
      availableCredit: 0,
      reason: `Ancienneté insuffisante (${accountAgeMonths} mois / minimum ${minAgeMonths})`,
      details: { accountAgeMonths, completedOrdersCount: completedOrdersCount ?? 0, outstandingBalance, creditLimit, outstandingRatio },
    }
  }

  if ((completedOrdersCount ?? 0) < minOrders) {
    return {
      eligible: false,
      availableCredit: 0,
      reason: `Nombre de commandes insuffisant (${completedOrdersCount} / minimum ${minOrders})`,
      details: { accountAgeMonths, completedOrdersCount: completedOrdersCount ?? 0, outstandingBalance, creditLimit, outstandingRatio },
    }
  }

  if (outstandingRatio >= maxRatio) {
    return {
      eligible: false,
      availableCredit: 0,
      reason: `Ratio d'encours dépassé (${Math.round(outstandingRatio * 100)}% / max ${Math.round(maxRatio * 100)}%)`,
      details: { accountAgeMonths, completedOrdersCount: completedOrdersCount ?? 0, outstandingBalance, creditLimit, outstandingRatio },
    }
  }

  const availableCredit = Math.max(0, Math.floor(creditLimit * maxRatio) - outstandingBalance)

  console.info('[credit:eligibility] ✅ éligible', {
    customerId,
    accountAgeMonths,
    completedOrders: completedOrdersCount,
    creditLimit,
    outstandingBalance,
    availableCredit,
  })

  return {
    eligible: true,
    availableCredit,
    details: { accountAgeMonths, completedOrdersCount: completedOrdersCount ?? 0, outstandingBalance, creditLimit, outstandingRatio },
  }
}

// ── createPaymentPlan ─────────────────────────────────────────────────────────

export async function createPaymentPlan(input: CreatePlanInput) {
  const { orderId, customerId, totalAmount, installmentsCount, firstPaymentPercent, createdBy } = input

  if (totalAmount <= 0) throw new Error('Le montant total doit être positif')
  if (firstPaymentPercent < 0 || firstPaymentPercent > 100) throw new Error('Pourcentage invalide (0–100)')

  // Vérifier éligibilité
  const elig = await checkEligibility(customerId)
  if (!elig.eligible) throw new Error(`Client non éligible : ${elig.reason}`)

  // Calcul des montants (entiers FCFA)
  const firstAmount    = Math.round(totalAmount * firstPaymentPercent / 100)
  const remaining      = totalAmount - firstAmount
  const perInstallment = installmentsCount > 1
    ? Math.floor(remaining / (installmentsCount - 1))
    : remaining
  const lastAdjustment = remaining - perInstallment * (installmentsCount - 1)

  // Création du plan
  const { data: plan, error: planErr } = await db
    .from('payment_plans')
    .insert({
      order_id:            orderId,
      customer_id:         customerId,
      total_amount:        totalAmount,
      outstanding_balance: totalAmount,
      status:              'ACTIVE',
      created_by:          createdBy,
    })
    .select()
    .single()

  if (planErr || !plan) {
    console.error('[credit:createPlan] erreur création plan', { error: planErr?.message, input })
    throw new Error(`Erreur création plan : ${planErr?.message}`)
  }

  // Génération des échéances
  const today       = new Date()
  const installments = []

  for (let i = 0; i < installmentsCount; i++) {
    const dueDate = new Date(today)
    dueDate.setMonth(dueDate.getMonth() + i)
    const isLast     = i === installmentsCount - 1
    let   amount     = i === 0 ? firstAmount : perInstallment
    if (isLast && installmentsCount > 1) amount += lastAdjustment // absorb rounding diff

    installments.push({
      payment_plan_id:    (plan as Record<string, unknown>).id,
      installment_number: i + 1,
      due_date:           dueDate.toISOString().slice(0, 10),
      amount_due:         amount,
      amount_paid:        0,
      status:             i === 0 && firstPaymentPercent === 100 ? 'PAID' : 'PENDING',
    })
  }

  const { error: instErr } = await db.from('payment_installments').insert(installments)
  if (instErr) {
    console.error('[credit:createPlan] erreur création échéances', { error: instErr.message })
    throw new Error(`Erreur création échéances : ${instErr.message}`)
  }

  // Récupérer les infos du client pour la notif SMS
  const { data: clientInfo } = await db
    .from('clients')
    .select('nom, telephone')
    .eq('id', customerId)
    .single()

  console.info('[credit:createPlan] ✅ plan créé', {
    planId:          (plan as Record<string, unknown>).id,
    customerId,
    orderId,
    totalAmount,
    installmentsCount,
  })

  // Notification SMS (fire-and-forget)
  if (clientInfo) {
    const c = clientInfo as { nom: string; telephone?: string }
    notifyCreditPlanCreated({
      planId:         (plan as Record<string, unknown>).id as string,
      customerName:   c.nom,
      customerPhone:  c.telephone,
      totalAmount,
      installments:   installments.map(ins => ({ dueDate: ins.due_date, amount: ins.amount_due })),
    }).catch(e => console.warn('[credit:createPlan] SMS échec', { error: (e as Error).message }))
  }

  return { plan, installments }
}

// ── recordPayment ─────────────────────────────────────────────────────────────

export async function recordPayment(input: RecordPaymentInput) {
  const { installmentId, amount, method, notes } = input

  if (amount <= 0) throw new Error('Le montant du paiement doit être positif')

  // Récupérer l'échéance
  const { data: installment, error: instErr } = await db
    .from('payment_installments')
    .select('*, payment_plans(id, customer_id, total_amount, outstanding_balance, status)')
    .eq('id', installmentId)
    .single()

  if (instErr || !installment) throw new Error('Échéance introuvable')

  const inst = installment as Record<string, unknown>
  if (inst.status === 'PAID') throw new Error('Cette échéance est déjà entièrement payée')

  const amountDue    = inst.amount_due  as number
  const amountPaid   = (inst.amount_paid as number) + amount
  const newStatus    = amountPaid >= amountDue ? 'PAID' : 'PARTIAL'

  // Mise à jour de l'échéance
  const { error: updateErr } = await db
    .from('payment_installments')
    .update({
      amount_paid:    amountPaid,
      paid_at:        newStatus === 'PAID' ? new Date().toISOString() : null,
      payment_method: method,
      status:         newStatus,
      notes:          notes ?? null,
      updated_at:     new Date().toISOString(),
    })
    .eq('id', installmentId)

  if (updateErr) {
    console.error('[credit:recordPayment] erreur mise à jour échéance', { error: updateErr.message, installmentId })
    throw new Error(`Erreur mise à jour : ${updateErr.message}`)
  }

  // Recalculer l'encours total du plan
  const plan     = (inst.payment_plans as Record<string, unknown>)
  const planId   = plan.id as string

  const { data: allInstallments } = await db
    .from('payment_installments')
    .select('amount_due, amount_paid, status')
    .eq('payment_plan_id', planId)

  const insts = (allInstallments ?? []) as Array<{ amount_due: number; amount_paid: number; status: string }>
  const newOutstanding = insts.reduce((s, i) => s + Math.max(0, i.amount_due - i.amount_paid), 0)
  const allPaid        = insts.every(i => i.status === 'PAID')
  const hasOverdue     = insts.some(i => i.status === 'OVERDUE')
  const newPlanStatus  = allPaid ? 'COMPLETED' : hasOverdue ? 'OVERDUE' : 'ACTIVE'

  const { error: planErr } = await db
    .from('payment_plans')
    .update({
      outstanding_balance: newOutstanding,
      status:              newPlanStatus,
      updated_at:          new Date().toISOString(),
    })
    .eq('id', planId)

  if (planErr) {
    console.error('[credit:recordPayment] erreur mise à jour plan', { error: planErr.message, planId })
  }

  console.info('[credit:recordPayment] ✅ paiement enregistré', {
    installmentId,
    amount,
    method,
    newStatus,
    newOutstanding,
    planId,
  })

  // Notification SMS confirmation (fire-and-forget)
  const customerId = plan.customer_id as string
  const { data: clientInfo } = await db
    .from('clients')
    .select('nom, telephone')
    .eq('id', customerId)
    .single()

  if (clientInfo) {
    const c = clientInfo as { nom: string; telephone?: string }
    notifyPaymentReceived({
      customerName:   c.nom,
      customerPhone:  c.telephone,
      amountPaid:     amount,
      remainingBalance: newOutstanding,
      planId,
    }).catch(e => console.warn('[credit:recordPayment] SMS échec', { error: (e as Error).message }))
  }

  return { newStatus, newOutstanding, planStatus: newPlanStatus }
}

// ── checkOverdueInstallments (cron) ───────────────────────────────────────────

export async function checkOverdueInstallments(): Promise<{ marked: number; errors: string[] }> {
  const today  = new Date().toISOString().slice(0, 10)
  const errors: string[] = []

  const { data: overdueRows, error } = await db
    .from('payment_installments')
    .select('id, payment_plan_id, due_date, amount_due, amount_paid, payment_plans(customer_id, customers:clients(nom, telephone))')
    .lt('due_date', today)
    .in('status', ['PENDING', 'PARTIAL'])

  if (error) {
    console.error('[credit:cron:overdue] erreur lecture échéances', { error: error.message })
    return { marked: 0, errors: [error.message] }
  }

  const rows   = (overdueRows ?? []) as Array<Record<string, unknown>>
  let   marked = 0

  for (const row of rows) {
    const { error: upErr } = await db
      .from('payment_installments')
      .update({ status: 'OVERDUE', updated_at: new Date().toISOString() })
      .eq('id', row.id)

    if (upErr) {
      errors.push(`installment ${row.id}: ${upErr.message}`)
      continue
    }

    // Mettre le plan en OVERDUE
    await db
      .from('payment_plans')
      .update({ status: 'OVERDUE', updated_at: new Date().toISOString() })
      .eq('id', row.payment_plan_id)
      .eq('status', 'ACTIVE')

    marked++

    // Notification SMS (fire-and-forget)
    const plan   = (row.payment_plans as Record<string, unknown>)
    const client = (plan?.customers as Record<string, unknown>)
    if (client) {
      const daysLate = Math.floor(
        (Date.now() - new Date(row.due_date as string).getTime()) / (1000 * 60 * 60 * 24),
      )
      notifyOverdueInstallment({
        customerName:  client.nom as string,
        customerPhone: client.telephone as string | undefined,
        amountDue:     (row.amount_due as number) - (row.amount_paid as number),
        daysLate,
        planId:        row.payment_plan_id as string,
      }).catch(e => console.warn('[credit:cron:overdue] SMS échec', { error: (e as Error).message }))
    }
  }

  console.info('[credit:cron:overdue] ✅', { marked, errors: errors.length, date: today })
  return { marked, errors }
}
