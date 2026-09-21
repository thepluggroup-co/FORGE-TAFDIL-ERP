-- ═══════════════════════════════════════════════════════════════════════
-- FORGE ERP — Fix: role trigger ne doit PAS écraser profiles.role lors
--              des refreshs de token (UPDATE sur auth.users).
--
-- ROOT CAUSE : le trigger AFTER INSERT OR UPDATE écrasait profiles.role
--   avec raw_app_meta_data->>'role' à chaque rafraîchissement JWT (~1h).
--   Si l'app_metadata avait encore les anciens noms de rôles, le rôle
--   s'affichait différemment à chaque refresh.
--
-- SOLUTION : INSERT seulement pour les nouveaux utilisateurs.
--            UPDATE : synchroniser uniquement l'email, jamais le rôle.
-- ═══════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  initial_role TEXT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- Normaliser le rôle initial (gère les anciens noms)
    initial_role := CASE COALESCE(NEW.raw_app_meta_data->>'role', '')
      WHEN 'directeur' THEN 'admin'
      WHEN 'viewer'    THEN 'apprenant'
      WHEN ''          THEN 'operateur'
      ELSE COALESCE(NEW.raw_app_meta_data->>'role', 'operateur')
    END;

    INSERT INTO public.profiles (id, email, role)
    VALUES (NEW.id, NEW.email, initial_role)
    ON CONFLICT (id) DO NOTHING;   -- profil existant → ne pas toucher

  ELSE
    -- UPDATE (refresh token, maj email, etc.) : sync email uniquement
    UPDATE public.profiles
       SET email      = NEW.email,
           updated_at = now()
     WHERE id = NEW.id
       AND email != NEW.email;   -- éviter write inutile si email inchangé
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT OR UPDATE ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ── Mettre à jour raw_app_meta_data pour les utilisateurs avec anciens rôles ──
-- (Évite que le JWT porte 'directeur' ou 'viewer' même si profiles.role est correct)
UPDATE auth.users
SET raw_app_meta_data = raw_app_meta_data || jsonb_build_object('role',
  CASE raw_app_meta_data->>'role'
    WHEN 'directeur' THEN 'admin'
    WHEN 'viewer'    THEN 'apprenant'
    ELSE raw_app_meta_data->>'role'
  END
)
WHERE raw_app_meta_data->>'role' IN ('directeur', 'viewer');

-- ── Vérification ──────────────────────────────────────────────────────────────
SELECT
  u.email,
  u.raw_app_meta_data->>'role'  AS jwt_role,
  p.role                         AS profile_role
FROM auth.users u
LEFT JOIN public.profiles p ON p.id = u.id
ORDER BY u.email;
