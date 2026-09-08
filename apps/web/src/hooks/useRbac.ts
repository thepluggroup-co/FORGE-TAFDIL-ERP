/**
 * FORGE ERP — Hooks React pour le module Sécurité / RBAC.
 * Tous les hooks retournent { data, loading, error?, refetch }.
 */
import { useState, useEffect, useCallback } from 'react'
import { apiClient } from '@/lib/api-client'
import { toast } from 'sonner'
import {
  RBAC_MODULES, RBAC_ACTIONS, RBAC_ROLE_NAMES,
  RBAC_MODULE_LABELS, RBAC_ACTION_LABELS, RBAC_ROLE_LABELS,
} from '@/lib/rbac-constants'

// ── Constantes RBAC — source unique pour tout le web, cf. lib/rbac-constants.ts ─

export {
  RBAC_MODULES, RBAC_ACTIONS, RBAC_ROLE_NAMES,
  RBAC_MODULE_LABELS, RBAC_ACTION_LABELS, RBAC_ROLE_LABELS,
}

// ── Types ─────────────────────────────────────────────────────────────────────

export type RbacRoleName = typeof RBAC_ROLE_NAMES[number]
export type RbacModule   = typeof RBAC_MODULES[number]
export type RbacAction   = typeof RBAC_ACTIONS[number]

export type AuditActionType =
  | 'ACCESS_DENIED' | 'USER_CREATED' | 'USER_UPDATED' | 'USER_DEACTIVATED' | 'USER_DELETED'
  | 'ROLE_CHANGED' | 'PERMISSION_CHANGED' | 'SETTINGS_CHANGED'
  | 'LOGIN_SUCCESS' | 'LOGIN_FAILED' | 'LOGOUT' | 'DATA_EXPORT'
  | 'PASSWORD_RESET' | 'PASSWORD_CHANGED' | 'SESSION_EXPIRED'

export interface RbacRole {
  id:          string
  name:        RbacRoleName
  label:       string
  description: string | null
  is_system:   boolean
}

export interface RbacPermission {
  id:           string
  module:       RbacModule
  action:       RbacAction
  label:        string
  is_immutable: boolean
}

export interface RbacUserRow {
  id:         string
  email:      string
  nom:        string
  role:       string   // legacy JWT role
  actif:      boolean
  telephone:  string | null
  created_at: string
  rbac_user_profiles: {
    is_active:           boolean
    last_login_at:       string | null
    password_must_change: boolean
    failed_login_count:  number
    locked_until:        string | null
    rbac_roles:          { name: RbacRoleName; label: string } | null
  } | null
}

export interface AuditLog {
  id:            string
  user_id:       string | null
  action_type:   AuditActionType
  module:        RbacModule | null
  resource_type: string | null
  resource_id:   string | null
  payload_before: unknown
  payload_after:  unknown
  ip_address:    string | null
  user_agent:    string | null
  created_at:    string
}

export interface SecuritySettings {
  password_min_length:      number
  password_require_upper:   boolean
  password_require_number:  boolean
  password_require_special: boolean
  password_expiration_days: number
  max_login_attempts:       number
  lockout_duration_minutes: number
  session_timeout_minutes:  number
  allowed_hours_enabled:    boolean
  allowed_hours_start:      string
  allowed_hours_end:        string
  allowed_days:             string
}

export interface LoginStats {
  totalAttempts24h:  number
  failedAttempts24h: number
  currentlyBlocked:  number
}

interface PaginatedResult<T> {
  data:       T[]
  total:      number
  page:       number
  perPage:    number
  totalPages: number
}

// ── usePermissions — self-service, n'importe quel rôle authentifié ───────────
// Pilote la visibilité UI (sidebar, gardes de route) depuis les VRAIES
// permissions RBAC de l'utilisateur courant, au lieu d'un tableau de rôles
// legacy statique — cf. bug caissier/Caisse où la sidebar avait divergé du
// système RBAC réellement consulté côté serveur pour ce module.

export interface MyPermissions {
  legacyRole:   string | null
  rbacRoleName: RbacRoleName | null
  permissions:  Array<{ module: RbacModule; action: RbacAction }>
}

export function usePermissions() {
  const [data, setData]       = useState<MyPermissions | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)

  const fetch = useCallback(async () => {
    setLoading(true)
    try {
      const res = await apiClient.get<{ data: MyPermissions }>('/api/profile/permissions')
      setData(res.data)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur chargement permissions')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void fetch() }, [fetch])

  // Faux tant que non chargé — ne jamais laisser une UI privilégiée s'afficher
  // brièvement avant que les vraies permissions soient connues.
  const hasPermission = useCallback(
    (module: RbacModule, action: RbacAction = 'READ') =>
      !loading && (data?.permissions.some(p => p.module === module && p.action === action) ?? false),
    [data, loading],
  )

  return { data, loading, error, refetch: fetch, hasPermission }
}

// ── useRbacRoles ──────────────────────────────────────────────────────────────

export function useRbacRoles() {
  const [data, setData]       = useState<RbacRole[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)

  const fetch = useCallback(async () => {
    setLoading(true)
    try {
      const res = await apiClient.get<{ data: RbacRole[] }>('/api/admin/rbac/roles')
      setData(res.data ?? [])
      setError(null)
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Erreur chargement rôles'
      setError(msg)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void fetch() }, [fetch])
  return { data, loading, error, refetch: fetch }
}

// ── useRbacUsers ──────────────────────────────────────────────────────────────

export function useRbacUsers() {
  const [data, setData]       = useState<RbacUserRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)

  const fetch = useCallback(async () => {
    setLoading(true)
    try {
      const res = await apiClient.get<{ data: RbacUserRow[] }>('/api/admin/rbac/users')
      setData(res.data ?? [])
      setError(null)
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Erreur chargement utilisateurs'
      setError(msg)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void fetch() }, [fetch])
  return { data, loading, error, refetch: fetch }
}

// ── useUpdateRbacUser ─────────────────────────────────────────────────────────

export function useUpdateRbacUser() {
  const [loading, setLoading] = useState(false)

  const update = useCallback(async (
    userId: string,
    body: { rbacRoleName?: RbacRoleName; isActive?: boolean },
  ) => {
    setLoading(true)
    try {
      await apiClient.patch(`/api/admin/rbac/users/${userId}`, body)
      toast.success('Utilisateur mis à jour')
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Erreur mise à jour'
      toast.error(msg)
      throw e
    } finally {
      setLoading(false)
    }
  }, [])

  const deactivate = useCallback(async (userId: string) => {
    setLoading(true)
    try {
      await apiClient.patch(`/api/admin/rbac/users/${userId}/deactivate`, {})
      toast.success('Compte désactivé')
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Erreur désactivation'
      toast.error(msg)
      throw e
    } finally {
      setLoading(false)
    }
  }, [])

  const resetPassword = useCallback(async (userId: string) => {
    setLoading(true)
    try {
      await apiClient.patch(`/api/admin/rbac/users/${userId}/reset-password`, {})
      toast.success('Réinitialisation envoyée')
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Erreur reset password'
      toast.error(msg)
      throw e
    } finally {
      setLoading(false)
    }
  }, [])

  const deleteUser = useCallback(async (userId: string) => {
    setLoading(true)
    try {
      await apiClient.delete(`/api/admin/rbac/users/${userId}`)
      toast.success('Utilisateur supprimé')
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Erreur suppression'
      toast.error(msg)
      throw e
    } finally {
      setLoading(false)
    }
  }, [])

  return { loading, update, deactivate, resetPassword, deleteUser }
}

// ── useRolePermissions ────────────────────────────────────────────────────────

export function useRolePermissions(roleId: string | null) {
  const [data, setData]       = useState<RbacPermission[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState<string | null>(null)

  const fetch = useCallback(async () => {
    if (!roleId) return
    setLoading(true)
    try {
      const res = await apiClient.get<{ data: Array<{ rbac_permissions: RbacPermission }> }>(
        `/api/admin/rbac/roles/${roleId}/permissions`,
      )
      setData((res.data ?? []).map(r => r.rbac_permissions))
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur chargement permissions')
    } finally {
      setLoading(false)
    }
  }, [roleId])

  useEffect(() => { void fetch() }, [fetch])
  return { data, loading, error, refetch: fetch }
}

// ── useSaveRolePermissions ────────────────────────────────────────────────────

export function useSaveRolePermissions() {
  const [loading, setLoading] = useState(false)

  const save = useCallback(async (
    roleId: string,
    permissions: Array<{ module: RbacModule; action: RbacAction; granted: boolean }>,
  ) => {
    setLoading(true)
    try {
      await apiClient.patch(`/api/admin/rbac/roles/${roleId}/permissions`, { permissions })
      toast.success('Permissions enregistrées')
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Erreur sauvegarde permissions'
      toast.error(msg)
      throw e
    } finally {
      setLoading(false)
    }
  }, [])

  return { loading, save }
}

// ── useAuditLogs ──────────────────────────────────────────────────────────────

export interface AuditLogsFilter {
  userId?:     string
  actionType?: string
  module?:     RbacModule
  from?:       string
  to?:         string
  page?:       number
  perPage?:    number
}

export function useAuditLogs(filter: AuditLogsFilter = {}) {
  const [data, setData]         = useState<PaginatedResult<AuditLog>>({
    data: [], total: 0, page: 1, perPage: 50, totalPages: 0,
  })
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState<string | null>(null)

  const fetch = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (filter.userId)     params.set('userId', filter.userId)
      if (filter.actionType) params.set('actionType', filter.actionType)
      if (filter.module)     params.set('module', filter.module)
      if (filter.from)       params.set('from', filter.from)
      if (filter.to)         params.set('to', filter.to)
      if (filter.page)       params.set('page', String(filter.page))
      if (filter.perPage)    params.set('perPage', String(filter.perPage))

      const res = await apiClient.get<PaginatedResult<AuditLog>>(
        `/api/admin/rbac/audit-logs?${params.toString()}`,
      )
      setData(res)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur chargement logs')
    } finally {
      setLoading(false)
    }
  }, [
    filter.userId, filter.actionType, filter.module,
    filter.from, filter.to, filter.page, filter.perPage,
  ])

  useEffect(() => { void fetch() }, [fetch])
  return { data, loading, error, refetch: fetch }
}

// ── useAuditLogDetail ─────────────────────────────────────────────────────────

export function useAuditLogDetail(logId: string | null) {
  const [data, setData]       = useState<AuditLog | null>(null)
  const [loading, setLoading] = useState(false)

  const fetch = useCallback(async () => {
    if (!logId) return
    setLoading(true)
    try {
      const res = await apiClient.get<{ data: AuditLog }>(`/api/admin/rbac/audit-logs/${logId}`)
      setData(res.data)
    } catch {
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [logId])

  useEffect(() => { void fetch() }, [fetch])
  return { data, loading }
}

// ── useSecuritySettings ───────────────────────────────────────────────────────

export function useSecuritySettings() {
  const [data, setData]       = useState<SecuritySettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)

  const fetch = useCallback(async () => {
    setLoading(true)
    try {
      const res = await apiClient.get<{ data: SecuritySettings }>('/api/admin/rbac/security-settings')
      setData(res.data)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur chargement paramètres')
    } finally {
      setLoading(false)
    }
  }, [])

  const save = useCallback(async (patch: Partial<SecuritySettings>) => {
    try {
      await apiClient.patch('/api/admin/rbac/security-settings', patch)
      toast.success('Paramètres enregistrés')
      await fetch()
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Erreur sauvegarde'
      toast.error(msg)
      throw e
    }
  }, [fetch])

  useEffect(() => { void fetch() }, [fetch])
  return { data, loading, error, refetch: fetch, save }
}

// ── useLoginStats ─────────────────────────────────────────────────────────────

export function useLoginStats() {
  const [data, setData]       = useState<LoginStats | null>(null)
  const [loading, setLoading] = useState(true)

  const fetch = useCallback(async () => {
    setLoading(true)
    try {
      const res = await apiClient.get<{ data: LoginStats }>('/api/admin/rbac/security-settings/login-stats')
      setData(res.data)
    } catch {
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void fetch() }, [fetch])
  return { data, loading, refetch: fetch }
}
