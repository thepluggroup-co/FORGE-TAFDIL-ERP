import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { supabaseAdmin } from '@forge/db'
import type { HonoVariables } from '../types'
import { requireRole } from '../middleware/rbac'
import {
  checkPermission,
  writeAuditLog,
  invalidatePermissionCache,
} from '../services/rbacService'

// ── Schémas Zod ───────────────────────────────────────────────────────────────

const RBAC_ROLE_NAMES = ['SUPER_ADMIN','MANAGER','COMMERCIAL','CAISSIER','MAGASINIER','FORMATEUR','READONLY','LIVREUR'] as const
const RBAC_MODULES    = ['STOCK','COMMERCIAL','FINANCE','HR','PRODUCTION','LOGISTICS','ADMIN','REPORTS','RECEIVABLES'] as const
const RBAC_ACTIONS    = ['READ','CREATE','UPDATE','DELETE','VALIDATE','CONFIGURE','EXPORT'] as const

const patchRbacUserSchema = z.object({
  rbacRoleName: z.enum(RBAC_ROLE_NAMES).optional(),
  isActive:     z.boolean().optional(),
})

const permissionsSchema = z.object({
  permissions: z.array(z.object({
    module:  z.enum(RBAC_MODULES),
    action:  z.enum(RBAC_ACTIONS),
    granted: z.boolean(),
  })),
})

const auditLogsQuerySchema = z.object({
  userId:      z.string().uuid().optional(),
  actionType:  z.string().optional(),
  module:      z.enum(RBAC_MODULES).optional(),
  from:        z.string().optional(),
  to:          z.string().optional(),
  page:        z.coerce.number().int().min(1).default(1),
  perPage:     z.coerce.number().int().min(1).max(200).default(50),
})

const securitySettingsSchema = z.object({
  passwordMinLength:      z.number().int().min(6).max(64).optional(),
  passwordRequireUpper:   z.boolean().optional(),
  passwordRequireNumber:  z.boolean().optional(),
  passwordRequireSpecial: z.boolean().optional(),
  passwordExpirationDays: z.number().int().min(0).max(365).optional(),
  maxLoginAttempts:       z.number().int().min(1).max(20).optional(),
  lockoutDurationMinutes: z.number().int().min(5).max(1440).optional(),
  sessionTimeoutMinutes:  z.number().int().min(5).max(1440).optional(),
  allowedHoursEnabled:    z.boolean().optional(),
  allowedHoursStart:      z.string().regex(/^\d{2}:\d{2}$/).optional(),
  allowedHoursEnd:        z.string().regex(/^\d{2}:\d{2}$/).optional(),
  allowedDays:            z.string().regex(/^[1-7](,[1-7])*$/).optional(),
})

export const adminRouter = new Hono<{ Variables: HonoVariables }>()

// ── Gestion utilisateurs réservée au Patron (admin) ──────────────────────────
adminRouter.use('*', requireRole(['admin']))

const VALID_ROLES = ['admin', 'superviseur', 'operateur', 'apprenant'] as const
type ForgeRole = typeof VALID_ROLES[number]

// ── GET /api/admin/users ──────────────────────────────────────────────────────
adminRouter.get('/users', async (c) => {
  if (!supabaseAdmin) {
    return c.json({ error: 'Service role key manquant côté serveur' }, 503)
  }

  const { data, error } = await supabaseAdmin
    .from('profiles')
    .select('id, email, nom, role, telephone, actif, created_at')
    .order('created_at', { ascending: true })

  if (error) return c.json({ error: error.message }, 500)
  return c.json({ data })
})

// ── PATCH /api/admin/users/:id ────────────────────────────────────────────────
// Supports: { role?, actif?, nom? }
adminRouter.patch('/users/:id', async (c) => {
  if (!supabaseAdmin) {
    return c.json({ error: 'Service role key manquant côté serveur' }, 503)
  }

  const id   = c.req.param('id')
  const body = await c.req.json<{ role?: string; actif?: boolean; nom?: string }>()

  if (body.role && !(VALID_ROLES as readonly string[]).includes(body.role)) {
    return c.json({ error: `Rôle invalide. Valeurs acceptées : ${VALID_ROLES.join(', ')}` }, 400)
  }

  // Prevent the caller from revoking their own admin role
  const caller = c.get('user')
  if (caller.id === id && body.role && body.role !== 'admin') { // empêche l'admin de se rétrograder
    return c.json({ error: 'Vous ne pouvez pas changer votre propre rôle' }, 400)
  }

  // Update profile table
  const profileUpdate: Record<string, unknown> = {}
  if (body.role  !== undefined) profileUpdate.role  = body.role
  if (body.actif !== undefined) profileUpdate.actif = body.actif
  if (body.nom   !== undefined) profileUpdate.nom   = body.nom

  const { error: profileError } = await supabaseAdmin
    .from('profiles')
    .update(profileUpdate)
    .eq('id', id)

  if (profileError) return c.json({ error: profileError.message }, 500)

  // Sync role to auth.users app_metadata so the JWT reflects the new role
  if (body.role) {
    const { error: authError } = await supabaseAdmin.auth.admin.updateUserById(id, {
      app_metadata: { role: body.role as ForgeRole },
    })
    if (authError) {
      console.error('[admin] Failed to update auth app_metadata:', authError.message)
    }
  }

  // Disable / re-enable account in auth.users
  if (body.actif !== undefined) {
    await supabaseAdmin.auth.admin.updateUserById(id, {
      ban_duration: body.actif ? 'none' : '876000h', // 100 years = effectively disabled
    }).catch((e) => console.error('[admin] ban update failed:', e))
  }

  return c.json({ success: true })
})

// Mapping rôle RBAC → rôle legacy profiles.role
const RBAC_TO_LEGACY: Record<string, ForgeRole> = {
  SUPER_ADMIN: 'admin',
  MANAGER:     'superviseur',
  COMMERCIAL:  'operateur',
  CAISSIER:    'operateur',
  MAGASINIER:  'operateur',
  FORMATEUR:   'apprenant',
  READONLY:    'apprenant',
}

// ── POST /api/admin/users/invite ──────────────────────────────────────────────
adminRouter.post('/users/invite', async (c) => {
  if (!supabaseAdmin) {
    return c.json({ error: 'Service role key manquant côté serveur' }, 503)
  }

  const { email, nom = '', rbacRoleName } =
    await c.req.json<{ email: string; nom?: string; rbacRoleName?: string }>()

  if (!email) return c.json({ error: 'Email requis' }, 400)

  // Dériver le rôle legacy depuis le rôle RBAC
  const legacyRole: ForgeRole = (rbacRoleName && RBAC_TO_LEGACY[rbacRoleName])
    ? RBAC_TO_LEGACY[rbacRoleName]!
    : 'operateur'

  // Invite user (sends magic-link email)
  const { data, error } = await supabaseAdmin.auth.admin.inviteUserByEmail(email, {
    data: { role: legacyRole, nom },
  })

  if (error) return c.json({ error: error.message }, 400)

  if (data.user) {
    await supabaseAdmin.from('profiles').upsert({
      id:    data.user.id,
      email,
      nom,
      role:  legacyRole,
      actif: true,
    })

    await supabaseAdmin.auth.admin.updateUserById(data.user.id, {
      app_metadata: { role: legacyRole },
    }).catch((e) => console.error('[admin] app_metadata update on invite failed:', e))

    // Créer le profil RBAC avec le rôle sélectionné
    if (rbacRoleName) {
      const { data: roleRow } = await supabaseAdmin
        .from('rbac_roles')
        .select('id')
        .eq('name', rbacRoleName)
        .single()

      if (roleRow) {
        await supabaseAdmin
          .from('rbac_user_profiles')
          .upsert(
            { profile_id: data.user.id, role_id: roleRow.id, is_active: true, password_must_change: true },
            { onConflict: 'profile_id' },
          )
          .catch((e) => console.error('[admin] rbac_user_profiles upsert failed:', e))
      }
    }
  }

  return c.json({ success: true, userId: data.user?.id })
})

// ═══════════════════════════════════════════════════════════════════════════════
// ── ROUTES RBAC ───────────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

// Toutes les routes RBAC ci-dessous utilisent supabaseAdmin.
// Si la service role key est absente, un middleware 503 couvre toutes les routes /rbac/*.
if (!supabaseAdmin) {
  adminRouter.all('/rbac/*', (c) => c.json({ error: 'SUPABASE_SERVICE_ROLE_KEY manquant' }, 503))
}
const db = supabaseAdmin!

// ── GET /api/admin/rbac/users — liste utilisateurs + profil RBAC ──────────────
adminRouter.get('/rbac/users', async (c) => {
  // Requêtes séparées pour éviter les joins PostgREST (cache FK non garanti)
  const [profilesRes, rbacRes] = await Promise.all([
    db.from('profiles')
      .select('id, email, nom, role, actif, telephone, created_at')
      .order('nom', { ascending: true }),
    db.from('rbac_user_profiles')
      .select('profile_id, role_id, is_active, last_login_at, password_must_change, failed_login_count, locked_until'),
  ])

  if (profilesRes.error) return c.json({ error: profilesRes.error.message }, 500)

  // Charger les rôles RBAC séparément
  const roleIds = [...new Set((rbacRes.data ?? []).map(r => r.role_id).filter(Boolean))]
  const { data: roles } = roleIds.length
    ? await db.from('rbac_roles').select('id, name, label').in('id', roleIds)
    : { data: [] }

  const rolesMap = new Map((roles ?? []).map(r => [r.id, r]))
  const rbacMap  = new Map(
    (rbacRes.data ?? []).map(r => [
      r.profile_id,
      { ...r, rbac_roles: rolesMap.get(r.role_id) ?? null },
    ]),
  )

  const data = (profilesRes.data ?? []).map(p => ({
    ...p,
    rbac_user_profiles: rbacMap.get(p.id) ?? null,
  }))

  return c.json({ data })
})

// ── PATCH /api/admin/rbac/users/:id — modifier rôle RBAC / activation ─────────
adminRouter.patch(
  '/rbac/users/:id',
  zValidator('json', patchRbacUserSchema),
  async (c) => {
    const targetId = c.req.param('id')
    const caller   = c.get('user')
    const body     = c.req.valid('json')

    // Garde-rail : ne pas se rétrograder soi-même
    if (caller.id === targetId && body.rbacRoleName && body.rbacRoleName !== 'SUPER_ADMIN') {
      return c.json({ error: 'Vous ne pouvez pas changer votre propre rôle RBAC' }, 400)
    }

    const permCheck = await checkPermission(caller.id, 'ADMIN', 'UPDATE', caller.role)
    if (!permCheck.allowed) return c.json({ error: 'Accès refusé', code: 'FORBIDDEN' }, 403)

    // Snapshot avant pour audit
    const { data: before } = await db
      .from('rbac_user_profiles')
      .select('role_id, is_active')
      .eq('profile_id', targetId)
      .single()

    if (body.rbacRoleName) {
      const { data: roleRow } = await db
        .from('rbac_roles')
        .select('id')
        .eq('name', body.rbacRoleName)
        .single()

      if (!roleRow) return c.json({ error: `Rôle RBAC introuvable : ${body.rbacRoleName}` }, 400)

      const { error } = await db
        .from('rbac_user_profiles')
        .upsert(
          { profile_id: targetId, role_id: roleRow.id, is_active: body.isActive ?? true },
          { onConflict: 'profile_id' },
        )

      if (error) return c.json({ error: error.message }, 500)
      invalidatePermissionCache(targetId)
    }

    if (body.isActive !== undefined) {
      await db
        .from('rbac_user_profiles')
        .update({ is_active: body.isActive })
        .eq('profile_id', targetId)
    }

    writeAuditLog({
      userId:       caller.id,
      actionType:   body.isActive === false ? 'USER_DEACTIVATED' : 'USER_UPDATED',
      resourceType: 'user',
      resourceId:   targetId,
      payloadBefore: before,
      payloadAfter:  body,
    })

    return c.json({ success: true })
  },
)

// ── PATCH /api/admin/rbac/users/:id/deactivate ────────────────────────────────
adminRouter.patch('/rbac/users/:id/deactivate', async (c) => {
  const targetId = c.req.param('id')
  const caller   = c.get('user')

  const permCheck = await checkPermission(caller.id, 'ADMIN', 'UPDATE', caller.role)
  if (!permCheck.allowed) return c.json({ error: 'Accès refusé', code: 'FORBIDDEN' }, 403)

  await db
    .from('rbac_user_profiles')
    .update({ is_active: false })
    .eq('profile_id', targetId)

  invalidatePermissionCache(targetId)

  writeAuditLog({
    userId: caller.id, actionType: 'USER_DEACTIVATED',
    resourceType: 'user', resourceId: targetId,
  })

  return c.json({ success: true })
})

// ── PATCH /api/admin/rbac/users/:id/reset-password ────────────────────────────
adminRouter.patch('/rbac/users/:id/reset-password', async (c) => {
  const targetId = c.req.param('id')
  const caller   = c.get('user')

  const permCheck = await checkPermission(caller.id, 'ADMIN', 'UPDATE', caller.role)
  if (!permCheck.allowed) return c.json({ error: 'Accès refusé', code: 'FORBIDDEN' }, 403)

  const { data: profile } = await db
    .from('profiles')
    .select('email')
    .eq('id', targetId)
    .single()

  if (!profile?.email) return c.json({ error: 'Utilisateur introuvable' }, 404)

  // Marquer password_must_change + envoyer reset email via Supabase
  await db
    .from('rbac_user_profiles')
    .update({ password_must_change: true })
    .eq('profile_id', targetId)

  await supabaseAdmin!.auth.admin.generateLink({
    type: 'recovery',
    email: profile.email,
  })

  writeAuditLog({
    userId: caller.id, actionType: 'PASSWORD_RESET',
    resourceType: 'user', resourceId: targetId,
  })

  return c.json({ success: true })
})

// ── Helper : résoudre l'ID d'un rôle depuis un nom ou un UUID ────────────────
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

async function resolveRoleId(idOrName: string): Promise<string | null> {
  if (UUID_RE.test(idOrName)) return idOrName
  const { data } = await db.from('rbac_roles').select('id').eq('name', idOrName).single()
  return data?.id ?? null
}

// ── GET /api/admin/rbac/roles ─────────────────────────────────────────────────
adminRouter.get('/rbac/roles', async (c) => {
  const { data, error } = await db
    .from('rbac_roles')
    .select('id, name, label, description, is_system')
    .order('name')

  if (error) return c.json({ error: error.message }, 500)
  return c.json({ data: data ?? [] })
})

// ── GET /api/admin/rbac/roles/:id/permissions ─────────────────────────────────
adminRouter.get('/rbac/roles/:id/permissions', async (c) => {
  const roleId = await resolveRoleId(c.req.param('id'))
  if (!roleId) return c.json({ data: [] })

  const { data: rp, error: rpErr } = await db
    .from('rbac_role_permissions')
    .select('permission_id')
    .eq('role_id', roleId)

  if (rpErr) return c.json({ error: rpErr.message }, 500)

  const permIds = (rp ?? []).map(r => r.permission_id).filter(Boolean)
  if (!permIds.length) return c.json({ data: [] })

  const { data: perms, error: permErr } = await db
    .from('rbac_permissions')
    .select('id, module, action, label, is_immutable')
    .in('id', permIds)

  if (permErr) return c.json({ error: permErr.message }, 500)

  const data = perms?.map(p => ({ rbac_permissions: p })) ?? []
  return c.json({ data })
})

// ── PATCH /api/admin/rbac/roles/:id/permissions ───────────────────────────────
adminRouter.patch(
  '/rbac/roles/:id/permissions',
  zValidator('json', permissionsSchema),
  async (c) => {
    const roleId = await resolveRoleId(c.req.param('id'))
    if (!roleId) return c.json({ error: 'Rôle introuvable' }, 404)

    const caller = c.get('user')
    const { permissions } = c.req.valid('json')

    const permCheck = await checkPermission(caller.id, 'ADMIN', 'CONFIGURE', caller.role)
    if (!permCheck.allowed) return c.json({ error: 'Accès refusé', code: 'FORBIDDEN' }, 403)

    // Garde-rail : SUPER_ADMIN ne peut pas perdre ADMIN:CONFIGURE
    const { data: roleRow } = await db
      .from('rbac_roles')
      .select('name')
      .eq('id', roleId)
      .single()

    if (roleRow?.name === 'SUPER_ADMIN') {
      const removingConfigure = permissions.some(
        p => p.module === 'ADMIN' && p.action === 'CONFIGURE' && !p.granted,
      )
      if (removingConfigure) {
        return c.json({
          error: 'SUPER_ADMIN doit toujours conserver ADMIN:CONFIGURE',
          code:  'IMMUTABLE_RULE',
        }, 400)
      }
    }

    // Récupérer les ids de permissions par module:action
    const toGrant   = permissions.filter(p => p.granted)
    const toRevoke  = permissions.filter(p => !p.granted)

    if (toRevoke.length > 0) {
      const { data: revokePerms } = await db
        .from('rbac_permissions')
        .select('id, module, action')

      const revokeIds = (revokePerms ?? [])
        .filter(p => toRevoke.some(r => r.module === p.module && r.action === p.action))
        .map(p => p.id)

      if (revokeIds.length > 0) {
        await db
          .from('rbac_role_permissions')
          .delete()
          .eq('role_id', roleId)
          .in('permission_id', revokeIds)
      }
    }

    if (toGrant.length > 0) {
      const { data: grantPerms } = await db
        .from('rbac_permissions')
        .select('id, module, action')

      const grantRows = (grantPerms ?? [])
        .filter(p => toGrant.some(g => g.module === p.module && g.action === p.action))
        .map(p => ({ role_id: roleId, permission_id: p.id, granted_by: caller.id }))

      if (grantRows.length > 0) {
        await db
          .from('rbac_role_permissions')
          .upsert(grantRows, { onConflict: 'role_id,permission_id' })
      }
    }

    // Invalider les caches de TOUS les utilisateurs avec ce rôle
    const { data: affectedUsers } = await db
      .from('rbac_user_profiles')
      .select('profile_id')
      .eq('role_id', roleId)

    for (const u of affectedUsers ?? []) invalidatePermissionCache(u.profile_id)

    writeAuditLog({
      userId: caller.id, actionType: 'PERMISSION_CHANGED',
      resourceType: 'role', resourceId: roleId,
      payloadAfter: { permissions },
    })

    return c.json({ success: true })
  },
)

// ── GET /api/admin/rbac/audit-logs ────────────────────────────────────────────
adminRouter.get(
  '/rbac/audit-logs',
  zValidator('query', auditLogsQuerySchema),
  async (c) => {
    const q = c.req.valid('query')

    let query = db
      .from('rbac_audit_logs')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range((q.page - 1) * q.perPage, q.page * q.perPage - 1)

    if (q.userId)     query = query.eq('user_id', q.userId)
    if (q.actionType) query = query.eq('action_type', q.actionType)
    if (q.module)     query = query.eq('module', q.module)
    if (q.from)       query = query.gte('created_at', q.from)
    if (q.to)         query = query.lte('created_at', q.to)

    const { data, error, count } = await query

    if (error) return c.json({ error: error.message }, 500)
    return c.json({
      data,
      total: count ?? 0,
      page: q.page,
      perPage: q.perPage,
      totalPages: Math.ceil((count ?? 0) / q.perPage),
    })
  },
)

// ── GET /api/admin/rbac/audit-logs/export — CSV ───────────────────────────────
adminRouter.get('/rbac/audit-logs/export', async (c) => {
  const caller = c.get('user')

  const permCheck = await checkPermission(caller.id, 'ADMIN', 'EXPORT', caller.role)
  if (!permCheck.allowed) return c.json({ error: 'Accès refusé', code: 'FORBIDDEN' }, 403)

  const { from, to, actionType, userId: filterUserId } = c.req.query()

  let query = db
    .from('rbac_audit_logs')
    .select('id, user_id, action_type, module, resource_type, resource_id, ip_address, created_at')
    .order('created_at', { ascending: false })
    .limit(10000)

  if (filterUserId) query = query.eq('user_id', filterUserId)
  if (actionType)   query = query.eq('action_type', actionType)
  if (from)         query = query.gte('created_at', from)
  if (to)           query = query.lte('created_at', to)

  const { data, error } = await query
  if (error) return c.json({ error: error.message }, 500)

  const header = 'id,user_id,action_type,module,resource_type,resource_id,ip_address,created_at\n'
  const rows = (data ?? []).map(row =>
    [
      row.id, row.user_id ?? '', row.action_type, row.module ?? '',
      row.resource_type ?? '', row.resource_id ?? '', row.ip_address ?? '', row.created_at,
    ]
      .map(v => `"${String(v).replace(/"/g, '""')}"`)
      .join(','),
  ).join('\n')

  writeAuditLog({ userId: caller.id, actionType: 'DATA_EXPORT', resourceType: 'audit_logs' })

  return new Response(header + rows, {
    headers: {
      'Content-Type':        'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="audit-logs-${new Date().toISOString().slice(0,10)}.csv"`,
    },
  })
})

// ── GET /api/admin/rbac/audit-logs/:id — détail avec diff ────────────────────
adminRouter.get('/rbac/audit-logs/:id', async (c) => {
  const id = c.req.param('id')

  const { data, error } = await db
    .from('rbac_audit_logs')
    .select('*')
    .eq('id', id)
    .single()

  if (error || !data) return c.json({ error: 'Log introuvable' }, 404)
  return c.json({ data })
})

// ── GET /api/admin/rbac/security-settings ────────────────────────────────────
adminRouter.get('/rbac/security-settings', async (c) => {
  const { data, error } = await db
    .from('rbac_security_settings')
    .select('*')
    .eq('id', 'singleton')
    .single()

  if (error) return c.json({ error: error.message }, 500)
  return c.json({ data })
})

// ── PATCH /api/admin/rbac/security-settings ───────────────────────────────────
adminRouter.patch(
  '/rbac/security-settings',
  zValidator('json', securitySettingsSchema),
  async (c) => {
    const caller = c.get('user')
    const body   = c.req.valid('json')

    const permCheck = await checkPermission(caller.id, 'ADMIN', 'CONFIGURE', caller.role)
    if (!permCheck.allowed) return c.json({ error: 'Accès refusé', code: 'FORBIDDEN' }, 403)

    const { data: before } = await db
      .from('rbac_security_settings')
      .select('*')
      .eq('id', 'singleton')
      .single()

    // Convertir camelCase → snake_case pour Supabase
    const update: Record<string, unknown> = {}
    if (body.passwordMinLength      !== undefined) update.password_min_length       = body.passwordMinLength
    if (body.passwordRequireUpper   !== undefined) update.password_require_upper    = body.passwordRequireUpper
    if (body.passwordRequireNumber  !== undefined) update.password_require_number   = body.passwordRequireNumber
    if (body.passwordRequireSpecial !== undefined) update.password_require_special  = body.passwordRequireSpecial
    if (body.passwordExpirationDays !== undefined) update.password_expiration_days  = body.passwordExpirationDays
    if (body.maxLoginAttempts       !== undefined) update.max_login_attempts        = body.maxLoginAttempts
    if (body.lockoutDurationMinutes !== undefined) update.lockout_duration_minutes  = body.lockoutDurationMinutes
    if (body.sessionTimeoutMinutes  !== undefined) update.session_timeout_minutes   = body.sessionTimeoutMinutes
    if (body.allowedHoursEnabled    !== undefined) update.allowed_hours_enabled     = body.allowedHoursEnabled
    if (body.allowedHoursStart      !== undefined) update.allowed_hours_start       = body.allowedHoursStart
    if (body.allowedHoursEnd        !== undefined) update.allowed_hours_end         = body.allowedHoursEnd
    if (body.allowedDays            !== undefined) update.allowed_days              = body.allowedDays
    update.updated_by = caller.id

    const { error } = await db
      .from('rbac_security_settings')
      .update(update)
      .eq('id', 'singleton')

    if (error) return c.json({ error: error.message }, 500)

    writeAuditLog({
      userId: caller.id, actionType: 'SETTINGS_CHANGED',
      resourceType: 'security_settings', resourceId: 'singleton',
      payloadBefore: before, payloadAfter: update,
    })

    return c.json({ success: true })
  },
)

// ── GET /api/admin/rbac/security-settings/login-stats ─────────────────────────
adminRouter.get('/rbac/security-settings/login-stats', async (c) => {
  const since24h = new Date(Date.now() - 24 * 3600_000).toISOString()

  const [total, failures, blocked] = await Promise.all([
    db.from('rbac_login_attempts')
      .select('*', { count: 'exact', head: true })
      .gte('attempted_at', since24h),
    db.from('rbac_login_attempts')
      .select('*', { count: 'exact', head: true })
      .eq('success', false)
      .gte('attempted_at', since24h),
    db.from('rbac_user_profiles')
      .select('*', { count: 'exact', head: true })
      .gt('locked_until', new Date().toISOString()),
  ])

  return c.json({
    data: {
      totalAttempts24h:   total.count   ?? 0,
      failedAttempts24h:  failures.count ?? 0,
      currentlyBlocked:   blocked.count  ?? 0,
    },
  })
})
