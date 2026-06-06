-- Contrainte unique sur presences(employe_id, date) pour le pointage rapide (upsert)
-- Sans cette contrainte, le ON CONFLICT dans usePresenceBatch échoue silencieusement.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'presences_employe_date_unique'
  ) THEN
    ALTER TABLE public.presences
      ADD CONSTRAINT presences_employe_date_unique UNIQUE (employe_id, date);
  END IF;
END$$;
