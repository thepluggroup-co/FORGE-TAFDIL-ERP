-- Logistics workflow: dedicated delivery statuses and history.

ALTER TABLE livraisons
  ALTER COLUMN statut TYPE text USING statut::text;

ALTER TABLE livraisons
  ALTER COLUMN statut SET DEFAULT 'planifiee';

UPDATE livraisons
SET statut = CASE statut
  WHEN 'confirmed' THEN 'planifiee'
  WHEN 'pret' THEN 'en_transit'
  WHEN 'delivered' THEN 'livree'
  WHEN 'cancelled' THEN 'annulee'
  ELSE statut
END;

ALTER TABLE livraisons
  DROP CONSTRAINT IF EXISTS livraisons_statut_check;

ALTER TABLE livraisons
  ADD CONSTRAINT livraisons_statut_check
  CHECK (statut IN ('planifiee', 'en_transit', 'livree', 'annulee'));

CREATE TABLE IF NOT EXISTS livraisons_historique (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  livraison_id uuid NOT NULL REFERENCES livraisons(id) ON DELETE CASCADE,
  ancien_statut text,
  nouveau_statut text NOT NULL,
  commentaire text,
  changed_by uuid REFERENCES profiles(id),
  changed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_livraisons_historique_livraison
  ON livraisons_historique(livraison_id, changed_at DESC);
