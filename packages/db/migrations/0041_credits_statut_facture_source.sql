UPDATE credits
SET statut = 'echu'
WHERE statut = 'en_retard';

UPDATE credits
SET statut = 'rembourse'
WHERE statut = 'solde';

ALTER TABLE credits
  DROP CONSTRAINT IF EXISTS credits_statut_check;

ALTER TABLE credits
  ADD CONSTRAINT credits_statut_check
  CHECK (statut IN ('en_cours', 'echu', 'rembourse'));
