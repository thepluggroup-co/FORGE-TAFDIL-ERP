import { Hono } from 'hono'
import { z } from 'zod'
import { zValidator } from '@hono/zod-validator'
import { supabaseAdmin } from '@forge/db'
import { requestPhoneOtp, verifyPhoneOtp } from '../services/phone-otp.service'
import { setOwnPin } from '../services/phone-pin.service'
import { getMyPermissions } from '../services/rbacService'
import type { HonoVariables } from '../types'

export const profileRouter = new Hono<{ Variables: HonoVariables }>()

if (!supabaseAdmin) {
  profileRouter.all('*', (c) => c.json({ error: 'SUPABASE_SERVICE_ROLE_KEY manquant' }, 503))
}
const db = supabaseAdmin!

// ── GET /api/profile/me ───────────────────────────────────────────────────────
profileRouter.get('/me', async (c) => {
  const user = c.get('user')

  const { data, error } = await db
    .from('profiles')
    .select('id, email, nom, role, telephone, adresse, actif, created_at')
    .eq('id', user.id)
    .single()

  if (error) return c.json({ error: error.message }, 500)
  return c.json({ data })
})

// ── GET /api/profile/permissions ──────────────────────────────────────────────
// Self-service : permet à N'IMPORTE QUEL utilisateur authentifié (pas
// seulement un admin, contrairement à /api/admin/rbac/*) de connaître SES
// PROPRES permissions RBAC réelles — utilisé pour piloter la sidebar et les
// gardes de route côté web au lieu d'un tableau de rôles legacy statique.
profileRouter.get('/permissions', async (c) => {
  const user = c.get('user')
  const data = await getMyPermissions(user.id, user.role)
  return c.json({ data })
})

// ── PATCH /api/profile/me ─────────────────────────────────────────────────────
const patchProfileSchema = z.object({
  nom:       z.string().min(1).max(100).optional(),
  telephone: z.string().max(30).nullable().optional(),
  adresse:   z.string().max(200).nullable().optional(),
})

profileRouter.patch(
  '/me',
  zValidator('json', patchProfileSchema),
  async (c) => {
    const user = c.get('user')
    const body = c.req.valid('json')

    const update: Record<string, unknown> = {}
    if (body.nom       !== undefined) update.nom       = body.nom.trim()
    if (body.telephone !== undefined) update.telephone = body.telephone
    if (body.adresse   !== undefined) update.adresse   = body.adresse

    if (!Object.keys(update).length) return c.json({ success: true })

    const { error } = await db
      .from('profiles')
      .update(update)
      .eq('id', user.id)

    if (error) return c.json({ error: error.message }, 500)
    return c.json({ success: true })
  },
)

// ── PATCH /api/profile/password-changed ───────────────────────────────────────
// Auto-service : un utilisateur ne peut lever CE flag que sur SA PROPRE ligne
// (user.id vient du JWT, pas du body) — appelé une fois par SetPassword.tsx
// après supabase.auth.updateUser({ password }) sur une invitation/reset.
profileRouter.patch('/password-changed', async (c) => {
  const user = c.get('user')

  const { error } = await db
    .from('rbac_user_profiles')
    .update({ password_must_change: false })
    .eq('profile_id', user.id)

  if (error) return c.json({ error: error.message }, 500)
  return c.json({ success: true })
})

// ── Téléphone + PIN ────────────────────────────────────────────────────────────
// Activation self-service : l'utilisateur est déjà connecté (email + mot de
// passe) — on vérifie juste qu'il possède le numéro avant de l'attacher à son
// compte Supabase Auth. Après ça, signInWithPassword({ phone, password })
// fonctionne avec le même mot de passe/PIN.

const requestPhoneOtpSchema = z.object({
  phone: z.string().min(6).max(30),
})

profileRouter.post(
  '/phone/request-otp',
  zValidator('json', requestPhoneOtpSchema),
  async (c) => {
    const user = c.get('user')
    const body = c.req.valid('json')

    const result = await requestPhoneOtp(user.id, body.phone)
    if (!result.ok) return c.json({ error: result.error ?? 'Envoi du code échoué' }, 400)
    return c.json({ success: true, skipped: result.skipped ?? false })
  },
)

const verifyPhoneOtpSchema = z.object({
  code: z.string().length(6),
})

profileRouter.post(
  '/phone/verify-otp',
  zValidator('json', verifyPhoneOtpSchema),
  async (c) => {
    const user = c.get('user')
    const body = c.req.valid('json')

    const result = await verifyPhoneOtp(user.id, body.code)
    if (!result.ok) return c.json({ error: result.error ?? 'Code invalide', code: result.code }, 422)
    return c.json({ success: true })
  },
)

// ── PIN (4 chiffres) — self-service, remplace un PIN temporaire ou en définit
// un premier. Toujours authentifié : soit via email+mot de passe classique,
// soit via une session déjà obtenue par /api/auth/phone-pin/login (magic
// link échangé côté client) — dans les deux cas c.get('user') est fiable. ──
const setPinSchema = z.object({
  pin: z.string().length(4).regex(/^\d{4}$/, 'Le PIN doit contenir 4 chiffres'),
})

profileRouter.post(
  '/pin',
  zValidator('json', setPinSchema),
  async (c) => {
    const user = c.get('user')
    const body = c.req.valid('json')

    const result = await setOwnPin(user.id, body.pin)
    if (!result.ok) return c.json({ error: result.error ?? 'Erreur définition du PIN' }, 400)
    return c.json({ success: true })
  },
)
