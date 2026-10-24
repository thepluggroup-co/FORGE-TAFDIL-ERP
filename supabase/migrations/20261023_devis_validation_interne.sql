-- Validation interne d'un devis (admin/superviseur) sans attendre le lien d'approbation
-- client. Distincte de DEVIS_VALIDATION_CLIENT (approbation via le lien token public).
-- PATCH /devis/:id/statut → accepte marque approuve_par_client = true et journalise
-- cette action pour garder la trace du canal utilisé en cas de litige.
ALTER TYPE audit_action_type ADD VALUE IF NOT EXISTS 'DEVIS_VALIDE_INTERNE';
