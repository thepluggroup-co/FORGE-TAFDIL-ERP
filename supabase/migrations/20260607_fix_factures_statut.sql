-- Fix factures.statut constraint to match API values
-- Old: ('brouillon','envoyee','payee','partiellement_payee','en_retard','annulee')
-- New: ('brouillon','valide','envoye','paye','annule')

BEGIN;

-- Migrate existing rows with old spellings before dropping constraint
UPDATE public.factures SET statut = 'envoye'    WHERE statut = 'envoyee';
UPDATE public.factures SET statut = 'paye'      WHERE statut = 'payee' OR statut = 'partiellement_payee';
UPDATE public.factures SET statut = 'annule'    WHERE statut = 'annulee';
-- 'en_retard' has no API equivalent — treat as brouillon (unpaid, unvalidated)
UPDATE public.factures SET statut = 'brouillon' WHERE statut = 'en_retard';

-- Replace constraint
ALTER TABLE public.factures DROP CONSTRAINT IF EXISTS factures_statut_check;
ALTER TABLE public.factures
  ADD CONSTRAINT factures_statut_check
  CHECK (statut IN ('brouillon','valide','envoye','paye','annule'));

COMMIT;
