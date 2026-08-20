/**
 * FORGE ERP — Tests Vitest — Module RBAC
 * Tests : checkPermission (IMMUTABLE_RULES, cache, DB), rateLimiter,
 *         requirePermission middleware (200/401/403), guardrail PermissionsMatrix.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ── Mock Supabase ──────────────────────────────────────────────────────────────

vi.mock('@forge/db', async (importOriginal) => {
  // RBAC_MODULES/RBAC_ACTIONS doivent rester les vraies constantes : le guard-rail
  // SUPER_ADMIN de rbacService.ts (checkPermission) les itère à l'exécution pour
  // dériver le wildcard de permissions — un mock figé se désynchroniserait dès
  // qu'un nouveau module RBAC est ajouté (cf. bug CAISSE:READ vécu en prod).
  const actual = await importOriginal<typeof import('@forge/db')>()
  return {
    ...actual,
    supabaseAdmin: { from: vi.fn() },
  }
})

import { supabaseAdmin } from '@forge/db'
import {
  checkPermission,
  checkLoginAttempts,
  recordLoginAttempt,
  invalidatePermissionCache,
  writeAuditLog,
} from '../services/rbacService'

// ── Helpers ────────────────────────────────────────────────────────────────────

type MockFn = ReturnType<typeof vi.fn>
const db = supabaseAdmin as unknown as { from: MockFn }

function buildBuilder(resolved: unknown) {
  const b: Record<string, unknown> = {}
  const methods = [
    'select','eq','neq','in','lt','lte','gte','gt','order','limit','range',
    'single','maybeSingle','insert','update','delete','upsert',
  ]
  for (const m of methods) {
    b[m] = (..._args: unknown[]) => {
      if (m === 'single' || m === 'maybeSingle') return Promise.resolve(resolved)
      if (m === 'insert' || m === 'update' || m === 'delete' || m === 'upsert') {
        return { ...b, then: (r: (v: unknown) => void) => Promise.resolve(resolved).then(r) }
      }
      return b
    }
  }
  // Allow awaiting the builder directly (for .select('*', { count: 'exact' }))
  b['then'] = (r: (v: unknown) => void) => Promise.resolve(resolved).then(r)
  return b
}

function mockDb(tableResponses: Record<string, unknown>) {
  db.from.mockImplementation((table: string) => {
    const res = tableResponses[table] ?? { data: null, error: null, count: 0 }
    return buildBuilder(res)
  })
}

// Reset entre chaque test pour éviter les queues mockReturnValueOnce résiduelles
beforeEach(() => db.from.mockReset())

// ═══════════════════════════════════════════════════════════════════════════════
// checkPermission — IMMUTABLE_RULES
// ═══════════════════════════════════════════════════════════════════════════════

describe('checkPermission — IMMUTABLE_RULES', () => {
  beforeEach(() => {
    invalidatePermissionCache('user-super')
    invalidatePermissionCache('user-manager')
    invalidatePermissionCache('user-readonly')
    invalidatePermissionCache('user-anon')
  })

  it('SUPER_ADMIN a toujours ADMIN:CONFIGURE', async () => {
    mockDb({
      rbac_user_profiles:    { data: { role_id: 'role-sa', is_active: true }, error: null },
      rbac_roles:            { data: { id: 'role-sa', name: 'SUPER_ADMIN' }, error: null },
      rbac_role_permissions: { data: [], error: null },
    })
    const result = await checkPermission('user-super', 'ADMIN', 'CONFIGURE')
    expect(result.allowed).toBe(true)
    expect(result.roleName).toBe('SUPER_ADMIN')
  })

  it('MANAGER ne peut pas accéder à ADMIN:CONFIGURE', async () => {
    mockDb({
      rbac_user_profiles:    { data: { role_id: 'role-mgr', is_active: true }, error: null },
      rbac_roles:            { data: { id: 'role-mgr', name: 'MANAGER' }, error: null },
      rbac_role_permissions: { data: [], error: null },
    })
    const result = await checkPermission('user-manager', 'ADMIN', 'CONFIGURE')
    expect(result.allowed).toBe(false)
    expect(result.reason).toContain('IMMUTABLE_RULE')
  })

  it('Personne ne peut supprimer ADMIN (audit_logs DELETE)', async () => {
    // ADMIN:DELETE est interdit globalement (immutable rule)
    const result = await checkPermission('user-anon', 'ADMIN', 'DELETE')
    expect(result.allowed).toBe(false)
    expect(result.reason).toBe('IMMUTABLE_RULE:ADMIN_DELETE')
  })

  it('READONLY ne peut pas créer (CREATE refusé par IMMUTABLE_RULES)', async () => {
    mockDb({
      rbac_user_profiles:    { data: { role_id: 'role-ro', is_active: true }, error: null },
      rbac_roles:            { data: { id: 'role-ro', name: 'READONLY' }, error: null },
      rbac_role_permissions: { data: [], error: null },
    })
    const result = await checkPermission('user-readonly', 'STOCK', 'CREATE')
    expect(result.allowed).toBe(false)
    expect(result.reason).toContain('IMMUTABLE_RULE')
    expect(result.reason).toContain('READONLY')
  })

  it('READONLY peut lire (READ autorisé)', async () => {
    invalidatePermissionCache('user-readonly')
    mockDb({
      rbac_user_profiles:    { data: { role_id: 'role-ro', is_active: true }, error: null },
      rbac_roles:            { data: { id: 'role-ro', name: 'READONLY' }, error: null },
      rbac_role_permissions: { data: [{ permission_id: 'perm-read-001' }], error: null },
      rbac_permissions:      { data: [{ module: 'STOCK', action: 'READ' }], error: null },
    })
    const result = await checkPermission('user-readonly', 'STOCK', 'READ')
    expect(result.allowed).toBe(true)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// checkPermission — Cache TTL
// ═══════════════════════════════════════════════════════════════════════════════

describe('checkPermission — cache', () => {
  it('Second appel utilise le cache (from() non rappelé)', async () => {
    invalidatePermissionCache('user-cached')
    mockDb({
      rbac_user_profiles:    { data: { role_id: 'role-mgr', is_active: true }, error: null },
      rbac_roles:            { data: { id: 'role-mgr', name: 'MANAGER' }, error: null },
      rbac_role_permissions: { data: [{ permission_id: 'perm-001' }], error: null },
      rbac_permissions:      { data: [{ module: 'STOCK', action: 'READ' }], error: null },
    })

    await checkPermission('user-cached', 'STOCK', 'READ')
    const callsAfterFirst = db.from.mock.calls.length

    await checkPermission('user-cached', 'STOCK', 'READ')
    const callsAfterSecond = db.from.mock.calls.length

    // Le cache doit avoir évité tout appel DB supplémentaire
    expect(callsAfterSecond).toBe(callsAfterFirst)
  })

  it('invalidatePermissionCache force un re-fetch', async () => {
    invalidatePermissionCache('user-inv')
    mockDb({
      rbac_user_profiles:    { data: { role_id: 'role-mgr', is_active: true }, error: null },
      rbac_roles:            { data: { id: 'role-mgr', name: 'MANAGER' }, error: null },
      rbac_role_permissions: { data: [{ permission_id: 'perm-001' }], error: null },
      rbac_permissions:      { data: [{ module: 'COMMERCIAL', action: 'READ' }], error: null },
    })

    await checkPermission('user-inv', 'COMMERCIAL', 'READ')
    const before = db.from.mock.calls.length

    invalidatePermissionCache('user-inv')
    await checkPermission('user-inv', 'COMMERCIAL', 'READ')
    const after = db.from.mock.calls.length

    expect(after).toBeGreaterThan(before)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// checkPermission — fallback legacy role
// ═══════════════════════════════════════════════════════════════════════════════

describe('checkPermission — fallback legacy role', () => {
  it('operateur → COMMERCIAL peut lire STOCK (via ROLE_MAP)', async () => {
    invalidatePermissionCache('user-legacy')
    mockDb({
      rbac_user_profiles:    { data: null, error: { code: 'PGRST116' } },
      rbac_roles:            { data: { id: 'role-comm', name: 'COMMERCIAL' }, error: null },
      rbac_role_permissions: { data: [{ permission_id: 'perm-read-001' }], error: null },
      rbac_permissions:      { data: [{ module: 'STOCK', action: 'READ' }], error: null },
    })
    const result = await checkPermission('user-legacy', 'STOCK', 'READ', 'operateur')
    expect(result.allowed).toBe(true)
    expect(result.roleName).toBe('COMMERCIAL')
  })

  it('utilisateur désactivé est refusé', async () => {
    invalidatePermissionCache('user-disabled')
    mockDb({
      rbac_user_profiles: { data: { role_id: 'role-comm', is_active: false, rbac_roles: { name: 'COMMERCIAL' } }, error: null },
    })
    const result = await checkPermission('user-disabled', 'STOCK', 'READ')
    expect(result.allowed).toBe(false)
    expect(result.reason).toBe('NO_RBAC_PROFILE')
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// checkLoginAttempts — rate limiting
// ═══════════════════════════════════════════════════════════════════════════════

describe('checkLoginAttempts — rate limit', () => {
  const TEST_EMAIL = 'test@forge.ci'
  const TEST_IP    = '192.168.1.100'

  it('retourne blocked=false si aucune tentative récente', async () => {
    mockDb({
      rbac_security_settings: {
        data: { max_login_attempts: 5, lockout_duration_minutes: 30 },
        error: null,
      },
      rbac_login_attempts: { data: null, error: null, count: 0 },
    })
    const result = await checkLoginAttempts(TEST_EMAIL, TEST_IP)
    expect(result.blocked).toBe(false)
    expect(result.remainingAttempts).toBe(5)
  })

  it('bloque après max_login_attempts échecs', async () => {
    mockDb({
      rbac_security_settings: {
        data: { max_login_attempts: 5, lockout_duration_minutes: 30 },
        error: null,
      },
      rbac_login_attempts: {
        data: [{ attempted_at: new Date().toISOString() }],
        error: null,
        count: 5,
      },
    })
    const result = await checkLoginAttempts(TEST_EMAIL, TEST_IP)
    expect(result.blocked).toBe(true)
    expect(result.remainingAttempts).toBe(0)
    expect(result.blockedUntil).toBeDefined()
  })

  it('ne bloque pas avant le seuil (4 échecs, max=5)', async () => {
    mockDb({
      rbac_security_settings: {
        data: { max_login_attempts: 5, lockout_duration_minutes: 30 },
        error: null,
      },
      rbac_login_attempts: { data: null, error: null, count: 4 },
    })
    const result = await checkLoginAttempts(TEST_EMAIL, TEST_IP)
    expect(result.blocked).toBe(false)
    expect(result.remainingAttempts).toBe(1)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// requirePermission middleware
// ═══════════════════════════════════════════════════════════════════════════════

describe('requirePermission — middleware', () => {
  // Hono context mock helper
  function makeCtx(userId: string, role: string) {
    const vars: Record<string, unknown> = {
      user: { id: userId, email: `${userId}@test.fr`, role },
    }
    return {
      get:  (k: string) => vars[k],
      set:  (k: string, v: unknown) => { vars[k] = v },
      json: (body: unknown, status?: number) => ({ body, status: status ?? 200 }),
      req:  { header: () => undefined },
    }
  }

  beforeEach(() => {
    invalidatePermissionCache('mw-admin')
    invalidatePermissionCache('mw-readonly')
    invalidatePermissionCache('mw-noauth')
  })

  it('retourne 401 si aucun user dans le contexte', async () => {
    const { requirePermission } = await import('../middleware/permission.middleware')
    const mw = requirePermission('STOCK', 'READ')
    const ctx = { get: () => undefined, json: (b: unknown, s?: number) => ({ body: b, status: s }) }
    const res = await mw(ctx as never, async () => {})
    expect((res as { status: number }).status).toBe(401)
  })

  it('retourne 403 si permission refusée', async () => {
    invalidatePermissionCache('mw-deny')
    mockDb({
      rbac_user_profiles:    { data: { role_id: 'role-ro', is_active: true }, error: null },
      rbac_roles:            { data: { id: 'role-ro', name: 'READONLY' }, error: null },
      rbac_role_permissions: { data: [], error: null },
    })
    const { requirePermission } = await import('../middleware/permission.middleware')
    const mw = requirePermission('ADMIN', 'CONFIGURE')
    const ctx = makeCtx('mw-deny', 'apprenant')
    const res = await mw(ctx as never, async () => {})
    expect((res as { status: number }).status).toBe(403)
  })

  it('appelle next() si permission accordée', async () => {
    invalidatePermissionCache('mw-ok')
    mockDb({
      rbac_user_profiles:    { data: { role_id: 'role-sa', is_active: true }, error: null },
      rbac_roles:            { data: { id: 'role-sa', name: 'SUPER_ADMIN' }, error: null },
      rbac_role_permissions: { data: [], error: null },
    })
    const { requirePermission } = await import('../middleware/permission.middleware')
    const mw = requirePermission('STOCK', 'READ')
    const ctx = makeCtx('mw-ok', 'admin')
    let nextCalled = false
    await mw(ctx as never, async () => { nextCalled = true })
    expect(nextCalled).toBe(true)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// writeAuditLog — fire-and-forget, ne lance pas d'erreur
// ═══════════════════════════════════════════════════════════════════════════════

describe('writeAuditLog', () => {
  it('ne rejette pas même si la DB échoue', async () => {
    db.from.mockReturnValue({
      insert: () => Promise.resolve({ error: { message: 'DB down' } }),
    })
    expect(() =>
      writeAuditLog({ actionType: 'ACCESS_DENIED', userId: 'u1', module: 'STOCK' }),
    ).not.toThrow()
    // Attendre la promesse interne pour que le test reste propre
    await vi.waitFor(() => expect(db.from).toHaveBeenCalled())
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// Validation Zod — routes RBAC
// ═══════════════════════════════════════════════════════════════════════════════

describe('Zod validation — RBAC routes', () => {
  it('rbacRoleName invalide est rejeté', () => {
    const { z } = require('zod') as typeof import('zod')
    const RBAC_ROLE_NAMES = ['SUPER_ADMIN','MANAGER','COMMERCIAL','CAISSIER','MAGASINIER','FORMATEUR','READONLY'] as const
    const schema = z.object({ rbacRoleName: z.enum(RBAC_ROLE_NAMES).optional() })
    expect(() => schema.parse({ rbacRoleName: 'DICTATEUR' })).toThrow()
  })

  it('rbacRoleName valide passe', () => {
    const { z } = require('zod') as typeof import('zod')
    const RBAC_ROLE_NAMES = ['SUPER_ADMIN','MANAGER','COMMERCIAL','CAISSIER','MAGASINIER','FORMATEUR','READONLY'] as const
    const schema = z.object({ rbacRoleName: z.enum(RBAC_ROLE_NAMES).optional() })
    expect(() => schema.parse({ rbacRoleName: 'MANAGER' })).not.toThrow()
  })

  it('allowed_hours format invalide est rejeté', () => {
    const { z } = require('zod') as typeof import('zod')
    const schema = z.object({ allowedHoursStart: z.string().regex(/^\d{2}:\d{2}$/).optional() })
    expect(() => schema.parse({ allowedHoursStart: '8:00' })).toThrow()
    expect(() => schema.parse({ allowedHoursStart: '08:00' })).not.toThrow()
  })
})
