import type { MiddlewareHandler } from 'hono'
import jwt from 'jsonwebtoken'
import { createPublicKey } from 'node:crypto'
import type { HonoVariables } from '../types'

// ── Config ────────────────────────────────────────────────────────────────────
const SUPABASE_URL = process.env.SUPABASE_URL ?? ''

// Lu lazily par-requête pour que les tests (setupFiles) puissent l'injecter après le chargement du module
const getJwtSecret = () => process.env.SUPABASE_JWT_SECRET ?? ''

if (!SUPABASE_URL) console.error('[auth] ⚠️  SUPABASE_URL manquant dans .env')

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
  [k: string]: unknown
}

let _jwks: JWK[] = []
let _jwksFetchedAt = 0
let _jwksFetchPromise: Promise<void> | null = null

async function fetchJwks(): Promise<void> {
  // Reuse the in-progress fetch so callers actually wait for it to finish
  // instead of returning immediately and finding _jwks still empty.
  if (_jwksFetchPromise) return _jwksFetchPromise
  _jwksFetchPromise = (async () => {
    try {
      const res = await fetch(`${SUPABASE_URL}/auth/v1/.well-known/jwks.json`, {
        signal: AbortSignal.timeout(12_000),
      })
      if (res.ok) {
        const data = await res.json() as { keys: JWK[] }
        _jwks = data.keys ?? []
        _jwksFetchedAt = Date.now()
        console.log('[auth] JWKS refreshed —', _jwks.length, 'key(s)')
      } else {
        console.error('[auth] JWKS fetch HTTP', res.status)
      }
    } catch (e) {
      console.error('[auth] JWKS fetch failed:', e)
    } finally {
      _jwksFetchPromise = null
    }
  })()
  return _jwksFetchPromise
}

// Pré-charger le JWKS au démarrage du module (non bloquant)
if (SUPABASE_URL) {
  fetchJwks().catch(() => { /* silently ignore startup errors */ })
}

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

  // Refresh JWKS if empty or stale (> 1 h)
  const now = Date.now()
  if (!_jwks.length || now - _jwksFetchedAt > 3_600_000) {
    await fetchJwks()
  }

  // Find key by kid, then fall back to first key, then force-refresh and retry once
  let jwk = kid ? _jwks.find(k => k.kid === kid) : _jwks[0]

  if (!jwk && kid && _jwks.length > 0) {
    // kid mismatch: Supabase may have rotated keys — force refresh
    console.warn('[auth] kid', kid, 'not in JWKS cache — forcing refresh')
    await fetchJwks()
    jwk = _jwks.find(k => k.kid === kid) ?? _jwks[0]
  }

  if (!jwk) {
    console.error('[auth] No JWK found. kid:', kid, '_jwks.length:', _jwks.length)
    return null
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return createPublicKey({ format: 'jwk', key: jwk as any })
  } catch (e) {
    console.error('[auth] createPublicKey failed for kid', kid, ':', e)
    return null
  }
}

// ── Vérification d'un en-tête Bearer ─────────────────────────────────────────
// Extraite du middleware pour être réutilisée par les routes publiques à
// authentification OPTIONNELLE (ex. POST /api/shop/commandes : anonyme = prix
// catalogue imposé par le serveur, personnel authentifié = vente boutique).

export type VerificationBearer =
  | { ok: true; user: HonoVariables['user'] }
  | { ok: false; status: 401 | 500; error: string; code: string }

export async function verifierBearer(authHeader: string | undefined): Promise<VerificationBearer> {
  if (!authHeader?.startsWith('Bearer ')) {
    console.warn('[auth] ❌ No Bearer token')
    return { ok: false, status: 401, error: 'Token manquant', code: 'MISSING_TOKEN' }
  }

  const token = authHeader.slice(7)

  // ── Decode header to know the algorithm ──────────────────────────────────────
  let alg = 'HS256'
  try {
    const h = JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString()) as { alg?: string }
    alg = h.alg ?? 'HS256'
  } catch {
    return { ok: false, status: 401, error: 'Token malformé', code: 'INVALID_TOKEN' }
  }

  // ── Verify signature ──────────────────────────────────────────────────────────
  let payload: jwt.JwtPayload
  try {
    if (alg === 'HS256') {
      // Legacy projects: symmetric HMAC — use the JWT secret string directly
      payload = jwt.verify(token, getJwtSecret(), { algorithms: ['HS256'] }) as jwt.JwtPayload
    } else {
      // New projects (ES256, RS256): asymmetric — verify with public key from JWKS
      const publicKey = await getPublicKeyForToken(token)
      if (!publicKey) {
        console.error('[auth] ❌ Could not obtain public key for alg:', alg)
        return { ok: false, status: 500, error: 'Erreur configuration auth', code: 'SERVER_ERROR' }
      }
      payload = jwt.verify(token, publicKey, { algorithms: [alg as jwt.Algorithm] }) as jwt.JwtPayload
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[auth] ❌ JWT verification failed:', msg)
    return { ok: false, status: 401, error: 'Token invalide', code: 'INVALID_TOKEN' }
  }

  // ── Extract user from payload ─────────────────────────────────────────────────
  const userId = payload.sub
  if (!userId) {
    return { ok: false, status: 401, error: 'Token invalide — sub manquant', code: 'INVALID_TOKEN' }
  }

  const email = (payload['email'] as string | undefined) ?? ''
  const appMeta = (payload['app_metadata'] as { role?: string } | undefined) ?? {}

  // Normalize legacy role names (after rename: directeur→admin, apprenant→technicien)
  const ROLE_MAP: Record<string, HonoVariables['user']['role']> = {
    admin:       'admin',
    superviseur: 'superviseur',
    operateur:   'operateur',
    technicien:  'technicien',
    livreur:     'livreur',
    caissier:    'caissier',
    directeur:   'admin',        // legacy
    apprenant:   'technicien',   // legacy
    viewer:      'technicien',   // legacy
  }
  const role = ROLE_MAP[appMeta.role as string] ?? 'technicien'

  console.log('[auth] ✅', email, '| role:', role, '| jwt_raw:', appMeta.role, '| alg:', alg)

  return { ok: true, user: { id: userId, email, role } }
}

// ── Middleware ────────────────────────────────────────────────────────────────
export const authMiddleware: MiddlewareHandler<{ Variables: HonoVariables }> = async (c, next) => {
  const verification = await verifierBearer(c.req.header('Authorization'))
  if (!verification.ok) {
    return c.json({ error: verification.error, code: verification.code }, verification.status)
  }

  c.set('user', verification.user)
  c.set('requestId', crypto.randomUUID())
  await next()
}
