ALTER TABLE public.devis_lignes
  ADD COLUMN IF NOT EXISTS produit_id UUID REFERENCES public.produits(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_devis_lignes_produit
  ON public.devis_lignes(produit_id)
  WHERE produit_id IS NOT NULL;
