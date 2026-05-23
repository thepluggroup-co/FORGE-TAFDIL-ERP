import type { MiddlewareHandler } from 'hono'
import { supabaseAdmin } from '@forge/db'
import type { HonoVariables } from '../types'

export const authMiddleware: MiddlewareHandler<{ Variables: HonoVariables }> = async (c, next) => {
  const authHeader = c.req.header('Authorization')

  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ error: 'Token manquant', code: 'MISSING_TOKEN' }, 401)
  }

  if (!supabaseAdmin) {
    console.error('[auth] SUPABASE_SERVICE_ROLE_KEY manquant')
    return c.json({ error: 'Configuration serveur invalide', code: 'SERVER_ERROR' }, 500)
  }

  const token = authHeader.slice(7)

  let user
  try {
    const { data, error } = await supabaseAdmin.auth.getUser(token)
    if (error || !data.user) {
      console.error('[auth] getUser failed:', error?.message)
      return c.json({ error: 'Token invalide', code: 'INVALID_TOKEN' }, 401)
    }
    user = data.user
  } catch (err) {
    console.error('[auth] getUser threw:', err)
    return c.json({ error: 'Erreur auth', code: 'AUTH_ERROR' }, 500)
  }

  const role =
    (user.app_metadata?.role as HonoVariables['user']['role']) ??
    (user.user_metadata?.role as HonoVariables['user']['role']) ??
    'viewer'

  c.set('user', { id: user.id, email: user.email ?? '', role })
  c.set('requestId', crypto.randomUUID())

  await next()
}
