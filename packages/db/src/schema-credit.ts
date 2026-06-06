/**
 * FORGE ERP — Schéma Drizzle ORM (SQLite) — Module Crédit / Plans de paiement
 * Tous les montants sont en entiers FCFA (pas de float).
 */
import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core'
import { createId } from '@paralleldrive/cuid2'
import { clients, commandes, profiles } from './schema'

const now  = () => new Date().toISOString()
const id   = () => text('id').primaryKey().$defaultFn(() => createId())
const ts   = (col: string) => text(col).notNull().$defaultFn(now)
const tsUp = (col: string) => text(col).notNull().$defaultFn(now)
const sync = () =>
  text('sync_status', { enum: ['synced', 'pending', 'conflict'] as const })
    .notNull()
    .default('pending')

// ── Types ─────────────────────────────────────────────────────────────────────

export type EligibilityType   = 'PROFESSIONAL' | 'INDIVIDUAL' | 'VIP'
export type PlanStatus        = 'ACTIVE' | 'COMPLETED' | 'OVERDUE' | 'CANCELLED'
export type InstallmentStatus = 'PENDING' | 'PARTIAL' | 'PAID' | 'OVERDUE'
export type PaymentMethod     = 'CASH' | 'MOBILE_MONEY' | 'ORANGE_MONEY' | 'MTN_MOMO' | 'TRANSFER' | 'CHECK'
export type RuleAppliesTo     = 'ALL' | 'PROFESSIONAL' | 'INDIVIDUAL'

// ── customer_credit_limits ────────────────────────────────────────────────────

export const customerCreditLimits = sqliteTable('customer_credit_limits', {
  id:                    id(),
  customerId:            text('customer_id').notNull().references(() => clients.id),
  maxCreditAmount:       integer('max_credit_amount').notNull().default(0),
  isActive:              integer('is_active', { mode: 'boolean' }).notNull().default(true),
  eligibilityType:       text('eligibility_type', {
    enum: ['PROFESSIONAL', 'INDIVIDUAL', 'VIP'] as const,
  }).notNull().default('INDIVIDUAL'),
  minOrderHistoryMonths: integer('min_order_history_months').notNull().default(3),
  minPastOrdersCount:    integer('min_past_orders_count').notNull().default(5),
  createdBy:             text('created_by').references(() => profiles.id),
  createdAt:             ts('created_at'),
  updatedAt:             tsUp('updated_at'),
  syncStatus:            sync(),
})

export type CustomerCreditLimit    = typeof customerCreditLimits.$inferSelect
export type NewCustomerCreditLimit = typeof customerCreditLimits.$inferInsert

// ── payment_plans ─────────────────────────────────────────────────────────────

export const paymentPlans = sqliteTable('payment_plans', {
  id:                 id(),
  orderId:            text('order_id').notNull().references(() => commandes.id),
  customerId:         text('customer_id').notNull().references(() => clients.id),
  totalAmount:        integer('total_amount').notNull(),
  outstandingBalance: integer('outstanding_balance').notNull(),
  status:             text('status', {
    enum: ['ACTIVE', 'COMPLETED', 'OVERDUE', 'CANCELLED'] as const,
  }).notNull().default('ACTIVE'),
  createdBy:          text('created_by').references(() => profiles.id),
  createdAt:          ts('created_at'),
  updatedAt:          tsUp('updated_at'),
  syncStatus:         sync(),
})

export type PaymentPlan    = typeof paymentPlans.$inferSelect
export type NewPaymentPlan = typeof paymentPlans.$inferInsert

// ── payment_installments ──────────────────────────────────────────────────────

export const paymentInstallments = sqliteTable('payment_installments', {
  id:                id(),
  paymentPlanId:     text('payment_plan_id').notNull().references(() => paymentPlans.id),
  installmentNumber: integer('installment_number').notNull(),
  dueDate:           text('due_date').notNull(),   // 'YYYY-MM-DD'
  amountDue:         integer('amount_due').notNull(),
  amountPaid:        integer('amount_paid').notNull().default(0),
  paidAt:            text('paid_at'),              // ISO timestamp, nullable
  paymentMethod:     text('payment_method', {
    enum: ['CASH', 'MOBILE_MONEY', 'ORANGE_MONEY', 'MTN_MOMO', 'TRANSFER', 'CHECK'] as const,
  }),
  status:            text('status', {
    enum: ['PENDING', 'PARTIAL', 'PAID', 'OVERDUE'] as const,
  }).notNull().default('PENDING'),
  notes:             text('notes'),
  createdAt:         ts('created_at'),
  updatedAt:         tsUp('updated_at'),
  syncStatus:        sync(),
})

export type PaymentInstallment    = typeof paymentInstallments.$inferSelect
export type NewPaymentInstallment = typeof paymentInstallments.$inferInsert

// ── credit_eligibility_rules ──────────────────────────────────────────────────

export const creditEligibilityRules = sqliteTable('credit_eligibility_rules', {
  id:                  id(),
  ruleName:            text('rule_name').notNull(),
  minAccountAgeMonths: integer('min_account_age_months').notNull().default(3),
  minCompletedOrders:  integer('min_completed_orders').notNull().default(5),
  minOrderAmountFcfa:  integer('min_order_amount_fcfa').notNull().default(0),
  // real ok ici : ratio de 0 à 1 (ex: 0.5 = 50%), pas un montant FCFA
  maxOutstandingRatio: real('max_outstanding_ratio').notNull().default(0.5),
  appliesTo:           text('applies_to', {
    enum: ['ALL', 'PROFESSIONAL', 'INDIVIDUAL'] as const,
  }).notNull().default('ALL'),
  isActive:            integer('is_active', { mode: 'boolean' }).notNull().default(true),
  createdAt:           ts('created_at'),
  updatedAt:           tsUp('updated_at'),
})

export type CreditEligibilityRule    = typeof creditEligibilityRules.$inferSelect
export type NewCreditEligibilityRule = typeof creditEligibilityRules.$inferInsert
