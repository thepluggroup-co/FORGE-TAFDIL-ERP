/**
 * FORGE ERP — Middleware permission RBAC
 * Fabrique requirePermission(module, action).
 * À utiliser APRÈS authMiddleware.
 */
import type { MiddlewareHandler } from 'hono'
import type { HonoVariables } from '../types'
import type { RbacModule, RbacAction } from '@forge/db'
import { checkPermission, writeAuditLog } from '../services/rbacService'

export function requirePermission(
  module: RbacModule,
  action: RbacAction,
): MiddlewareHandler<{ Variables: HonoVariables }> {
  return async (c, next) => {
    const user = c.get('user')

    if (!user) {
      return c.json({ error: 'Non authentifié', code: 'UNAUTHENTICATED' }, 401)
    }

    const result = await checkPermission(user.id, module, action, user.role)

    if (!result.allowed) {
      // Log ACCESS_DENIED en audit (fire-and-forget)
      writeAuditLog({
        userId:       user.id,
        actionType:   'ACCESS_DENIED',
        module,
        ipAddress:    c.req.header('x-forwarded-for') ?? c.req.header('x-real-ip'),
        userAgent:    c.req.header('user-agent'),
        payloadAfter: { action, reason: result.reason, role: result.roleName },
      })

      console.info('[rbac:middleware] ACCESS_DENIED', {
        userId: user.id,
        email:  user.email,
        module,
        action,
        reason: result.reason,
      })

      return c.json(
        {
          error:  'Accès refusé',
          code:   'FORBIDDEN',
          details: `Permission requise : ${module}:${action}. Rôle actuel : ${result.roleName ?? user.role}`,
        },
        403,
      )
    }

    await next()
  }
}
