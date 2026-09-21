-- ============================================================
-- Migration : Module équipements et outils
-- NOTE : IDs UUID pour compatibilité avec Supabase PostgreSQL
-- ============================================================

CREATE TABLE IF NOT EXISTS equipements (
  id                    UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  code                  TEXT    UNIQUE NOT NULL,
  designation           TEXT    NOT NULL,
  categorie             TEXT    NOT NULL DEFAULT 'outil',
                        -- outil | machine_legere | instrument | epi | vehicule
  numero_serie          TEXT,
  fournisseur           TEXT,
  date_acquisition      TEXT,
  valeur_achat_xaf      REAL    NOT NULL DEFAULT 0,
  emplacement           TEXT,
  responsable_id        UUID    REFERENCES employes(id),
  statut                TEXT    NOT NULL DEFAULT 'disponible',
                        -- disponible | en_service | maintenance | hors_service | cede
  prochaine_revision    TEXT,
  intervalle_revision_j INTEGER NOT NULL DEFAULT 365,
  notes                 TEXT,
  created_by            UUID    REFERENCES profiles(id),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_equipements_statut    ON equipements(statut);
CREATE INDEX IF NOT EXISTS idx_equipements_revision  ON equipements(prochaine_revision)
  WHERE statut != 'hors_service';
CREATE INDEX IF NOT EXISTS idx_equipements_categorie ON equipements(categorie);

CREATE TABLE IF NOT EXISTS maintenances_equipement (
  id               UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  equipement_id    UUID    NOT NULL REFERENCES equipements(id) ON DELETE CASCADE,
  type             TEXT    NOT NULL DEFAULT 'preventive',
                   -- preventive | corrective | calibrage | remplacement
  date_maintenance TEXT    NOT NULL,
  technicien_id    UUID    REFERENCES employes(id),
  cout_xaf         REAL    NOT NULL DEFAULT 0,
  description      TEXT,
  prochaine_date   TEXT,
  statut           TEXT    NOT NULL DEFAULT 'planifie',
                   -- planifie | en_cours | fait | annule
  created_by       UUID    REFERENCES profiles(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_maintenances_equipement
  ON maintenances_equipement(equipement_id);
