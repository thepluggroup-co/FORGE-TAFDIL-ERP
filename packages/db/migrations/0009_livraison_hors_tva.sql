ALTER TABLE commandes
  ADD COLUMN IF NOT EXISTS frais_livraison_xaf numeric(12,2) NOT NULL DEFAULT 0;

ALTER TABLE factures
  ADD COLUMN IF NOT EXISTS frais_livraison_xaf numeric(12,2) NOT NULL DEFAULT 0;
