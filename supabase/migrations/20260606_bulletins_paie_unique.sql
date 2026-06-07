-- Contrainte unique sur bulletins_paie(employe_id, mois)
-- Requise pour le upsert batch dans genererBulletinsMois()

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'bulletins_paie_employe_mois_unique'
  ) THEN
    ALTER TABLE public.bulletins_paie
      ADD CONSTRAINT bulletins_paie_employe_mois_unique UNIQUE (employe_id, mois);
  END IF;
END$$;

-- Contrainte unique sur presences(employe_id, date)
-- Requise pour le upsert dans usePresenceBatch()

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
