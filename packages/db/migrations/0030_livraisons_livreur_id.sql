-- Ajout de livreur_id sur livraisons pour le rôle LIVREUR (Prompt 1 — mobile delivery workflow)
ALTER TABLE livraisons ADD COLUMN IF NOT EXISTS livreur_id uuid REFERENCES profiles(id);

CREATE INDEX IF NOT EXISTS idx_livraisons_livreur_id ON livraisons(livreur_id);
