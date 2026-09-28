-- ═══════════════════════════════════════════════════════════════════════════
-- CATALOGUE HYBRIDE — PHASE 3 : produits CONFIGURABLES (pilote Portail P003)
--
-- 1. modele_parametres / modele_parametre_valeurs : schéma de configuration
--    typé d'un modèle (limites fabricables, choix, options et leur coût).
-- 2. regles_marge : taux de marge SAISI PAR L'UTILISATEUR (décision D4),
--    par modèle, par famille ou global. Jamais codé en dur.
-- 3. configurations : configuration client persistée, numérotée CFG-XXXXX
--    par la base (unicité garantie), FIGÉE après création (trigger).
--
-- Purement additif. Aucune table existante modifiée.
-- Rollback : DROP TABLE configurations, regles_marge, modele_parametre_valeurs,
--            modele_parametres ; DROP SEQUENCE configurations_numero_seq ;
--            DROP FUNCTION configurations_figee().
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
BEGIN
  RAISE NOTICE 'Avant : modeles=%, devis=%', (SELECT count(*) FROM public.modeles), (SELECT count(*) FROM public.devis);
END $$;

-- ── 1. Schéma de configuration ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.modele_parametres (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  modele_id        UUID        NOT NULL REFERENCES public.modeles(id) ON DELETE CASCADE,
  code             TEXT        NOT NULL CHECK (code ~ '^[a-z][a-z0-9_]{0,39}$'),
  libelle          TEXT        NOT NULL,
  type             TEXT        NOT NULL CHECK (type IN ('nombre', 'choix', 'booleen')),
  obligatoire      BOOLEAN     NOT NULL DEFAULT true,
  unite            TEXT        CHECK (unite IS NULL OR unite IN ('mm', 'cm', 'm')),
  min              NUMERIC,
  max              NUMERIC,
  pas              NUMERIC     CHECK (pas IS NULL OR pas > 0),
  role_calcul      TEXT        CHECK (role_calcul IS NULL OR role_calcul IN ('largeur','hauteur','longueur','epaisseur','diametre','poids')),
  cout_si_oui_xaf  NUMERIC     NOT NULL DEFAULT 0 CHECK (cout_si_oui_xaf >= 0),   -- booleen : coût de revient ajouté par unité
  ordre            INTEGER     NOT NULL DEFAULT 0,
  actif            BOOLEAN     NOT NULL DEFAULT true,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (modele_id, code),
  CONSTRAINT modele_parametres_bornes CHECK (min IS NULL OR max IS NULL OR min <= max)
);
CREATE INDEX IF NOT EXISTS idx_modele_parametres_modele ON public.modele_parametres(modele_id);

CREATE TABLE IF NOT EXISTS public.modele_parametre_valeurs (
  id                       UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  parametre_id             UUID    NOT NULL REFERENCES public.modele_parametres(id) ON DELETE CASCADE,
  code                     TEXT    NOT NULL CHECK (code ~ '^[a-z0-9][a-z0-9_]{0,39}$'),
  libelle                  TEXT    NOT NULL,
  cout_supplementaire_xaf  NUMERIC NOT NULL DEFAULT 0 CHECK (cout_supplementaire_xaf >= 0),
  validation_requise       BOOLEAN NOT NULL DEFAULT false,
  ordre                    INTEGER NOT NULL DEFAULT 0,
  actif                    BOOLEAN NOT NULL DEFAULT true,
  UNIQUE (parametre_id, code)
);
CREATE INDEX IF NOT EXISTS idx_modele_parametre_valeurs_parametre ON public.modele_parametre_valeurs(parametre_id);

-- ── 2. Règles de marge (D4) ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.regles_marge (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  portee      TEXT        NOT NULL CHECK (portee IN ('global', 'famille', 'modele')),
  famille_id  UUID        REFERENCES public.familles(id) ON DELETE CASCADE,
  modele_id   UUID        REFERENCES public.modeles(id) ON DELETE CASCADE,
  taux_pct    NUMERIC     NOT NULL CHECK (taux_pct >= 0 AND taux_pct <= 500),
  actif       BOOLEAN     NOT NULL DEFAULT true,
  notes       TEXT,
  created_by  UUID,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT regles_marge_portee_coherente CHECK (
    (portee = 'global'  AND famille_id IS NULL     AND modele_id IS NULL) OR
    (portee = 'famille' AND famille_id IS NOT NULL AND modele_id IS NULL) OR
    (portee = 'modele'  AND modele_id  IS NOT NULL AND famille_id IS NULL)
  )
);
-- Une seule règle ACTIVE par cible
CREATE UNIQUE INDEX IF NOT EXISTS idx_regles_marge_une_active_par_cible
  ON public.regles_marge (portee, COALESCE(famille_id, modele_id, '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE actif;

-- ── 3. Configurations client ───────────────────────────────────────────────

CREATE SEQUENCE IF NOT EXISTS public.configurations_numero_seq;

CREATE TABLE IF NOT EXISTS public.configurations (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  numero                TEXT        NOT NULL UNIQUE
                          DEFAULT ('CFG-' || lpad(nextval('public.configurations_numero_seq')::text, 5, '0')),
  modele_id             UUID        NOT NULL REFERENCES public.modeles(id),
  fiche_technique_id    UUID        REFERENCES public.fiche_technique(id),
  statut                TEXT        NOT NULL CHECK (statut IN ('valide', 'invalide', 'a_valider', 'hors_limites')),
  quantite              INTEGER     NOT NULL CHECK (quantite > 0),
  valeurs               JSONB       NOT NULL,          -- saisie retenue (unités de saisie)
  schema_snapshot       JSONB       NOT NULL,          -- paramètres tels qu'appliqués (limites, coûts d'options)
  estimation_snapshot   JSONB,                         -- détail interne coût / marge / prix — jamais exposé au client
  cout_revient_xaf      NUMERIC,
  taux_marge_pct        NUMERIC,
  prix_estime_ht_xaf    NUMERIC,                       -- prix de VENTE estimé, NON contractuel
  source                TEXT        NOT NULL DEFAULT 'web',
  client_id             UUID        REFERENCES public.clients(id) ON DELETE SET NULL,
  client_nom            TEXT,
  client_telephone      TEXT,
  client_email          TEXT,
  commentaire           TEXT,
  devis_id              UUID        REFERENCES public.devis(id) ON DELETE SET NULL,
  demande_devis_web_id  UUID        REFERENCES public.demandes_devis_web(id) ON DELETE SET NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_configurations_modele ON public.configurations(modele_id);
CREATE INDEX IF NOT EXISTS idx_configurations_statut ON public.configurations(statut);
CREATE INDEX IF NOT EXISTS idx_configurations_devis  ON public.configurations(devis_id);

-- §11 : une configuration enregistrée n'est jamais modifiée silencieusement.
-- Seuls les rattachements (devis, demande de devis) peuvent être posés, une fois.
CREATE OR REPLACE FUNCTION public.configurations_figee() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.numero IS DISTINCT FROM OLD.numero
     OR NEW.modele_id IS DISTINCT FROM OLD.modele_id
     OR NEW.fiche_technique_id IS DISTINCT FROM OLD.fiche_technique_id
     OR NEW.statut IS DISTINCT FROM OLD.statut
     OR NEW.quantite IS DISTINCT FROM OLD.quantite
     OR NEW.valeurs IS DISTINCT FROM OLD.valeurs
     OR NEW.schema_snapshot IS DISTINCT FROM OLD.schema_snapshot
     OR NEW.estimation_snapshot IS DISTINCT FROM OLD.estimation_snapshot
     OR NEW.cout_revient_xaf IS DISTINCT FROM OLD.cout_revient_xaf
     OR NEW.taux_marge_pct IS DISTINCT FROM OLD.taux_marge_pct
     OR NEW.prix_estime_ht_xaf IS DISTINCT FROM OLD.prix_estime_ht_xaf
     OR (OLD.devis_id IS NOT NULL AND NEW.devis_id IS DISTINCT FROM OLD.devis_id)
     OR (OLD.demande_devis_web_id IS NOT NULL AND NEW.demande_devis_web_id IS DISTINCT FROM OLD.demande_devis_web_id)
  THEN
    RAISE EXCEPTION 'Configuration % figée : créer une nouvelle configuration plutôt que la modifier', OLD.numero;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_configurations_figee ON public.configurations;
CREATE TRIGGER trg_configurations_figee
  BEFORE UPDATE ON public.configurations FOR EACH ROW EXECUTE FUNCTION public.configurations_figee();

-- ── 4. updated_at, RLS, audit ──────────────────────────────────────────────

CREATE OR REPLACE TRIGGER trg_modele_parametres_updated_at
  BEFORE UPDATE ON public.modele_parametres FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE OR REPLACE TRIGGER trg_regles_marge_updated_at
  BEFORE UPDATE ON public.regles_marge FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Coûts d'options, marges et estimations internes : API seule (clé service_role).
ALTER TABLE public.modele_parametres        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.modele_parametre_valeurs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.regles_marge             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.configurations           ENABLE ROW LEVEL SECURITY;

ALTER TYPE audit_action_type ADD VALUE IF NOT EXISTS 'MARGE_MODIFIEE';
ALTER TYPE audit_action_type ADD VALUE IF NOT EXISTS 'CONFIGURATION_CREEE';

DO $$
BEGIN
  RAISE NOTICE 'Après : modeles=%, devis=% (identiques attendus)', (SELECT count(*) FROM public.modeles), (SELECT count(*) FROM public.devis);
END $$;
