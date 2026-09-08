import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { supabaseAdmin, RBAC_ROLE_NAMES, RBAC_MODULES, RBAC_ACTIONS } from '@forge/db'
import type { HonoVariables } from '../types'
import { requireRole } from '../middleware/rbac'
import {
  checkPermission,
  writeAuditLog,
  invalidatePermissionCache,
} from '../services/rbacService'
import { resolveInviteRedirectUrl } from '../utils/inviteRedirect'
import { generateAndSendPin } from '../services/phone-pin.service'

// ── Schémas Zod ───────────────────────────────────────────────────────────────
// RBAC_ROLE_NAMES/RBAC_MODULES/RBAC_ACTIONS viennent de packages/db/src/schema-rbac.ts
// (source unique) — ne plus redéclarer une copie locale ici : c'est cette dérive
// qui a fait manquer le module CAISSE pendant un temps.

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

// 'caissier' doit rester dans cette liste — apps/web/src/context/AuthContext.tsx
// et apps/web/src/components/layout/Sidebar.tsx (CAISSIER_RESPONSABLE) le
// traitent comme un rôle legacy à part entière, distinct de 'operateur'.
// Sans lui, un compte RBAC CAISSIER créé via RBAC_TO_LEGACY reçoit le rôle
// legacy 'operateur' et le module Caisse reste invisible dans la sidebar.
const VALID_ROLES = ['admin', 'superviseur', 'operateur', 'technicien', 'caissier'] as const
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
  CAISSIER:    'caissier',
  MAGASINIER:  'operateur',
  FORMATEUR:   'technicien',
  READONLY:    'technicien',
}

// ── POST /api/admin/users/invite ──────────────────────────────────────────────
adminRouter.post('/users/invite', async (c) => {
  if (!supabaseAdmin) {
    return c.json({ error: 'Service role key manquant côté serveur' }, 503)
  }

  const { email, nom = '', rbacRoleName, password, phone } =
    await c.req.json<{ email: string; nom?: string; rbacRoleName?: string; password?: string; phone?: string }>()

  if (!email) return c.json({ error: 'Email requis' }, 400)

  // Dériver le rôle legacy depuis le rôle RBAC
  const legacyRole: ForgeRole = (rbacRoleName && RBAC_TO_LEGACY[rbacRoleName])
    ? RBAC_TO_LEGACY[rbacRoleName]!
    : 'operateur'

  // ── Deux chemins de création ──────────────────────────────────────────────
  // 1. Invitation classique : envoie un email via le service Supabase par
  //    défaut, dont le quota est très bas (quelques envois/heure) — souvent
  //    épuisé en dev/tests ("email rate limit exceeded"), et nécessite une
  //    vraie boîte mail + un SMTP custom configuré en prod pour scaler.
  // 2. `password` fourni : crée le compte directement avec ce mot de passe,
  //    déjà confirmé (email_confirm: true) — AUCUN email envoyé, donc aucun
  //    quota concerné. Utilisable immédiatement pour se connecter. Pensé pour
  //    créer des comptes de test/démo sans dépendre de l'envoi d'email.
  const { data, error } = password
    ? await supabaseAdmin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { role: legacyRole, nom },
        app_metadata:  { role: legacyRole },
      })
    : await supabaseAdmin.auth.admin.inviteUserByEmail(email, {
        data: { role: legacyRole, nom },
        redirectTo: resolveInviteRedirectUrl(),
      })

  if (error) return c.json({ error: error.message }, 400)

  if (data.user) {
    await supabaseAdmin.from('profiles').upsert({
      id:        data.user.id,
      email,
      nom,
      role:      legacyRole,
      actif:     true,
      ...(phone ? { telephone: phone } : {}),
    })

    // createUser positionne déjà app_metadata.role ci-dessus — cet appel ne
    // sert que pour le chemin invite (inviteUserByEmail ne le fait pas).
    if (!password) {
      // auth.admin.updateUserById renvoie une vraie Promise (appel fetch direct) —
      // .catch() y est valide.
      await supabaseAdmin.auth.admin.updateUserById(data.user.id, {
        app_metadata: { role: legacyRole },
      }).catch((e) => console.error('[admin] app_metadata update on invite failed:', e))
    }

    // Créer le profil RBAC avec le rôle sélectionné
    if (rbacRoleName) {
      const { data: roleRow } = await supabaseAdmin
        .from('rbac_roles')
        .select('id')
        .eq('name', rbacRoleName)
        .single()

      if (roleRow) {
        // Le query builder Supabase (from().upsert()) n'est "thenable" qu'après
        // await — pas une vraie Promise, donc pas de .catch() dessus (c'était le
        // bug : "supabaseAdmin.from(...).upsert(...).catch is not a function",
        // qui faisait échouer TOUTE la création d'utilisateur avant même de
        // renvoyer la réponse). On l'attend et on vérifie `error` normalement.
        // password_must_change=false quand un admin fixe lui-même le mot de
        // passe (chemin createUser) — le forcer à changer un mot de passe
        // qu'on vient de lui donner n'a pas de sens ; seul le chemin invite
        // (l'utilisateur choisit son propre mot de passe au premier login)
        // doit le forcer.
        const { error: rbacUpsertErr } = await supabaseAdmin
          .from('rbac_user_profiles')
          .upsert(
            { profile_id: data.user.id, role_id: roleRow.id, is_active: true, password_must_change: !password },
            { onConflict: 'profile_id' },
          )
        if (rbacUpsertErr) console.error('[admin] rbac_user_profiles upsert failed:', rbacUpsertErr.message)
      }
    }

    // Téléphone fourni → PIN aléatoire à 4 chiffres généré et envoyé par SMS
    // (+ WhatsApp best-effort). Non bloquant : un échec d'envoi ne doit pas
    // faire échouer la création du compte, qui reste utilisable par email.
    if (phone) {
      const pinResult = await generateAndSendPin(data.user.id, phone)
      if (!pinResult.ok) console.error('[admin] génération/envoi PIN échoué:', pinResult.error)
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

// ── DELETE /api/admin/rbac/users/:id ───────────────────────────────────────
adminRouter.delete('/rbac/users/:id', async (c) => {
  const targetId = c.req.param('id')
  const caller   = c.get('user')

  if (caller.id === targetId) {
    return c.json({ error: 'Vous ne pouvez pas supprimer votre propre compte' }, 400)
  }

  const permCheck = await checkPermission(caller.id, 'ADMIN', 'DELETE', caller.role)
  if (!permCheck.allowed) {
    // Les règles immuables du RBAC refusent toutes les actions ADMIN:DELETE au niveau global.
    // Pour la suppression de comptes utilisateurs, on autorise explicitement l'accès aux admins
    // qui ont déjà un rôle de gestion de l'administration.
    if (permCheck.reason === 'IMMUTABLE_RULE:ADMIN_DELETE') {
      const fallbackCheck = await checkPermission(caller.id, 'ADMIN', 'UPDATE', caller.role)
      if (!fallbackCheck.allowed) {
        return c.json({ error: 'Accès refusé', code: 'FORBIDDEN' }, 403)
      }
    } else {
      return c.json({ error: 'Accès refusé', code: 'FORBIDDEN' }, 403)
    }
  }

  const { error: authError } = await supabaseAdmin!.auth.admin.deleteUser(targetId)
  if (authError) {
    return c.json({ error: authError.message }, 400)
  }

  const [{ error: rbacError }, { error: profileError }] = await Promise.all([
    db.from('rbac_user_profiles').delete().eq('profile_id', targetId).throwOnError(),
    db.from('profiles').delete().eq('id', targetId).throwOnError(),
  ])

  if (rbacError || profileError) {
    console.error('[admin] delete user cleanup failed', { targetId, rbacError, profileError })
  }

  invalidatePermissionCache(targetId)

  writeAuditLog({
    userId: caller.id, actionType: 'USER_DELETED',
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

  // admin.generateLink() NE PAS confondre avec resetPasswordForEmail : le
  // premier construit juste un lien (pour un envoi d'email fait par vos soins),
  // il n'envoie RIEN — c'était le bug ici, l'admin cliquait "reset" et
  // l'utilisateur ne recevait jamais rien. resetPasswordForEmail déclenche le
  // vrai email Supabase, avec le même redirectTo corrigé que l'invitation.
  const { error: resetErr } = await supabaseAdmin!.auth.resetPasswordForEmail(profile.email, {
    redirectTo: resolveInviteRedirectUrl(),
  })
  if (resetErr) return c.json({ error: resetErr.message }, 400)

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
  // error non vérifié auparavant : un timeout/coupure réseau vers Supabase
  // (cf. fetchWithTimeout, packages/db/src/supabase-client.ts) faisait échouer
  // cette requête silencieusement — data restait undefined et le rôle
  // ressortait comme "introuvable" alors qu'il existe bel et bien, masquant
  // un problème réseau derrière un faux 404 métier. On relance maintenant
  // l'erreur pour que app.onError la classe correctement (503 réseau vs 404).
  const { data, error } = await db.from('rbac_roles').select('id').eq('name', idOrName).single()
  if (error && error.code !== 'PGRST116') throw error   // PGRST116 = "no rows" (vraiment introuvable)
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
    const caller = c.get('user')
    const { permissions } = c.req.valid('json')

    // ── Requêtes indépendantes lancées en parallèle — même raisonnement que
    // POST /api/caisse/tickets : chaque aller-retour Supabase s'additionnait
    // plutôt que de se chevaucher, ce qui faisait dépasser le timeout client
    // (15s) sur connexion lente/à froid, avant même d'atteindre les requêtes
    // de grant/revoke plus bas.
    const [roleId, permCheck] = await Promise.all([
      resolveRoleId(c.req.param('id')),
      checkPermission(caller.id, 'ADMIN', 'CONFIGURE', caller.role),
    ])
    if (!roleId) return c.json({ error: 'Rôle introuvable' }, 404)
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

    // Un seul fetch de rbac_permissions réutilisé pour grant ET revoke — la
    // matrice envoie systématiquement les 70 combinaisons module×action à
    // chaque sauvegarde (remplacement complet, pas un diff), donc les deux
    // branches étaient quasi toujours empruntées et interrogeaient deux fois
    // la même table pour rien.
    const allPerms = (toGrant.length > 0 || toRevoke.length > 0)
      ? (await db.from('rbac_permissions').select('id, module, action')).data ?? []
      : []

    if (toRevoke.length > 0) {
      const revokeIds = allPerms
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
      const grantRows = allPerms
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
