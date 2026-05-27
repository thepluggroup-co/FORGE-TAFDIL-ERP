-- ═══════════════════════════════════════════════════════════════════════════
-- FORGE ERP — Fix admin role for admin@tafdiil.com
-- Run in Supabase Dashboard → SQL Editor
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. Ensure profiles trigger exists (safe to re-run)
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, role)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_app_meta_data->>'role', 'operateur')
  )
  ON CONFLICT (id) DO UPDATE
    SET email = EXCLUDED.email,
        role  = COALESCE(NEW.raw_app_meta_data->>'role', profiles.role);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT OR UPDATE ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 2. Set admin role in auth.users app_metadata (JWT will carry this role)
UPDATE auth.users
SET raw_app_meta_data = COALESCE(raw_app_meta_data, '{}'::jsonb) || '{"role": "admin"}'::jsonb
WHERE email = 'admin@tafdiil.com';

-- 3. Upsert profile row with admin role
INSERT INTO public.profiles (id, email, role, actif)
SELECT id, email, 'admin', true
FROM auth.users
WHERE email = 'admin@tafdiil.com'
ON CONFLICT (id) DO UPDATE SET role = 'admin', actif = true;

-- 4. Verify — you should see role = 'admin' in both columns
SELECT
  u.email,
  u.raw_app_meta_data->>'role'  AS jwt_role,
  p.role                         AS profile_role,
  p.actif
FROM auth.users u
LEFT JOIN public.profiles p ON p.id = u.id
WHERE u.email = 'admin@tafdiil.com';
