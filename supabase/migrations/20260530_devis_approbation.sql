-- ============================================================
-- Migration : Approbation client des devis
-- + Contrainte CMD01 : commande uniquement après approbation
-- ============================================================

ALTER TABLE devis
  ADD COLUMN IF NOT EXISTS token_approbation    TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS token_expires_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS approuve_par_client  BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS approuve_at          TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS commentaire_client   TEXT,
  ADD COLUMN IF NOT EXISTS bon_sortie_id        TEXT REFERENCES bons_sortie(id);

CREATE INDEX IF NOT EXISTS idx_devis_token
  ON devis(token_approbation) WHERE token_approbation IS NOT NULL;
