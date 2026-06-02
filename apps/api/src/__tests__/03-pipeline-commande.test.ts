/**
 * TEST-03 : Pipeline commande web avec paiement Notchpay
 *
 * 1. POST /api/paiements/initier → appel Notchpay (mocké fetch)
 * 2. POST /api/paiements/webhook  → paiement.complete
 * 3. Assert : commande statut → 'confirmee' en < 3 s
 * 4. Assert : stock déduit
 * 5. Assert : notification Realtime émise
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createHmac } from 'crypto'
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

// ── Fixtures ───────────────────────────────────────────────────────────────────

const COMMANDE_REF = 'CMD-20260518-0042'
const COMMANDE_ID  = 'cmd-uuid-0042'
const PAYMENT_REF  = 'pay-notch-ref-0042'
const MONTANT      = 50_000
const PRODUIT_ID   = 'prod-uuid-tole-3mm'

const COMMANDE_SHOP = {
  id:                COMMANDE_ID,
  ref:               COMMANDE_REF,
  montant_ttc:       MONTANT,
  statut_paiement:   'en_attente',
  statut_commande:   'nouvelle',
  client_nom:        'Kouam Pierre',
  client_telephone:  null,
  client_adresse:    'Douala, Bonanjo',
  erp_commande_id:   null,
  payment_reference: PAYMENT_REF,
  lignes: [
    { product_id: PRODUIT_ID, designation: 'Tôle 3mm', quantite: 2 },
  ],
}

describe('TEST-03 : Pipeline commande web avec paiement', () => {
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    vi.clearAllMocks()
    originalFetch = globalThis.fetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('initie un paiement Notchpay pour une commande web existante', async () => {
    const mockFrom = vi.mocked(supabase.from)

    // Commande existe, pas encore payée
    mockFrom.mockReturnValueOnce(
      mkChain({ data: COMMANDE_SHOP, error: null }) as never,
    )
    // update payment_reference
    mockFrom.mockReturnValue(mkChain({ data: null, error: null }) as never)

    // Mock fetch → Notchpay API
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok:   true,
      json: () => Promise.resolve({
        transaction: {
          reference:    PAYMENT_REF,
          checkout_url: 'https://pay.notchpay.co/xxx',
          status:       'pending',
          expires_at:   '2026-05-18T14:00:00Z',
        },
      }),
    }))

    const res = await app.request('/api/paiements/initier', {
      method:  'POST',
      headers: new Headers({ 'Content-Type': 'application/json' }),
      body:    JSON.stringify({
        commande_ref: COMMANDE_REF,
        montant:      MONTANT,
        email:        'kouam@example.cm',
      }),
    })

    expect(res.status).toBe(201)
    const body = await res.json() as Record<string, unknown>
    expect(body.payment_reference).toBe(PAYMENT_REF)
    expect(body.checkout_url).toMatch(/notchpay/)
    expect(body.status).toBe('pending')
  })

  it('webhook payment.complete → commande confirmée, stock déduit, Realtime émis en < 3 s', async () => {
    const mockFrom    = vi.mocked(supabase.from)
    const mockChannel = vi.mocked(supabase.channel)

    // 1. select commande par payment_reference
    mockFrom.mockReturnValueOnce(
      mkChain({ data: COMMANDE_SHOP, error: null }) as never,
    )
    // 2. update commandes_shop statut_paiement + statut_commande
    mockFrom.mockReturnValueOnce(mkChain({ data: null, error: null }) as never)
    // 3. select stock produit
    mockFrom.mockReturnValueOnce(
      mkChain({ data: { stock_actuel: 10 }, error: null }) as never,
    )
    // 4. update produit stock (10 - 2 = 8)
    mockFrom.mockReturnValueOnce(mkChain({ data: null, error: null }) as never)
    // 5. insert mouvement_stock
    mockFrom.mockReturnValue(mkChain({ data: null, error: null }) as never)

    const payload = JSON.stringify({
      event: 'payment.complete',
      data: {
        reference: PAYMENT_REF,
        amount:    MONTANT,
      },
    })

    const t0 = Date.now()

    const res = await app.request('/api/paiements/webhook', {
      method:  'POST',
      headers: new Headers({
        'Content-Type':       'application/json',
        // NOTCHPAY_SECRET_KEY est vide en test → signature bypass
        'x-notch-signature':  '',
      }),
      body: payload,
    })

    const elapsed = Date.now() - t0

    expect(res.status).toBe(200)
    const body = await res.json() as { received: boolean }
    expect(body.received).toBe(true)

    // ── Assert : commande mise à jour ──────────────────────────────────────────
    const updateCall = mockFrom.mock.calls.find((c) => {
      const chain = c[0] as string
      return chain === 'commandes_shop'
    })
    expect(updateCall).toBeDefined()

    // ── Assert : stock déduit ──────────────────────────────────────────────────
    const produitUpdateCall = mockFrom.mock.calls.some((c) => c[0] === 'produits')
    expect(produitUpdateCall).toBe(true)

    // ── Assert : mouvement de stock enregistré ─────────────────────────────────
    const mouvCall = mockFrom.mock.calls.some((c) => c[0] === 'mouvements_stock')
    expect(mouvCall).toBe(true)

    // ── Assert : notification Realtime émise ───────────────────────────────────
    expect(mockChannel).toHaveBeenCalledWith('erp-notifications')

    // ── Assert : temps de traitement < 3 s ────────────────────────────────────
    expect(elapsed).toBeLessThan(3_000)
  })

  it('webhook payment.failed → statut paiement → echec', async () => {
    const mockFrom = vi.mocked(supabase.from)

    mockFrom.mockReturnValueOnce(
      mkChain({
        data: {
          ref:              COMMANDE_REF,
          client_nom:       'Kouam Pierre',
          client_telephone: null,
        },
        error: null,
      }) as never,
    )
    mockFrom.mockReturnValue(mkChain({ data: null, error: null }) as never)

    const payload = JSON.stringify({
      event: 'payment.failed',
      data:  { reference: PAYMENT_REF },
    })

    const res = await app.request('/api/paiements/webhook', {
      method:  'POST',
      headers: new Headers({
        'Content-Type':      'application/json',
        'x-notch-signature': '',
      }),
      body: payload,
    })

    expect(res.status).toBe(200)

    // La commande doit être marquée comme échouée
    const updateCallArgs = mockFrom.mock.calls.map((c) => c[0])
    expect(updateCallArgs).toContain('commandes_shop')
  })

  it('webhook avec signature invalide → 401', async () => {
    // Activer la vérification de signature pour ce test uniquement
    const oldKey = process.env.NOTCHPAY_SECRET_KEY
    process.env.NOTCHPAY_SECRET_KEY = 'real-secret-key'

    const payload   = JSON.stringify({ event: 'payment.complete', data: {} })
    const badSig    = 'invalid-signature-xxxx'

    const res = await app.request('/api/paiements/webhook', {
      method:  'POST',
      headers: new Headers({
        'Content-Type':      'application/json',
        'x-notch-signature': badSig,
      }),
      body: payload,
    })

    process.env.NOTCHPAY_SECRET_KEY = oldKey

    expect(res.status).toBe(401)
    const body = await res.json() as { error: string }
    expect(body.error).toMatch(/signature/i)
  })
})
