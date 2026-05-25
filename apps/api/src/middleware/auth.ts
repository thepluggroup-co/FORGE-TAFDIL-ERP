import type { MiddlewareHandler } from 'hono'
import { supabaseAdmin } from '@forge/db'
import type { HonoVariables } from '../types'

const AUTH_TIMEOUT_MS = 5_000   // max wait for Supabase getUser call

/**
 * Auth middleware — uses supabaseAdmin.auth.getUser() to validate the token,
 * wrapped in a hard 5-second timeout so a slow Supabase response never
 * blocks the request forever.
 */
export const authMiddleware: MiddlewareHandler<{ Variables: HonoVariables }> = async (c, next) => {
  const authHeader = c.req.header('Authorization')

  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ error: 'Token manquant', code: 'MISSING_TOKEN' }, 401)
  }

  if (!supabaseAdmin) {
    console.error('[auth] supabaseAdmin is null — SUPABASE_SERVICE_ROLE_KEY missing in .env')
    return c.json({ error: 'Configuration serveur invalide', code: 'SERVER_ERROR' }, 500)
  }

  const token = authHeader.slice(7)

  // Race the Supabase getUser call against a timeout so it never hangs.
  let userData: Awaited<ReturnType<typeof supabaseAdmin.auth.getUser>>
  try {
    userData = await Promise.race([
      supabaseAdmin.auth.getUser(token),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('AUTH_TIMEOUT')), AUTH_TIMEOUT_MS),
      ),
    ])
  } catch (err) {
    const isTimeout = err instanceof Error && err.message === 'AUTH_TIMEOUT'
    console.error('[auth] getUser failed:', isTimeout ? 'timeout after 5s' : err)
    return c.json(
      { error: isTimeout ? 'Auth timeout — réessayez' : 'Erreur auth', code: 'AUTH_ERROR' },
      isTimeout ? 503 : 500,
    )
  }

  const { data, error } = userData
  if (error || !data.user) {
    return c.json({ error: 'Token invalide', code: 'INVALID_TOKEN' }, 401)
  }

  const user = data.user
  const role =
    (user.app_metadata?.role as HonoVariables['user']['role']) ??
    'viewer'

  c.set('user', { id: user.id, email: user.email ?? '', role })
  c.set('requestId', crypto.randomUUID())
  await next()
}
