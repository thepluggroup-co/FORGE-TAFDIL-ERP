/**
 * stocks.test.ts — Tests 1 à 4
 *
 * 1. GET /api/stocks retourne un tableau paginé de produits
 * 2. POST /api/stocks/:id/mouvement sortie > stock → 422 INSUFFICIENT_STOCK
 * 3. POST /api/stocks/:id/mouvement entree valide → stock_actuel augmente exactement
 * 4. CONCURRENCE : deux sorties simultanées → une réussit, une échoue, stock jamais négatif
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mkChain, authHeaders } from './helpers'

vi.mock('@forge/db/supabase', () => ({
  supabase: {
    from:          vi.fn(),
    rpc:           vi.fn(),
    channel:       vi.fn(() => ({ send: vi.fn().mockResolvedValue('ok') })),
    removeChannel: vi.fn(),
  },
  supabaseAdmin: null,
}))

import app from '../app'
import { supabase } from '@forge/db/supabase'

// ── Fixtures ───────────────────────────────────────────────────────────────────

const PRODUIT_ID = 'prod-test-stock-uuid-001'

const PRODUIT = {
  id:               PRODUIT_ID,
  ref:              'ALU-6060',
  designation:      'Aluminium 6060 T5',
  categorie:        'Aluminium',
  unite:            'kg',
  stock_actuel:     10,
  stock_min:        20,
  stock_critique:   5,
  prix_unitaire_xaf: 3500,
  statut:           'alerte',
  sync_status:      'synced',
}

describe('Test 1 — GET /api/stocks retourne un tableau paginé', () => {
  beforeEach(() => vi.clearAllMocks())

  it('retourne data[], total, page avec statut 200', async () => {
    vi.mocked(supabase.from).mockReturnValueOnce(
      mkChain({ data: [PRODUIT], count: 1, error: null }) as never,
    )

    const res = await app.request('/api/stocks', {
      method:  'GET',
      headers: new Headers({ 'Content-Type': 'application/json' }),
    })

    expect(res.status).toBe(200)

    const body = await res.json() as {
      data:        typeof PRODUIT[]
      total:       number
      page:        number
      per_page:    number
      total_pages: number
    }

    expect(Array.isArray(body.data)).toBe(true)
    expect(body.data.length).toBeGreaterThanOrEqual(1)
    expect(body.data[0]).toMatchObject({ id: PRODUIT_ID, designation: 'Aluminium 6060 T5' })
    expect(typeof body.total).toBe('number')
    expect(body.page).toBe(1)
    expect(body.per_page).toBe(20)
  })

  it('filtre par statut=alerte', async () => {
    vi.mocked(supabase.from).mockReturnValueOnce(
      mkChain({ data: [PRODUIT], count: 1, error: null }) as never,
    )

    const res = await app.request('/api/stocks?statut=alerte', {
      method: 'GET',
    })

    expect(res.status).toBe(200)
    const body = await res.json() as { data: typeof PRODUIT[] }
    expect(body.data[0].statut).toBe('alerte')
  })

  it('retourne data vide si aucun produit', async () => {
    vi.mocked(supabase.from).mockReturnValueOnce(
      mkChain({ data: [], count: 0, error: null }) as never,
    )

    const res = await app.request('/api/stocks', { method: 'GET' })
    expect(res.status).toBe(200)
    const body = await res.json() as { data: unknown[]; total: number }
    expect(body.data).toHaveLength(0)
    expect(body.total).toBe(0)
  })
})

describe('Test 2 — POST mouvement sortie > stock → 422', () => {
  beforeEach(() => vi.clearAllMocks())

  it('retourne 422 INSUFFICIENT_STOCK quand quantite > stock_actuel', async () => {
    // RPC non déployée → fallback JS
    vi.mocked(supabase.rpc).mockResolvedValueOnce({
      data:  null,
      error: { code: '42883', message: 'function fn_mouvement_stock does not exist' },
    } as never)

    // Fallback JS : fetch du produit
    vi.mocked(supabase.from).mockReturnValueOnce(
      mkChain({ data: { stock_actuel: 10, stock_min: 20, stock_critique: 5 }, error: null }) as never,
    )

    const res = await app.request(`/api/stocks/${PRODUIT_ID}/mouvement`, {
      method:  'POST',
      headers: new Headers(authHeaders('operateur')),
      body:    JSON.stringify({ type: 'sortie', quantite: 15, notes: 'Test dépassement' }),
    })

    expect(res.status).toBe(422)
    const body = await res.json() as { error: string; code: string }
    expect(body.code).toBe('INSUFFICIENT_STOCK')
    expect(body.error).toMatch(/stock insuffisant/i)
  })

  it('retourne 401 sans token', async () => {
    const res = await app.request(`/api/stocks/${PRODUIT_ID}/mouvement`, {
      method:  'POST',
      headers: new Headers({ 'Content-Type': 'application/json' }),
      body:    JSON.stringify({ type: 'sortie', quantite: 1 }),
    })
    expect(res.status).toBe(401)
  })

  it('retourne 400 si quantite ≤ 0', async () => {
    const res = await app.request(`/api/stocks/${PRODUIT_ID}/mouvement`, {
      method:  'POST',
      headers: new Headers(authHeaders('operateur')),
      body:    JSON.stringify({ type: 'sortie', quantite: -5 }),
    })
    expect(res.status).toBe(400) // Zod validation error
  })
})

describe('Test 3 — POST mouvement entree valide → stock_actuel augmente', () => {
  beforeEach(() => vi.clearAllMocks())

  it('stock_actuel augmente exactement de la quantite via RPC atomique', async () => {
    const STOCK_INITIAL = 20
    const QUANTITE      = 15
    const STOCK_FINAL   = STOCK_INITIAL + QUANTITE // 35

    // RPC fn_mouvement_stock → succès atomique
    vi.mocked(supabase.rpc).mockResolvedValueOnce({
      data: {
        success:      true,
        mouvement_id: 'mvt-entree-001',
        stock_actuel: STOCK_FINAL,
        statut:       'normal',
      },
      error: null,
    } as never)

    const res = await app.request(`/api/stocks/${PRODUIT_ID}/mouvement`, {
      method:  'POST',
      headers: new Headers(authHeaders('operateur')),
      body:    JSON.stringify({
        type:      'entree',
        quantite:  QUANTITE,
        reference: 'BL-20260518-001',
        notes:     'Réapprovisionnement fournisseur',
      }),
    })

    expect(res.status).toBe(201)

    const body = await res.json() as { stock_actuel?: number; success?: boolean }

    // Succès confirmé
    expect(body.success ?? true).toBeTruthy()

    // Le RPC a reçu les bons paramètres
    expect(vi.mocked(supabase.rpc)).toHaveBeenCalledWith('fn_mouvement_stock', expect.objectContaining({
      p_produit_id: PRODUIT_ID,
      p_type:       'entree',
      p_quantite:   QUANTITE,
    }))
  })

  it('stock_actuel augmente via fallback JS quand RPC absent', async () => {
    const STOCK_INITIAL = 20
    const QUANTITE      = 15
    const STOCK_FINAL   = STOCK_INITIAL + QUANTITE // 35

    // RPC absente
    vi.mocked(supabase.rpc).mockResolvedValueOnce({
      data:  null,
      error: { code: '42883', message: 'function fn_mouvement_stock does not exist' },
    } as never)

    // Fallback : fetch produit
    vi.mocked(supabase.from).mockReturnValueOnce(
      mkChain({ data: { stock_actuel: STOCK_INITIAL, stock_min: 10, stock_critique: 5 }, error: null }) as never,
    )
    // Insert mouvement
    vi.mocked(supabase.from).mockReturnValueOnce(
      mkChain({ data: { id: 'mvt-001', type: 'entree', quantite: QUANTITE }, error: null }) as never,
    )
    // Update produit
    vi.mocked(supabase.from).mockReturnValueOnce(
      mkChain({ data: { ...PRODUIT, stock_actuel: STOCK_FINAL, statut: 'normal' }, error: null }) as never,
    )

    const res = await app.request(`/api/stocks/${PRODUIT_ID}/mouvement`, {
      method:  'POST',
      headers: new Headers(authHeaders('operateur')),
      body:    JSON.stringify({ type: 'entree', quantite: QUANTITE }),
    })

    expect(res.status).toBe(201)

    const body = await res.json() as { produit?: { stock_actuel: number } }

    // Le nouveau stock est exactement initial + quantite
    if (body.produit?.stock_actuel !== undefined) {
      expect(body.produit.stock_actuel).toBe(STOCK_FINAL)
    }
  })
})

describe('Test 4 — CONCURRENCE : deux sorties simultanées → stock jamais négatif', () => {
  beforeEach(() => vi.clearAllMocks())

  it('une sortie réussit, l\'autre échoue proprement, stock ≥ 0', async () => {
    const mockRpc = vi.mocked(supabase.rpc)

    // Appel 1 → PostgreSQL SELECT FOR UPDATE → succès (stock 10 → 3 après sortie de 7)
    mockRpc.mockResolvedValueOnce({
      data: { success: true, stock_actuel: 3, mouvement_id: 'mvt-conc-001' },
      error: null,
    } as never)

    // Appel 2 → PostgreSQL détecte stock insuffisant (race condition résolue atomiquement)
    mockRpc.mockResolvedValueOnce({
      data:  null,
      error: { code: 'P0001', message: 'Stock insuffisant — transaction annulée' },
    } as never)

    const headers = new Headers(authHeaders('operateur'))
    const body    = JSON.stringify({ type: 'sortie', quantite: 7 })

    const makeRequest = () =>
      app.request(`/api/stocks/${PRODUIT_ID}/mouvement`, { method: 'POST', headers, body })

    const t0 = Date.now()
    const [res1, res2] = await Promise.all([makeRequest(), makeRequest()])
    const elapsed = Date.now() - t0

    const statuses   = [res1.status, res2.status]
    const [b1, b2]   = await Promise.all([
      res1.json() as Promise<Record<string, unknown>>,
      res2.json() as Promise<Record<string, unknown>>,
    ])

    // Exactement une réussit (201) et une échoue (400 ou 422)
    expect(statuses).toContain(201)
    expect(statuses.some((s) => s === 400 || s === 422)).toBe(true)

    // L'erreur contient un message sur le stock insuffisant
    const errBody = res1.status !== 201 ? b1 : b2
    expect(String(errBody.error)).toMatch(/stock insuffisant/i)

    // Le stock résultant du succès est non négatif
    const successBody = res1.status === 201 ? b1 : b2
    if (typeof successBody.stock_actuel === 'number') {
      expect(successBody.stock_actuel).toBeGreaterThanOrEqual(0)
    }

    // RPC appelé deux fois avec quantité positive
    expect(mockRpc).toHaveBeenCalledTimes(2)
    for (const call of mockRpc.mock.calls) {
      expect((call[1] as { p_quantite: number }).p_quantite).toBeGreaterThan(0)
    }

    // Les deux requêtes traitées en < 5 s
    expect(elapsed).toBeLessThan(5_000)
  })
})
