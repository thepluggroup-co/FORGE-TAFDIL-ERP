-- ============================================================
-- Migration : Membres d'équipe sur les projets (PRJ03)
-- NOTE : IDs UUID pour compatibilité avec Supabase PostgreSQL
-- ============================================================

CREATE TABLE IF NOT EXISTS projets_membres (
  id                UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  projet_id         UUID    NOT NULL REFERENCES projets(id) ON DELETE CASCADE,
  employe_id        UUID    NOT NULL REFERENCES employes(id),
  role_projet       TEXT    NOT NULL DEFAULT 'technicien',
                    -- chef_projet | assistant | technicien | stagiaire | sous_traitant
  date_debut        TEXT,
  date_fin          TEXT,
  heures_planifiees REAL    NOT NULL DEFAULT 0,
  heures_reelles    REAL    NOT NULL DEFAULT 0,
  created_by        UUID    REFERENCES profiles(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(projet_id, employe_id)
);

CREATE INDEX IF NOT EXISTS idx_projets_membres_projet  ON projets_membres(projet_id);
CREATE INDEX IF NOT EXISTS idx_projets_membres_employe ON projets_membres(employe_id);

-- Colonnes chef projet et assistant sur le projet
-- (UUID car employes.id est UUID dans Supabase PostgreSQL)
ALTER TABLE projets
  ADD COLUMN IF NOT EXISTS chef_projet_id UUID REFERENCES employes(id),
  ADD COLUMN IF NOT EXISTS assistant_id   UUID REFERENCES employes(id);
