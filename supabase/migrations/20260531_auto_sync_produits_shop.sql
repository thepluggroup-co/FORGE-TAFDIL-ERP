-- ═══════════════════════════════════════════════════════════════════════════
-- FORGE ERP — Auto-sync produits → produits_shop
-- Objectif :
--   1. Trigger : chaque nouveau produit ERP crée automatiquement une ligne
--      dans produits_shop (visible_shop = false par défaut).
--   2. Backfill : synchro des produits existants non encore présents.
--   3. Colonne type_projet sur demandes_devis_web pour séparer les types.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Trigger auto-création produits_shop ─────────────────────────────────

CREATE OR REPLACE FUNCTION public.fn_auto_create_produit_shop()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.produits_shop (product_id, visible_shop, prix_public)
  VALUES (NEW.id, true, 0)
  ON CONFLICT (product_id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_create_produit_shop ON public.produits;
CREATE TRIGGER trg_auto_create_produit_shop
  AFTER INSERT ON public.produits
  FOR EACH ROW EXECUTE FUNCTION public.fn_auto_create_produit_shop();

-- ── 2. Backfill : produits existants sans entrée shop ──────────────────────

INSERT INTO public.produits_shop (product_id, visible_shop, prix_public)
SELECT id, true, 0
FROM   public.produits
WHERE  id NOT IN (SELECT product_id FROM public.produits_shop)
ON CONFLICT (product_id) DO NOTHING;

-- Activer les produits déjà présents mais masqués (visible_shop = false)
UPDATE public.produits_shop SET visible_shop = true WHERE visible_shop = false;

-- ── 3. Colonne type_projet sur demandes_devis_web ──────────────────────────

ALTER TABLE public.demandes_devis_web
  ADD COLUMN IF NOT EXISTS type_projet TEXT,
  ADD COLUMN IF NOT EXISTS produit_ref TEXT;

-- ── Vérification ──────────────────────────────────────────────────────────

DO $$
DECLARE
  v_trigger_count INTEGER;
  v_synced        INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_trigger_count
  FROM pg_trigger
  WHERE tgname = 'trg_auto_create_produit_shop';

  SELECT COUNT(*) INTO v_synced
  FROM public.produits p
  WHERE EXISTS (SELECT 1 FROM public.produits_shop ps WHERE ps.product_id = p.id);

  RAISE NOTICE 'Trigger créé : %, Produits synchronisés : %', v_trigger_count, v_synced;
END;
$$;
