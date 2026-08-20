/**
 * FORGE ERP — Schéma Drizzle ORM (SQLite) — Module Sécurité / RBAC
 * Tables : rbac_roles, rbac_permissions, rbac_role_permissions,
 *          rbac_user_profiles, rbac_audit_logs, rbac_security_settings,
 *          rbac_login_attempts, rbac_cached_permissions (desktop offline)
 */
import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core'
import { createId } from '@paralleldrive/cuid2'
import { profiles } from './schema'

const now  = () => new Date().toISOString()
const id   = () => text('id').primaryKey().$defaultFn(() => createId())
const ts   = (col: string) => text(col).notNull().$defaultFn(now)
const tsUp = (col: string) => text(col).notNull().$defaultFn(now)

// ── Constantes exportées ──────────────────────────────────────────────────────

export const RBAC_MODULES = [
  'STOCK', 'COMMERCIAL', 'FINANCE', 'HR', 'PRODUCTION',
  'LOGISTICS', 'ADMIN', 'REPORTS', 'RECEIVABLES', 'CAISSE',
] as const

export const RBAC_ACTIONS = [
  'READ', 'CREATE', 'UPDATE', 'DELETE', 'VALIDATE', 'CONFIGURE', 'EXPORT',
] as const

export const RBAC_ROLE_NAMES = [
  'SUPER_ADMIN', 'MANAGER', 'COMMERCIAL', 'CAISSIER',
  'MAGASINIER', 'FORMATEUR', 'READONLY', 'LIVREUR',
] as const

export type RbacModule   = typeof RBAC_MODULES[number]
export type RbacAction   = typeof RBAC_ACTIONS[number]
export type RbacRoleName = typeof RBAC_ROLE_NAMES[number]

export const AUDIT_ACTIONS = [
  'ACCESS_DENIED', 'USER_CREATED', 'USER_UPDATED', 'USER_DEACTIVATED',
  'ROLE_CHANGED', 'PERMISSION_CHANGED', 'SETTINGS_CHANGED',
  'LOGIN_SUCCESS', 'LOGIN_FAILED', 'LOGOUT', 'DATA_EXPORT',
  'PASSWORD_RESET', 'PASSWORD_CHANGED', 'SESSION_EXPIRED',
] as const

export type AuditActionType = typeof AUDIT_ACTIONS[number]

// ── rbac_roles ────────────────────────────────────────────────────────────────

export const rbacRoles = sqliteTable('rbac_roles', {
  id:          id(),
  name:        text('name', { enum: RBAC_ROLE_NAMES }).notNull().unique(),
  label:       text('label').notNull(),
  description: text('description'),
  isSystem:    integer('is_system', { mode: 'boolean' }).notNull().default(true),
  createdAt:   ts('created_at'),
  updatedAt:   tsUp('updated_at'),
})

export type RbacRole    = typeof rbacRoles.$inferSelect
export type NewRbacRole = typeof rbacRoles.$inferInsert

// ── rbac_permissions ──────────────────────────────────────────────────────────

export const rbacPermissions = sqliteTable('rbac_permissions', {
  id:          id(),
  module:      text('module', { enum: RBAC_MODULES }).notNull(),
  action:      text('action', { enum: RBAC_ACTIONS }).notNull(),
  label:       text('label').notNull(),
  description: text('description'),
  isImmutable: integer('is_immutable', { mode: 'boolean' }).notNull().default(false),
  createdAt:   ts('created_at'),
})

export type RbacPermission    = typeof rbacPermissions.$inferSelect
export type NewRbacPermission = typeof rbacPermissions.$inferInsert

// ── rbac_role_permissions ─────────────────────────────────────────────────────

export const rbacRolePermissions = sqliteTable('rbac_role_permissions', {
  id:           id(),
  roleId:       text('role_id').notNull().references(() => rbacRoles.id),
  permissionId: text('permission_id').notNull().references(() => rbacPermissions.id),
  grantedBy:    text('granted_by').references(() => profiles.id),
  createdAt:    ts('created_at'),
})

export type RbacRolePermission    = typeof rbacRolePermissions.$inferSelect
export type NewRbacRolePermission = typeof rbacRolePermissions.$inferInsert

// ── rbac_user_profiles ────────────────────────────────────────────────────────
// Extension 1-1 de profiles : ajoute les métadonnées de sécurité RBAC.

export const rbacUserProfiles = sqliteTable('rbac_user_profiles', {
  profileId:              text('profile_id').primaryKey().references(() => profiles.id),
  roleId:                 text('role_id').notNull().references(() => rbacRoles.id),
  isActive:               integer('is_active',               { mode: 'boolean' }).notNull().default(true),
  passwordMustChange:     integer('password_must_change',    { mode: 'boolean' }).notNull().default(false),
  lastLoginAt:            text('last_login_at'),
  sessionTimeoutMinutes:  integer('session_timeout_minutes').notNull().default(60),
  failedLoginCount:       integer('failed_login_count').notNull().default(0),
  lockedUntil:            text('locked_until'),
  createdAt:              ts('created_at'),
  updatedAt:              tsUp('updated_at'),
})

export type RbacUserProfile    = typeof rbacUserProfiles.$inferSelect
export type NewRbacUserProfile = typeof rbacUserProfiles.$inferInsert

// ── rbac_audit_logs ───────────────────────────────────────────────────────────
// APPEND-ONLY : aucun UPDATE ni DELETE, pas d'updated_at, pas de sync_status.

export const rbacAuditLogs = sqliteTable('rbac_audit_logs', {
  id:            id(),
  userId:        text('user_id').references(() => profiles.id),
  actionType:    text('action_type', { enum: AUDIT_ACTIONS }).notNull(),
  module:        text('module'),
  resourceType:  text('resource_type'),
  resourceId:    text('resource_id'),
  payloadBefore: text('payload_before'), // JSON sérialisé
  payloadAfter:  text('payload_after'),  // JSON sérialisé
  ipAddress:     text('ip_address'),
  userAgent:     text('user_agent'),
  createdAt:     ts('created_at'),
})

export type RbacAuditLog    = typeof rbacAuditLogs.$inferSelect
export type NewRbacAuditLog = typeof rbacAuditLogs.$inferInsert

// ── rbac_security_settings (singleton) ───────────────────────────────────────

export const rbacSecuritySettings = sqliteTable('rbac_security_settings', {
  id:                     text('id').primaryKey().default('singleton'),
  // Politique mot de passe
  passwordMinLength:      integer('password_min_length').notNull().default(8),
  passwordRequireUpper:   integer('password_require_upper',   { mode: 'boolean' }).notNull().default(true),
  passwordRequireNumber:  integer('password_require_number',  { mode: 'boolean' }).notNull().default(true),
  passwordRequireSpecial: integer('password_require_special', { mode: 'boolean' }).notNull().default(false),
  passwordExpirationDays: integer('password_expiration_days').notNull().default(90),
  // Sécurité connexion
  maxLoginAttempts:        integer('max_login_attempts').notNull().default(5),
  lockoutDurationMinutes:  integer('lockout_duration_minutes').notNull().default(30),
  sessionTimeoutMinutes:   integer('session_timeout_minutes').notNull().default(60),
  // Plages horaires
  allowedHoursEnabled:    integer('allowed_hours_enabled',    { mode: 'boolean' }).notNull().default(false),
  allowedHoursStart:      text('allowed_hours_start').notNull().default('08:00'),
  allowedHoursEnd:        text('allowed_hours_end').notNull().default('18:00'),
  allowedDays:            text('allowed_days').notNull().default('1,2,3,4,5'), // 1=Lun, 7=Dim
  updatedBy:              text('updated_by').references(() => profiles.id),
  updatedAt:              tsUp('updated_at'),
})

export type RbacSecuritySettings    = typeof rbacSecuritySettings.$inferSelect
export type NewRbacSecuritySettings = typeof rbacSecuritySettings.$inferInsert

// ── rbac_login_attempts ───────────────────────────────────────────────────────

export const rbacLoginAttempts = sqliteTable('rbac_login_attempts', {
  id:          id(),
  email:       text('email').notNull(),
  ipAddress:   text('ip_address'),
  success:     integer('success', { mode: 'boolean' }).notNull().default(false),
  userAgent:   text('user_agent'),
  attemptedAt: ts('attempted_at'),
})

export type RbacLoginAttempt    = typeof rbacLoginAttempts.$inferSelect
export type NewRbacLoginAttempt = typeof rbacLoginAttempts.$inferInsert

// ── rbac_cached_permissions (desktop offline uniquement) ──────────────────────

export const rbacCachedPermissions = sqliteTable('rbac_cached_permissions', {
  userId:   text('user_id').notNull(),
  module:   text('module').notNull(),
  action:   text('action').notNull(),
  granted:  integer('granted', { mode: 'boolean' }).notNull().default(true),
  cachedAt: ts('cached_at'),
})

export type RbacCachedPermission    = typeof rbacCachedPermissions.$inferSelect
export type NewRbacCachedPermission = typeof rbacCachedPermissions.$inferInsert
