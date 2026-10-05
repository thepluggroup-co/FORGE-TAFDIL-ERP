import type { MiddlewareHandler } from 'hono'
import type { HonoVariables } from '../types'

type ForgeRole = HonoVariables['user']['role']

/**
 * Rapports comptables (grand-livre, balance, bilan, TVA…) : relèvent de REPORTS:READ
 * mais exposent la comptabilité. Le technicien (READONLY), privé de FINANCE par
 * règle immuable (rbacService), en est exclu ici aussi.
 */
export const refuserLectureSeule: MiddlewareHandler<{ Variables: HonoVariables }> = async (c, next) => {
  if (c.get('user')?.role === 'technicien') {
    return c.json({ error: 'Accès refusé', code: 'FORBIDDEN', details: 'Rapports comptables non accessibles en lecture seule' }, 403)
  }
  await next()
}

/**
 * Middleware RBAC — restreint l'accès aux rôles autorisés.
 * À utiliser après authMiddleware.
 *
 * Plusieurs routes (factures, écritures, paie, gestion des utilisateurs…) sont
 * volontairement réservées à `admin` par requireRole, même si la matrice RBAC
 * donne au MANAGER (superviseur) le droit correspondant : décision métier
 * confirmée le 2026-10-05, ne pas migrer ces routes vers requirePermission.
 *
 * @example
 * app.post('/api/produits', authMiddleware, requireRole(['admin', 'superviseur']), handler)
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
