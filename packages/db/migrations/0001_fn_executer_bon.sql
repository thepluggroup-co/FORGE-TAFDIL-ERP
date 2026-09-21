-- ============================================================================
-- FORGE ERP — Migration 0001 : fn_executer_bon
-- Exécution atomique d'un bon de sortie (ALL-or-NOTHING)
-- À appliquer dans : Supabase Dashboard → SQL Editor → Run
-- ============================================================================

CREATE OR REPLACE FUNCTION fn_executer_bon(
  p_bon_id             UUID,
  p_user_id            UUID,
  p_quantites_reelles  JSONB DEFAULT NULL   -- [{ligne_id, quantite_servie}]
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_bon          bons_sortie%ROWTYPE;
  v_ligne        bons_sortie_lignes%ROWTYPE;
  v_produit      produits%ROWTYPE;
  v_qte_servie   NUMERIC;
  v_nouvelle_qte NUMERIC;
  v_statut       TEXT;
BEGIN
  -- ── 1. Verrouiller + récupérer le bon ──────────────────────────────────────
  SELECT * INTO v_bon
  FROM bons_sortie
  WHERE id = p_bon_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'BON_NOT_FOUND: Bon % introuvable', p_bon_id;
  END IF;

  IF v_bon.statut <> 'valide' THEN
    RAISE EXCEPTION 'INVALID_TRANSITION: Impossible d''exécuter un bon en statut "%". Statut requis : valide.', v_bon.statut;
  END IF;

  -- ── 2. Vérification préalable du stock (pré-vol ALL-or-NOTHING) ────────────
  FOR v_ligne IN
    SELECT bsl.*
    FROM bons_sortie_lignes bsl
    WHERE bsl.bon_id = p_bon_id
      AND bsl.produit_id IS NOT NULL
  LOOP
    -- Quantité réelle si fournie, sinon quantité demandée
    v_qte_servie := COALESCE(
      (SELECT (elem->>'quantite_servie')::NUMERIC
       FROM jsonb_array_elements(p_quantites_reelles) AS elem
       WHERE elem->>'ligne_id' = v_ligne.id::TEXT
       LIMIT 1),
      v_ligne.quantite_demandee
    );

    -- Verrouiller le produit pour éviter la race condition
    SELECT * INTO v_produit
    FROM produits
    WHERE id = v_ligne.produit_id
    FOR UPDATE;

    IF v_produit.stock_actuel < v_qte_servie THEN
      RAISE EXCEPTION 'INSUFFICIENT_STOCK: Stock insuffisant pour "%" — disponible: %, demandé: %',
        v_ligne.designation,
        v_produit.stock_actuel,
        v_qte_servie;
    END IF;
  END LOOP;

  -- ── 3. Exécution : déduire + mouvements + mise à jour lignes ───────────────
  FOR v_ligne IN
    SELECT bsl.*
    FROM bons_sortie_lignes bsl
    WHERE bsl.bon_id = p_bon_id
  LOOP
    v_qte_servie := COALESCE(
      (SELECT (elem->>'quantite_servie')::NUMERIC
       FROM jsonb_array_elements(p_quantites_reelles) AS elem
       WHERE elem->>'ligne_id' = v_ligne.id::TEXT
       LIMIT 1),
      v_ligne.quantite_demandee
    );

    -- Mettre à jour la quantité servie sur la ligne
    UPDATE bons_sortie_lignes
    SET quantite_servie = v_qte_servie
    WHERE id = v_ligne.id;

    -- Déduire du stock si produit référencé
    IF v_ligne.produit_id IS NOT NULL AND v_qte_servie > 0 THEN

      -- Mouvement de sortie
      INSERT INTO mouvements_stock (produit_id, type, quantite, reference, notes, created_by)
      VALUES (
        v_ligne.produit_id,
        'sortie',
        v_qte_servie,
        v_bon.numero,
        'Exécution bon ' || v_bon.numero,
        p_user_id
      );

      -- Récupérer le stock actuel (déjà verrouillé en étape 2)
      SELECT * INTO v_produit FROM produits WHERE id = v_ligne.produit_id;

      v_nouvelle_qte := GREATEST(0, v_produit.stock_actuel - v_qte_servie);

      v_statut := CASE
        WHEN v_nouvelle_qte = 0                              THEN 'rupture'
        WHEN v_nouvelle_qte <= v_produit.stock_critique      THEN 'critique'
        WHEN v_nouvelle_qte <= v_produit.stock_min           THEN 'alerte'
        ELSE 'normal'
      END;

      UPDATE produits
      SET
        stock_actuel = v_nouvelle_qte,
        statut       = v_statut::produit_statut,
        updated_at   = NOW()
      WHERE id = v_ligne.produit_id;

    END IF;
  END LOOP;

  -- ── 4. Marquer le bon comme exécuté ────────────────────────────────────────
  UPDATE bons_sortie
  SET statut     = 'execute',
      updated_at = NOW()
  WHERE id = p_bon_id;

  RETURN jsonb_build_object(
    'success', true,
    'bon_id',  p_bon_id,
    'numero',  v_bon.numero
  );

EXCEPTION
  WHEN OTHERS THEN
    -- PostgreSQL rollback automatique — propager l'erreur proprement
    RAISE;
END;
$$;

-- Autoriser l'appel depuis le rôle anon/authenticated via Supabase
GRANT EXECUTE ON FUNCTION fn_executer_bon(UUID, UUID, JSONB) TO authenticated;
REVOKE EXECUTE ON FUNCTION fn_executer_bon(UUID, UUID, JSONB) FROM anon;
