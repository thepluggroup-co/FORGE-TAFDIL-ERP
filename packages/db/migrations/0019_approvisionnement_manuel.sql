-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 0017 : Approvisionnement manuel — fournisseurs + extension tables
--
-- 1. Table fournisseurs (référentiel)
-- 2. Extension bons_approvisionnement :
--      type (auto|manuel), fournisseur_id, fournisseur_nom,
--      date_livraison_souhaitee, quantite_recue
--      + statuts étendus (envoye, recu_partiel, recu_total)
-- 3. Extension bons_approvisionnement_lignes : quantite_recue
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Fournisseurs ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS fournisseurs (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  nom         TEXT        NOT NULL,
  telephone   TEXT,
  email       TEXT,
  adresse     TEXT,
  notes       TEXT,
  actif       BOOLEAN     NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  sync_status TEXT        NOT NULL DEFAULT 'synced'
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_fournisseurs_nom ON fournisseurs(nom);
CREATE INDEX IF NOT EXISTS idx_fournisseurs_actif ON fournisseurs(actif);

ALTER TABLE fournisseurs ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "authenticated full access" ON fournisseurs
    FOR ALL TO authenticated USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── 2. Extension bons_approvisionnement ───────────────────────────────────────

ALTER TABLE bons_approvisionnement
  ADD COLUMN IF NOT EXISTS type                     TEXT  NOT NULL DEFAULT 'auto',
  ADD COLUMN IF NOT EXISTS fournisseur_id           UUID  REFERENCES fournisseurs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS fournisseur_nom          TEXT,
  ADD COLUMN IF NOT EXISTS date_livraison_souhaitee DATE,
  ADD COLUMN IF NOT EXISTS quantite_recue           NUMERIC(12,2) DEFAULT 0;

-- Contrainte type
DO $$ BEGIN
  ALTER TABLE bons_approvisionnement
    ADD CONSTRAINT chk_bons_appro_type
    CHECK (type IN ('auto', 'manuel'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Mettre à jour la contrainte statut pour inclure les nouveaux états
ALTER TABLE bons_approvisionnement DROP CONSTRAINT IF EXISTS chk_bons_appro_statut;

ALTER TABLE bons_approvisionnement
  ADD CONSTRAINT chk_bons_appro_statut
  CHECK (statut IN ('brouillon', 'valide', 'envoye', 'commande',
                    'recu_partiel', 'recu_total', 'recu', 'annule'));

CREATE INDEX IF NOT EXISTS idx_bons_appro_type       ON bons_approvisionnement(type);
CREATE INDEX IF NOT EXISTS idx_bons_appro_fournisseur ON bons_approvisionnement(fournisseur_id);

-- ── 3. Extension bons_approvisionnement_lignes ────────────────────────────────

ALTER TABLE bons_approvisionnement_lignes
  ADD COLUMN IF NOT EXISTS quantite_recue NUMERIC(12,2) DEFAULT 0;
