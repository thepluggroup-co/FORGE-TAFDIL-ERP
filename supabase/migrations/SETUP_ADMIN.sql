-- ═══════════════════════════════════════════════════════════════════════════
-- FORGE ERP — One-time admin setup
-- Run this once in Supabase Dashboard → SQL Editor after creating your user.
-- Replace 'admin@tafdil.com' with your actual email.
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. Add auto-create profile trigger (safe to re-run)
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

-- 2. Set your user's role to 'admin' in app_metadata
--    (this is what the API reads from the JWT)
UPDATE auth.users
SET raw_app_meta_data = raw_app_meta_data || '{"role": "admin"}'::jsonb
WHERE email = 'admin@tafdil.com';   -- ← change to your email

-- 3. Create or update the profiles row for your user
INSERT INTO public.profiles (id, email, role)
SELECT id, email, 'admin'
FROM auth.users
WHERE email = 'admin@tafdil.com'    -- ← change to your email
ON CONFLICT (id) DO UPDATE SET role = 'admin';

-- 4. Verify
SELECT u.email, u.raw_app_meta_data->>'role' AS jwt_role, p.role AS profile_role
FROM auth.users u
LEFT JOIN public.profiles p ON p.id = u.id
WHERE u.email = 'admin@tafdil.com'; -- ← change to your email
