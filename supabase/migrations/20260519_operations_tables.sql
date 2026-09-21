-- ═══════════════════════════════════════════════════════════════════════════
-- FORGE ERP — Tables opérationnelles
-- Toutes utilisent IF NOT EXISTS — sûr à relancer.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

-- ══════════════════════════════════════════════════════════════════════════
-- RH — EMPLOYÉS
-- ══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.employes (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  nom              TEXT        NOT NULL,
  poste            TEXT        NOT NULL,
  departement      TEXT        NOT NULL,
  type_contrat     TEXT        NOT NULL DEFAULT 'CDI'
                     CHECK (type_contrat IN ('CDI','CDD','stage','freelance')),
  date_entree      TEXT        NOT NULL,
  date_sortie      TEXT,
  salaire_base_xaf NUMERIC     NOT NULL DEFAULT 0,
  telephone        TEXT,
  email            TEXT,
  cin              TEXT,
  cnps             TEXT,
  statut           TEXT        NOT NULL DEFAULT 'actif'
                     CHECK (statut IN ('actif','inactif','conge','essai')),
  created_by       UUID,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  sync_status      TEXT        NOT NULL DEFAULT 'pending'
);

CREATE OR REPLACE TRIGGER trg_employes_updated_at
  BEFORE UPDATE ON public.employes
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.employes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "employes_all" ON public.employes;
CREATE POLICY "employes_all" ON public.employes FOR ALL USING (true) WITH CHECK (true);

-- ── Présences ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.presences (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  employe_id  UUID        NOT NULL REFERENCES public.employes(id) ON DELETE CASCADE,
  date        TEXT        NOT NULL,
  arrivee     TEXT,
  depart      TEXT,
  heures      NUMERIC     NOT NULL DEFAULT 0,
  statut      TEXT        NOT NULL
                CHECK (statut IN ('present','absent','conge','retard','maladie')),
  notes       TEXT,
  created_by  UUID,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  sync_status TEXT        NOT NULL DEFAULT 'pending'
);

CREATE INDEX IF NOT EXISTS idx_presences_employe ON public.presences(employe_id);
CREATE INDEX IF NOT EXISTS idx_presences_date    ON public.presences(date DESC);

ALTER TABLE public.presences ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "presences_all" ON public.presences;
CREATE POLICY "presences_all" ON public.presences FOR ALL USING (true) WITH CHECK (true);

-- ── Bulletins de paie ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.bulletins_paie (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  employe_id          UUID        NOT NULL REFERENCES public.employes(id) ON DELETE CASCADE,
  mois                TEXT        NOT NULL,
  salaire_base_xaf    NUMERIC     NOT NULL,
  heures_sup_xaf      NUMERIC     NOT NULL DEFAULT 0,
  primes_xaf          NUMERIC     NOT NULL DEFAULT 0,
  deductions_xaf      NUMERIC     NOT NULL DEFAULT 0,
  cotisation_cnps_xaf NUMERIC     NOT NULL DEFAULT 0,
  cnps_employeur_xaf  NUMERIC     NOT NULL DEFAULT 0,
  irpp_xaf            NUMERIC     NOT NULL DEFAULT 0,
  net_xaf             NUMERIC     NOT NULL,
  cout_employeur_xaf  NUMERIC     NOT NULL DEFAULT 0,
  statut              TEXT        NOT NULL DEFAULT 'en_attente'
                        CHECK (statut IN ('en_attente','valide','vire')),
  genere_le           TEXT,
  created_by          UUID,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  sync_status         TEXT        NOT NULL DEFAULT 'pending'
);

CREATE INDEX IF NOT EXISTS idx_bulletins_employe ON public.bulletins_paie(employe_id);
CREATE INDEX IF NOT EXISTS idx_bulletins_mois    ON public.bulletins_paie(mois DESC);

CREATE OR REPLACE TRIGGER trg_bulletins_updated_at
  BEFORE UPDATE ON public.bulletins_paie
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.bulletins_paie ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "bulletins_all" ON public.bulletins_paie;
CREATE POLICY "bulletins_all" ON public.bulletins_paie FOR ALL USING (true) WITH CHECK (true);

-- ── Apprenants ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.apprenants (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  nom         TEXT        NOT NULL,
  specialite  TEXT        NOT NULL,
  niveau      INTEGER     NOT NULL DEFAULT 1,
  duree_mois  INTEGER     NOT NULL DEFAULT 0,
  statut      TEXT        NOT NULL DEFAULT 'actif'
                CHECK (statut IN ('actif','suspendu','diplome','recrute')),
  employe_id  UUID        REFERENCES public.employes(id) ON DELETE SET NULL,
  notes       TEXT,
  created_by  UUID,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  sync_status TEXT        NOT NULL DEFAULT 'pending'
);

CREATE INDEX IF NOT EXISTS idx_apprenants_statut ON public.apprenants(statut);

CREATE OR REPLACE TRIGGER trg_apprenants_updated_at
  BEFORE UPDATE ON public.apprenants
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.apprenants ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "apprenants_all" ON public.apprenants;
CREATE POLICY "apprenants_all" ON public.apprenants FOR ALL USING (true) WITH CHECK (true);

-- ── Validations de niveau ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.validations_niveau (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  apprenant_id    UUID        NOT NULL REFERENCES public.apprenants(id) ON DELETE CASCADE,
  niveau          INTEGER     NOT NULL,
  valide_by       UUID,
  date_validation TEXT        NOT NULL,
  commentaire     TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.validations_niveau ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "validations_all" ON public.validations_niveau;
CREATE POLICY "validations_all" ON public.validations_niveau FOR ALL USING (true) WITH CHECK (true);

-- ══════════════════════════════════════════════════════════════════════════
-- PRODUCTION — JOBS
-- ══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.jobs_production (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  numero              TEXT        NOT NULL UNIQUE,
  produit_designation TEXT        NOT NULL,
  machine_nom         TEXT,
  technicien_nom      TEXT,
  avancement_pct      INTEGER     NOT NULL DEFAULT 0,
  statut              TEXT        NOT NULL DEFAULT 'confirmed'
                        CHECK (statut IN ('confirmed','in_production','pret','delivered','cancelled')),
  date_debut          TEXT,
  date_fin_prevue     TEXT,
  date_fin_reelle     TEXT,
  notes               TEXT,
  created_by          UUID,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  sync_status         TEXT        NOT NULL DEFAULT 'pending'
);

CREATE INDEX IF NOT EXISTS idx_jobs_statut  ON public.jobs_production(statut);
CREATE INDEX IF NOT EXISTS idx_jobs_created ON public.jobs_production(created_at DESC);

CREATE OR REPLACE TRIGGER trg_jobs_updated_at
  BEFORE UPDATE ON public.jobs_production
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.jobs_production ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "jobs_all" ON public.jobs_production;
CREATE POLICY "jobs_all" ON public.jobs_production FOR ALL USING (true) WITH CHECK (true);

-- ══════════════════════════════════════════════════════════════════════════
-- PROJETS
-- ══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.projets (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  nom             TEXT        NOT NULL,
  description     TEXT,
  client_nom      TEXT,
  chef_projet_nom TEXT,
  budget_xaf      NUMERIC     NOT NULL DEFAULT 0,
  depense_xaf     NUMERIC     NOT NULL DEFAULT 0,
  avancement_pct  INTEGER     NOT NULL DEFAULT 0,
  statut          TEXT        NOT NULL DEFAULT 'planifie'
                    CHECK (statut IN ('planifie','en_cours','suspendu','livre','annule')),
  date_debut      TEXT,
  deadline        TEXT,
  created_by      UUID,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  sync_status     TEXT        NOT NULL DEFAULT 'pending'
);

CREATE INDEX IF NOT EXISTS idx_projets_statut  ON public.projets(statut);
CREATE INDEX IF NOT EXISTS idx_projets_created ON public.projets(created_at DESC);

CREATE OR REPLACE TRIGGER trg_projets_updated_at
  BEFORE UPDATE ON public.projets
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.projets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "projets_all" ON public.projets;
CREATE POLICY "projets_all" ON public.projets FOR ALL USING (true) WITH CHECK (true);

-- ══════════════════════════════════════════════════════════════════════════
-- LOGISTIQUE — LIVRAISONS
-- ══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.livraisons (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  numero                TEXT        NOT NULL UNIQUE,
  client_nom            TEXT        NOT NULL,
  destination           TEXT        NOT NULL,
  transporteur          TEXT,
  statut                TEXT        NOT NULL DEFAULT 'confirmed'
                          CHECK (statut IN ('confirmed','in_production','pret','delivered','cancelled')),
  date_depart           TEXT,
  date_livraison_prevue TEXT,
  date_livraison_reelle TEXT,
  notes                 TEXT,
  created_by            UUID,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  sync_status           TEXT        NOT NULL DEFAULT 'pending'
);

CREATE INDEX IF NOT EXISTS idx_livraisons_statut  ON public.livraisons(statut);
CREATE INDEX IF NOT EXISTS idx_livraisons_created ON public.livraisons(created_at DESC);

CREATE OR REPLACE TRIGGER trg_livraisons_updated_at
  BEFORE UPDATE ON public.livraisons
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.livraisons ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "livraisons_all" ON public.livraisons;
CREATE POLICY "livraisons_all" ON public.livraisons FOR ALL USING (true) WITH CHECK (true);

-- ══════════════════════════════════════════════════════════════════════════
-- MARKETING — CAMPAGNES
-- ══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.campagnes_marketing (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  nom               TEXT        NOT NULL,
  description       TEXT,
  canal             TEXT        NOT NULL,
  budget_xaf        NUMERIC     NOT NULL DEFAULT 0,
  reach             INTEGER     NOT NULL DEFAULT 0,
  leads_count       INTEGER     NOT NULL DEFAULT 0,
  conversions_count INTEGER     NOT NULL DEFAULT 0,
  statut            TEXT        NOT NULL DEFAULT 'planifie'
                      CHECK (statut IN ('planifie','active','pause','termine','annule')),
  date_debut        TEXT        NOT NULL,
  date_fin          TEXT        NOT NULL,
  created_by        UUID,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  sync_status       TEXT        NOT NULL DEFAULT 'pending'
);

CREATE INDEX IF NOT EXISTS idx_campagnes_statut  ON public.campagnes_marketing(statut);
CREATE INDEX IF NOT EXISTS idx_campagnes_created ON public.campagnes_marketing(created_at DESC);

CREATE OR REPLACE TRIGGER trg_campagnes_updated_at
  BEFORE UPDATE ON public.campagnes_marketing
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.campagnes_marketing ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "campagnes_all" ON public.campagnes_marketing;
CREATE POLICY "campagnes_all" ON public.campagnes_marketing FOR ALL USING (true) WITH CHECK (true);

-- ══════════════════════════════════════════════════════════════════════════
-- SÉCURITÉ — INCIDENTS
-- ══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.incidents_securite (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  type                 TEXT        NOT NULL,
  description          TEXT        NOT NULL,
  zone                 TEXT        NOT NULL,
  signale_par          TEXT        NOT NULL,
  statut               TEXT        NOT NULL DEFAULT 'ouvert'
                         CHECK (statut IN ('ouvert','traite','corrige','resolu')),
  date_incident        TEXT        NOT NULL,
  date_resolution      TEXT,
  actions_correctrices TEXT,
  created_by           UUID,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  sync_status          TEXT        NOT NULL DEFAULT 'pending'
);

CREATE INDEX IF NOT EXISTS idx_incidents_statut  ON public.incidents_securite(statut);
CREATE INDEX IF NOT EXISTS idx_incidents_created ON public.incidents_securite(created_at DESC);

CREATE OR REPLACE TRIGGER trg_incidents_updated_at
  BEFORE UPDATE ON public.incidents_securite
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.incidents_securite ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "incidents_all" ON public.incidents_securite;
CREATE POLICY "incidents_all" ON public.incidents_securite FOR ALL USING (true) WITH CHECK (true);

-- ══════════════════════════════════════════════════════════════════════════
-- Vérification
-- ══════════════════════════════════════════════════════════════════════════

SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN (
    'employes','presences','bulletins_paie','apprenants','validations_niveau',
    'jobs_production','projets','livraisons','campagnes_marketing','incidents_securite'
  )
ORDER BY table_name;
