ALTER TABLE public.credits
  ADD COLUMN IF NOT EXISTS facture_id UUID REFERENCES public.factures(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_credits_facture_id ON public.credits(facture_id);
CREATE INDEX IF NOT EXISTS idx_credits_commande_id ON public.credits(commande_id);
