import { Hono } from 'hono'
import { supabaseAdmin } from '@forge/db'
import type { HonoVariables } from '../types'
import { requireRole } from '../middleware/rbac'

export const adminRouter = new Hono<{ Variables: HonoVariables }>()

// ── All admin routes require 'admin' role ─────────────────────────────────────
adminRouter.use('*', requireRole(['admin']))

const VALID_ROLES = ['admin', 'directeur', 'operateur', 'viewer'] as const
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
  if (caller.id === id && body.role && body.role !== 'admin') {
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

// ── POST /api/admin/users/invite ──────────────────────────────────────────────
adminRouter.post('/users/invite', async (c) => {
  if (!supabaseAdmin) {
    return c.json({ error: 'Service role key manquant côté serveur' }, 503)
  }

  const { email, role = 'operateur', nom = '' } =
    await c.req.json<{ email: string; role?: string; nom?: string }>()

  if (!email) return c.json({ error: 'Email requis' }, 400)

  if (!(VALID_ROLES as readonly string[]).includes(role)) {
    return c.json({ error: `Rôle invalide. Valeurs acceptées : ${VALID_ROLES.join(', ')}` }, 400)
  }

  // Invite user (sends magic-link email)
  const { data, error } = await supabaseAdmin.auth.admin.inviteUserByEmail(email, {
    data: { role, nom },
  })

  if (error) return c.json({ error: error.message }, 400)

  // Pre-create profile row so it appears immediately in the list
  if (data.user) {
    await supabaseAdmin.from('profiles').upsert({
      id:    data.user.id,
      email,
      nom,
      role,
      actif: true,
    })

    // Write role to app_metadata so the JWT will carry it on first sign-in
    await supabaseAdmin.auth.admin.updateUserById(data.user.id, {
      app_metadata: { role },
    }).catch((e) => console.error('[admin] app_metadata update on invite failed:', e))
  }

  return c.json({ success: true, userId: data.user?.id })
})
