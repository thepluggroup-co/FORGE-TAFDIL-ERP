-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 0017 : Historique des versements par facture
--
-- Crée versements_factures pour tracer chaque encaissement partiel/total.
-- Toutes les instructions sont idempotentes (IF NOT EXISTS / DO blocks).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS versements_factures (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  facture_id     UUID        NOT NULL REFERENCES factures(id) ON DELETE CASCADE,
  montant_xaf    INTEGER     NOT NULL CHECK (montant_xaf > 0),
  date_versement DATE        NOT NULL,
  mode_paiement  TEXT        CHECK (mode_paiement IN ('orange_money','mtn_momo','virement','especes','cheque','autre')),
  reference      TEXT,
  note           TEXT,
  enregistre_par TEXT,
  created_at     TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_versements_facture_id ON versements_factures(facture_id);
CREATE INDEX IF NOT EXISTS idx_versements_date       ON versements_factures(date_versement DESC);

ALTER TABLE versements_factures ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "authenticated full access" ON versements_factures
    FOR ALL TO authenticated USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
