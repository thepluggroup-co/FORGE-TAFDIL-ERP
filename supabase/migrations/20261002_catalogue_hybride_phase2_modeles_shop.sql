-- ═══════════════════════════════════════════════════════════════════════════
-- CATALOGUE HYBRIDE — PHASE 2 : produits STANDARD fabriqués vendus en ligne
-- (ARCHITECTURE/TAFDIL_FORGE_AUDIT.md, décision D1)
--
-- `modeles` reste la source de vérité du produit fini ; `modeles_shop` est sa
-- vitrine web, calquée sur `produits_shop` (qui reste la vitrine des articles
-- de stock / négoce). Seuls les modèles dont le mode commercial effectif est
-- STANDARD peuvent être vendus : règle contrôlée par l'API.
--
-- Purement additif : une table neuve, une colonne nullable. Aucune donnée
-- existante modifiée.
--
-- Rollback : DROP TABLE public.modeles_shop ;
--            ALTER TABLE public.commandes_lignes DROP COLUMN modele_id ;
--            (uniquement si aucune commande n'y fait encore référence)
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
BEGIN
  RAISE NOTICE 'Avant : modeles=%, commandes_lignes=%',
    (SELECT count(*) FROM public.modeles),
    (SELECT count(*) FROM public.commandes_lignes);
END $$;

-- ── 1. Vitrine web des modèles ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.modeles_shop (
  modele_id               UUID        PRIMARY KEY REFERENCES public.modeles(id) ON DELETE CASCADE,
  visible_shop            BOOLEAN     NOT NULL DEFAULT false,
  prix_public             INTEGER     NOT NULL DEFAULT 0 CHECK (prix_public >= 0),  -- XAF, prix de VENTE HT (TVA ajoutée à la commande, même convention que produits_shop)
  description_longue      TEXT,
  images                  JSONB       NOT NULL DEFAULT '[]',
  tags                    JSONB       NOT NULL DEFAULT '[]',
  delai_fabrication_jours INTEGER     CHECK (delai_fabrication_jours IS NULL OR delai_fabrication_jours >= 0),
  min_commande            INTEGER     NOT NULL DEFAULT 1 CHECK (min_commande >= 1),
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_modeles_shop_visible ON public.modeles_shop(visible_shop);

CREATE OR REPLACE TRIGGER trg_modeles_shop_updated_at
  BEFORE UPDATE ON public.modeles_shop FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Lue et écrite uniquement par l'API (clé service_role) : RLS activé SANS
-- politique, contrairement à produits_shop (voir 20260930 pour le contexte).
ALTER TABLE public.modeles_shop ENABLE ROW LEVEL SECURITY;

-- ── 2. Lignes de commande : référence au modèle vendu ──────────────────────
-- produit_id (article de stock) et modele_id (produit fini) sont tous deux
-- nullables : une ligne issue d'un devis peut n'avoir ni l'un ni l'autre.

ALTER TABLE public.commandes_lignes
  ADD COLUMN IF NOT EXISTS modele_id UUID REFERENCES public.modeles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_commandes_lignes_modele ON public.commandes_lignes(modele_id);

-- ── 3. Audit : modification du prix public d'un modèle en vitrine ──────────
ALTER TYPE audit_action_type ADD VALUE IF NOT EXISTS 'PRIX_VITRINE_MODIFIE';

-- ── Vérification ─────────────────────────────────────────────────────────
DO $$
BEGIN
  RAISE NOTICE 'Après : modeles=%, commandes_lignes=% (identiques attendus), modeles_shop=%',
    (SELECT count(*) FROM public.modeles),
    (SELECT count(*) FROM public.commandes_lignes),
    (SELECT count(*) FROM public.modeles_shop);
END $$;
