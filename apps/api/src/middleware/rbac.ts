import type { MiddlewareHandler } from 'hono'
import type { HonoVariables } from '../types'

type ForgeRole = HonoVariables['user']['role']

/**
 * Middleware RBAC — restreint l'accès aux rôles autorisés.
 * À utiliser après authMiddleware.
 *
 * @example
 * app.post('/api/produits', authMiddleware, requireRole(['directeur', 'admin']), handler)
 */
export function requireRole(roles: ForgeRole[]): MiddlewareHandler<{ Variables: HonoVariables }> {
  return async (c, next) => {
    const user = c.get('user')

    if (!user) {
      return c.json({ error: 'Non authentifié', code: 'UNAUTHENTICATED' }, 401)
    }

    if (!roles.includes(user.role)) {
      return c.json(
        {
          error: 'Accès refusé',
          code: 'FORBIDDEN',
          details: `Rôle requis : ${roles.join(' ou ')}. Rôle actuel : ${user.role}`,
        },
        403,
      )
    }

    await next()
  }
}
