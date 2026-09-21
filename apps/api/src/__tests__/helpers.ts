import { vi } from 'vitest'
import jwt from 'jsonwebtoken'

export const TEST_JWT_SECRET = 'forge-test-jwt-secret-x0x0x0x0x0x0x0x0x0x0'

/**
 * Crée un mock complet d'un client Supabase.
 * À utiliser pour BOTH supabase ET supabaseAdmin dans les mocks de test —
 * les routes utilisent `const db = supabaseAdmin!` donc supabaseAdmin
 * ne doit jamais être null dans les mocks.
 */
export function mkClient() {
  const storageChain = {
    upload:        vi.fn().mockResolvedValue({ error: null }),
    download:      vi.fn().mockResolvedValue({ data: null, error: { message: 'not found' } }),
    getPublicUrl:  vi.fn().mockReturnValue({ data: { publicUrl: 'https://test.supabase.co/storage/test.pdf' } }),
    createSignedUrl: vi.fn().mockResolvedValue({ data: { signedUrl: 'https://test.supabase.co/storage/signed.pdf' } }),
  }
  const client = {
    from:          vi.fn(),
    rpc:           vi.fn(),
    channel:       vi.fn(() => ({ send: vi.fn().mockResolvedValue('ok') })),
    removeChannel: vi.fn(),
    storage:       { from: vi.fn().mockReturnValue(storageChain) },
    auth:          { getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }) },
  }
  return client
}

export function makeToken(
  role: 'admin' | 'superviseur' | 'operateur' | 'apprenant' | 'livreur' | 'caissier' = 'admin',
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
  userId?: string,
): Record<string, string> {
  return {
    Authorization: `Bearer ${makeToken(role, userId)}`,
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
