import type { MiddlewareHandler } from 'hono'
import jwt from 'jsonwebtoken'
import { createPublicKey } from 'node:crypto'
import type { HonoVariables } from '../types'

// ── Config ────────────────────────────────────────────────────────────────────
const SUPABASE_URL       = process.env.SUPABASE_URL ?? ''
const SUPABASE_JWT_SECRET = process.env.SUPABASE_JWT_SECRET ?? ''

if (!SUPABASE_URL)        console.error('[auth] ⚠️  SUPABASE_URL manquant dans .env')
if (!SUPABASE_JWT_SECRET) console.warn('[auth] ⚠️  SUPABASE_JWT_SECRET manquant — HS256 ne fonctionnera pas')

// ── JWKS cache (refreshed every hour) ─────────────────────────────────────────
interface JWK {
  kid:  string
  kty:  string
  alg?: string
  use?: string
  crv?: string
  x?:   string
  y?:   string
  n?:   string
  e?:   string
}

let _jwks: JWK[] = []
let _jwksFetchedAt = 0

async function getPublicKeyForToken(token: string): Promise<ReturnType<typeof createPublicKey> | null> {
  // Decode JWT header without verifying
  let kid: string | undefined
  let alg: string | undefined
  try {
    const raw = Buffer.from(token.split('.')[0], 'base64url').toString()
    const h = JSON.parse(raw) as { kid?: string; alg?: string }
    kid = h.kid
    alg = h.alg
  } catch {
    return null
  }

  // Only needed for asymmetric algorithms
  if (!alg || alg === 'HS256') return null

  // Refresh JWKS if stale (> 1 h)
  const now = Date.now()
  if (!_jwks.length || now - _jwksFetchedAt > 3_600_000) {
    try {
      const res = await fetch(`${SUPABASE_URL}/auth/v1/.well-known/jwks.json`, {
        signal: AbortSignal.timeout(5_000),
      })
      if (res.ok) {
        const data = await res.json() as { keys: JWK[] }
        _jwks = data.keys ?? []
        _jwksFetchedAt = now
        console.log('[auth] JWKS refreshed —', _jwks.length, 'key(s)')
      }
    } catch (e) {
      console.error('[auth] JWKS fetch failed:', e)
    }
  }

  const jwk = kid ? _jwks.find(k => k.kid === kid) : _jwks[0]
  if (!jwk) return null

  try {
    // Node.js 15+ supports createPublicKey({ format: 'jwk', key: <JWK object> })
    return createPublicKey({ format: 'jwk', key: jwk as Parameters<typeof createPublicKey>[0] & object })
  } catch (e) {
    console.error('[auth] createPublicKey failed:', e)
    return null
  }
}

// ── Middleware ────────────────────────────────────────────────────────────────
export const authMiddleware: MiddlewareHandler<{ Variables: HonoVariables }> = async (c, next) => {
  const authHeader = c.req.header('Authorization')

  if (!authHeader?.startsWith('Bearer ')) {
    console.warn('[auth] ❌ No Bearer token')
    return c.json({ error: 'Token manquant', code: 'MISSING_TOKEN' }, 401)
  }

  const token = authHeader.slice(7)

  // ── Decode header to know the algorithm ──────────────────────────────────────
  let alg = 'HS256'
  try {
    const h = JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString()) as { alg?: string }
    alg = h.alg ?? 'HS256'
  } catch {
    return c.json({ error: 'Token malformé', code: 'INVALID_TOKEN' }, 401)
  }

  // ── Verify signature ──────────────────────────────────────────────────────────
  let payload: jwt.JwtPayload
  try {
    if (alg === 'HS256') {
      // Legacy projects: symmetric HMAC — use the JWT secret string directly
      payload = jwt.verify(token, SUPABASE_JWT_SECRET, { algorithms: ['HS256'] }) as jwt.JwtPayload
    } else {
      // New projects (ES256, RS256): asymmetric — verify with public key from JWKS
      const publicKey = await getPublicKeyForToken(token)
      if (!publicKey) {
        console.error('[auth] ❌ Could not obtain public key for alg:', alg)
        return c.json({ error: 'Erreur configuration auth', code: 'SERVER_ERROR' }, 500)
      }
      payload = jwt.verify(token, publicKey, { algorithms: [alg as jwt.Algorithm] }) as jwt.JwtPayload
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[auth] ❌ JWT verification failed:', msg)
    return c.json({ error: 'Token invalide', code: 'INVALID_TOKEN' }, 401)
  }

  // ── Extract user from payload ─────────────────────────────────────────────────
  const userId = payload.sub
  if (!userId) {
    return c.json({ error: 'Token invalide — sub manquant', code: 'INVALID_TOKEN' }, 401)
  }

  const email = (payload['email'] as string | undefined) ?? ''
  const appMeta = (payload['app_metadata'] as { role?: string } | undefined) ?? {}
  const role = (appMeta.role as HonoVariables['user']['role']) ?? 'viewer'

  console.log('[auth] ✅', email, '| role:', role, '| alg:', alg)

  c.set('user', { id: userId, email, role })
  c.set('requestId', crypto.randomUUID())
  await next()
}
