-- ═══════════════════════════════════════════════════════════════════════════
-- CATALOGUE HYBRIDE — Promotions sur les produits finis STANDARD
--
-- Une ligne de campagnes_produits vise désormais SOIT un article de stock
-- (product_id, inchangé), SOIT un produit fini (modele_id, nouveau).
-- Additif : toutes les lignes existantes ont un product_id et restent valides.
--
-- Rollback (seulement si aucune promotion ne vise un modèle) :
--   ALTER TABLE public.campagnes_produits DROP CONSTRAINT campagnes_produits_une_cible;
--   ALTER TABLE public.campagnes_produits DROP CONSTRAINT campagnes_produits_campagne_modele_key;
--   ALTER TABLE public.campagnes_produits DROP COLUMN modele_id;
--   ALTER TABLE public.campagnes_produits ALTER COLUMN product_id SET NOT NULL;
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
BEGIN
  RAISE NOTICE 'Avant : campagnes_produits=%', (SELECT count(*) FROM public.campagnes_produits);
END $$;

ALTER TABLE public.campagnes_produits
  ADD COLUMN IF NOT EXISTS modele_id UUID REFERENCES public.modeles(id) ON DELETE CASCADE;

ALTER TABLE public.campagnes_produits
  ALTER COLUMN product_id DROP NOT NULL;

-- Exactement une cible par ligne
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'campagnes_produits_une_cible') THEN
    ALTER TABLE public.campagnes_produits
      ADD CONSTRAINT campagnes_produits_une_cible
      CHECK ((product_id IS NULL) <> (modele_id IS NULL));
  END IF;
END $$;

-- Un produit fini au plus une fois par campagne (sert aussi d'arbitre à l'upsert de l'API)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'campagnes_produits_campagne_modele_key') THEN
    ALTER TABLE public.campagnes_produits
      ADD CONSTRAINT campagnes_produits_campagne_modele_key UNIQUE (campagne_id, modele_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_campagnes_produits_modele ON public.campagnes_produits(modele_id);

DO $$
BEGIN
  RAISE NOTICE 'Après : campagnes_produits=% (identique attendu)', (SELECT count(*) FROM public.campagnes_produits);
END $$;
