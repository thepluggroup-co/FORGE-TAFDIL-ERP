-- Ajout colonne adresse sur profiles
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS adresse TEXT;
