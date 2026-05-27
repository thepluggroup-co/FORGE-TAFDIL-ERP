-- ────────────────────────────────────────────────────────────────────────────
-- Migration : sessions de formation + inscriptions + évolution apprenants
-- ────────────────────────────────────────────────────────────────────────────

-- ── formation_sessions ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.formation_sessions (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  module        TEXT         NOT NULL,
  niveau        INTEGER      NOT NULL CHECK (niveau BETWEEN 1 AND 5),
  statut        TEXT         NOT NULL DEFAULT 'planifiee'
                             CHECK (statut IN ('planifiee','en_cours','terminee','annulee')),
  date_debut    DATE,
  date_fin      DATE,
  formateur     TEXT,
  lieu          TEXT,
  capacite_max  INTEGER      NOT NULL DEFAULT 10,
  horaires      TEXT[]       NOT NULL DEFAULT '{}',
  description   TEXT,
  created_by    UUID,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE OR REPLACE TRIGGER trg_formation_sessions_updated_at
  BEFORE UPDATE ON public.formation_sessions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.formation_sessions DISABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_formation_sessions_statut ON public.formation_sessions(statut);
CREATE INDEX IF NOT EXISTS idx_formation_sessions_niveau ON public.formation_sessions(niveau);

-- ── formation_inscriptions ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.formation_inscriptions (
  id               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  apprenant_id     UUID         NOT NULL REFERENCES public.apprenants(id)        ON DELETE CASCADE,
  session_id       UUID         NOT NULL REFERENCES public.formation_sessions(id) ON DELETE CASCADE,
  date_inscription DATE         NOT NULL DEFAULT CURRENT_DATE,
  disponibilites   TEXT[]       NOT NULL DEFAULT '{}',   -- créneaux disponibles choisis
  nb_seances       INTEGER      NOT NULL DEFAULT 0,      -- nb séances effectivement suivies
  evaluation       NUMERIC(4,1),                         -- note / 20 optionnelle
  statut           TEXT         NOT NULL DEFAULT 'inscrit'
                                CHECK (statut IN ('inscrit','en_cours','termine','abandonne')),
  notes            TEXT,
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
  UNIQUE (apprenant_id, session_id)
);

CREATE OR REPLACE TRIGGER trg_formation_inscriptions_updated_at
  BEFORE UPDATE ON public.formation_inscriptions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.formation_inscriptions DISABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_inscriptions_apprenant ON public.formation_inscriptions(apprenant_id);
CREATE INDEX IF NOT EXISTS idx_inscriptions_session   ON public.formation_inscriptions(session_id);

-- ── validations_niveau : colonnes manquantes ──────────────────────────────────

ALTER TABLE public.validations_niveau
  ADD COLUMN IF NOT EXISTS valide_by       UUID,
  ADD COLUMN IF NOT EXISTS date_validation DATE,
  ADD COLUMN IF NOT EXISTS commentaire     TEXT;
