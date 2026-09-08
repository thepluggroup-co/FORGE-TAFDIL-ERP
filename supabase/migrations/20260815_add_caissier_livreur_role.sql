-- ═══════════════════════════════════════════════════════════════════════════
-- FORGE ERP — Ajout du rôle "caissier" + réparation du rôle "livreur"
-- dans le système RBAC Postgres.
--
-- CONTEXTE — deux mécanismes distincts contraignent le rôle côté Postgres :
--
--   1. public.profiles.role : colonne TEXT avec CHECK constraint
--      (CHECK (role IN ('admin','directeur','operateur','viewer')) —
--      cf. 20260524_core_tables_complete.sql / MASTER_MIGRATION.sql).
--      C'est le rôle "legacy" porté par le JWT (raw_app_meta_data->>'role').
--
--   2. rbac_role_name : ENUM Postgres dédié au module RBAC moderne
--      (cf. 20260607_rbac_module.sql). 'CAISSIER' y existe déjà (et est
--      déjà seedé dans rbac_roles avec les permissions RECEIVABLES
--      READ+CREATE) mais 'LIVREUR' n'a JAMAIS été ajouté à cet enum ni
--      à rbac_roles/rbac_role_permissions, alors que le code (mobile,
--      apps/api/src/types.ts, packages/db/src/schema-rbac.ts) l'utilise
--      déjà. Le livreur mobile tourne donc aujourd'hui sans aucune
--      permission RBAC réelle en base.
--
-- CORRECTIF (tentative d'exécution du 2026-09-02) : la première version de
-- cette migration listait ('admin','directeur','operateur','viewer','caissier',
-- 'livreur') — copié du commentaire de 20260524_core_tables_complete.sql sans
-- vérifier les valeurs RÉELLEMENT en base. Or la contrainte live avait déjà
-- été élargie ailleurs (hors migration trackée) pour accepter 'superviseur' —
-- au moins une ligne profiles.role='superviseur' existe déjà en prod. La
-- première tentative a donc échoué : "check constraint ... is violated by
-- some row". Liste corrigée ci-dessous = union de tout ce qui est légitime :
-- valeurs déjà vues en base (admin, superviseur, operateur) + valeurs legacy
-- gérées en entrée par apps/web/src/context/AuthContext.tsx::LEGACY_ROLE_MAP
-- (directeur, viewer) + valeurs applicatives modernes pas encore utilisées
-- mais valides (technicien, caissier) + le nouveau rôle livreur.

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('admin', 'directeur', 'operateur', 'viewer', 'superviseur', 'technicien', 'caissier', 'livreur'));

-- ── 2. rbac_role_name — ajouter LIVREUR (CAISSIER existe déjà) ──────────────

DO $$ BEGIN
  ALTER TYPE rbac_role_name ADD VALUE IF NOT EXISTS 'LIVREUR';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── 3. rbac_roles — seed du rôle LIVREUR (manquant) ─────────────────────────

INSERT INTO rbac_roles (name, label, description, is_system) VALUES
  ('LIVREUR', 'Livreur', 'Livraisons et signature bon de livraison uniquement', true)
ON CONFLICT (name) DO NOTHING;

-- ── 4. rbac_role_permissions — LIVREUR : LOGISTICS READ + UPDATE ───────────
-- Correspond à l'usage réel côté mobile : fetchMesLivraisons (LOGISTICS:READ),
-- updateLivraisonStatut / signLivraison (LOGISTICS:UPDATE).

INSERT INTO rbac_role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM rbac_roles r, rbac_permissions p
WHERE r.name = 'LIVREUR'
  AND p.module = 'LOGISTICS'
  AND p.action IN ('READ', 'UPDATE')
ON CONFLICT DO NOTHING;

-- ── 5. rbac_role_permissions — CAISSIER : ajout STOCK READ ──────────────────
-- CAISSIER a déjà RECEIVABLES READ+CREATE (20260607_rbac_module.sql).
-- Complément pour "consulter le stock en lecture seule" (PROMPT 1, fondations
-- transverses). Les permissions liées aux tickets de vente/remises seront
-- ajoutées avec le module CAISSE lors du prompt dédié aux tables Caisse.

INSERT INTO rbac_role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM rbac_roles r, rbac_permissions p
WHERE r.name = 'CAISSIER'
  AND p.module = 'STOCK'
  AND p.action = 'READ'
ON CONFLICT DO NOTHING;

-- ── 6. Vérification ──────────────────────────────────────────────────────────

SELECT r.name, r.label, p.module, p.action
FROM rbac_roles r
JOIN rbac_role_permissions rp ON rp.role_id = r.id
JOIN rbac_permissions p       ON p.id = rp.permission_id
WHERE r.name IN ('CAISSIER', 'LIVREUR')
ORDER BY r.name, p.module, p.action;

-- ═══════════════════════════════════════════════════════════════════════════
-- APPLICATION — cette migration N'A PAS été exécutée.
--
-- Option A (recommandée, cohérente avec FIX_ADMIN_ROLE.sql/SETUP_ADMIN.sql
-- déjà présents dans ce dossier) :
--   Supabase Dashboard → SQL Editor → coller le contenu de ce fichier → Run.
--
-- Option B (si le CLI Supabase est lié au projet) :
--   supabase db push
--
-- Option C (accès direct psql) :
--   psql "$DATABASE_URL" -f supabase/migrations/20260815_add_caissier_livreur_role.sql
-- ═══════════════════════════════════════════════════════════════════════════
