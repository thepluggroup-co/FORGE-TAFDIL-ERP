import { Ratelimit } from '@upstash/ratelimit'
import { Redis }     from '@upstash/redis'
import type { MiddlewareHandler } from 'hono'

// ── IP extraction ─────────────────────────────────────────────────────────────
// Prefer headers set by trusted reverse proxies over x-forwarded-for,
// which clients can spoof by prepending values.

function getClientIp(c: Parameters<MiddlewareHandler>[0]): string {
  return (
    c.req.header('cf-connecting-ip') ??
    c.req.header('x-real-ip') ??
    c.req.header('x-forwarded-for')?.split(',').at(-1)?.trim() ??
    'unknown'
  )
}

// ── Response helpers ──────────────────────────────────────────────────────────

function setRateLimitHeaders(
  c: Parameters<MiddlewareHandler>[0],
  limit: number,
  remaining: number,
  resetSec: number,
) {
  c.header('X-RateLimit-Limit',     String(limit))
  c.header('X-RateLimit-Remaining', String(remaining))
  c.header('X-RateLimit-Reset',     String(resetSec))
}

function rejectRateLimit(
  c: Parameters<MiddlewareHandler>[0],
  limit: number,
  resetSec: number,
) {
  const retryAfter = Math.max(0, resetSec - Math.floor(Date.now() / 1000))
  c.header('Retry-After', String(retryAfter))
  return c.json(
    {
      error:   'Trop de requêtes',
      code:    'RATE_LIMIT_EXCEEDED',
      details: `Limite : ${limit} req/min. Réessayez dans ${retryAfter}s.`,
    },
    429,
  )
}

// ── Upstash Redis limiters (production) ───────────────────────────────────────
// Required env vars:
//   UPSTASH_REDIS_REST_URL   — e.g. https://xxx.upstash.io
//   UPSTASH_REDIS_REST_TOKEN — REST token from Upstash console

const UPSTASH_URL   = process.env.UPSTASH_REDIS_REST_URL
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN
const USE_REDIS     = Boolean(UPSTASH_URL && UPSTASH_TOKEN)

if (!USE_REDIS) {
  console.warn(
    '[rateLimit] UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN not set — ' +
    'falling back to ephemeral in-memory store (unsafe for multi-instance deployments)',
  )
}

type Limiters = { global: Ratelimit; ai: Ratelimit }
let _limiters: Limiters | undefined

function getLimiters(): Limiters {
  if (_limiters) return _limiters
  const redis = new Redis({ url: UPSTASH_URL!, token: UPSTASH_TOKEN! })
  _limiters = {
    global: new Ratelimit({
      redis,
      limiter:        Ratelimit.slidingWindow(100, '1 m'),
      prefix:         'forge:rl:global',
      analytics:      false,
      ephemeralCache: new Map(),
    }),
    ai: new Ratelimit({
      redis,
      limiter:        Ratelimit.slidingWindow(10, '1 m'),
      prefix:         'forge:rl:ai',
      analytics:      false,
      ephemeralCache: new Map(),
    }),
  }
  return _limiters
}

// ── In-memory fallback (local dev / missing env vars) ─────────────────────────

interface MemEntry { count: number; resetAt: number }

function makeMemLimiter(max: number, windowMs: number) {
  const store = new Map<string, MemEntry>()
  const timer = setInterval(() => {
    const now = Date.now()
    for (const [k, e] of store) if (e.resetAt <= now) store.delete(k)
  }, 5 * 60_000)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (typeof (timer as any).unref === 'function') (timer as any).unref()

  return function check(key: string) {
    const now = Date.now()
    let e = store.get(key)
    if (!e || e.resetAt <= now) {
      e = { count: 1, resetAt: now + windowMs }
      store.set(key, e)
    } else {
      e.count++
    }
    return {
      success:   e.count <= max,
      limit:     max,
      remaining: Math.max(0, max - e.count),
      resetSec:  Math.ceil(e.resetAt / 1000),
    }
  }
}

const memGlobal = makeMemLimiter(100, 60_000)
const memAi     = makeMemLimiter(10,  60_000)

// ── Exported middlewares ──────────────────────────────────────────────────────

/** Global rate limit: 100 req/min per IP address. */
export const rateLimitMiddleware: MiddlewareHandler = async (c, next) => {
  const ip = getClientIp(c)

  if (USE_REDIS) {
    const { success, limit, remaining, reset } = await getLimiters().global.limit(ip)
    const resetSec = Math.ceil(reset / 1000)  // Upstash returns ms
    setRateLimitHeaders(c, limit, remaining, resetSec)
    if (!success) return rejectRateLimit(c, limit, resetSec)
  } else {
    const { success, limit, remaining, resetSec } = memGlobal(ip)
    setRateLimitHeaders(c, limit, remaining, resetSec)
    if (!success) return rejectRateLimit(c, limit, resetSec)
  }

  return next()
}

/** AI-specific rate limit: 10 req/min per authenticated user ID (falls back to IP). */
export const aiRateLimitMiddleware: MiddlewareHandler = async (c, next) => {
  const user   = c.get('user') as { id: string } | undefined
  const userId = user?.id ?? getClientIp(c)

  if (USE_REDIS) {
    const { success, limit, remaining, reset } = await getLimiters().ai.limit(userId)
    const resetSec = Math.ceil(reset / 1000)
    setRateLimitHeaders(c, limit, remaining, resetSec)
    if (!success) return rejectRateLimit(c, limit, resetSec)
  } else {
    const { success, limit, remaining, resetSec } = memAi(userId)
    setRateLimitHeaders(c, limit, remaining, resetSec)
    if (!success) return rejectRateLimit(c, limit, resetSec)
  }

  return next()
}
