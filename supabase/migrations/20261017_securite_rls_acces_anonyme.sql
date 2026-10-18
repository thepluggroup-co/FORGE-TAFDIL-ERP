-- ═══════════════════════════════════════════════════════════════════════════
-- FORGE ERP — Sécurité : fermer l'accès anonyme à la base (RLS)
--
-- CONSTAT (revue de sécurité du 2026-10-12)
--   La plupart des tables ont une politique `FOR ALL USING (true)` sans rôle
--   (donc valable pour `anon`), ou RLS désactivé. Or la clé anonyme Supabase est
--   publique par nature (elle est dans le site web, l'app mobile et
--   l'installateur desktop). Conséquence : sans se connecter, n'importe qui peut
--   lire ET modifier clients, factures, bulletins de paie, etc. en appelant
--   directement l'API REST de Supabase. Cas le plus grave : `user_pins` et
--   `profiles` étant modifiables, on pouvait se fabriquer un PIN puis ouvrir la
--   session de n'importe quel compte, administrateur compris.
--
-- CE QUE FAIT CETTE MIGRATION
--   1. Tables d'identifiants / de droits / de journaux : accès service_role
--      uniquement (elles ne sont lues et écrites que par l'API).
--   2. `profiles` : lecture seule pour le personnel connecté (l'ERP web la lit
--      directement) ; les écritures passent par l'API.
--   3. Toutes les autres politiques ouvertes à PUBLIC → réservées au rôle
--      `authenticated` (personnel connecté). Leur contenu ne change pas : ce que
--      le personnel peut faire aujourd'hui depuis l'ERP web reste possible.
--   4. Tables dont RLS est désactivé → RLS activé, avec une politique
--      « personnel connecté » si la table n'en a aucune (même accès qu'avant
--      pour le personnel, plus rien pour les anonymes).
--   5. Lecture publique du shop recréée explicitement, limitée aux produits
--      visibles en boutique et aux campagnes actives.
--   6. Vues et fonctions SECURITY DEFINER : plus accessibles au rôle `anon`.
--   7. otp_sessions.tentatives : compteur d'essais du code de connexion du shop.
--
-- CE QU'ELLE NE FAIT PAS (voir le compte rendu de la revue)
--   Les politiques restent « tout le personnel connecté » : un technicien peut
--   encore lire une table de paie en interrogeant Supabase directement avec son
--   propre jeton. Les droits par rôle ne sont appliqués que par l'API. Les
--   restreindre en base demande de faire passer ces lectures par l'API d'abord.
--
-- ⚠ ORDRE DE DÉPLOIEMENT — À RESPECTER
--   a) Déployer d'abord l'API et le shop de cette branche.
--   b) Publier la mise à jour DESKTOP de cette branche et attendre que les
--      postes l'aient installée : les versions ≤ 1.0.1 synchronisent leurs
--      données avec la clé anonyme seule et ne recevraient plus rien après
--      cette migration (les données déjà en local restent consultables).
--   c) Supabase Dashboard → Authentication → Sign In / Providers → Email :
--      « Allow new users to sign up » DÉSACTIVÉ. Sinon tout inscrit devient
--      `authenticated` et retrouve l'accès que cette migration retire aux
--      anonymes. Contrôle (doit ne lister que des comptes du personnel) :
--        SELECT email, raw_app_meta_data->>'role' AS role, created_at
--        FROM auth.users ORDER BY created_at DESC;
--   d) Appliquer cette migration (SQL Editor → coller → Run), puis vérifier
--      l'ERP web, la page catalogue du shop et une synchro desktop.
--
-- Ré-exécutable sans risque. Ne modifie aucune donnée.
--
-- RETOUR ARRIÈRE D'URGENCE (si un écran ne charge plus) — par table concernée :
--   CREATE POLICY urgence_personnel ON public.<table>
--     FOR ALL TO authenticated USING (true) WITH CHECK (true);
--   (ne rouvrir à `anon` qu'en dernier recours, et temporairement.)
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. Tables réservées à l'API (service_role) ──────────────────────────────
-- Vérifié dans apps/web, apps/mobile, apps/desktop et apps/shop : aucune n'est
-- lue ni écrite avec la clé anonyme ou un jeton utilisateur.
DO $$
DECLARE
  t text;
  p record;
  tables_api text[] := ARRAY[
    'user_pins', 'phone_otp_codes', 'otp_sessions', 'shop_email_codes',
    'clients_shop', 'push_tokens',
    'rbac_user_profiles', 'rbac_roles', 'rbac_permissions', 'rbac_role_permissions',
    'rbac_security_settings', 'rbac_login_attempts', 'rbac_audit_logs',
    'audit_log', 'email_queue'
  ];
BEGIN
  FOREACH t IN ARRAY tables_api LOOP
    IF to_regclass('public.' || quote_ident(t)) IS NULL THEN
      RAISE NOTICE 'table % absente — ignorée', t;
      CONTINUE;
    END IF;
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    FOR p IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = t LOOP
      EXECUTE format('DROP POLICY %I ON public.%I', p.policyname, t);
    END LOOP;
  END LOOP;
END $$;

-- ── 2. profiles : lecture seule pour le personnel connecté ──────────────────
-- Une écriture directe permettait de changer l'email ou le téléphone d'un
-- profil, donc de détourner la connexion par PIN vers un autre compte.
DO $$
DECLARE p record;
BEGIN
  IF to_regclass('public.profiles') IS NULL THEN RETURN; END IF;
  ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
  FOR p IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'profiles' LOOP
    EXECUTE format('DROP POLICY %I ON public.profiles', p.policyname);
  END LOOP;
  CREATE POLICY profiles_lecture_personnel ON public.profiles
    FOR SELECT TO authenticated USING (true);
END $$;

-- ── 3. Politiques ouvertes à PUBLIC → personnel connecté uniquement ─────────
DO $$
DECLARE p record;
BEGIN
  FOR p IN
    SELECT tablename, policyname FROM pg_policies
    WHERE schemaname = 'public' AND 'public' = ANY (roles)
  LOOP
    EXECUTE format('ALTER POLICY %I ON public.%I TO authenticated', p.policyname, p.tablename);
  END LOOP;
END $$;

-- ── 4. Tables sans RLS → RLS activé, accès conservé au personnel connecté ───
DO $$
DECLARE t text;
BEGIN
  FOR t IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND NOT c.relrowsecurity
  LOOP
    BEGIN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
      IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = t) THEN
        EXECUTE format(
          'CREATE POLICY personnel_acces ON public.%I FOR ALL TO authenticated USING (true) WITH CHECK (true)', t);
      END IF;
    EXCEPTION WHEN insufficient_privilege THEN
      -- table d'une extension, non modifiable depuis le SQL Editor
      RAISE NOTICE 'table % non modifiable (extension ?) — à vérifier à la main', t;
    END;
  END LOOP;
END $$;

-- ── 5. Lecture publique du shop (clé anonyme) ───────────────────────────────
-- Le shop lit ces tables sans connexion : catalogue, plan du site, promotions,
-- et mise à jour en direct du stock affiché. Rien d'autre n'est public.
DO $$
BEGIN
  IF to_regclass('public.produits_shop') IS NOT NULL THEN
    DROP POLICY IF EXISTS shop_lecture_publique ON public.produits_shop;
    CREATE POLICY shop_lecture_publique ON public.produits_shop
      FOR SELECT TO anon USING (visible_shop = true);
  END IF;

  IF to_regclass('public.produits') IS NOT NULL AND to_regclass('public.produits_shop') IS NOT NULL THEN
    DROP POLICY IF EXISTS shop_lecture_publique ON public.produits;
    CREATE POLICY shop_lecture_publique ON public.produits
      FOR SELECT TO anon USING (
        EXISTS (
          SELECT 1 FROM public.produits_shop ps
          WHERE ps.product_id = produits.id AND ps.visible_shop = true
        )
      );
  END IF;

  IF to_regclass('public.campagnes_marketing') IS NOT NULL THEN
    DROP POLICY IF EXISTS shop_lecture_publique ON public.campagnes_marketing;
    CREATE POLICY shop_lecture_publique ON public.campagnes_marketing
      FOR SELECT TO anon USING (statut = 'active');
  END IF;

  IF to_regclass('public.campagnes_produits') IS NOT NULL THEN
    DROP POLICY IF EXISTS shop_lecture_publique ON public.campagnes_produits;
    CREATE POLICY shop_lecture_publique ON public.campagnes_produits
      FOR SELECT TO anon USING (true);
  END IF;
END $$;

-- ── 6. Vues et fonctions : plus rien pour `anon` ────────────────────────────
-- Une vue s'exécute avec les droits de son propriétaire : elle contourne RLS.
-- Une fonction SECURITY DEFINER aussi (fn_dashboard_kpis exposait les
-- indicateurs financiers, fn_mouvement_stock permettait de modifier le stock).
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT c.relname
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('v', 'm')
  LOOP
    BEGIN
      EXECUTE format('REVOKE ALL ON public.%I FROM anon, PUBLIC', r.relname);
    EXCEPTION WHEN insufficient_privilege THEN
      RAISE NOTICE 'vue % non modifiable — à vérifier à la main', r.relname;
    END;
  END LOOP;

  FOR r IN
    SELECT p.oid::regprocedure AS signature
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prosecdef
  LOOP
    BEGIN
      EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM anon, PUBLIC', r.signature);
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', r.signature);
    EXCEPTION WHEN insufficient_privilege THEN
      RAISE NOTICE 'fonction % non modifiable — à vérifier à la main', r.signature;
    END;
  END LOOP;
END $$;

-- ── 7. Shop : compteur d'essais du code de connexion par SMS ────────────────
-- Tant que la colonne n'existe pas, le shop invalide le code dès la première
-- erreur de saisie ; avec elle, le client a droit à 5 essais.
ALTER TABLE IF EXISTS public.otp_sessions
  ADD COLUMN IF NOT EXISTS tentatives integer NOT NULL DEFAULT 0;

COMMIT;

-- ── Vérification (lecture seule) ────────────────────────────────────────────
-- a) Aucune table sans RLS : cette requête doit renvoyer zéro ligne.
SELECT c.relname AS table_sans_rls
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND NOT c.relrowsecurity;

-- b) Ce qui reste accessible sans connexion : seules les 4 politiques
--    « shop_lecture_publique » doivent apparaître.
SELECT tablename, policyname, cmd, roles
FROM pg_policies
WHERE schemaname = 'public' AND (roles && ARRAY['anon', 'public']::name[])
ORDER BY tablename, policyname;
