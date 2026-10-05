-- ═══════════════════════════════════════════════════════════════════════════
-- FORGE ERP — Formation : parcours individuel du technicien
--
-- Le technicien (READONLY) n'a plus accès au module RH (règle immuable,
-- 20261011 / rbacService.ts) mais doit suivre SON parcours de formation, et
-- uniquement le sien.
--
-- 1. apprenants.profile_id : rattache une fiche apprenant à un compte
--    utilisateur (un compte ↔ au plus un apprenant). Renseigné par la RH via
--    PATCH /api/rh/apprenants/:id/compte. L'API sert ensuite
--    GET /api/formation/mon-parcours en filtrant sur ce lien.
--
-- 2. RLS : apprenants, validations_niveau, formation_sessions et
--    formation_inscriptions étaient ouvertes à tous (`USING (true)` ou RLS
--    désactivé) — un technicien connecté, voire un anonyme avec la clé
--    publique, pouvait lire tous les parcours via l'API REST Supabase.
--    Aucun client (web, mobile, desktop, shop) ne lit ces tables
--    directement : tout passe par l'API Hono (clé service_role, qui contourne
--    RLS). On active donc RLS SANS politique : seule l'API y accède.
--
-- Rollback :
--   ALTER TABLE public.apprenants DROP COLUMN profile_id;
--   CREATE POLICY "apprenants_all" ON public.apprenants FOR ALL USING (true) WITH CHECK (true);
--   CREATE POLICY "validations_all" ON public.validations_niveau FOR ALL USING (true) WITH CHECK (true);
--   ALTER TABLE public.formation_sessions     DISABLE ROW LEVEL SECURITY;
--   ALTER TABLE public.formation_inscriptions DISABLE ROW LEVEL SECURITY;
--
-- APPLICATION — Supabase Dashboard → SQL Editor → coller → Run, AVANT le
-- déploiement de l'API de cette branche (les nouvelles routes lisent
-- profile_id). Ré-exécutable sans risque.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Lien compte ↔ apprenant ────────────────────────────────────────────
ALTER TABLE public.apprenants
  ADD COLUMN IF NOT EXISTS profile_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_apprenants_profile_id
  ON public.apprenants(profile_id) WHERE profile_id IS NOT NULL;

-- ── 2. RLS : accès réservé à l'API (service_role) ──────────────────────────
DROP POLICY IF EXISTS "apprenants_all"  ON public.apprenants;
DROP POLICY IF EXISTS "validations_all" ON public.validations_niveau;

ALTER TABLE public.apprenants             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.validations_niveau     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.formation_sessions     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.formation_inscriptions ENABLE ROW LEVEL SECURITY;

-- ── Vérification ──────────────────────────────────────────────────────────────
SELECT tablename, rowsecurity,
       (SELECT count(*) FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = t.tablename) AS nb_politiques
FROM pg_tables t
WHERE schemaname = 'public'
  AND tablename IN ('apprenants', 'validations_niveau', 'formation_sessions', 'formation_inscriptions')
ORDER BY tablename;

SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'apprenants' AND column_name = 'profile_id';
