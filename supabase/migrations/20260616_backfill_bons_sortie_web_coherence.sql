-- Rattrape la coherence des anciens bons de sortie issus des commandes web :
-- - rattache le bon a la commande ERP miroir quand elle existe ;
-- - rattache les lignes aux produits via commandes_shop.lignes->product_id ;
-- - remplace l'unite generique par l'unite produit ;
-- - pour les bons deja executes, aligne la quantite servie sur la demandee
--   quand aucune quantite servie n'avait ete enregistree.

ALTER TABLE public.bons_sortie
  ADD COLUMN IF NOT EXISTS commande_id UUID REFERENCES public.commandes(id) ON DELETE SET NULL;

UPDATE public.bons_sortie AS b
SET commande_id = cs.erp_commande_id
FROM public.commandes_shop AS cs
WHERE b.commande_id IS NULL
  AND cs.erp_commande_id IS NOT NULL
  AND (
    b.demandeur = cs.ref
    OR b.numero = ('WEB-' || cs.ref)
  );

WITH shop_lignes AS (
  SELECT
    cs.ref,
    cs.erp_commande_id,
    elem->>'designation' AS designation,
    elem->>'product_id' AS product_id,
    NULLIF(elem->>'quantite', '')::NUMERIC AS quantite
  FROM public.commandes_shop AS cs
  CROSS JOIN LATERAL jsonb_array_elements(COALESCE(cs.lignes::jsonb, '[]'::jsonb)) AS elem
  WHERE elem ? 'product_id'
)
UPDATE public.bons_sortie_lignes AS bsl
SET produit_id = sl.product_id::UUID
FROM public.bons_sortie AS b, shop_lignes AS sl
WHERE bsl.bon_id = b.id
  AND bsl.produit_id IS NULL
  AND sl.product_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  AND (
    b.demandeur = sl.ref
    OR b.numero = ('WEB-' || sl.ref)
    OR (b.commande_id IS NOT NULL AND b.commande_id = sl.erp_commande_id)
  )
  AND lower(trim(bsl.designation)) = lower(trim(sl.designation))
  AND bsl.quantite_demandee = sl.quantite;

UPDATE public.bons_sortie_lignes AS bsl
SET unite = p.unite
FROM public.produits AS p
WHERE bsl.produit_id = p.id
  AND p.unite IS NOT NULL
  AND p.unite <> '';

UPDATE public.bons_sortie_lignes AS bsl
SET quantite_servie = bsl.quantite_demandee
FROM public.bons_sortie AS b
WHERE bsl.bon_id = b.id
  AND b.statut = 'execute'
  AND COALESCE(bsl.quantite_servie, 0) = 0;
