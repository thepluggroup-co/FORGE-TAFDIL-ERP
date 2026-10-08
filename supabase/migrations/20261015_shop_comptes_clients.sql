-- ═══════════════════════════════════════════════════════════════════════════
-- Shop — comptes clients : email, Google, Facebook (en plus du code SMS)
--
-- Les clients du shop restent SÉPARÉS des comptes du personnel ERP : ils ne
-- passent jamais par Supabase Auth (session signée par le shop, cookie
-- forge-shop-token). Un même client peut se connecter par téléphone, email,
-- Google ou Facebook ; le compte est commun dès que le téléphone ou l'email
-- (vérifié) correspond.
--
-- 1. clients_shop : le téléphone devient facultatif (compte Google/Facebook/
--    email sans téléphone) ; email unique (insensible à la casse) ;
--    identifiants Google/Facebook ; photo de profil.
-- 2. shop_email_codes : codes de connexion à 6 chiffres envoyés par email
--    (hachés, 10 minutes, 5 essais).
--
-- RLS sans politique : accès par l'API uniquement (clé service_role).
-- Rollback : DROP TABLE public.shop_email_codes ; ALTER TABLE public.clients_shop
--   DROP COLUMN google_id, DROP COLUMN facebook_id, DROP COLUMN avatar_url,
--   DROP COLUMN email_verifie ; (téléphone NOT NULL seulement s'il n'y a pas
--   de compte sans téléphone).
--
-- APPLICATION — SQL Editor, après 20261013_shop_auth_otp.sql. Ré-exécutable.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.clients_shop ALTER COLUMN telephone DROP NOT NULL;

ALTER TABLE public.clients_shop
  ADD COLUMN IF NOT EXISTS email_verifie BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS google_id     TEXT,
  ADD COLUMN IF NOT EXISTS facebook_id   TEXT,
  ADD COLUMN IF NOT EXISTS avatar_url    TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_clients_shop_email_unique
  ON public.clients_shop (lower(email)) WHERE email IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_clients_shop_google
  ON public.clients_shop (google_id) WHERE google_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_clients_shop_facebook
  ON public.clients_shop (facebook_id) WHERE facebook_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.shop_email_codes (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  email       TEXT        NOT NULL,
  code_hash   TEXT        NOT NULL,
  salt        TEXT        NOT NULL,
  tentatives  INTEGER     NOT NULL DEFAULT 0,
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_shop_email_codes_email ON public.shop_email_codes (lower(email), created_at DESC);
ALTER TABLE public.shop_email_codes ENABLE ROW LEVEL SECURITY;

-- ── Vérification ──────────────────────────────────────────────────────────────
SELECT column_name, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'clients_shop'
  AND column_name IN ('telephone', 'email', 'email_verifie', 'google_id', 'facebook_id', 'avatar_url')
ORDER BY column_name;
