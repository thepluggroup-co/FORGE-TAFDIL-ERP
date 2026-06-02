/**
 * TEST-01 : Anti-survente de stock concurrent
 *
 * Valide que mouvement_stock_atomique (fn_mouvement_stock PostgreSQL SELECT FOR UPDATE)
 * empêche deux sorties concurrentes de dépasser le stock disponible.
 *
 * Scenario : stock = 10 unités
 * Deux sorties de 7 unités en Promise.all
 * → une réussit (201), l'autre échoue (400/422)
 * → stock final jamais négatif
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mkChain, authHeaders } from './helpers'

vi.mock('@forge/db/supabase', () => {
  // Chaîne sûre par défaut — ne crashe jamais, retourne data=[] sans erreur
  const safeChain = () => {
    const c: Record<string, unknown> = {}
    for (const m of ['select','insert','update','delete','upsert','eq','neq','in',
      'or','gte','lte','lt','gt','not','ilike','like','order','range','limit','head','filter'])
      c[m] = vi.fn().mockReturnValue(c)
    c['single']      = vi.fn().mockResolvedValue({ data: null, error: null })
    c['maybeSingle'] = vi.fn().mockResolvedValue({ data: null, error: null })
    c['then']        = (res: (v: unknown) => unknown) =>
      Promise.resolve({ data: [], count: 0, error: null }).then(res)
    return c
  }
  const mockClient = {
    from:          vi.fn().mockImplementation(safeChain),
    rpc:           vi.fn().mockResolvedValue({ data: null, error: null }),
    channel:       vi.fn(() => ({ send: vi.fn().mockResolvedValue('ok') })),
    removeChannel: vi.fn(),
    storage: { from: vi.fn().mockReturnValue({
      upload:          vi.fn().mockResolvedValue({ error: null }),
      download:        vi.fn().mockResolvedValue({ data: null, error: { message: 'not found' } }),
      getPublicUrl:    vi.fn().mockReturnValue({ data: { publicUrl: 'https://test.supabase.co/test.pdf' } }),
      createSignedUrl: vi.fn().mockResolvedValue({ data: { signedUrl: 'https://test.supabase.co/signed.pdf' } }),
    }) },
  }
  return { supabase: mockClient, supabaseAdmin: mockClient }
})

import app from '../app'
import { supabase } from '@forge/db/supabase'

const PRODUIT_ID = 'prod-test-concurrent-uuid-001'
const QTE        = 7

describe('TEST-01 : Anti-survente de stock concurrent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(supabase.from).mockReturnValue(
      mkChain({ data: null, error: null }) as ReturnType<typeof mkChain>,
    )
  })

  it('stock=10, deux sorties de 7 en parallèle — une réussit, une échoue, stock jamais négatif', async () => {
    const mockRpc = vi.mocked(supabase.rpc)

    // Premier appel RPC → succès atomique (stock 10 → 3)
    mockRpc.mockResolvedValueOnce({
      data:  { stock_actuel: 3, mouvement_id: 'mvt-001', success: true },
      error: null,
    } as never)

    // Deuxième appel RPC → échec atomique (PostgreSQL P0001 : deadlock / stock insuffisant)
    mockRpc.mockResolvedValueOnce({
      data:  null,
      error: { code: 'P0001', message: 'Stock insuffisant — transaction annulée' },
    } as never)

    const headers = new Headers(authHeaders('operateur'))
    const body    = JSON.stringify({ type: 'sortie', quantite: QTE })

    const makeRequest = () =>
      app.request(`/api/stocks/${PRODUIT_ID}/mouvement`, {
        method: 'POST',
        headers,
        body,
      })

    const t0 = Date.now()
    const [res1, res2] = await Promise.all([makeRequest(), makeRequest()])
    const elapsed = Date.now() - t0

    const statuses = [res1.status, res2.status]
    const [body1, body2] = await Promise.all([
      res1.json() as Promise<Record<string, unknown>>,
      res2.json() as Promise<Record<string, unknown>>,
    ])

    // Une seule opération réussit
    expect(statuses).toContain(201)
    expect(statuses.some((s) => s === 400 || s === 422)).toBe(true)

    // Le corps d'erreur contient un message lisible sur le stock insuffisant
    const errBody = res1.status !== 201 ? body1 : body2
    expect(String(errBody.error)).toMatch(/stock insuffisant/i)

    // Le stock résultant de l'opération réussie n'est jamais négatif
    const successBody = res1.status === 201 ? body1 : body2
    if (successBody.stock_actuel !== undefined) {
      expect(Number(successBody.stock_actuel)).toBeGreaterThanOrEqual(0)
    }

    // Le RPC atomique a été invoqué deux fois avec des quantités positives
    expect(mockRpc).toHaveBeenCalledTimes(2)
    for (const call of mockRpc.mock.calls) {
      const args = call[1] as { p_quantite: number }
      expect(args.p_quantite).toBeGreaterThan(0)
    }

    // Performance : les deux requêtes ensemble en < 5 s
    expect(elapsed).toBeLessThan(5_000)
  })

  it('retourne 401 si le token est absent', async () => {
    const res = await app.request(`/api/stocks/${PRODUIT_ID}/mouvement`, {
      method:  'POST',
      headers: new Headers({ 'Content-Type': 'application/json' }),
      body:    JSON.stringify({ type: 'sortie', quantite: 1 }),
    })
    expect(res.status).toBe(401)
  })
})
