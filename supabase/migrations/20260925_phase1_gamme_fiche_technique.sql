-- ═══════════════════════════════════════════════════════════════════════════
-- PHASE 1 — MASTER PROMPT V3 : largeur/profondeur de gamme, unités
-- centralisées, fiches techniques versionnées, traçabilité du devis.
--
-- Ne modifie ni ne supprime aucune colonne existante. Purement additif.
-- Compatible avec les devis existants (toutes les nouvelles colonnes sont
-- nullables ou à valeur par défaut neutre).
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Largeur de gamme : familles et catégories ────────────────────────────

CREATE TABLE IF NOT EXISTS public.produit_familles (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  code        TEXT        NOT NULL UNIQUE,
  designation TEXT        NOT NULL,
  description TEXT,
  atelier     TEXT,        -- 'Métallerie' | 'Ferronnerie' | 'Les deux' | NULL, libre
  ordre       INTEGER     NOT NULL DEFAULT 0,
  actif       BOOLEAN     NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── 2. Unités de facturation centralisées (§9/§10 du brief) ────────────────
-- Créée avant produit_categories car référencée par celle-ci.

CREATE TABLE IF NOT EXISTS public.unites_facturation (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  code        TEXT        NOT NULL UNIQUE,   -- 'm2', 'ml', 'm3', 'kg', 'l', 'h', 'forfait', 'unite'
  libelle     TEXT        NOT NULL,
  mode_calcul TEXT        NOT NULL
                CHECK (mode_calcul IN ('quantitatif','surface','lineaire','volume','poids','forfait','qualitatif')),
  actif       BOOLEAN     NOT NULL DEFAULT true,
  ordre       INTEGER     NOT NULL DEFAULT 0
);

INSERT INTO public.unites_facturation (code, libelle, mode_calcul, ordre) VALUES
  ('unite',    'Unité',                  'quantitatif', 1),
  ('m2',       'Mètre carré',            'surface',     2),
  ('ml',       'Mètre linéaire',         'lineaire',    3),
  ('m3',       'Mètre cube',             'volume',      4),
  ('kg',       'Kilogramme',             'poids',       5),
  ('l',        'Litre',                  'quantitatif', 6),
  ('h',        'Heure',                  'quantitatif', 7),
  ('forfait',  'Forfait',                'forfait',     8)
ON CONFLICT (code) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.produit_categories (
  id                          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  famille_id                  UUID        NOT NULL REFERENCES public.produit_familles(id),
  code                        TEXT        NOT NULL UNIQUE,
  designation                 TEXT        NOT NULL,
  description                 TEXT,
  unite_facturation_defaut_id UUID        REFERENCES public.unites_facturation(id),
  ordre                       INTEGER     NOT NULL DEFAULT 0,
  actif                       BOOLEAN     NOT NULL DEFAULT true,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_produit_categories_famille ON public.produit_categories(famille_id);

-- ── 3. produits : rattachement progressif à la nouvelle hiérarchie ─────────
-- `categorie` (texte libre) est conservée telle quelle : aucune donnée existante
-- n'est modifiée. `categorie_id` est la nouvelle référence, nullable pendant
-- la période de transition.

ALTER TABLE public.produits
  ADD COLUMN IF NOT EXISTS categorie_id         UUID REFERENCES public.produit_categories(id),
  ADD COLUMN IF NOT EXISTS unite_facturation_id  UUID REFERENCES public.unites_facturation(id);

CREATE INDEX IF NOT EXISTS idx_produits_categorie_id ON public.produits(categorie_id);

-- ── 4. Fiches techniques versionnées (§14/§15) ──────────────────────────────
-- Une seule version 'active' par produit : contrainte d'unicité partielle.

CREATE TABLE IF NOT EXISTS public.fiche_technique (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  produit_id            UUID        NOT NULL REFERENCES public.produits(id),
  version               INTEGER     NOT NULL DEFAULT 1,
  statut                TEXT        NOT NULL DEFAULT 'brouillon'
                          CHECK (statut IN ('brouillon','active','archivee')),
  mode_calcul           TEXT        NOT NULL
                          CHECK (mode_calcul IN ('quantitatif','surface','lineaire','volume','poids','forfait','qualitatif')),
  unite_facturation_id  UUID        REFERENCES public.unites_facturation(id),
  notes                 TEXT,
  created_by            UUID,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (produit_id, version)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_fiche_technique_une_active_par_produit
  ON public.fiche_technique(produit_id) WHERE statut = 'active';
CREATE INDEX IF NOT EXISTS idx_fiche_technique_produit ON public.fiche_technique(produit_id);

CREATE TABLE IF NOT EXISTS public.fiche_technique_ressources (
  id                          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  fiche_technique_id          UUID        NOT NULL REFERENCES public.fiche_technique(id) ON DELETE CASCADE,
  type                        TEXT        NOT NULL CHECK (type IN ('materiau','main_oeuvre','equipement')),
  ressource_produit_id        UUID        REFERENCES public.produits(id),     -- si type = materiau
  ressource_equipement_id     UUID        REFERENCES public.equipements(id),  -- si type = equipement
  designation                 TEXT        NOT NULL,
  unite                       TEXT        NOT NULL,
  quantite_par_unite          NUMERIC     NOT NULL,  -- ex : 4 kg d'acier par m² facturable
  cout_unitaire_reference_xaf NUMERIC     NOT NULL DEFAULT 0,
  temps_reference_h           NUMERIC,
  ordre                       INTEGER     NOT NULL DEFAULT 0,
  actif                       BOOLEAN     NOT NULL DEFAULT true,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ressource_coherente CHECK (
    (type = 'materiau'   AND ressource_equipement_id IS NULL) OR
    (type = 'equipement' AND ressource_produit_id     IS NULL) OR
    (type = 'main_oeuvre' AND ressource_produit_id IS NULL AND ressource_equipement_id IS NULL)
  )
);
CREATE INDEX IF NOT EXISTS idx_ftr_fiche ON public.fiche_technique_ressources(fiche_technique_id);

-- ── 5. devis : traçabilité canal + snapshot figé (§19/§21/§32) ─────────────
-- IMPORTANT (confirmé par le promoteur) : la TVA n'entre PAS dans le calcul
-- du devis. tva_xaf/total_ttc_xaf restent à 0 par défaut sur les nouveaux
-- devis ; ils ne sont renseignés qu'au stade facture (hors périmètre Phase 1).

ALTER TABLE public.devis
  ADD COLUMN IF NOT EXISTS source_demande      TEXT,   -- 'web' | 'whatsapp' | 'telephone' | 'boutique' | 'bureau' | 'commercial' — libre, extensible
  ADD COLUMN IF NOT EXISTS fiche_technique_id  UUID REFERENCES public.fiche_technique(id),
  ADD COLUMN IF NOT EXISTS config_snapshot     JSONB,
  ADD COLUMN IF NOT EXISTS ressources_snapshot JSONB;

ALTER TABLE public.devis_lignes
  ADD COLUMN IF NOT EXISTS configuration     JSONB,
  ADD COLUMN IF NOT EXISTS formule_utilisee  TEXT;

-- ── 6. Triggers updated_at (réutilise la fonction existante) ───────────────

CREATE OR REPLACE TRIGGER trg_produit_familles_updated_at
  BEFORE UPDATE ON public.produit_familles FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE OR REPLACE TRIGGER trg_produit_categories_updated_at
  BEFORE UPDATE ON public.produit_categories FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE OR REPLACE TRIGGER trg_fiche_technique_updated_at
  BEFORE UPDATE ON public.fiche_technique FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE OR REPLACE TRIGGER trg_fiche_technique_ressources_updated_at
  BEFORE UPDATE ON public.fiche_technique_ressources FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── 7. Sécurité (§43 du brief) ──────────────────────────────────────────────
-- Choix délibéré, DIFFÉRENT de la convention actuelle du dépôt :
-- la quasi-totalité des tables existantes ont RLS *désactivé*
-- (`DISABLE ROW LEVEL SECURITY`), donc lisibles/modifiables en clair par
-- n'importe qui disposant de la clé anonyme Supabase. C'est un problème de
-- sécurité déjà signalé séparément, indépendant de cette migration.
--
-- Ces 5 tables contiennent des coûts de revient, des marges et des ressources
-- de production — exactement les données que le §43 interdit d'exposer à un
-- client. On active donc RLS SANS AUCUNE POLICY : cela bloque totalement
-- l'accès via la clé anonyme et les JWT utilisateurs, sans bloquer le
-- serveur API (qui utilise la clé service_role, laquelle contourne RLS par
-- construction chez Supabase). Si un accès direct navigateur→Supabase à ces
-- tables devient nécessaire plus tard, ajouter une policy explicite alors —
-- ne jamais repasser par défaut sur `USING (true)`.

ALTER TABLE public.produit_familles            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.produit_categories          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.unites_facturation          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fiche_technique             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fiche_technique_ressources  ENABLE ROW LEVEL SECURITY;

-- ── Vérification ─────────────────────────────────────────────────────────
DO $$
BEGIN
  RAISE NOTICE 'Phase 1 appliquée : % familles, % unités de facturation',
    (SELECT count(*) FROM public.produit_familles),
    (SELECT count(*) FROM public.unites_facturation);
END $$;
