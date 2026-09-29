-- ═══════════════════════════════════════════════════════════════════════════
-- CATALOGUE HYBRIDE — PHASE 7 : l'ordre de fabrication reprend la gamme (§24/§25)
--
--   1. jobs_production : fiche technique (version figée au devis) et quantité
--      facturable sur laquelle l'OF a été planifié
--   2. of_operations    : étapes de l'OF, COPIE de la gamme au lancement
--      (libellés, temps prévus, taux horaires figés) + temps réel saisi
--   3. of_consommations : matières et consommables prévus + quantité réelle
--
-- La copie protège l'OF : modifier la gamme ou un taux horaire ensuite ne
-- change pas un OF déjà planifié (le contrôle des coûts, Phase 8, compare
-- prévu et réel sur ces valeurs figées).
--
-- Additif et rejouable. Aucune donnée existante modifiée.
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
BEGIN
  RAISE NOTICE 'Avant : jobs_production=%, of_operations %, of_consommations %',
    (SELECT count(*) FROM public.jobs_production),
    CASE WHEN to_regclass('public.of_operations')    IS NULL THEN 'absente' ELSE 'présente' END,
    CASE WHEN to_regclass('public.of_consommations') IS NULL THEN 'absente' ELSE 'présente' END;
END $$;

-- ── 1. OF : fiche technique et quantité facturable ─────────────────────────
ALTER TABLE public.jobs_production
  ADD COLUMN IF NOT EXISTS fiche_technique_id  UUID REFERENCES public.fiche_technique(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS quantite_facturable NUMERIC CHECK (quantite_facturable IS NULL OR quantite_facturable > 0),
  ADD COLUMN IF NOT EXISTS gamme_chargee_le    TIMESTAMPTZ;

-- ── 2. Étapes de l'OF ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.of_operations (
  id                          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id                      UUID        NOT NULL REFERENCES public.jobs_production(id) ON DELETE CASCADE,
  gamme_operation_id          UUID        REFERENCES public.gamme_operations(id) ON DELETE SET NULL,  -- origine, pour traçabilité
  numero                      INTEGER     NOT NULL CHECK (numero > 0),
  libelle                     TEXT        NOT NULL,
  poste_id                    UUID        REFERENCES public.postes_travail(id) ON DELETE SET NULL,
  poste_libelle               TEXT,
  equipement_id               UUID        REFERENCES public.equipements(id) ON DELETE SET NULL,
  equipement_designation      TEXT,
  temps_prevu_h               NUMERIC     NOT NULL DEFAULT 0 CHECK (temps_prevu_h >= 0),
  cout_horaire_poste_xaf      NUMERIC,    -- figé au lancement
  cout_horaire_equipement_xaf NUMERIC,    -- figé au lancement
  statut                      TEXT        NOT NULL DEFAULT 'a_faire'
                                CHECK (statut IN ('a_faire', 'en_cours', 'terminee', 'sautee')),
  technicien_id               UUID,       -- employé (RH) ; FK ajoutée ci-dessous si la table existe
  technicien_nom              TEXT,
  temps_reel_h                NUMERIC     CHECK (temps_reel_h IS NULL OR temps_reel_h >= 0),
  debut_le                    TIMESTAMPTZ,
  fin_le                      TIMESTAMPTZ,
  notes                       TEXT,
  saisi_par                   UUID,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (job_id, numero)
);
CREATE INDEX IF NOT EXISTS idx_of_operations_job ON public.of_operations(job_id);

DO $$
BEGIN
  IF to_regclass('public.employes') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'of_operations_technicien_fkey') THEN
    ALTER TABLE public.of_operations
      ADD CONSTRAINT of_operations_technicien_fkey FOREIGN KEY (technicien_id) REFERENCES public.employes(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ── 3. Consommations de l'OF ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.of_consommations (
  id                          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id                      UUID        NOT NULL REFERENCES public.jobs_production(id) ON DELETE CASCADE,
  ressource_id                UUID        REFERENCES public.fiche_technique_ressources(id) ON DELETE SET NULL,  -- NULL = consommation imprévue
  type                        TEXT        NOT NULL CHECK (type IN ('materiau', 'consommable')),
  produit_id                  UUID        REFERENCES public.produits(id) ON DELETE SET NULL,  -- article de stock
  designation                 TEXT        NOT NULL,
  unite                       TEXT        NOT NULL,
  quantite_prevue             NUMERIC     NOT NULL DEFAULT 0 CHECK (quantite_prevue >= 0),
  cout_unitaire_reference_xaf NUMERIC     NOT NULL DEFAULT 0,   -- figé au lancement
  quantite_reelle             NUMERIC     CHECK (quantite_reelle IS NULL OR quantite_reelle >= 0),
  quantite_sortie_stock       NUMERIC     NOT NULL DEFAULT 0 CHECK (quantite_sortie_stock >= 0),  -- déjà déstockée
  notes                       TEXT,
  saisi_par                   UUID,
  saisi_le                    TIMESTAMPTZ,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_of_consommations_job ON public.of_consommations(job_id);

CREATE OR REPLACE TRIGGER trg_of_operations_updated_at
  BEFORE UPDATE ON public.of_operations FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE OR REPLACE TRIGGER trg_of_consommations_updated_at
  BEFORE UPDATE ON public.of_consommations FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Taux horaires et coûts figés : API seule (clé service_role).
ALTER TABLE public.of_operations    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.of_consommations ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  RAISE NOTICE 'Après : jobs_production=% (identique attendu), of_operations=%, of_consommations=%',
    (SELECT count(*) FROM public.jobs_production),
    (SELECT count(*) FROM public.of_operations),
    (SELECT count(*) FROM public.of_consommations);
END $$;

-- ── Rollback (manuel) ──────────────────────────────────────────────────────
-- DROP TABLE public.of_consommations; DROP TABLE public.of_operations;
-- ALTER TABLE public.jobs_production DROP COLUMN gamme_chargee_le,
--   DROP COLUMN quantite_facturable, DROP COLUMN fiche_technique_id;
