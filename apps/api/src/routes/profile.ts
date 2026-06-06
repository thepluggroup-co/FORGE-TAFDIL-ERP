import { Hono } from 'hono'
import { z } from 'zod'
import { zValidator } from '@hono/zod-validator'
import { supabaseAdmin } from '@forge/db'
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
