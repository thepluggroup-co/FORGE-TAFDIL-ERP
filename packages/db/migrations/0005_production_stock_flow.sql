-- Production stock flow: a production job can feed inventory and optionally publish to shop.

ALTER TABLE jobs_production
  ADD COLUMN IF NOT EXISTS type_job text NOT NULL DEFAULT 'commande';

ALTER TABLE jobs_production
  ADD COLUMN IF NOT EXISTS produit_id uuid REFERENCES produits(id);

ALTER TABLE jobs_production
  ADD COLUMN IF NOT EXISTS produit_ref text;

ALTER TABLE jobs_production
  ADD COLUMN IF NOT EXISTS categorie text;

ALTER TABLE jobs_production
  ADD COLUMN IF NOT EXISTS unite text;

ALTER TABLE jobs_production
  ADD COLUMN IF NOT EXISTS quantite_prevue numeric(12,2);

ALTER TABLE jobs_production
  ADD COLUMN IF NOT EXISTS quantite_produite numeric(12,2);

ALTER TABLE jobs_production
  ADD COLUMN IF NOT EXISTS prix_unitaire_xaf numeric(12,2);

ALTER TABLE jobs_production
  ADD COLUMN IF NOT EXISTS prix_public_xaf numeric(12,2);

ALTER TABLE jobs_production
  ADD COLUMN IF NOT EXISTS publier_shop boolean NOT NULL DEFAULT false;

ALTER TABLE jobs_production
  ADD COLUMN IF NOT EXISTS description_produit text;

ALTER TABLE jobs_production
  DROP CONSTRAINT IF EXISTS jobs_production_type_job_check;

ALTER TABLE jobs_production
  ADD CONSTRAINT jobs_production_type_job_check
  CHECK (type_job IN ('commande', 'stock'));
