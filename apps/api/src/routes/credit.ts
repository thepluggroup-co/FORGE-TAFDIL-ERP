/**
 * FORGE ERP — Routes API Crédit / Plans de paiement
 * Hono router avec validation Zod.
 * Auth requise sur toutes les routes (appliquée dans app.ts via api.use('*', authMiddleware)).
 * RBAC : admin pour plafonds/règles, user (opérateur+) pour paiements.
 */
import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { supabaseAdmin } from '@forge/db'
import { requireRole } from '../middleware/rbac'
import type { HonoVariables } from '../types'
import {
  checkEligibility,
  createPaymentPlan,
  recordPayment,
  checkOverdueInstallments,
} from '../services/creditService'

const router = new Hono<{ Variables: HonoVariables }>()
const db = supabaseAdmin!

// ── Schemas Zod ───────────────────────────────────────────────────────────────

const creditLimitSchema = z.object({
  customer_id:              z.string().uuid(),
  max_credit_amount:        z.number().int().min(0),
  eligibility_type:         z.enum(['PROFESSIONAL', 'INDIVIDUAL', 'VIP']),
  min_order_history_months: z.number().int().min(0).default(3),
  min_past_orders_count:    z.number().int().min(0).default(5),
  is_active:                z.boolean().default(true),
})

const createPlanSchema = z.object({
  order_id:              z.string().uuid(),
  customer_id:           z.string().uuid(),
  total_amount:          z.number().int().positive(),
  installments_count:    z.union([z.literal(2), z.literal(3), z.literal(4), z.literal(6)]),
  first_payment_percent: z.number().min(0).max(100).default(30),
})

const recordPaymentSchema = z.object({
  amount: z.number().int().positive(),
  method: z.enum(['CASH', 'MOBILE_MONEY', 'ORANGE_MONEY', 'MTN_MOMO', 'TRANSFER', 'CHECK']),
  notes:  z.string().optional(),
})

const eligibilityRuleSchema = z.object({
  rule_name:              z.string().min(1),
  min_account_age_months: z.number().int().min(0).default(3),
  min_completed_orders:   z.number().int().min(0).default(5),
  min_order_amount_fcfa:  z.number().int().min(0).default(0),
  max_outstanding_ratio:  z.number().min(0).max(1).default(0.5),
  applies_to:             z.enum(['ALL', 'PROFESSIONAL', 'INDIVIDUAL']).default('ALL'),
  is_active:              z.boolean().default(true),
})

// ═══════════════════════════════════════════════════════════════════════════════
// PLAFONDS DE CRÉDIT
// ═══════════════════════════════════════════════════════════════════════════════

// GET /credit/limits/:customerId
router.get('/limits/:customerId', async (c) => {
  const { customerId } = c.req.param()

  const { data, error } = await db
    .from('customer_credit_limits')
    .select('*')
    .eq('customer_id', customerId)
    .order('created_at', { ascending: false })

  if (error) {
    console.error('[credit:limits:get]', { error: error.message, customerId })
    return c.json({ error: 'Erreur lecture plafond', code: 'DB_ERROR' }, 500)
  }

  return c.json({ data: data ?? [] })
})

// POST /credit/limits — admin only
router.post('/limits', requireRole(['admin']), zValidator('json', creditLimitSchema), async (c) => {
  const user  = c.get('user')
  const body  = c.req.valid('json')

  // Désactiver l'éventuel plafond actif existant
  await db
    .from('customer_credit_limits')
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq('customer_id', body.customer_id)
    .eq('is_active', true)

  const { data, error } = await db
    .from('customer_credit_limits')
    .insert({
      customer_id:              body.customer_id,
      max_credit_amount:        body.max_credit_amount,
      eligibility_type:         body.eligibility_type,
      min_order_history_months: body.min_order_history_months,
      min_past_orders_count:    body.min_past_orders_count,
      is_active:                body.is_active,
      created_by:               user.id,
    })
    .select()
    .single()

  if (error) {
    console.error('[credit:limits:post]', { error: error.message, customerId: body.customer_id })
    return c.json({ error: 'Erreur création plafond', code: 'DB_ERROR' }, 500)
  }

  console.info('[credit:limits:post] ✅', { customerId: body.customer_id, limit: body.max_credit_amount, by: user.id })
  return c.json({ data }, 201)
})

// GET /credit/limits/:customerId/check
router.get('/limits/:customerId/check', async (c) => {
  const { customerId } = c.req.param()

  try {
    const result = await checkEligibility(customerId)
    return c.json(result)
  } catch (e) {
    console.error('[credit:limits:check]', { error: (e as Error).message, customerId })
    return c.json({ error: 'Erreur vérification éligibilité', code: 'ELIGIBILITY_ERROR' }, 500)
  }
})

// ═══════════════════════════════════════════════════════════════════════════════
// PLANS DE PAIEMENT
// ═══════════════════════════════════════════════════════════════════════════════

// POST /credit/plans
router.post('/plans', requireRole(['admin', 'superviseur', 'operateur']), zValidator('json', createPlanSchema), async (c) => {
  const user = c.get('user')
  const body = c.req.valid('json')

  try {
    const result = await createPaymentPlan({
      orderId:             body.order_id,
      customerId:          body.customer_id,
      totalAmount:         body.total_amount,
      installmentsCount:   body.installments_count as 2 | 3 | 4 | 6,
      firstPaymentPercent: body.first_payment_percent,
      createdBy:           user.id,
    })
    return c.json(result, 201)
  } catch (e) {
    const msg = (e as Error).message
    console.warn('[credit:plans:post]', { error: msg, userId: user.id })
    return c.json({ error: msg, code: 'PLAN_CREATION_ERROR' }, 422)
  }
})

// GET /credit/plans/:planId
router.get('/plans/:planId', async (c) => {
  const { planId } = c.req.param()

  const { data, error } = await db
    .from('payment_plans')
    .select('*, clients(id, nom, telephone), commandes(id, numero, total_ttc_xaf)')
    .eq('id', planId)
    .single()

  if (error || !data) return c.json({ error: 'Plan introuvable', code: 'NOT_FOUND' }, 404)
  return c.json({ data })
})

// GET /credit/plans?customerId=&status=
router.get('/plans', async (c) => {
  const customerId = c.req.query('customerId')
  const status     = c.req.query('status')
  const page       = Math.max(1, parseInt(c.req.query('page') ?? '1'))
  const perPage    = Math.min(100, parseInt(c.req.query('perPage') ?? '20'))
  const from       = (page - 1) * perPage
  const to         = from + perPage - 1

  let query = db
    .from('payment_plans')
    .select('*, clients(id, nom), commandes(id, numero)', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(from, to)

  if (customerId) query = query.eq('customer_id', customerId)
  if (status)     query = query.eq('status', status)

  const { data, error, count } = await query

  if (error) {
    console.error('[credit:plans:list]', { error: error.message })
    return c.json({ error: 'Erreur lecture plans', code: 'DB_ERROR' }, 500)
  }

  return c.json({ data: data ?? [], total: count ?? 0, page, perPage })
})

// PATCH /credit/plans/:planId/cancel — admin only
router.patch('/plans/:planId/cancel', requireRole(['admin', 'superviseur']), async (c) => {
  const { planId } = c.req.param()
  const user       = c.get('user')

  const { data: plan } = await db
    .from('payment_plans')
    .select('status')
    .eq('id', planId)
    .single()

  if (!plan) return c.json({ error: 'Plan introuvable', code: 'NOT_FOUND' }, 404)
  if ((plan as Record<string, unknown>).status === 'COMPLETED') {
    return c.json({ error: 'Un plan terminé ne peut pas être annulé', code: 'INVALID_STATUS' }, 422)
  }

  const { error } = await db
    .from('payment_plans')
    .update({ status: 'CANCELLED', updated_at: new Date().toISOString() })
    .eq('id', planId)

  if (error) return c.json({ error: 'Erreur annulation', code: 'DB_ERROR' }, 500)

  console.info('[credit:plans:cancel]', { planId, by: user.id })
  return c.json({ ok: true })
})

// ═══════════════════════════════════════════════════════════════════════════════
// VERSEMENTS
// ═══════════════════════════════════════════════════════════════════════════════

// POST /credit/plans/:planId/installments/:installmentId/pay
router.post(
  '/plans/:planId/installments/:installmentId/pay',
  requireRole(['admin', 'superviseur', 'operateur']),
  zValidator('json', recordPaymentSchema),
  async (c) => {
    const { installmentId } = c.req.param()
    const body = c.req.valid('json')

    try {
      const result = await recordPayment({
        installmentId,
        amount: body.amount,
        method: body.method,
        notes:  body.notes,
      })
      return c.json(result)
    } catch (e) {
      const msg = (e as Error).message
      console.warn('[credit:installments:pay]', { error: msg, installmentId })
      return c.json({ error: msg, code: 'PAYMENT_ERROR' }, 422)
    }
  },
)

// GET /credit/plans/:planId/installments
router.get('/plans/:planId/installments', async (c) => {
  const { planId } = c.req.param()

  const { data, error } = await db
    .from('payment_installments')
    .select('*')
    .eq('payment_plan_id', planId)
    .order('installment_number', { ascending: true })

  if (error) return c.json({ error: 'Erreur lecture échéances', code: 'DB_ERROR' }, 500)
  return c.json({ data: data ?? [] })
})

// ═══════════════════════════════════════════════════════════════════════════════
// TABLEAU DE BORD CRÉANCES
// ═══════════════════════════════════════════════════════════════════════════════

// GET /credit/dashboard
router.get('/dashboard', requireRole(['admin', 'superviseur']), async (c) => {
  const [plansRes, overdueRes, totalRes] = await Promise.all([
    // Plans actifs
    db.from('payment_plans').select('customer_id, outstanding_balance', { count: 'exact' }).eq('status', 'ACTIVE'),
    // Clients en retard
    db.from('payment_plans').select('customer_id', { count: 'exact' }).eq('status', 'OVERDUE'),
    // Total décaissé (montant original de tous les plans créés)
    db.from('payment_plans').select('total_amount, outstanding_balance').neq('status', 'CANCELLED'),
  ])

  const activePlans   = (plansRes.data ?? []) as Array<{ outstanding_balance: number; customer_id: string }>
  const totalEncours  = activePlans.reduce((s, p) => s + p.outstanding_balance, 0)
  const activeClients = new Set(activePlans.map(p => p.customer_id)).size
  const overdueCount  = plansRes.error ? 0 : (overdueRes.count ?? 0)

  const allPlans   = (totalRes.data ?? []) as Array<{ total_amount: number; outstanding_balance: number }>
  const totalIssued = allPlans.reduce((s, p) => s + p.total_amount, 0)
  const totalPaid   = allPlans.reduce((s, p) => s + (p.total_amount - p.outstanding_balance), 0)
  const recoveryRate = totalIssued > 0 ? Math.round((totalPaid / totalIssued) * 100) : 0

  // Encours par mois (6 derniers mois)
  const sixMonthsAgo = new Date()
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6)

  const { data: monthlyData } = await db
    .from('payment_installments')
    .select('amount_paid, paid_at')
    .gte('paid_at', sixMonthsAgo.toISOString())
    .eq('status', 'PAID')

  const monthlyMap: Record<string, number> = {}
  for (const row of (monthlyData ?? []) as Array<{ amount_paid: number; paid_at: string }>) {
    const month = row.paid_at.slice(0, 7) // 'YYYY-MM'
    monthlyMap[month] = (monthlyMap[month] ?? 0) + row.amount_paid
  }
  const monthlyTrend = Object.entries(monthlyMap)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, amount]) => ({ month, amount }))

  return c.json({
    totalEncours,
    activeClients,
    overdueCount,
    recoveryRate,
    monthlyTrend,
  })
})

// GET /credit/overdue
router.get('/overdue', requireRole(['admin', 'superviseur']), async (c) => {
  const today = new Date().toISOString().slice(0, 10)

  // Requêtes séparées pour éviter les joins PostgREST (cache FK non garanti)
  const { data: installments, error: instErr } = await db
    .from('payment_installments')
    .select('id, due_date, amount_due, amount_paid, installment_number, status, payment_plan_id')
    .lt('due_date', today)
    .in('status', ['PENDING', 'PARTIAL', 'OVERDUE'])
    .order('due_date', { ascending: true })

  if (instErr) return c.json({ error: 'Erreur lecture impayés', code: 'DB_ERROR' }, 500)
  if (!installments?.length) return c.json({ data: [] })

  const planIds = [...new Set(installments.map(i => i.payment_plan_id).filter(Boolean))]

  const { data: plans } = await db
    .from('payment_plans')
    .select('id, customer_id, total_amount, outstanding_balance')
    .in('id', planIds)

  const customerIds = [...new Set((plans ?? []).map(p => p.customer_id).filter(Boolean))]

  const { data: clients } = await db
    .from('clients')
    .select('id, nom, telephone')
    .in('id', customerIds)

  const plansMap  = new Map((plans   ?? []).map(p => [p.id,  p]))
  const clientMap = new Map((clients ?? []).map(c => [c.id,  c]))

  const rows = installments.map(inst => {
    const plan   = plansMap.get(inst.payment_plan_id)
    const client = plan ? clientMap.get(plan.customer_id) : null
    const daysLate = Math.floor(
      (Date.now() - new Date(inst.due_date).getTime()) / (1000 * 60 * 60 * 24),
    )
    return {
      ...inst,
      days_late:     daysLate,
      payment_plans: plan ? { ...plan, clients: client ?? null } : null,
    }
  })

  return c.json({ data: rows })
})

// ═══════════════════════════════════════════════════════════════════════════════
// RÈGLES D'ÉLIGIBILITÉ
// ═══════════════════════════════════════════════════════════════════════════════

// GET /credit/rules
router.get('/rules', async (c) => {
  const { data, error } = await db
    .from('credit_eligibility_rules')
    .select('*')
    .eq('is_active', true)
    .order('created_at', { ascending: false })

  if (error) return c.json({ error: 'Erreur lecture règles', code: 'DB_ERROR' }, 500)
  return c.json({ data: data ?? [] })
})

// POST /credit/rules — admin only
router.post('/rules', requireRole(['admin']), zValidator('json', eligibilityRuleSchema), async (c) => {
  const user = c.get('user')
  const body = c.req.valid('json')

  const { data, error } = await db
    .from('credit_eligibility_rules')
    .insert(body)
    .select()
    .single()

  if (error) {
    console.error('[credit:rules:post]', { error: error.message })
    return c.json({ error: 'Erreur création règle', code: 'DB_ERROR' }, 500)
  }

  console.info('[credit:rules:post] ✅', { ruleName: body.rule_name, by: user.id })
  return c.json({ data }, 201)
})

// ═══════════════════════════════════════════════════════════════════════════════
// CRON interne (appelable via endpoint protégé)
// ═══════════════════════════════════════════════════════════════════════════════

router.post('/cron/mark-overdue', requireRole(['admin']), async (c) => {
  const result = await checkOverdueInstallments()
  return c.json(result)
})

export { router as creditRouter }
