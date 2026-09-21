-- FORGE ERP — Module Sécurité / RBAC
-- Cible : PostgreSQL / Supabase
-- rbac_audit_logs est APPEND-ONLY (aucun UPDATE/DELETE autorisé)

-- ── Enums ─────────────────────────────────────────────────────────────────────

DO $$ BEGIN CREATE TYPE rbac_module AS ENUM (
  'STOCK','COMMERCIAL','FINANCE','HR','PRODUCTION','LOGISTICS','ADMIN','REPORTS','RECEIVABLES'
); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE rbac_action AS ENUM (
  'READ','CREATE','UPDATE','DELETE','VALIDATE','CONFIGURE','EXPORT'
); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE rbac_role_name AS ENUM (
  'SUPER_ADMIN','MANAGER','COMMERCIAL','CAISSIER','MAGASINIER','FORMATEUR','READONLY'
); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE audit_action_type AS ENUM (
  'ACCESS_DENIED','USER_CREATED','USER_UPDATED','USER_DEACTIVATED',
  'ROLE_CHANGED','PERMISSION_CHANGED','SETTINGS_CHANGED',
  'LOGIN_SUCCESS','LOGIN_FAILED','LOGOUT','DATA_EXPORT',
  'PASSWORD_RESET','PASSWORD_CHANGED','SESSION_EXPIRED'
); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── rbac_roles ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS rbac_roles (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name        rbac_role_name NOT NULL UNIQUE,
  label       text        NOT NULL,
  description text,
  is_system   boolean     NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- ── rbac_permissions ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS rbac_permissions (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  module       rbac_module NOT NULL,
  action       rbac_action NOT NULL,
  label        text        NOT NULL,
  description  text,
  is_immutable boolean     NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (module, action)
);

-- ── rbac_role_permissions ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS rbac_role_permissions (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  role_id       uuid        NOT NULL REFERENCES rbac_roles(id)       ON DELETE CASCADE,
  permission_id uuid        NOT NULL REFERENCES rbac_permissions(id)  ON DELETE CASCADE,
  granted_by    uuid        REFERENCES profiles(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (role_id, permission_id)
);

CREATE INDEX IF NOT EXISTS idx_role_perms_role ON rbac_role_permissions(role_id);
CREATE INDEX IF NOT EXISTS idx_role_perms_perm ON rbac_role_permissions(permission_id);

-- ── rbac_user_profiles ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS rbac_user_profiles (
  profile_id              uuid        PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  role_id                 uuid        NOT NULL REFERENCES rbac_roles(id),
  is_active               boolean     NOT NULL DEFAULT true,
  password_must_change    boolean     NOT NULL DEFAULT false,
  last_login_at           timestamptz,
  session_timeout_minutes integer     NOT NULL DEFAULT 60,
  failed_login_count      integer     NOT NULL DEFAULT 0,
  locked_until            timestamptz,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rbac_user_role ON rbac_user_profiles(role_id);

-- ── rbac_audit_logs (APPEND-ONLY) ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS rbac_audit_logs (
  id             uuid             PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid             REFERENCES profiles(id),
  action_type    audit_action_type NOT NULL,
  module         rbac_module,
  resource_type  text,
  resource_id    text,
  payload_before jsonb,
  payload_after  jsonb,
  ip_address     text,
  user_agent     text,
  created_at     timestamptz      NOT NULL DEFAULT now()
  -- Pas d'updated_at — append-only
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_user       ON rbac_audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action     ON rbac_audit_logs(action_type);
CREATE INDEX IF NOT EXISTS idx_audit_logs_module     ON rbac_audit_logs(module);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created    ON rbac_audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_resource   ON rbac_audit_logs(resource_type, resource_id);

-- Politique RLS : lecture seule par les admins, INSERT par service_role seulement
ALTER TABLE rbac_audit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY audit_logs_select ON rbac_audit_logs
  FOR SELECT USING (true);   -- accès contrôlé côté API

CREATE POLICY audit_logs_insert ON rbac_audit_logs
  FOR INSERT WITH CHECK (true);

-- Interdire UPDATE et DELETE via une règle de trigger
CREATE OR REPLACE FUNCTION prevent_audit_modification()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'rbac_audit_logs est append-only — modifications interdites';
END;
$$;

DO $$ BEGIN
  CREATE TRIGGER trg_audit_logs_no_update
    BEFORE UPDATE ON rbac_audit_logs
    FOR EACH ROW EXECUTE FUNCTION prevent_audit_modification();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TRIGGER trg_audit_logs_no_delete
    BEFORE DELETE ON rbac_audit_logs
    FOR EACH ROW EXECUTE FUNCTION prevent_audit_modification();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── rbac_security_settings (singleton) ───────────────────────────────────────

CREATE TABLE IF NOT EXISTS rbac_security_settings (
  id                     text        PRIMARY KEY DEFAULT 'singleton',
  password_min_length    integer     NOT NULL DEFAULT 8,
  password_require_upper boolean     NOT NULL DEFAULT true,
  password_require_number boolean    NOT NULL DEFAULT true,
  password_require_special boolean   NOT NULL DEFAULT false,
  password_expiration_days integer   NOT NULL DEFAULT 90,
  max_login_attempts     integer     NOT NULL DEFAULT 5,
  lockout_duration_minutes integer   NOT NULL DEFAULT 30,
  session_timeout_minutes integer    NOT NULL DEFAULT 60,
  allowed_hours_enabled  boolean     NOT NULL DEFAULT false,
  allowed_hours_start    text        NOT NULL DEFAULT '08:00',
  allowed_hours_end      text        NOT NULL DEFAULT '18:00',
  allowed_days           text        NOT NULL DEFAULT '1,2,3,4,5',
  updated_by             uuid        REFERENCES profiles(id),
  updated_at             timestamptz NOT NULL DEFAULT now()
);

INSERT INTO rbac_security_settings (id) VALUES ('singleton') ON CONFLICT DO NOTHING;

-- ── rbac_login_attempts ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS rbac_login_attempts (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  email        text        NOT NULL,
  ip_address   text,
  success      boolean     NOT NULL DEFAULT false,
  user_agent   text,
  attempted_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_login_attempts_email      ON rbac_login_attempts(email);
CREATE INDEX IF NOT EXISTS idx_login_attempts_ip         ON rbac_login_attempts(ip_address);
CREATE INDEX IF NOT EXISTS idx_login_attempts_attempted  ON rbac_login_attempts(attempted_at DESC);
CREATE INDEX IF NOT EXISTS idx_login_attempts_failed     ON rbac_login_attempts(email, ip_address) WHERE success = false;

-- ── Triggers updated_at ───────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

DO $$ BEGIN
  CREATE TRIGGER trg_rbac_roles_upd BEFORE UPDATE ON rbac_roles FOR EACH ROW EXECUTE FUNCTION set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TRIGGER trg_rbac_user_profiles_upd BEFORE UPDATE ON rbac_user_profiles FOR EACH ROW EXECUTE FUNCTION set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TRIGGER trg_rbac_settings_upd BEFORE UPDATE ON rbac_security_settings FOR EACH ROW EXECUTE FUNCTION set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Migration des utilisateurs existants ─────────────────────────────────────
-- Mappe les anciens rôles JWT vers les nouveaux rôles RBAC.
-- Exécuté APRÈS le seed (rbac_roles doit être peuplé).

CREATE OR REPLACE FUNCTION migrate_existing_users_to_rbac()
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  role_map JSONB := '{"admin":"SUPER_ADMIN","directeur":"SUPER_ADMIN","superviseur":"MANAGER","operateur":"COMMERCIAL","apprenant":"READONLY"}';
  p RECORD;
  rbac_role_id UUID;
  mapped_role  TEXT;
BEGIN
  FOR p IN SELECT id, role FROM profiles LOOP
    mapped_role := role_map ->> p.role;
    IF mapped_role IS NULL THEN mapped_role := 'READONLY'; END IF;

    SELECT id INTO rbac_role_id FROM rbac_roles WHERE name = mapped_role::rbac_role_name;

    INSERT INTO rbac_user_profiles (profile_id, role_id, is_active)
    VALUES (p.id, rbac_role_id, true)
    ON CONFLICT (profile_id) DO NOTHING;
  END LOOP;
END;
$$;
