-- ═══════════════════════════════════════════════════════════════════════════
-- CATALOGUE HYBRIDE — PHASE 4 : moteur de coût de revient complet
--
-- COÛT DE REVIENT = matières + consommables + main-d'œuvre + équipements
--                 + sous-traitance + options + frais indirects + transport + installation
--
-- 1. fiche_technique_ressources : types « consommable » (§17, séparés des
--    matières, peuvent pointer vers un article de stock) et « sous_traitance »
--    (§18 : fournisseur, délai). Les lignes existantes restent valides.
-- 2. modele_parametres / modele_parametre_valeurs : nature du coût d'une option
--    (option / transport / installation) et assiette (par unité ou par commande).
-- 3. frais_indirects : frais paramétrables (§19) — taux ou montant, assiette,
--    centre de coût, période, portée. Jamais codés en dur.
--
-- Additif ; les contraintes CHECK élargies acceptent toutes les valeurs existantes.
-- Rollback : voir le bloc en fin de fichier.
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
BEGIN
  RAISE NOTICE 'Avant : fiche_technique_ressources=%, modele_parametres=%',
    (SELECT count(*) FROM public.fiche_technique_ressources),
    (SELECT count(*) FROM public.modele_parametres);
END $$;

-- ── 1. Nouveaux types de ressources ────────────────────────────────────────

ALTER TABLE public.fiche_technique_ressources
  ADD COLUMN IF NOT EXISTS ressource_fournisseur_id UUID,   -- sous_traitance : sous-traitant (FK posée plus bas si la table existe)
  ADD COLUMN IF NOT EXISTS delai_jours              INTEGER CHECK (delai_jours IS NULL OR delai_jours >= 0);

-- Remplace les CHECK de type / cohérence (noms retrouvés dynamiquement, pas devinés).
DO $$
DECLARE c record;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
     WHERE conrelid = 'public.fiche_technique_ressources'::regclass
       AND contype = 'c'
       AND (pg_get_constraintdef(oid) ILIKE '%main_oeuvre%')
  LOOP
    EXECUTE format('ALTER TABLE public.fiche_technique_ressources DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

ALTER TABLE public.fiche_technique_ressources
  ADD CONSTRAINT fiche_technique_ressources_type_check
    CHECK (type IN ('materiau', 'consommable', 'main_oeuvre', 'equipement', 'sous_traitance')),
  ADD CONSTRAINT ressource_coherente CHECK (
    (type IN ('materiau', 'consommable') AND ressource_equipement_id IS NULL AND ressource_fournisseur_id IS NULL) OR
    (type = 'equipement'     AND ressource_produit_id IS NULL AND ressource_fournisseur_id IS NULL) OR
    (type = 'main_oeuvre'    AND ressource_produit_id IS NULL AND ressource_equipement_id IS NULL AND ressource_fournisseur_id IS NULL) OR
    (type = 'sous_traitance' AND ressource_produit_id IS NULL AND ressource_equipement_id IS NULL)
  );

DO $$
BEGIN
  IF to_regclass('public.fournisseurs') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fiche_technique_ressources_fournisseur_fkey') THEN
    ALTER TABLE public.fiche_technique_ressources
      ADD CONSTRAINT fiche_technique_ressources_fournisseur_fkey
      FOREIGN KEY (ressource_fournisseur_id) REFERENCES public.fournisseurs(id) ON DELETE SET NULL;
  ELSIF to_regclass('public.fournisseurs') IS NULL THEN
    RAISE NOTICE 'Table fournisseurs absente : ressource_fournisseur_id reste sans clé étrangère';
  END IF;
END $$;

-- ── 2. Nature et assiette des coûts d'options ──────────────────────────────

ALTER TABLE public.modele_parametres
  ADD COLUMN IF NOT EXISTS categorie_cout    TEXT    NOT NULL DEFAULT 'option'
    CHECK (categorie_cout IN ('option', 'transport', 'installation')),
  ADD COLUMN IF NOT EXISTS cout_par_commande BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE public.modele_parametre_valeurs
  ADD COLUMN IF NOT EXISTS categorie_cout    TEXT    NOT NULL DEFAULT 'option'
    CHECK (categorie_cout IN ('option', 'transport', 'installation')),
  ADD COLUMN IF NOT EXISTS cout_par_commande BOOLEAN NOT NULL DEFAULT false;

-- ── 3. Frais indirects paramétrables ───────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.frais_indirects (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  libelle      TEXT        NOT NULL,
  centre_cout  TEXT,                                   -- ex. ATELIER, ADMIN, LOGISTIQUE
  mode         TEXT        NOT NULL CHECK (mode IN ('pourcentage', 'fixe_par_unite', 'fixe_par_commande')),
  valeur       NUMERIC     NOT NULL CHECK (valeur >= 0),
  base         TEXT        CHECK (base IS NULL OR base IN ('cout_direct', 'main_oeuvre', 'materiaux')),
  portee       TEXT        NOT NULL CHECK (portee IN ('global', 'famille', 'modele')),
  famille_id   UUID        REFERENCES public.familles(id) ON DELETE CASCADE,
  modele_id    UUID        REFERENCES public.modeles(id) ON DELETE CASCADE,
  date_debut   DATE,
  date_fin     DATE,
  actif        BOOLEAN     NOT NULL DEFAULT true,
  notes        TEXT,
  created_by   UUID,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT frais_indirects_base_si_pourcentage CHECK (mode <> 'pourcentage' OR base IS NOT NULL),
  CONSTRAINT frais_indirects_pourcentage_borne  CHECK (mode <> 'pourcentage' OR valeur <= 200),
  CONSTRAINT frais_indirects_periode            CHECK (date_debut IS NULL OR date_fin IS NULL OR date_debut <= date_fin),
  CONSTRAINT frais_indirects_portee_coherente   CHECK (
    (portee = 'global'  AND famille_id IS NULL     AND modele_id IS NULL) OR
    (portee = 'famille' AND famille_id IS NOT NULL AND modele_id IS NULL) OR
    (portee = 'modele'  AND modele_id  IS NOT NULL AND famille_id IS NULL)
  )
);
CREATE INDEX IF NOT EXISTS idx_frais_indirects_actif ON public.frais_indirects(actif);

CREATE OR REPLACE TRIGGER trg_frais_indirects_updated_at
  BEFORE UPDATE ON public.frais_indirects FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.frais_indirects ENABLE ROW LEVEL SECURITY;   -- API seule (service_role)

ALTER TYPE audit_action_type ADD VALUE IF NOT EXISTS 'FRAIS_INDIRECTS_MODIFIES';

DO $$
BEGIN
  RAISE NOTICE 'Après : fiche_technique_ressources=%, modele_parametres=% (identiques attendus)',
    (SELECT count(*) FROM public.fiche_technique_ressources),
    (SELECT count(*) FROM public.modele_parametres);
END $$;

-- ── Rollback (manuel, uniquement si aucune donnée n'utilise les nouveaux types) ──
-- DROP TABLE public.frais_indirects;
-- ALTER TABLE public.modele_parametre_valeurs DROP COLUMN categorie_cout, DROP COLUMN cout_par_commande;
-- ALTER TABLE public.modele_parametres        DROP COLUMN categorie_cout, DROP COLUMN cout_par_commande;
-- ALTER TABLE public.fiche_technique_ressources DROP CONSTRAINT ressource_coherente,
--   DROP CONSTRAINT fiche_technique_ressources_type_check, DROP COLUMN ressource_fournisseur_id, DROP COLUMN delai_jours;
-- puis recréer les CHECK d'origine (20260925_phase1_gamme_fiche_technique.sql).
