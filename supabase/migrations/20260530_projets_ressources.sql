-- ============================================================
-- Migration : Ressources assignées aux projets
-- NOTE : IDs UUID pour compatibilité avec Supabase PostgreSQL
-- ============================================================

CREATE TABLE IF NOT EXISTS projets_ressources (
  id                UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  projet_id         UUID    NOT NULL REFERENCES projets(id) ON DELETE CASCADE,
  type              TEXT    NOT NULL DEFAULT 'main_oeuvre',
                    -- main_oeuvre | intrant | consommable | equipement | sous_traitant
  designation       TEXT    NOT NULL,
  employe_id        UUID    REFERENCES employes(id),
  produit_id        UUID    REFERENCES produits(id),
  equipement_id     UUID    REFERENCES equipements(id),
  quantite          REAL    NOT NULL DEFAULT 1  CHECK (quantite > 0),
  unite             TEXT    NOT NULL DEFAULT 'unité',
  cout_unitaire_xaf REAL    NOT NULL DEFAULT 0  CHECK (cout_unitaire_xaf >= 0),
  statut            TEXT    NOT NULL DEFAULT 'planifie',
                    -- planifie | disponible | en_cours | utilise | manquant
  notes             TEXT,
  created_by        UUID    REFERENCES profiles(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_projets_ressources_projet
  ON projets_ressources(projet_id);
CREATE INDEX IF NOT EXISTS idx_projets_ressources_type
  ON projets_ressources(projet_id, type);

CREATE OR REPLACE VIEW v_projets_couts AS
SELECT
  p.id                                                        AS projet_id,
  p.nom                                                       AS projet_nom,
  p.budget_xaf,
  COALESCE(SUM(r.quantite * r.cout_unitaire_xaf), 0)         AS cout_ressources_xaf,
  COALESCE(SUM(r.quantite * r.cout_unitaire_xaf)
    FILTER (WHERE r.type = 'main_oeuvre'), 0)                AS cout_main_oeuvre_xaf,
  COALESCE(SUM(r.quantite * r.cout_unitaire_xaf)
    FILTER (WHERE r.type IN ('intrant','consommable')), 0)   AS cout_materiaux_xaf,
  GREATEST(0, p.budget_xaf -
    COALESCE(SUM(r.quantite * r.cout_unitaire_xaf), 0))      AS budget_restant_xaf
FROM projets p
LEFT JOIN projets_ressources r ON r.projet_id = p.id
GROUP BY p.id, p.nom, p.budget_xaf;
