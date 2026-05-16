import type { MiddlewareHandler } from 'hono'
import { verify } from 'jsonwebtoken'
import type { HonoVariables, SupabaseJwtPayload } from '../types'

const JWT_SECRET = process.env.SUPABASE_JWT_SECRET ?? ''

export const authMiddleware: MiddlewareHandler<{ Variables: HonoVariables }> = async (c, next) => {
  const authHeader = c.req.header('Authorization')

  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ error: 'Token manquant', code: 'MISSING_TOKEN' }, 401)
  }

  const token = authHeader.slice(7)

  if (!JWT_SECRET) {
    console.error('[auth] SUPABASE_JWT_SECRET non configuré')
    return c.json({ error: 'Configuration serveur invalide', code: 'SERVER_ERROR' }, 500)
  }

  let payload: SupabaseJwtPayload
  try {
    payload = verify(token, JWT_SECRET) as SupabaseJwtPayload
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Token invalide'
    return c.json({ error: 'Token invalide', code: 'INVALID_TOKEN', details: message }, 401)
  }

  // Priorité : app_metadata.role > user_metadata.role > payload.role > 'viewer'
  const role =
    (payload.app_metadata?.role as HonoVariables['user']['role']) ??
    (payload.user_metadata?.role as HonoVariables['user']['role']) ??
    (payload.role as HonoVariables['user']['role']) ??
    'viewer'

  c.set('user', {
    id: payload.sub,
    email: payload.email,
    role,
  })

  c.set('requestId', crypto.randomUUID())

  await next()
}
