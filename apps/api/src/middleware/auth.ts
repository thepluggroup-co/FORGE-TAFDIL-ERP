import type { MiddlewareHandler } from 'hono'
import jwt from 'jsonwebtoken'
const { verify } = jwt
import { supabaseAdmin } from '@forge/db'
import type { HonoVariables, SupabaseJwtPayload } from '../types'

/**
 * Auth middleware — deux modes :
 *
 *  1. Production  (SUPABASE_SERVICE_ROLE_KEY présent → supabaseAdmin non-null)
 *     → supabaseAdmin.auth.getUser(token)
 *       Avantage : détecte les tokens révoqués côté Supabase.
 *
 *  2. Dev / Tests (supabaseAdmin = null, SERVICE_ROLE_KEY absent)
 *     → vérification JWT locale avec SUPABASE_JWT_SECRET
 *       Permet aux tests de tourner sans appel réseau.
 */
export const authMiddleware: MiddlewareHandler<{ Variables: HonoVariables }> = async (c, next) => {
  const authHeader = c.req.header('Authorization')

  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ error: 'Token manquant', code: 'MISSING_TOKEN' }, 401)
  }

  const token = authHeader.slice(7)

  if (supabaseAdmin) {
    // ── Mode production : vérification via Supabase Admin API ───────────────
    let user
    try {
      const { data, error } = await supabaseAdmin.auth.getUser(token)
      if (error || !data.user) {
        return c.json({ error: 'Token invalide', code: 'INVALID_TOKEN' }, 401)
      }
      user = data.user
    } catch {
      return c.json({ error: 'Erreur auth', code: 'AUTH_ERROR' }, 500)
    }

    const role =
      (user.app_metadata?.role as HonoVariables['user']['role']) ??
      'viewer'

    c.set('user', { id: user.id, email: user.email ?? '', role })

  } else {
    // ── Mode dev/test : vérification JWT locale ──────────────────────────────
    const JWT_SECRET = process.env.SUPABASE_JWT_SECRET ?? ''

    if (!JWT_SECRET || JWT_SECRET.startsWith('<')) {
      console.error('[auth] Ni SUPABASE_SERVICE_ROLE_KEY ni SUPABASE_JWT_SECRET configurés')
      return c.json({ error: 'Configuration serveur invalide', code: 'SERVER_ERROR' }, 500)
    }

    let payload: SupabaseJwtPayload
    try {
      payload = verify(token, JWT_SECRET) as SupabaseJwtPayload
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Token invalide'
      return c.json({ error: 'Token invalide', code: 'INVALID_TOKEN', details: message }, 401)
    }

    const role =
      (payload.app_metadata?.role as HonoVariables['user']['role']) ??
      (payload.user_metadata?.role as HonoVariables['user']['role']) ??
      (payload.role as HonoVariables['user']['role']) ??
      'viewer'

    c.set('user', { id: payload.sub, email: payload.email, role })
  }

  c.set('requestId', crypto.randomUUID())
  await next()
}
