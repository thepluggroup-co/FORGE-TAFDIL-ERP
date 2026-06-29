/**
 * FORGE ERP — Service RBAC
 * Gestion des permissions, audit trail, et tentatives de connexion.
 *
 * Ordre de priorité :
 *   1. IMMUTABLE_RULES (jamais de DB query)
 *   2. Cache mémoire TTL 5 min
 *   3. DB PostgreSQL / Supabase
 *   4. Fallback rôle JWT legacy si pas de rbac_user_profiles
 */
import { supabaseAdmin } from '@forge/db'
import type { RbacModule, RbacAction, AuditActionType } from '@forge/db'

const db = supabaseAdmin!

// ── Types ─────────────────────────────────────────────────────────────────────

export interface PermissionResult {
  allowed: boolean
  reason?: string
  roleName?: string
}

export interface LoginCheckResult {
  blocked: boolean
  remainingAttempts: number
  blockedUntil?: Date
}

export interface WriteAuditInput {
  userId?: string
  actionType: AuditActionType
  module?: RbacModule
  resourceType?: string
  resourceId?: string
  payloadBefore?: unknown
  payloadAfter?: unknown
  ipAddress?: string
  userAgent?: string
}

// ── Cache permissions (in-memory, TTL 5 min) ─────────────────────────────────

interface CacheEntry {
  perms: Set<string>   // 'MODULE:ACTION'
  roleName: string
  expiresAt: number
}

const _permCache = new Map<string, CacheEntry>()
const CACHE_TTL_MS = 5 * 60 * 1000   // 5 minutes

function getCached(userId: string): CacheEntry | null {
  const entry = _permCache.get(userId)
  if (!entry) return null
  if (Date.now() > entry.expiresAt) { _permCache.delete(userId); return null }
  return entry
}

export function invalidatePermissionCache(userId: string): void {
  _permCache.delete(userId)
  console.info('[rbac:cache] invalidé', { userId })
}

export function invalidateAllPermissionCaches(): void {
  _permCache.clear()
  console.info('[rbac:cache] cache complet effacé')
}

// ── IMMUTABLE_RULES (vérifiées avant toute DB query) ─────────────────────────
// Ces règles ne peuvent jamais être contredites par la DB.

function checkImmutableRules(
  roleName: string | undefined,
  module: RbacModule,
  action: RbacAction,
): { decision: 'ALLOW' | 'DENY' | 'PASS' } {
  // READONLY ne peut jamais écrire
  if (roleName === 'READONLY' && action !== 'READ' && action !== 'EXPORT') {
    return { decision: 'DENY' }
  }

  // ADMIN:CONFIGURE → SUPER_ADMIN uniquement
  if (module === 'ADMIN' && action === 'CONFIGURE') {
    return roleName === 'SUPER_ADMIN' ? { decision: 'ALLOW' } : { decision: 'DENY' }
  }

  // audit_logs DELETE → toujours refusé (append-only)
  if (module === 'ADMIN' && action === 'DELETE') {
    return { decision: 'DENY' }
  }

  return { decision: 'PASS' }
}

// ── Legacy role fallback ──────────────────────────────────────────────────────

const LEGACY_ROLE_MAP: Record<string, string> = {
  admin:       'SUPER_ADMIN',
  directeur:   'SUPER_ADMIN',
  superviseur: 'MANAGER',
  operateur:   'COMMERCIAL',
  technicien:  'READONLY',
  apprenant:   'READONLY',   // legacy alias
}

// ── Chargement des permissions depuis la DB ───────────────────────────────────

async function loadPermissionsFromDb(userId: string, legacyRole?: string): Promise<CacheEntry | null> {
  // 1. Chercher le profil RBAC (sans join PostgREST — FK pas toujours dans le cache)
  const { data: profile } = await db
    .from('rbac_user_profiles')
    .select('role_id, is_active')
    .eq('profile_id', userId)
    .single()

  let roleName: string | undefined

  if (profile) {
    if (!profile.is_active) {
      console.warn('[rbac] utilisateur désactivé', { userId })
      return null
    }
    if (profile.role_id) {
      const { data: roleRow } = await db
        .from('rbac_roles')
        .select('name')
        .eq('id', profile.role_id)
        .single()
      roleName = roleRow?.name as string | undefined
    }
  } else if (legacyRole) {
    // Fallback vers l'ancien système JWT
    roleName = LEGACY_ROLE_MAP[legacyRole]
  }

  if (!roleName) return null

  // 2. Charger les permissions du rôle via son id (sans join PostgREST)
  const { data: roleRow } = await db
    .from('rbac_roles')
    .select('id')
    .eq('name', roleName)
    .single()

  const perms = new Set<string>()

  if (roleRow) {
    const { data: rp } = await db
      .from('rbac_role_permissions')
      .select('permission_id')
      .eq('role_id', roleRow.id)

    if (rp?.length) {
      const permIds = rp.map(r => r.permission_id).filter(Boolean)
      const { data: permRows } = await db
        .from('rbac_permissions')
        .select('module, action')
        .in('id', permIds)
      for (const p of permRows ?? []) {
        perms.add(`${p.module}:${p.action}`)
      }
    }
  }

  // SUPER_ADMIN a tout (guard-rail côté cache)
  if (roleName === 'SUPER_ADMIN') {
    const MODULES = ['STOCK','COMMERCIAL','FINANCE','HR','PRODUCTION','LOGISTICS','ADMIN','REPORTS','RECEIVABLES']
    const ACTIONS = ['READ','CREATE','UPDATE','DELETE','VALIDATE','CONFIGURE','EXPORT']
    for (const m of MODULES) for (const a of ACTIONS) perms.add(`${m}:${a}`)
  }

  const entry: CacheEntry = { perms, roleName, expiresAt: Date.now() + CACHE_TTL_MS }
  _permCache.set(userId, entry)

  return entry
}

// ── checkPermission ───────────────────────────────────────────────────────────

export async function checkPermission(
  userId: string,
  module: RbacModule,
  action: RbacAction,
  legacyRole?: string,
): Promise<PermissionResult> {
  // 1. IMMUTABLE_RULES — pas besoin de connaître le rôle pour les règles DENY globales
  const preCheck = checkImmutableRules(undefined, module, action)
  if (preCheck.decision === 'DENY' && module === 'ADMIN' && action === 'DELETE') {
    return { allowed: false, reason: 'IMMUTABLE_RULE:ADMIN_DELETE' }
  }

  // 2. Récupérer les perms (cache ou DB)
  let entry = getCached(userId)
  if (!entry) {
    entry = await loadPermissionsFromDb(userId, legacyRole)
  }

  if (!entry) {
    console.warn('[rbac:checkPermission] aucun profil RBAC', { userId, module, action })
    return { allowed: false, reason: 'NO_RBAC_PROFILE' }
  }

  // 3. IMMUTABLE_RULES avec le rôle connu
  const ruleCheck = checkImmutableRules(entry.roleName, module, action)
  if (ruleCheck.decision === 'DENY') {
    return { allowed: false, reason: `IMMUTABLE_RULE:${entry.roleName}_CANNOT_${action}`, roleName: entry.roleName }
  }
  if (ruleCheck.decision === 'ALLOW') {
    return { allowed: true, roleName: entry.roleName }
  }

  // 4. Vérification dans le set de permissions
  const allowed = entry.perms.has(`${module}:${action}`)

  if (!allowed) {
    console.info('[rbac:ACCESS_DENIED]', { userId, module, action, role: entry.roleName })
  }

  return { allowed, roleName: entry.roleName }
}

// ── writeAuditLog (async fire-and-forget) ────────────────────────────────────

export function writeAuditLog(input: WriteAuditInput): void {
  void db
    .from('rbac_audit_logs')
    .insert({
      user_id:        input.userId ?? null,
      action_type:    input.actionType,
      module:         input.module ?? null,
      resource_type:  input.resourceType ?? null,
      resource_id:    input.resourceId ?? null,
      payload_before: input.payloadBefore ?? null,
      payload_after:  input.payloadAfter ?? null,
      ip_address:     input.ipAddress ?? null,
      user_agent:     input.userAgent ?? null,
    })
    .then(({ error }) => {
      if (error) console.error('[rbac:audit] Erreur écriture log', { error: error.message, input })
    })
}

// ── checkLoginAttempts ────────────────────────────────────────────────────────

export async function checkLoginAttempts(
  email: string,
  ip: string,
): Promise<LoginCheckResult> {
  // Lire la politique depuis security_settings
  const { data: settings } = await db
    .from('rbac_security_settings')
    .select('max_login_attempts, lockout_duration_minutes')
    .eq('id', 'singleton')
    .single()

  const maxAttempts     = settings?.max_login_attempts      ?? 5
  const lockoutMinutes  = settings?.lockout_duration_minutes ?? 30
  const windowStart     = new Date(Date.now() - lockoutMinutes * 60_000).toISOString()

  // Compter les échecs récents pour email + IP
  const { count } = await db
    .from('rbac_login_attempts')
    .select('*', { count: 'exact', head: true })
    .eq('email', email)
    .eq('ip_address', ip)
    .eq('success', false)
    .gte('attempted_at', windowStart)

  const failCount = count ?? 0

  if (failCount >= maxAttempts) {
    // Trouver l'heure de la tentative la plus récente pour calculer blockedUntil
    const { data: lastAttempt } = await db
      .from('rbac_login_attempts')
      .select('attempted_at')
      .eq('email', email)
      .eq('ip_address', ip)
      .eq('success', false)
      .order('attempted_at', { ascending: false })
      .limit(1)
      .single()

    const blockedUntil = lastAttempt
      ? new Date(new Date(lastAttempt.attempted_at).getTime() + lockoutMinutes * 60_000)
      : new Date(Date.now() + lockoutMinutes * 60_000)

    return { blocked: true, remainingAttempts: 0, blockedUntil }
  }

  return { blocked: false, remainingAttempts: maxAttempts - failCount }
}

// ── recordLoginAttempt ────────────────────────────────────────────────────────

export async function recordLoginAttempt(
  email: string,
  ip: string,
  success: boolean,
  userAgent?: string,
): Promise<void> {
  const { error } = await db
    .from('rbac_login_attempts')
    .insert({ email, ip_address: ip, success, user_agent: userAgent ?? null })

  if (error) {
    console.error('[rbac:loginAttempt] Erreur enregistrement', { email, ip, success, error: error.message })
    return
  }

  const actionType: AuditActionType = success ? 'LOGIN_SUCCESS' : 'LOGIN_FAILED'
  writeAuditLog({ actionType, ipAddress: ip, userAgent, payloadAfter: { email } })

  if (!success) {
    console.warn('[rbac:loginAttempt] Échec connexion', { email, ip })
  }
}
