ALTER TABLE credits
  ADD COLUMN facture_id uuid REFERENCES factures(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_credits_facture_id ON credits(facture_id);
CREATE INDEX IF NOT EXISTS idx_credits_commande_id ON credits(commande_id);
