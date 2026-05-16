import type { MiddlewareHandler } from 'hono'

const WINDOW_MS = 60_000  // 1 minute
const MAX_REQUESTS = 100

interface RateLimitEntry {
  count: number
  resetAt: number
}

const store = new Map<string, RateLimitEntry>()

// Nettoyer les entrées expirées toutes les 5 minutes pour éviter les fuites mémoire
setInterval(() => {
  const now = Date.now()
  for (const [key, entry] of store) {
    if (entry.resetAt <= now) store.delete(key)
  }
}, 5 * 60_000)

export const rateLimitMiddleware: MiddlewareHandler = async (c, next) => {
  const ip =
    c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ??
    c.req.header('x-real-ip') ??
    'unknown'

  const now = Date.now()
  const entry = store.get(ip)

  if (!entry || entry.resetAt <= now) {
    store.set(ip, { count: 1, resetAt: now + WINDOW_MS })
    c.header('X-RateLimit-Limit', String(MAX_REQUESTS))
    c.header('X-RateLimit-Remaining', String(MAX_REQUESTS - 1))
    c.header('X-RateLimit-Reset', String(Math.ceil((now + WINDOW_MS) / 1000)))
    return next()
  }

  entry.count++

  const remaining = Math.max(0, MAX_REQUESTS - entry.count)
  const resetSec = Math.ceil(entry.resetAt / 1000)

  c.header('X-RateLimit-Limit', String(MAX_REQUESTS))
  c.header('X-RateLimit-Remaining', String(remaining))
  c.header('X-RateLimit-Reset', String(resetSec))

  if (entry.count > MAX_REQUESTS) {
    const retryAfter = Math.ceil((entry.resetAt - now) / 1000)
    c.header('Retry-After', String(retryAfter))
    return c.json(
      {
        error: 'Trop de requêtes',
        code: 'RATE_LIMIT_EXCEEDED',
        details: `Limite : ${MAX_REQUESTS} req/min. Réessayez dans ${retryAfter}s.`,
      },
      429,
    )
  }

  return next()
}
