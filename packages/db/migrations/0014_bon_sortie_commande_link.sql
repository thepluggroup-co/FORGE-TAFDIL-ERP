-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 0014 : Lien bon de sortie ↔ commande + colonne type
--
-- IMPORTANT : dans Supabase, bons_sortie.statut est un TEXT libre (pas un
-- type enum PG nommé). Le statut 'en_attente' est donc accepté sans ALTER TYPE.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Ajouter les nouvelles colonnes (idempotent via IF NOT EXISTS)
ALTER TABLE bons_sortie
  ADD COLUMN IF NOT EXISTS commande_id UUID REFERENCES commandes(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS devis_id    UUID REFERENCES devis(id)     ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS type        TEXT NOT NULL DEFAULT 'manuel';

-- 2. CHECK constraint sur type (DO block pour idempotence)
DO $$ BEGIN
  ALTER TABLE bons_sortie
    ADD CONSTRAINT chk_bons_sortie_type
    CHECK (type IN ('commande', 'devis', 'manuel'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 3. Index pour performance (badge notification + filtres)
CREATE INDEX IF NOT EXISTS idx_bons_sortie_commande_id ON bons_sortie(commande_id);
CREATE INDEX IF NOT EXISTS idx_bons_sortie_statut      ON bons_sortie(statut);
