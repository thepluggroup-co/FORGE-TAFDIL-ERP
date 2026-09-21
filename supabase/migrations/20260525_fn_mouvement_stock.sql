-- ═══════════════════════════════════════════════════════════════════════════
-- FORGE ERP — fn_mouvement_stock
-- Mouvement de stock atomique (SELECT FOR UPDATE, ALL-or-NOTHING)
-- Appelé par :  1) RPC direct depuis l'API  (/api/stocks/:id/mouvement)
--               2) Trigger trg_produits_stock_init (stock initial à la création)
-- Safe to run multiple times — uses OR REPLACE / DROP IF EXISTS
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Fonction principale ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_mouvement_stock(
  p_produit_id UUID,
  p_type       TEXT,          -- 'entree' | 'sortie' | 'ajustement' | 'transfert'
  p_quantite   NUMERIC,
  p_reference  TEXT    DEFAULT NULL,
  p_notes      TEXT    DEFAULT NULL,
  p_user_id    UUID    DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_produit  produits%ROWTYPE;
  v_nouvelle_qte NUMERIC;
  v_statut   TEXT;
  v_mvt_id   UUID;
BEGIN
  -- Verrouiller le produit pour éviter les race conditions
  SELECT * INTO v_produit
  FROM public.produits
  WHERE id = p_produit_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PRODUIT_NOT_FOUND: Produit % introuvable', p_produit_id;
  END IF;

  -- Calculer la nouvelle quantité selon le type
  CASE p_type
    WHEN 'entree' THEN
      v_nouvelle_qte := v_produit.stock_actuel + p_quantite;

    WHEN 'sortie' THEN
      IF v_produit.stock_actuel < p_quantite THEN
        RAISE EXCEPTION 'INSUFFICIENT_STOCK: Stock insuffisant — disponible: %, demandé: %',
          v_produit.stock_actuel, p_quantite;
      END IF;
      v_nouvelle_qte := v_produit.stock_actuel - p_quantite;

    WHEN 'ajustement' THEN
      -- Ajustement = nouvelle valeur absolue
      v_nouvelle_qte := p_quantite;

    WHEN 'transfert' THEN
      IF v_produit.stock_actuel < p_quantite THEN
        RAISE EXCEPTION 'INSUFFICIENT_STOCK: Stock insuffisant pour transfert — disponible: %, demandé: %',
          v_produit.stock_actuel, p_quantite;
      END IF;
      v_nouvelle_qte := v_produit.stock_actuel - p_quantite;

    ELSE
      RAISE EXCEPTION 'INVALID_TYPE: Type de mouvement invalide: %', p_type;
  END CASE;

  -- Calculer le nouveau statut
  v_statut := CASE
    WHEN v_nouvelle_qte = 0                                THEN 'rupture'
    WHEN v_nouvelle_qte <= v_produit.stock_critique        THEN 'critique'
    WHEN v_nouvelle_qte <= v_produit.stock_min             THEN 'alerte'
    ELSE 'normal'
  END;

  -- Insérer le mouvement
  INSERT INTO public.mouvements_stock (produit_id, type, quantite, reference, notes, created_by)
  VALUES (p_produit_id, p_type, p_quantite, p_reference, p_notes, p_user_id)
  RETURNING id INTO v_mvt_id;

  -- Mettre à jour le stock et le statut du produit
  UPDATE public.produits
  SET
    stock_actuel = v_nouvelle_qte,
    statut       = v_statut,
    updated_at   = now()
  WHERE id = p_produit_id;

  RETURN jsonb_build_object(
    'success',       true,
    'mouvement_id',  v_mvt_id,
    'produit_id',    p_produit_id,
    'type',          p_type,
    'quantite',      p_quantite,
    'stock_avant',   v_produit.stock_actuel,
    'stock_apres',   v_nouvelle_qte,
    'statut',        v_statut
  );

EXCEPTION
  WHEN OTHERS THEN
    RAISE;
END;
$$;

-- Permissions
GRANT EXECUTE ON FUNCTION public.fn_mouvement_stock(UUID, TEXT, NUMERIC, TEXT, TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_mouvement_stock(UUID, TEXT, NUMERIC, TEXT, TEXT, UUID) TO service_role;


-- ── 2. Trigger : stock initial à la création du produit ───────────────────────
-- Quand un produit est créé avec stock_actuel > 0, enregistre un mouvement
-- "entrée" initial dans mouvements_stock.

CREATE OR REPLACE FUNCTION public.fn_produits_stock_init()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.stock_actuel > 0 THEN
    INSERT INTO public.mouvements_stock (produit_id, type, quantite, reference, notes, created_by)
    VALUES (
      NEW.id,
      'entree',
      NEW.stock_actuel,
      'INIT',
      'Stock initial à la création',
      NEW.created_by
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_produits_stock_init ON public.produits;
CREATE TRIGGER trg_produits_stock_init
  AFTER INSERT ON public.produits
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_produits_stock_init();
