-- Remplit les montants manquants des bons de sortie issus des commandes web.
-- Certains bons crees par le fallback "WEB-${ref}" n'avaient pas montant_total_xaf,
-- ce qui faisait afficher "Sur devis" dans le tableau.

ALTER TABLE public.bons_sortie
  ADD COLUMN IF NOT EXISTS montant_total_xaf NUMERIC;

ALTER TABLE public.bons_sortie
  ADD COLUMN IF NOT EXISTS commande_id UUID REFERENCES public.commandes(id) ON DELETE SET NULL;

UPDATE public.bons_sortie AS b
SET montant_total_xaf = cs.montant_ttc
FROM public.commandes_shop AS cs
WHERE b.montant_total_xaf IS NULL
  AND cs.montant_ttc IS NOT NULL
  AND (
    b.demandeur = cs.ref
    OR b.numero = ('WEB-' || cs.ref)
    OR (b.commande_id IS NOT NULL AND b.commande_id = cs.erp_commande_id)
  );
