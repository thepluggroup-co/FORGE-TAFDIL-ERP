-- ============================================================
-- Migration : Congés, absences et enrichissement bulletins paie
-- NOTE : IDs UUID pour compatibilité avec Supabase PostgreSQL
-- ============================================================

CREATE TABLE IF NOT EXISTS conges (
  id              UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  employe_id      UUID    NOT NULL REFERENCES employes(id) ON DELETE CASCADE,
  type            TEXT    NOT NULL DEFAULT 'conge_paye',
                  -- conge_paye | sans_solde | maladie | maternite | paternite | evenement_familial
  date_debut      TEXT    NOT NULL,
  date_fin        TEXT    NOT NULL,
  jours_ouvres    INTEGER NOT NULL DEFAULT 1 CHECK (jours_ouvres > 0),
  statut          TEXT    NOT NULL DEFAULT 'en_attente',
                  -- en_attente | approuve | refuse | annule
  motif           TEXT,
  approuve_par    UUID    REFERENCES profiles(id),
  approuve_at     TIMESTAMPTZ,
  commentaire_rh  TEXT,
  created_by      UUID    REFERENCES profiles(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_conges_employe_id ON conges(employe_id);
CREATE INDEX IF NOT EXISTS idx_conges_statut     ON conges(statut);
CREATE INDEX IF NOT EXISTS idx_conges_dates      ON conges(date_debut, date_fin);

ALTER TABLE bulletins_paie
  ADD COLUMN IF NOT EXISTS jours_travailles   INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS jours_conge        INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS jours_absence      INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS jours_maladie      INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS heures_sup_nb      REAL    NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS irpp_xaf           REAL    NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cnps_employeur_xaf REAL    NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cout_employeur_xaf REAL    NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS mode_generation    TEXT    NOT NULL DEFAULT 'manuel';

CREATE OR REPLACE VIEW v_solde_conges AS
SELECT
  e.id                                                                      AS employe_id,
  e.nom                                                                     AS employe_nom,
  GREATEST(0,
    FLOOR((CURRENT_DATE - e.date_entree::date) / 30.0 * 1.5)
  )::INTEGER                                                                AS jours_acquis,
  COALESCE(SUM(c.jours_ouvres)
    FILTER (WHERE c.statut = 'approuve' AND c.type = 'conge_paye'), 0)     AS jours_pris,
  GREATEST(0,
    FLOOR((CURRENT_DATE - e.date_entree::date) / 30.0 * 1.5)::INTEGER -
    COALESCE(SUM(c.jours_ouvres)
      FILTER (WHERE c.statut = 'approuve' AND c.type = 'conge_paye'), 0)
  )                                                                         AS jours_restants
FROM employes e
LEFT JOIN conges c ON c.employe_id = e.id
WHERE e.statut != 'inactif'
GROUP BY e.id, e.nom, e.date_entree;
