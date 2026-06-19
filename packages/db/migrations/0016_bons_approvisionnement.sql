-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 0015 : Bons d'approvisionnement automatiques
--
-- Crée les tables bons_approvisionnement + bons_approvisionnement_lignes.
-- Un bon est généré automatiquement quand l'exécution d'un bon de sortie
-- fait passer un produit sous son seuil stock_min.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS bons_approvisionnement (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  numero         TEXT NOT NULL UNIQUE,
  statut         TEXT NOT NULL DEFAULT 'brouillon',
  bon_sortie_id  UUID REFERENCES bons_sortie(id) ON DELETE SET NULL,
  notes          TEXT,
  created_by     UUID REFERENCES profiles(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  sync_status    TEXT NOT NULL DEFAULT 'synced'
);

DO $$ BEGIN
  ALTER TABLE bons_approvisionnement
    ADD CONSTRAINT chk_bons_appro_statut
    CHECK (statut IN ('brouillon', 'valide', 'commande', 'recu', 'annule'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS bons_approvisionnement_lignes (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bon_id                UUID NOT NULL REFERENCES bons_approvisionnement(id) ON DELETE CASCADE,
  produit_id            UUID REFERENCES produits(id),
  designation           TEXT NOT NULL,
  unite                 TEXT NOT NULL DEFAULT 'unité',
  quantite_a_commander  NUMERIC(12,2) NOT NULL,
  stock_actuel_snap     NUMERIC(12,2) NOT NULL,
  stock_min_snap        NUMERIC(12,2) NOT NULL,
  statut_alerte         TEXT NOT NULL DEFAULT 'alerte',
  fournisseur           TEXT
);

-- Contrainte sur statut_alerte (idempotente)
DO $$ BEGIN
  ALTER TABLE bons_approvisionnement_lignes
    ADD CONSTRAINT chk_ligne_alerte
    CHECK (statut_alerte IN ('alerte', 'critique', 'rupture'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_bons_appro_statut         ON bons_approvisionnement(statut);
CREATE INDEX IF NOT EXISTS idx_bons_appro_sortie         ON bons_approvisionnement(bon_sortie_id);
CREATE INDEX IF NOT EXISTS idx_bons_appro_lignes_bon     ON bons_approvisionnement_lignes(bon_id);
CREATE INDEX IF NOT EXISTS idx_bons_appro_lignes_produit ON bons_approvisionnement_lignes(produit_id);

-- RLS : même politique que les autres tables métier
ALTER TABLE bons_approvisionnement        ENABLE ROW LEVEL SECURITY;
ALTER TABLE bons_approvisionnement_lignes ENABLE ROW LEVEL SECURITY;

-- Accès complet pour le rôle authenticated (géré par RBAC applicatif)
DO $$ BEGIN
  CREATE POLICY "authenticated full access" ON bons_approvisionnement
    FOR ALL TO authenticated USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "authenticated full access" ON bons_approvisionnement_lignes
    FOR ALL TO authenticated USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
