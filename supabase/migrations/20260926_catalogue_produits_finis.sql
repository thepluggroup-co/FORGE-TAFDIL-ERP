-- ═══════════════════════════════════════════════════════════════════════════
-- PHASE 1 — CATALOGUE PRODUITS FINIS : arbre de catégorisation
-- (familles / modèles / spécifications techniques)
--
-- Purement additif. Ne modifie ni ne supprime aucune table, colonne ou
-- contrainte existante. Sans rapport avec `produits` (stock de matières
-- premières/consommables) : le lien se fera en Phase 2 via
-- fiche_technique_ressources, pas ici.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Familles (arbre auto-référencé) ──────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.familles (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  nom         TEXT        NOT NULL,
  parent_id   UUID,
  type_gamme  TEXT        NOT NULL CHECK (type_gamme IN ('catalogue', 'sur_mesure', 'configuration')),
  ordre       INTEGER     NOT NULL DEFAULT 0,
  actif       BOOLEAN     NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- FK auto-référencée ajoutée séparément (Drizzle ne supporte pas les forward
-- refs sur la même table sans AnyPgColumn — cf. schema.pg.ts, famillesPg.parentId).
-- ON DELETE RESTRICT : on ne veut jamais qu'une suppression de famille parente
-- efface silencieusement ses sous-familles ou les laisse orphelines — il faut
-- explicitement reclasser/désactiver les enfants d'abord.
ALTER TABLE public.familles
  ADD CONSTRAINT familles_parent_id_fkey
  FOREIGN KEY (parent_id) REFERENCES public.familles(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_familles_parent_id ON public.familles(parent_id);

-- ── 2. Modèles ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.modeles (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  famille_id         UUID        NOT NULL REFERENCES public.familles(id),
  reference          TEXT        NOT NULL UNIQUE,
  designation        TEXT        NOT NULL,
  description        TEXT,
  unite_facturation  TEXT        NOT NULL DEFAULT 'unité',
  type_gamme         TEXT        CHECK (type_gamme IN ('catalogue', 'sur_mesure', 'configuration')),
  actif              BOOLEAN     NOT NULL DEFAULT true,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_modeles_famille_id ON public.modeles(famille_id);

-- ── 3. Spécifications techniques (clé/valeur) ───────────────────────────────

CREATE TABLE IF NOT EXISTS public.modele_specifications (
  id         UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  modele_id  UUID    NOT NULL REFERENCES public.modeles(id) ON DELETE CASCADE,
  cle        TEXT    NOT NULL,
  valeur     TEXT    NOT NULL,
  unite      TEXT,
  ordre      INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_modele_specifications_modele_id ON public.modele_specifications(modele_id);

-- ── 4. Triggers updated_at (réutilise la fonction existante) ───────────────

CREATE OR REPLACE TRIGGER trg_familles_updated_at
  BEFORE UPDATE ON public.familles FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE OR REPLACE TRIGGER trg_modeles_updated_at
  BEFORE UPDATE ON public.modeles FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── 5. Seed : les 12 familles racines TAFDIL ────────────────────────────────
-- Classification confirmée par le promoteur. Idempotent (ON CONFLICT DO NOTHING
-- sur nom+parent_id via une contrainte partielle n'existe pas ici — on protège
-- avec un simple NOT EXISTS pour rester rejouable sans dupliquer les racines).

INSERT INTO public.familles (nom, type_gamme, ordre)
SELECT v.nom, v.type_gamme, v.ordre
FROM (VALUES
  ('Charpente / Hangar métallique',    'configuration', 1),
  ('Tuyauterie industrielle',          'sur_mesure',    2),
  ('Citerne / Bac de stockage',        'catalogue',     3),
  ('Panneau publicitaire / Kiosque',   'configuration', 4),
  ('Portail / Grilles / Ferronnerie',  'configuration', 5),
  ('Carrosserie plateau camion',       'sur_mesure',    6),
  ('Auvent / Couverture métallique',   'configuration', 7),
  ('Menuiserie métallique',            'configuration', 8),
  ('Mécanosoudure / Tôlerie',          'sur_mesure',    9),
  ('Aménagement / Bâtiment',           'sur_mesure',    10),
  ('Fournitures industrielles',        'catalogue',     11),
  ('Produit du catalogue',             'catalogue',     12)
) AS v(nom, type_gamme, ordre)
WHERE NOT EXISTS (
  SELECT 1 FROM public.familles f WHERE f.nom = v.nom AND f.parent_id IS NULL
);

-- ── Vérification ─────────────────────────────────────────────────────────
DO $$
BEGIN
  RAISE NOTICE 'Catalogue produits finis appliqué : % familles racines',
    (SELECT count(*) FROM public.familles WHERE parent_id IS NULL);
END $$;
