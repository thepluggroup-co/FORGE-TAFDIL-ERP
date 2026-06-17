-- Rattrape les factures manquantes pour les bons de sortie deja valides/executes.
-- Couvre les bons web crees sans commande_id lorsque commandes_shop.erp_commande_id existe.

UPDATE public.bons_sortie AS b
SET commande_id = cs.erp_commande_id,
    updated_at = now()
FROM public.commandes_shop AS cs
WHERE b.commande_id IS NULL
  AND cs.erp_commande_id IS NOT NULL
  AND b.demandeur = cs.ref;

WITH candidates AS (
  SELECT DISTINCT ON (c.id)
    c.id AS commande_id,
    c.client_id,
    c.client_nom,
    c.total_ht_xaf,
    c.tva_xaf,
    COALESCE(c.frais_livraison_xaf, 0) AS frais_livraison_xaf,
    c.total_ttc_xaf,
    COALESCE(c.montant_paye_xaf, 0) AS montant_paye_xaf,
    b.id AS bon_id
  FROM public.bons_sortie AS b
  JOIN public.commandes AS c ON c.id = b.commande_id
  WHERE b.statut IN ('valide', 'execute')
    AND NOT EXISTS (
      SELECT 1
      FROM public.factures AS f
      WHERE f.commande_id = c.id
        AND f.statut <> 'annule'
    )
  ORDER BY c.id, b.updated_at DESC NULLS LAST, b.created_at DESC
),
numbered AS (
  SELECT
    candidates.*,
    row_number() OVER (ORDER BY commande_id) AS rn,
    (
      SELECT count(*)
      FROM public.factures
      WHERE created_at >= date_trunc('year', now())
    ) AS base_count
  FROM candidates
),
inserted AS (
  INSERT INTO public.factures (
    numero,
    commande_id,
    client_id,
    client_nom,
    statut,
    date_emission,
    date_echeance,
    total_ht_xaf,
    tva_xaf,
    frais_livraison_xaf,
    total_ttc_xaf,
    montant_paye_xaf,
    notes,
    sync_status
  )
  SELECT
    'FAC-' || extract(year from now())::int || '-' || lpad((base_count + rn)::text, 4, '0'),
    commande_id,
    client_id,
    client_nom,
    CASE
      WHEN montant_paye_xaf >= total_ttc_xaf THEN 'paye'
      WHEN montant_paye_xaf > 0 THEN 'envoye'
      ELSE 'brouillon'
    END,
    current_date::text,
    (current_date + interval '7 days')::date::text,
    total_ht_xaf,
    tva_xaf,
    frais_livraison_xaf,
    total_ttc_xaf,
    LEAST(montant_paye_xaf, total_ttc_xaf),
    'Facture generee automatiquement par rattrapage des bons de sortie.',
    'synced'
  FROM numbered
  RETURNING id, commande_id
)
INSERT INTO public.factures_lignes (
  facture_id,
  designation,
  unite,
  quantite,
  prix_unitaire_ht_xaf,
  total_ht_xaf,
  ordre
)
SELECT
  inserted.id,
  cl.designation,
  COALESCE(cl.unite, 'unite'),
  cl.quantite,
  cl.prix_unitaire_ht_xaf,
  cl.total_ht_xaf,
  COALESCE(cl.ordre, 0)
FROM inserted
JOIN public.commandes_lignes AS cl ON cl.commande_id = inserted.commande_id;
