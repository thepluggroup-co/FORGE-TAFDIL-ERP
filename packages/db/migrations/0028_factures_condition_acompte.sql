-- 0028 : Factures — condition de paiement + acompte reçu

ALTER TABLE factures
  ADD COLUMN IF NOT EXISTS condition_paiement_id UUID REFERENCES conditions_paiement(id),
  ADD COLUMN IF NOT EXISTS acompte_recu_xaf      REAL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_factures_condition_paiement ON factures(condition_paiement_id)
  WHERE condition_paiement_id IS NOT NULL;
