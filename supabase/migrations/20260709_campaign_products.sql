-- Liaison campagnes marketing -> produits shop avec remise/prix promotionnel.

CREATE TABLE IF NOT EXISTS public.campagnes_produits (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  campagne_id     UUID        NOT NULL REFERENCES public.campagnes_marketing(id) ON DELETE CASCADE,
  product_id      UUID        NOT NULL REFERENCES public.produits(id) ON DELETE CASCADE,
  remise_type     TEXT        NOT NULL DEFAULT 'pct' CHECK (remise_type IN ('pct','forfait')),
  remise_valeur   NUMERIC     NOT NULL DEFAULT 0,
  prix_promo_xaf  NUMERIC,
  priorite        INTEGER     NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (campagne_id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_campagnes_produits_campagne ON public.campagnes_produits(campagne_id);
CREATE INDEX IF NOT EXISTS idx_campagnes_produits_product ON public.campagnes_produits(product_id);

CREATE OR REPLACE TRIGGER trg_campagnes_produits_updated_at
  BEFORE UPDATE ON public.campagnes_produits
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.campagnes_produits ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "campagnes_produits_all" ON public.campagnes_produits;
CREATE POLICY "campagnes_produits_all" ON public.campagnes_produits FOR ALL USING (true) WITH CHECK (true);
