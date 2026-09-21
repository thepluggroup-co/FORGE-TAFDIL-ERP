-- Informations d'identification propres à chaque type de client.
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS niu TEXT,
  ADD COLUMN IF NOT EXISTS rccm TEXT,
  ADD COLUMN IF NOT EXISTS numero_cni TEXT,
  ADD COLUMN IF NOT EXISTS profession TEXT,
  ADD COLUMN IF NOT EXISTS identifiant_administratif TEXT,
  ADD COLUMN IF NOT EXISTS service TEXT;

-- L'application utilise "institution" pour les organismes publics et privés.
ALTER TABLE public.clients DROP CONSTRAINT IF EXISTS clients_type_check;
UPDATE public.clients SET type = 'institution' WHERE type = 'administration';
ALTER TABLE public.clients
  ADD CONSTRAINT clients_type_check
  CHECK (type IN ('particulier', 'entreprise', 'institution'));
