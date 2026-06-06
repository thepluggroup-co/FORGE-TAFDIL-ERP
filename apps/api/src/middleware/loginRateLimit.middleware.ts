/**
 * FORGE ERP — Middleware rate-limit connexion
 * 5 tentatives / 15 min par email+IP → blocage 30 min.
 * Appeler AVANT le handler de login, SANS authMiddleware.
 */
import type { MiddlewareHandler } from 'hono'
import { checkLoginAttempts } from '../services/rbacService'

export const loginRateLimit: MiddlewareHandler = async (c, next) => {
  let email = ''
  let body: Record<string, unknown> = {}

  try {
    body  = await c.req.json<Record<string, unknown>>()
    email = (body['email'] as string | undefined) ?? ''
  } catch {
    // Corps non-JSON ou vide — on laisse passer (le handler validera)
    await next()
    return
  }

  const ip = c.req.header('x-forwarded-for')
    ?? c.req.header('x-real-ip')
    ?? 'unknown'

  if (!email) {
    // Remettre le corps parsé dans le contexte pour ne pas le consommer deux fois
    c.set('parsedBody' as never, body)
    await next()
    return
  }

  const check = await checkLoginAttempts(email, ip)

  if (check.blocked) {
    const retryAfterSec = check.blockedUntil
      ? Math.ceil((check.blockedUntil.getTime() - Date.now()) / 1000)
      : 1800

    console.warn('[rbac:rateLimit] compte bloqué', { email, ip, blockedUntil: check.blockedUntil })

    c.header('Retry-After', String(retryAfterSec))
    return c.json(
      {
        error: 'Trop de tentatives de connexion. Compte temporairement bloqué.',
        code:  'RATE_LIMITED',
        blockedUntil: check.blockedUntil?.toISOString(),
        retryAfterSeconds: retryAfterSec,
      },
      429,
    )
  }

  c.set('parsedBody' as never, body)
  await next()
}
