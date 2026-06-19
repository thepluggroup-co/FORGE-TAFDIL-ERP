-- 0029 : Bons de sortie — préparateur + statut_preparation

DO $$ BEGIN
  CREATE TYPE statut_preparation_enum AS ENUM ('a_preparer', 'en_cours', 'pret');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE bons_sortie
  ADD COLUMN IF NOT EXISTS preparateur_id     UUID REFERENCES profiles(id),
  ADD COLUMN IF NOT EXISTS statut_preparation statut_preparation_enum;

CREATE INDEX IF NOT EXISTS idx_bons_sortie_preparation
  ON bons_sortie(statut_preparation) WHERE statut_preparation IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_bons_sortie_preparateur
  ON bons_sortie(preparateur_id) WHERE preparateur_id IS NOT NULL;
