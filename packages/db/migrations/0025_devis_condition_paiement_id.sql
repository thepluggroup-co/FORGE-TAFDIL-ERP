-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 0025 : Lier devis.condition_paiement_id → référentiel conditions_paiement
--
-- 1. Ajoute la colonne FK (idempotente).
-- 2. Mappe les anciennes valeurs texte vers les codes du référentiel.
-- 3. L'ancienne colonne conditions_paiement est CONSERVÉE pour rollback.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE devis
  ADD COLUMN IF NOT EXISTS condition_paiement_id UUID REFERENCES conditions_paiement(id);

-- Mapping text → code (ordre du plus spécifique au plus général)
DO $$ BEGIN
  -- livraison → P30-LIV  (avant le fallback P100 pour éviter le court-circuit)
  UPDATE devis d
  SET condition_paiement_id = cp.id
  FROM conditions_paiement cp
  WHERE cp.code = 'P30-LIV'
    AND d.condition_paiement_id IS NULL
    AND d.conditions_paiement ILIKE '%livraison%';

  -- crédit 60 jours → P30-60
  UPDATE devis d
  SET condition_paiement_id = cp.id
  FROM conditions_paiement cp
  WHERE cp.code = 'P30-60'
    AND d.condition_paiement_id IS NULL
    AND d.conditions_paiement ILIKE '%60%jour%';

  -- crédit 30 jours → P30-45
  UPDATE devis d
  SET condition_paiement_id = cp.id
  FROM conditions_paiement cp
  WHERE cp.code = 'P30-45'
    AND d.condition_paiement_id IS NULL
    AND d.conditions_paiement ILIKE '%30%jour%';

  -- Fallback : tout ce qui reste (Virement bancaire, Paiement comptant, NULL, autre) → P100
  UPDATE devis d
  SET condition_paiement_id = cp.id
  FROM conditions_paiement cp
  WHERE cp.code = 'P100'
    AND d.condition_paiement_id IS NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_devis_condition_paiement_id ON devis(condition_paiement_id);
