import { vi } from 'vitest'
import jwt from 'jsonwebtoken'

export const TEST_JWT_SECRET = 'forge-test-jwt-secret-x0x0x0x0x0x0x0x0x0x0'

export function makeToken(
  role: 'directeur' | 'admin' | 'operateur' | 'viewer' = 'admin',
  userId = 'test-user-uid-001',
): string {
  return jwt.sign(
    {
      sub: userId,
      email: 'test@tafdil.cm',
      app_metadata: { role },
      aud: 'authenticated',
    },
    TEST_JWT_SECRET,
    { expiresIn: '1h' },
  )
}

export function authHeaders(
  role: Parameters<typeof makeToken>[0] = 'admin',
): Record<string, string> {
  return {
    Authorization: `Bearer ${makeToken(role)}`,
    'Content-Type': 'application/json',
  }
}

/**
 * Crée un objet chainable mockant le client Supabase fluent API.
 * Toutes les méthodes de filtrage retournent `this`.
 * `.single()` et `await chain` résolvent vers `response`.
 */
export function mkChain(response: Record<string, unknown>) {
  const c: Record<string, unknown> = {}

  const chainMethods = [
    'select', 'insert', 'update', 'delete', 'upsert',
    'eq', 'neq', 'in', 'or', 'gte', 'lte', 'lt', 'gt',
    'not', 'ilike', 'like', 'order', 'range', 'limit', 'head', 'filter',
  ]

  for (const method of chainMethods) {
    c[method] = vi.fn().mockReturnValue(c)
  }

  c['single']      = vi.fn().mockResolvedValue(response)
  c['maybeSingle'] = vi.fn().mockResolvedValue(response)

  // Rend la chaîne directement awaitable : `await supabase.from(...).select(...)`
  c['then'] = (resolve: (v: unknown) => void, reject: (e: unknown) => void) =>
    Promise.resolve(response).then(resolve, reject)

  return c
}

export type MockChain = ReturnType<typeof mkChain>
