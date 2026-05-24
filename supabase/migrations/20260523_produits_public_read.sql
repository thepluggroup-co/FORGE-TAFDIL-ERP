-- Allow anonymous/public read access to produits table
-- This is required for the shop catalogue endpoint (GET /api/shop/catalogue)
-- which joins produits_shop with produits using an !inner join via the anon key client.
-- Without this policy, the join fails with a PostgREST RLS permission error (500).

CREATE POLICY IF NOT EXISTS "produits_read_public"
  ON public.produits
  FOR SELECT
  USING (true);
