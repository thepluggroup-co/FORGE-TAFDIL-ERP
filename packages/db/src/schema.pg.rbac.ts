/**
 * FORGE ERP — Schéma Drizzle ORM (PostgreSQL / Supabase) — Module RBAC
 * Miroir de schema-rbac.ts, dialecte PostgreSQL.
 */
import {
  pgTable, uuid, text, integer, boolean,
  timestamp, pgEnum, jsonb,
} from 'drizzle-orm/pg-core'

// ── Helpers ───────────────────────────────────────────────────────────────────

const id  = () => uuid('id').primaryKey().defaultRandom()
const ts  = (col: string) => timestamp(col, { withTimezone: true }).notNull().defaultNow()
const tsN = (col: string) => timestamp(col, { withTimezone: true })

// ── Enums PostgreSQL ──────────────────────────────────────────────────────────

export const rbacModuleEnum = pgEnum('rbac_module', [
  'STOCK', 'COMMERCIAL', 'FINANCE', 'HR', 'PRODUCTION',
  'LOGISTICS', 'ADMIN', 'REPORTS', 'RECEIVABLES',
])

export const rbacActionEnum = pgEnum('rbac_action', [
  'READ', 'CREATE', 'UPDATE', 'DELETE', 'VALIDATE', 'CONFIGURE', 'EXPORT',
])

export const rbacRoleNameEnum = pgEnum('rbac_role_name', [
  'SUPER_ADMIN', 'MANAGER', 'COMMERCIAL', 'CAISSIER',
  'MAGASINIER', 'FORMATEUR', 'READONLY',
])

export const auditActionEnum = pgEnum('audit_action_type', [
  'ACCESS_DENIED', 'USER_CREATED', 'USER_UPDATED', 'USER_DEACTIVATED',
  'ROLE_CHANGED', 'PERMISSION_CHANGED', 'SETTINGS_CHANGED',
  'LOGIN_SUCCESS', 'LOGIN_FAILED', 'LOGOUT', 'DATA_EXPORT',
  'PASSWORD_RESET', 'PASSWORD_CHANGED', 'SESSION_EXPIRED',
])

// ── rbac_roles ────────────────────────────────────────────────────────────────

export const rbacRolesPg = pgTable('rbac_roles', {
  id:          id(),
  name:        rbacRoleNameEnum('name').notNull().unique(),
  label:       text('label').notNull(),
  description: text('description'),
  isSystem:    boolean('is_system').notNull().default(true),
  createdAt:   ts('created_at'),
  updatedAt:   ts('updated_at'),
})

export type RbacRolePg    = typeof rbacRolesPg.$inferSelect
export type NewRbacRolePg = typeof rbacRolesPg.$inferInsert

// ── rbac_permissions ──────────────────────────────────────────────────────────

export const rbacPermissionsPg = pgTable('rbac_permissions', {
  id:          id(),
  module:      rbacModuleEnum('module').notNull(),
  action:      rbacActionEnum('action').notNull(),
  label:       text('label').notNull(),
  description: text('description'),
  isImmutable: boolean('is_immutable').notNull().default(false),
  createdAt:   ts('created_at'),
})

export type RbacPermissionPg    = typeof rbacPermissionsPg.$inferSelect
export type NewRbacPermissionPg = typeof rbacPermissionsPg.$inferInsert

// ── rbac_role_permissions ─────────────────────────────────────────────────────

export const rbacRolePermissionsPg = pgTable('rbac_role_permissions', {
  id:           id(),
  roleId:       uuid('role_id').notNull(),           // FK → rbac_roles(id)
  permissionId: uuid('permission_id').notNull(),     // FK → rbac_permissions(id)
  grantedBy:    uuid('granted_by'),                  // FK → profiles(id)
  createdAt:    ts('created_at'),
})

export type RbacRolePermissionPg    = typeof rbacRolePermissionsPg.$inferSelect
export type NewRbacRolePermissionPg = typeof rbacRolePermissionsPg.$inferInsert

// ── rbac_user_profiles ────────────────────────────────────────────────────────

export const rbacUserProfilesPg = pgTable('rbac_user_profiles', {
  profileId:             uuid('profile_id').primaryKey(),   // FK → profiles(id)
  roleId:                uuid('role_id').notNull(),          // FK → rbac_roles(id)
  isActive:              boolean('is_active').notNull().default(true),
  passwordMustChange:    boolean('password_must_change').notNull().default(false),
  lastLoginAt:           tsN('last_login_at'),
  sessionTimeoutMinutes: integer('session_timeout_minutes').notNull().default(60),
  failedLoginCount:      integer('failed_login_count').notNull().default(0),
  lockedUntil:           tsN('locked_until'),
  createdAt:             ts('created_at'),
  updatedAt:             ts('updated_at'),
})

export type RbacUserProfilePg    = typeof rbacUserProfilesPg.$inferSelect
export type NewRbacUserProfilePg = typeof rbacUserProfilesPg.$inferInsert

// ── rbac_audit_logs (append-only) ────────────────────────────────────────────

export const rbacAuditLogsPg = pgTable('rbac_audit_logs', {
  id:            id(),
  userId:        uuid('user_id'),                    // FK → profiles(id), nullable (actions anonymes)
  actionType:    auditActionEnum('action_type').notNull(),
  module:        rbacModuleEnum('module'),
  resourceType:  text('resource_type'),
  resourceId:    text('resource_id'),
  payloadBefore: jsonb('payload_before'),
  payloadAfter:  jsonb('payload_after'),
  ipAddress:     text('ip_address'),
  userAgent:     text('user_agent'),
  createdAt:     ts('created_at'),
  // Pas d'updated_at — append-only
})

export type RbacAuditLogPg    = typeof rbacAuditLogsPg.$inferSelect
export type NewRbacAuditLogPg = typeof rbacAuditLogsPg.$inferInsert

// ── rbac_security_settings (singleton) ───────────────────────────────────────

export const rbacSecuritySettingsPg = pgTable('rbac_security_settings', {
  id:                     text('id').primaryKey().default('singleton'),
  passwordMinLength:      integer('password_min_length').notNull().default(8),
  passwordRequireUpper:   boolean('password_require_upper').notNull().default(true),
  passwordRequireNumber:  boolean('password_require_number').notNull().default(true),
  passwordRequireSpecial: boolean('password_require_special').notNull().default(false),
  passwordExpirationDays: integer('password_expiration_days').notNull().default(90),
  maxLoginAttempts:       integer('max_login_attempts').notNull().default(5),
  lockoutDurationMinutes: integer('lockout_duration_minutes').notNull().default(30),
  sessionTimeoutMinutes:  integer('session_timeout_minutes').notNull().default(60),
  allowedHoursEnabled:    boolean('allowed_hours_enabled').notNull().default(false),
  allowedHoursStart:      text('allowed_hours_start').notNull().default('08:00'),
  allowedHoursEnd:        text('allowed_hours_end').notNull().default('18:00'),
  allowedDays:            text('allowed_days').notNull().default('1,2,3,4,5'),
  updatedBy:              uuid('updated_by'),        // FK → profiles(id)
  updatedAt:              ts('updated_at'),
})

export type RbacSecuritySettingsPg    = typeof rbacSecuritySettingsPg.$inferSelect
export type NewRbacSecuritySettingsPg = typeof rbacSecuritySettingsPg.$inferInsert

// ── rbac_login_attempts ───────────────────────────────────────────────────────

export const rbacLoginAttemptsPg = pgTable('rbac_login_attempts', {
  id:          id(),
  email:       text('email').notNull(),
  ipAddress:   text('ip_address'),
  success:     boolean('success').notNull().default(false),
  userAgent:   text('user_agent'),
  attemptedAt: ts('attempted_at'),
})

export type RbacLoginAttemptPg    = typeof rbacLoginAttemptsPg.$inferSelect
export type NewRbacLoginAttemptPg = typeof rbacLoginAttemptsPg.$inferInsert
