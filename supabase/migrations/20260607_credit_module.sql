-- FORGE ERP — Module Crédit / Plans de paiement
-- Cible : PostgreSQL / Supabase
-- Tous les montants en entiers FCFA

-- ── Enums ─────────────────────────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE eligibility_type AS ENUM ('PROFESSIONAL', 'INDIVIDUAL', 'VIP');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE plan_status AS ENUM ('ACTIVE', 'COMPLETED', 'OVERDUE', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE installment_status AS ENUM ('PENDING', 'PARTIAL', 'PAID', 'OVERDUE');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE payment_method AS ENUM ('CASH', 'MOBILE_MONEY', 'ORANGE_MONEY', 'MTN_MOMO', 'TRANSFER', 'CHECK');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE rule_applies_to AS ENUM ('ALL', 'PROFESSIONAL', 'INDIVIDUAL');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── customer_credit_limits ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS customer_credit_limits (
  id                       uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id              uuid        NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  max_credit_amount        integer     NOT NULL DEFAULT 0,
  is_active                boolean     NOT NULL DEFAULT true,
  eligibility_type         eligibility_type NOT NULL DEFAULT 'INDIVIDUAL',
  min_order_history_months integer     NOT NULL DEFAULT 3,
  min_past_orders_count    integer     NOT NULL DEFAULT 5,
  created_by               uuid        REFERENCES profiles(id),
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);

-- Un seul plafond actif par client
CREATE UNIQUE INDEX IF NOT EXISTS idx_credit_limits_customer_active
  ON customer_credit_limits(customer_id)
  WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_credit_limits_customer_id
  ON customer_credit_limits(customer_id);

-- ── payment_plans ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS payment_plans (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id            uuid        NOT NULL REFERENCES commandes(id)  ON DELETE RESTRICT,
  customer_id         uuid        NOT NULL REFERENCES clients(id)    ON DELETE RESTRICT,
  total_amount        integer     NOT NULL,
  outstanding_balance integer     NOT NULL,
  status              plan_status NOT NULL DEFAULT 'ACTIVE',
  created_by          uuid        REFERENCES profiles(id),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payment_plans_customer
  ON payment_plans(customer_id);
CREATE INDEX IF NOT EXISTS idx_payment_plans_order
  ON payment_plans(order_id);
CREATE INDEX IF NOT EXISTS idx_payment_plans_status
  ON payment_plans(status);

-- ── payment_installments ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS payment_installments (
  id                  uuid               PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_plan_id     uuid               NOT NULL REFERENCES payment_plans(id) ON DELETE CASCADE,
  installment_number  integer            NOT NULL,
  due_date            date               NOT NULL,
  amount_due          integer            NOT NULL,
  amount_paid         integer            NOT NULL DEFAULT 0,
  paid_at             timestamptz,
  payment_method      payment_method,
  status              installment_status NOT NULL DEFAULT 'PENDING',
  notes               text,
  created_at          timestamptz        NOT NULL DEFAULT now(),
  updated_at          timestamptz        NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_installments_plan
  ON payment_installments(payment_plan_id);
CREATE INDEX IF NOT EXISTS idx_installments_due_date
  ON payment_installments(due_date);
CREATE INDEX IF NOT EXISTS idx_installments_status
  ON payment_installments(status);

-- ── credit_eligibility_rules ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS credit_eligibility_rules (
  id                    uuid            PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_name             text            NOT NULL,
  min_account_age_months integer        NOT NULL DEFAULT 3,
  min_completed_orders  integer         NOT NULL DEFAULT 5,
  min_order_amount_fcfa integer         NOT NULL DEFAULT 0,
  max_outstanding_ratio numeric(4,3)    NOT NULL DEFAULT 0.5,
  applies_to            rule_applies_to NOT NULL DEFAULT 'ALL',
  is_active             boolean         NOT NULL DEFAULT true,
  created_at            timestamptz     NOT NULL DEFAULT now(),
  updated_at            timestamptz     NOT NULL DEFAULT now()
);

-- Règle par défaut
INSERT INTO credit_eligibility_rules
  (rule_name, min_account_age_months, min_completed_orders, min_order_amount_fcfa, max_outstanding_ratio, applies_to)
VALUES
  ('Règle standard TAFDIL', 3, 5, 500000, 0.5, 'ALL')
ON CONFLICT DO NOTHING;

-- ── Trigger updated_at ────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DO $$ BEGIN
  CREATE TRIGGER trg_credit_limits_updated_at
    BEFORE UPDATE ON customer_credit_limits
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TRIGGER trg_payment_plans_updated_at
    BEFORE UPDATE ON payment_plans
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TRIGGER trg_payment_installments_updated_at
    BEFORE UPDATE ON payment_installments
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
