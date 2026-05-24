import type { MiddlewareHandler } from 'hono'
import jwt from 'jsonwebtoken'
const { verify } = jwt
import type { HonoVariables, SupabaseJwtPayload } from '../types'

/**
 * Auth middleware — vérifie le JWT localement avec SUPABASE_JWT_SECRET.
 *
 * La vérification locale est identique à celle de Supabase (même secret,
 * même algorithme HS256) mais n'envoie aucune requête réseau, ce qui
 * supprime la latence et empêche les blocages si Supabase est lent.
 *
 * Le seul cas non couvert : la révocation de token côté Supabase.
 * Pour un ERP interne derrière VPN / accès restreint, c'est acceptable.
 * Activer la vérification réseau = décommenter le bloc "supabaseAdmin" ci-dessous.
 */
export const authMiddleware: MiddlewareHandler<{ Variables: HonoVariables }> = async (c, next) => {
  const authHeader = c.req.header('Authorization')

  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ error: 'Token manquant', code: 'MISSING_TOKEN' }, 401)
  }

  const token = authHeader.slice(7)
  const JWT_SECRET = process.env.SUPABASE_JWT_SECRET ?? ''

  if (!JWT_SECRET) {
    console.error('[auth] SUPABASE_JWT_SECRET manquant dans .env')
    return c.json({ error: 'Configuration serveur invalide', code: 'SERVER_ERROR' }, 500)
  }

  // Supabase JWT secrets are base64-encoded strings.
  // The HMAC key used for signing is the *decoded* bytes, not the raw string.
  const secretKey = Buffer.from(JWT_SECRET, 'base64')

  let payload: SupabaseJwtPayload
  try {
    payload = verify(token, secretKey) as SupabaseJwtPayload
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Token invalide'
    return c.json({ error: 'Token invalide', code: 'INVALID_TOKEN', details: message }, 401)
  }

  const role =
    (payload.app_metadata?.role as HonoVariables['user']['role']) ??
    (payload.user_metadata?.role as HonoVariables['user']['role']) ??
    'viewer'

  c.set('user', {
    id:    payload.sub,
    email: payload.email ?? '',
    role,
  })
  c.set('requestId', crypto.randomUUID())

  await next()
}
