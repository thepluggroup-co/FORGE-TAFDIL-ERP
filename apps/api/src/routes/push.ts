import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import type { HonoVariables } from '../types'
import { registerPushToken, unregisterPushToken } from '../services/push.service'

export const pushRouter = new Hono<{ Variables: HonoVariables }>()

const registerSchema = z.object({
  token:       z.string().min(1),
  platform:    z.enum(['android', 'ios']).default('android'),
  app_version: z.string().max(40).optional(),
})

// Auto-scopé à l'utilisateur authentifié (c.get('user').id) — pas de
// permission RBAC à vérifier, chacun ne gère que ses propres appareils.
pushRouter.post('/register', zValidator('json', registerSchema), async (c) => {
  const user = c.get('user')
  const body = c.req.valid('json')

  try {
    await registerPushToken(user.id, body.token, body.platform, body.app_version)
    return c.json({ ok: true })
  } catch (e) {
    return c.json({ error: (e as Error).message }, 500)
  }
})

const unregisterSchema = z.object({ token: z.string().min(1) })

pushRouter.post('/unregister', zValidator('json', unregisterSchema), async (c) => {
  const user = c.get('user')
  const { token } = c.req.valid('json')

  await unregisterPushToken(user.id, token)
  return c.json({ ok: true })
})
