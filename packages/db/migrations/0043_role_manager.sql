-- Fusion des anciens profils superviseur dans le rôle manager.
-- Dans le RBAC déployé, le profil superviseur était déjà mappé vers MANAGER
-- (voir LEGACY_ROLE_MAP et la matrice MANAGER). Aucun droit exclusif au seul
-- superviseur n'existait donc à reporter : les deux profils reçoivent le même
-- jeu de permissions MANAGER, sans élargissement de privilèges.
BEGIN;

UPDATE auth.users
SET raw_app_meta_data = jsonb_set(COALESCE(raw_app_meta_data, '{}'::jsonb), '{role}', '"manager"'::jsonb, true)
WHERE raw_app_meta_data->>'role' = 'superviseur';

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
UPDATE public.profiles SET role = 'manager' WHERE role = 'superviseur';

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('admin', 'directeur', 'manager', 'operateur', 'viewer', 'technicien', 'caissier', 'livreur', 'apprenant'));

DROP POLICY IF EXISTS "admin_supervisor_read_all_bl" ON public.bons_livraison;
CREATE POLICY "admin_manager_read_all_bl" ON public.bons_livraison
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role IN ('admin', 'manager'))
  );

COMMIT;
