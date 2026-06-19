-- Migration 0026 — bons_sortie : nature_transaction + imputation_payeur
-- Idempotente : DO $$ BEGIN ... EXCEPTION WHEN duplicate_object THEN NULL END $$

DO $$ BEGIN
  CREATE TYPE nature_transaction_enum AS ENUM ('comptant', 'credit', 'deduction_acompte');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE imputation_payeur_enum AS ENUM ('entreprise_tafdil', 'atelier', 'administration');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE bons_sortie
  ADD COLUMN IF NOT EXISTS nature_transaction nature_transaction_enum,
  ADD COLUMN IF NOT EXISTS imputation_payeur  imputation_payeur_enum;

CREATE INDEX IF NOT EXISTS idx_bons_sortie_nature      ON bons_sortie(nature_transaction);
CREATE INDEX IF NOT EXISTS idx_bons_sortie_imputation  ON bons_sortie(imputation_payeur);
