-- ═══════════════════════════════════════════════════════════════════════════
-- CATALOGUE HYBRIDE — PHASE 5 : gamme opératoire, postes, référentiel unique
--
-- A. Décision D5 : `equipements` est le référentiel UNIQUE des machines et
--    équipements. Les lignes de `machines` y sont recopiées (une fois,
--    traçables via ancienne_machine_id) et les ordres de fabrication
--    (jobs_production) reçoivent equipement_id. `machines` et
--    jobs_production.machine_id sont CONSERVÉS (dépréciés, aucun DROP).
--
-- B. §15/§16/§21 : taux horaires et gamme de fabrication.
--    - equipements.cout_horaire_xaf : coût horaire machine
--    - postes_travail : postes de main-d'œuvre et leur coût horaire
--    - gamme_operations : opérations ordonnées (10, 20, 30…) d'une fiche
--      technique (donc versionnées avec elle), avec poste et/ou équipement,
--      temps par unité facturable et temps fixe de préparation par commande.
--
-- Données existantes : comptées avant / après, aucune suppression.
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
BEGIN
  RAISE NOTICE 'Avant : machines=%, equipements=%, jobs_production=% (dont % avec machine_id)',
    (SELECT count(*) FROM public.machines),
    (SELECT count(*) FROM public.equipements),
    (SELECT count(*) FROM public.jobs_production),
    (SELECT count(*) FROM public.jobs_production WHERE machine_id IS NOT NULL);
END $$;

-- ── A. Convergence machines → equipements ──────────────────────────────────

ALTER TABLE public.equipements
  ADD COLUMN IF NOT EXISTS cout_horaire_xaf    NUMERIC CHECK (cout_horaire_xaf IS NULL OR cout_horaire_xaf >= 0),
  ADD COLUMN IF NOT EXISTS ancienne_machine_id UUID UNIQUE;

-- Recopie des machines pas encore migrées. Statuts traduits vers le vocabulaire
-- des équipements ; code unique dérivé de l'identifiant (pas de collision possible
-- avec un code saisi à la main, préfixe MAC- réservé à cette migration).
INSERT INTO public.equipements (code, designation, categorie, numero_serie, emplacement, statut, notes, ancienne_machine_id)
SELECT
  'MAC-' || upper(substr(replace(m.id::text, '-', ''), 1, 8)),
  m.nom,
  'machine_production',
  m.numero_serie,
  m.zone,
  CASE m.statut
    WHEN 'actif'       THEN 'disponible'
    WHEN 'maintenance' THEN 'maintenance'
    WHEN 'panne'       THEN 'en_panne'
    WHEN 'reserve'     THEN 'disponible'
    ELSE 'hors_service'
  END,
  'Migré depuis la table machines (type : ' || coalesce(m.type, '—') || ')',
  m.id
FROM public.machines m
WHERE NOT EXISTS (SELECT 1 FROM public.equipements e WHERE e.ancienne_machine_id = m.id);

ALTER TABLE public.jobs_production
  ADD COLUMN IF NOT EXISTS equipement_id UUID REFERENCES public.equipements(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_jobs_production_equipement ON public.jobs_production(equipement_id);

UPDATE public.jobs_production j
   SET equipement_id = e.id
  FROM public.equipements e
 WHERE e.ancienne_machine_id = j.machine_id
   AND j.equipement_id IS NULL;

COMMENT ON TABLE public.machines IS
  'DÉPRÉCIÉ (décision D5) — référentiel unique : equipements. Lignes recopiées (equipements.ancienne_machine_id). Conservé sans suppression.';
COMMENT ON COLUMN public.jobs_production.machine_id IS
  'DÉPRÉCIÉ (décision D5) — utiliser equipement_id.';

-- ── B1. Postes de travail (main-d'œuvre) ───────────────────────────────────

CREATE TABLE IF NOT EXISTS public.postes_travail (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  code              TEXT        NOT NULL UNIQUE CHECK (code ~ '^[A-Z0-9][A-Z0-9_-]{0,19}$'),
  libelle           TEXT        NOT NULL,                  -- ex. Soudeur, Peintre, Monteur
  cout_horaire_xaf  NUMERIC     NOT NULL CHECK (cout_horaire_xaf >= 0),
  actif             BOOLEAN     NOT NULL DEFAULT true,
  notes             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE OR REPLACE TRIGGER trg_postes_travail_updated_at
  BEFORE UPDATE ON public.postes_travail FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── B2. Gamme opératoire d'une fiche technique ─────────────────────────────

CREATE TABLE IF NOT EXISTS public.gamme_operations (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  fiche_technique_id  UUID        NOT NULL REFERENCES public.fiche_technique(id) ON DELETE CASCADE,
  numero              INTEGER     NOT NULL CHECK (numero > 0),          -- 10, 20, 30…
  libelle             TEXT        NOT NULL,                             -- Découpe, Soudage, Peinture…
  poste_id            UUID        REFERENCES public.postes_travail(id),
  equipement_id       UUID        REFERENCES public.equipements(id),
  temps_unitaire_h    NUMERIC     NOT NULL DEFAULT 0 CHECK (temps_unitaire_h >= 0),  -- par unité facturable (m², ml, pièce…)
  temps_fixe_h        NUMERIC     NOT NULL DEFAULT 0 CHECK (temps_fixe_h >= 0),      -- préparation, une fois par commande
  actif               BOOLEAN     NOT NULL DEFAULT true,
  notes               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (fiche_technique_id, numero),
  CONSTRAINT gamme_operations_ressource CHECK (poste_id IS NOT NULL OR equipement_id IS NOT NULL),
  CONSTRAINT gamme_operations_temps     CHECK (temps_unitaire_h > 0 OR temps_fixe_h > 0)
);
CREATE INDEX IF NOT EXISTS idx_gamme_operations_fiche ON public.gamme_operations(fiche_technique_id);

CREATE OR REPLACE TRIGGER trg_gamme_operations_updated_at
  BEFORE UPDATE ON public.gamme_operations FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Coûts horaires internes : API seule (clé service_role).
ALTER TABLE public.postes_travail   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gamme_operations ENABLE ROW LEVEL SECURITY;

ALTER TYPE audit_action_type ADD VALUE IF NOT EXISTS 'TAUX_HORAIRE_MODIFIE';

DO $$
BEGIN
  RAISE NOTICE 'Après : machines=% (inchangé), equipements=% (dont % migrés), jobs_production=% (dont % avec equipement_id)',
    (SELECT count(*) FROM public.machines),
    (SELECT count(*) FROM public.equipements),
    (SELECT count(*) FROM public.equipements WHERE ancienne_machine_id IS NOT NULL),
    (SELECT count(*) FROM public.jobs_production),
    (SELECT count(*) FROM public.jobs_production WHERE equipement_id IS NOT NULL);
END $$;

-- ── Rollback (manuel) ──────────────────────────────────────────────────────
-- DROP TABLE public.gamme_operations; DROP TABLE public.postes_travail;
-- ALTER TABLE public.jobs_production DROP COLUMN equipement_id;
-- DELETE FROM public.equipements WHERE ancienne_machine_id IS NOT NULL;   -- lignes recopiées seulement
-- ALTER TABLE public.equipements DROP COLUMN ancienne_machine_id, DROP COLUMN cout_horaire_xaf;
