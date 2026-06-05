-- Align invoice status constraint with the ERP finance workflow.

ALTER TABLE factures
  DROP CONSTRAINT IF EXISTS factures_statut_check;

UPDATE factures
SET statut = CASE statut
  WHEN 'payee' THEN 'paye'
  WHEN 'payé' THEN 'paye'
  WHEN 'payée' THEN 'paye'
  WHEN 'envoyee' THEN 'envoye'
  WHEN 'envoyé' THEN 'envoye'
  WHEN 'envoyée' THEN 'envoye'
  WHEN 'validee' THEN 'valide'
  WHEN 'validé' THEN 'valide'
  WHEN 'validée' THEN 'valide'
  WHEN 'annulee' THEN 'annule'
  WHEN 'annulé' THEN 'annule'
  WHEN 'annulée' THEN 'annule'
  ELSE statut
END;

ALTER TABLE factures
  ADD CONSTRAINT factures_statut_check
  CHECK (statut IN ('brouillon', 'valide', 'envoye', 'paye', 'annule'));
