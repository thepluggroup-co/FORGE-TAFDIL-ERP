-- ═══════════════════════════════════════════════════════════════════════════
-- FORGE ERP — Correctifs issus de la campagne de tests multi-profils (2026-10-05)
--
-- 1. BUG-01 — commandes_shop lisible par n'importe qui avec la clé anonyme
--    (politique `commandes_shop_select_public` USING (true), laissée en place
--    par 20260930_shop_securite_prix_rls.sql). La page de suivi du shop passe
--    désormais par l'API (clé service_role) et n'utilise plus le Realtime
--    anonyme ; seul le personnel authentifié de l'ERP web (hooks + Realtime)
--    lit encore la table directement. La lecture est donc réservée au rôle
--    `authenticated`. Les clients du shop ne sont pas des utilisateurs Supabase
--    Auth (JWT maison, apps/shop/lib/auth.ts) : ils ne sont pas concernés.
--
--    ⚠ Si l'inscription publique Supabase Auth est activée, tout inscrit
--    devient `authenticated` : vérifier Dashboard → Authentication → Providers
--    → Email → « Allow new users to sign up » = désactivé (l'ERP fonctionne
--    sur invitation).
--
-- 2. BUG-03 — le rôle COMMERCIAL (operateur) avait PRODUCTION CREATE/UPDATE/
--    VALIDATE (20260903) mais pas READ : il créait des jobs qu'il ne pouvait
--    pas lister, et le web lui masquait Production, Catalogue, Équipements et
--    Projets. Ajout de PRODUCTION:READ.
--
-- Rollback :
--   DROP POLICY "commandes_shop_select_staff" ON public.commandes_shop;
--   CREATE POLICY "commandes_shop_select_public" ON public.commandes_shop FOR SELECT USING (true);
--   DELETE FROM rbac_role_permissions WHERE role_id = (SELECT id FROM rbac_roles WHERE name = 'COMMERCIAL')
--     AND permission_id = (SELECT id FROM rbac_permissions WHERE module = 'PRODUCTION' AND action = 'READ');
--
-- APPLICATION — Supabase Dashboard → SQL Editor → coller → Run, APRÈS le
-- déploiement de l'API et du shop de cette branche (sinon la page de suivi,
-- encore en lecture anonyme, renverrait 404). Ré-exécutable sans risque.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. commandes_shop : lecture réservée au personnel authentifié ──────────
DROP POLICY IF EXISTS "commandes_shop_select_public" ON public.commandes_shop;
DROP POLICY IF EXISTS "commandes_shop_select_staff"  ON public.commandes_shop;
CREATE POLICY "commandes_shop_select_staff" ON public.commandes_shop
  FOR SELECT TO authenticated USING (true);

ALTER TABLE public.commandes_shop ENABLE ROW LEVEL SECURITY;

-- ── 2. COMMERCIAL : PRODUCTION:READ ────────────────────────────────────────
INSERT INTO rbac_role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM rbac_roles r, rbac_permissions p
WHERE r.name = 'COMMERCIAL'
  AND p.module = 'PRODUCTION'
  AND p.action = 'READ'
ON CONFLICT DO NOTHING;

-- ── Vérification ──────────────────────────────────────────────────────────────
SELECT policyname, roles, cmd
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'commandes_shop';

SELECT r.name, p.module, p.action
FROM rbac_roles r
JOIN rbac_role_permissions rp ON rp.role_id = r.id
JOIN rbac_permissions p       ON p.id = rp.permission_id
WHERE r.name = 'COMMERCIAL' AND p.module = 'PRODUCTION'
ORDER BY p.action;
