/**
 * FORGE ERP — Schéma Drizzle ORM (PostgreSQL / Supabase) — Module Crédit
 * Miroir de schema-credit.ts, dialecte PostgreSQL.
 * Tous les montants sont en entiers FCFA.
 */
import {
  pgTable, uuid, text, integer, boolean,
  timestamp, date, numeric, pgEnum,
} from 'drizzle-orm/pg-core'

// ── Helpers ───────────────────────────────────────────────────────────────────

const id  = () => uuid('id').primaryKey().defaultRandom()
const ts  = (col: string) => timestamp(col, { withTimezone: true }).notNull().defaultNow()
const tsN = (col: string) => timestamp(col, { withTimezone: true })

// ── Enums PostgreSQL ──────────────────────────────────────────────────────────

export const eligibilityTypeEnum   = pgEnum('eligibility_type',   ['PROFESSIONAL', 'INDIVIDUAL', 'VIP'])
export const planStatusEnum        = pgEnum('plan_status',        ['ACTIVE', 'COMPLETED', 'OVERDUE', 'CANCELLED'])
export const installmentStatusEnum = pgEnum('installment_status', ['PENDING', 'PARTIAL', 'PAID', 'OVERDUE'])
export const paymentMethodEnum     = pgEnum('payment_method',     ['CASH', 'MOBILE_MONEY', 'ORANGE_MONEY', 'MTN_MOMO', 'TRANSFER', 'CHECK'])
export const ruleAppliesToEnum     = pgEnum('rule_applies_to',    ['ALL', 'PROFESSIONAL', 'INDIVIDUAL'])

// ── customer_credit_limits ────────────────────────────────────────────────────

export const customerCreditLimitsPg = pgTable('customer_credit_limits', {
  id:                    id(),
  customerId:            uuid('customer_id').notNull(),     // FK → clients(id)
  maxCreditAmount:       integer('max_credit_amount').notNull().default(0),
  isActive:              boolean('is_active').notNull().default(true),
  eligibilityType:       eligibilityTypeEnum('eligibility_type').notNull().default('INDIVIDUAL'),
  minOrderHistoryMonths: integer('min_order_history_months').notNull().default(3),
  minPastOrdersCount:    integer('min_past_orders_count').notNull().default(5),
  createdBy:             uuid('created_by'),                // FK → profiles(id)
  createdAt:             ts('created_at'),
  updatedAt:             ts('updated_at'),
})

export type CustomerCreditLimitPg    = typeof customerCreditLimitsPg.$inferSelect
export type NewCustomerCreditLimitPg = typeof customerCreditLimitsPg.$inferInsert

// ── payment_plans ─────────────────────────────────────────────────────────────

export const paymentPlansPg = pgTable('payment_plans', {
  id:                 id(),
  orderId:            uuid('order_id').notNull(),            // FK → commandes(id)
  customerId:         uuid('customer_id').notNull(),         // FK → clients(id)
  totalAmount:        integer('total_amount').notNull(),
  outstandingBalance: integer('outstanding_balance').notNull(),
  status:             planStatusEnum('status').notNull().default('ACTIVE'),
  createdBy:          uuid('created_by'),                   // FK → profiles(id)
  createdAt:          ts('created_at'),
  updatedAt:          ts('updated_at'),
})

export type PaymentPlanPg    = typeof paymentPlansPg.$inferSelect
export type NewPaymentPlanPg = typeof paymentPlansPg.$inferInsert

// ── payment_installments ──────────────────────────────────────────────────────

export const paymentInstallmentsPg = pgTable('payment_installments', {
  id:                id(),
  paymentPlanId:     uuid('payment_plan_id').notNull(),     // FK → payment_plans(id)
  installmentNumber: integer('installment_number').notNull(),
  dueDate:           date('due_date').notNull(),
  amountDue:         integer('amount_due').notNull(),
  amountPaid:        integer('amount_paid').notNull().default(0),
  paidAt:            tsN('paid_at'),
  paymentMethod:     paymentMethodEnum('payment_method'),
  status:            installmentStatusEnum('status').notNull().default('PENDING'),
  notes:             text('notes'),
  createdAt:         ts('created_at'),
  updatedAt:         ts('updated_at'),
})

export type PaymentInstallmentPg    = typeof paymentInstallmentsPg.$inferSelect
export type NewPaymentInstallmentPg = typeof paymentInstallmentsPg.$inferInsert

// ── credit_eligibility_rules ──────────────────────────────────────────────────

export const creditEligibilityRulesPg = pgTable('credit_eligibility_rules', {
  id:                  id(),
  ruleName:            text('rule_name').notNull(),
  minAccountAgeMonths: integer('min_account_age_months').notNull().default(3),
  minCompletedOrders:  integer('min_completed_orders').notNull().default(5),
  minOrderAmountFcfa:  integer('min_order_amount_fcfa').notNull().default(0),
  maxOutstandingRatio: numeric('max_outstanding_ratio', { precision: 4, scale: 3 }).notNull().default('0.500'),
  appliesTo:           ruleAppliesToEnum('applies_to').notNull().default('ALL'),
  isActive:            boolean('is_active').notNull().default(true),
  createdAt:           ts('created_at'),
  updatedAt:           ts('updated_at'),
})

export type CreditEligibilityRulePg    = typeof creditEligibilityRulesPg.$inferSelect
export type NewCreditEligibilityRulePg = typeof creditEligibilityRulesPg.$inferInsert
