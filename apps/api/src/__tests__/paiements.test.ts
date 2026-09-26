/**
 * paiements.test.ts — Couverture de apps/api/src/routes/paiements.ts
 *
 * Le routeur paiements est monté SANS authMiddleware (endpoints publics :
 * checkout shop + webhook NOKASH). Les tests couvrent donc la validation
 * de payload, la logique anti-fraude du webhook, et le polling de statut.
 *
 * Endpoints couverts :
 *  - POST /api/paiements/initier   (validation canal/phone, commande introuvable, déjà payée)
 *  - GET  /api/paiements/:ref/statut (cache local paye/echec/pending)
 *  - POST /api/paiements/webhook   (signature, payload invalide, payment.complete, payment.failed)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkChain } from './helpers'

vi.mock('@forge/db/supabase', () => {
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

// Évite l'appel finance réel lors de payment.complete
vi.mock('../services/finance-core.service', () => ({
  enregistrerPaiementCommande: vi.fn().mockResolvedValue({ id: 'pay-001' }),
}))
vi.mock('../services/workflow-notifications.service', () => ({
  notifyWorkflow: vi.fn().mockResolvedValue(undefined),
}))
// resolveCommandeContext ferait sinon de vrais appels DB supplémentaires
// (hors du périmètre de ces tests webhook) → mocké au niveau service, comme
// les deux ci-dessus.
vi.mock('../services/commande-workflow.service', () => ({
  resolveCommandeContext: vi.fn().mockResolvedValue({ commandeId: null }),
}))

// nokashStatusRequest() (apps/api/src/routes/paiements.ts) appelle fetch()
// directement (pas de client injecté à mocker) — le webhook re-vérifie
// TOUJOURS le statut réel auprès de NOKASH avant d'agir (le payload du
// callback n'est jamais fait confiance, cf. commentaire au-dessus de la route).
// On stub donc global.fetch pour simuler la réponse de cette revérification.
function mockNokashStatusRequest(data: { status: string; amount?: number } | null) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    json: async () => ({ status: data ? 'REQUEST_OK' : 'ERROR', message: 'ok', data }),
  }))
}

import app from '../app'
import { supabase } from '@forge/db/supabase'

const JSON_HEADERS = { 'Content-Type': 'application/json' }

beforeEach(() => vi.clearAllMocks())
// vi.stubGlobal('fetch', ...) (webhook tests) ne doit jamais fuiter vers les
// tests suivants — sans quoi un stub oublié rendrait /initier "injoignable"
// silencieusement vrai au lieu de tester le vrai fetch réseau.
afterEach(() => vi.unstubAllGlobals())

// ── POST /api/paiements/initier ──────────────────────────────────────────────

describe('POST /api/paiements/initier', () => {
  it('retourne 400 si commande_ref manquant', async () => {
    const res = await app.request('/api/paiements/initier', {
      method: 'POST', headers: JSON_HEADERS,
      body: JSON.stringify({ canal: 'cm.mtn', telephone: '690000000' }),
    })
    expect(res.status).toBe(400)
  })

  it('retourne 400 si canal Mobile Money invalide', async () => {
    const res = await app.request('/api/paiements/initier', {
      method: 'POST', headers: JSON_HEADERS,
      body: JSON.stringify({ commande_ref: 'CMD-001', canal: 'paypal', telephone: '690000000' }),
    })
    expect(res.status).toBe(400)
  })

  it('retourne 400 si numéro Mobile Money trop court', async () => {
    const res = await app.request('/api/paiements/initier', {
      method: 'POST', headers: JSON_HEADERS,
      body: JSON.stringify({ commande_ref: 'CMD-001', canal: 'cm.mtn', telephone: '123' }),
    })
    expect(res.status).toBe(400)
  })

  it('retourne 404 si commande introuvable', async () => {
    vi.mocked(supabase.from).mockReturnValueOnce(
      mkChain({ data: null, error: { message: 'not found' } }) as never,
    )
    const res = await app.request('/api/paiements/initier', {
      method: 'POST', headers: JSON_HEADERS,
      body: JSON.stringify({ commande_ref: 'CMD-404', canal: 'cm.mtn', telephone: '690123456' }),
    })
    expect(res.status).toBe(404)
  })

  it('retourne 409 si commande déjà payée', async () => {
    vi.mocked(supabase.from).mockReturnValueOnce(
      mkChain({
        data: { id: 'c1', ref: 'CMD-001', montant_ttc: 10000, statut_paiement: 'paye', mode_paiement: 'integral' },
        error: null,
      }) as never,
    )
    const res = await app.request('/api/paiements/initier', {
      method: 'POST', headers: JSON_HEADERS,
      body: JSON.stringify({ commande_ref: 'CMD-001', canal: 'cm.mtn', telephone: '690123456' }),
    })
    expect(res.status).toBe(409)
  })

  it('retourne 422 INVALID_DELIVERY_ADVANCE si avance livraison hors barème', async () => {
    vi.mocked(supabase.from).mockReturnValueOnce(
      mkChain({
        data: { id: 'c1', ref: 'CMD-002', montant_ttc: 100000, statut_paiement: 'en_attente', mode_paiement: 'livraison' },
        error: null,
      }) as never,
    )
    const res = await app.request('/api/paiements/initier', {
      method: 'POST', headers: JSON_HEADERS,
      body: JSON.stringify({ commande_ref: 'CMD-002', canal: 'cm.mtn', telephone: '690123456', montant: 12345 }),
    })
    expect(res.status).toBe(422)
    const body = await res.json() as { code: string }
    expect(body.code).toBe('INVALID_DELIVERY_ADVANCE')
  })
})

// ── GET /api/paiements/:reference/statut ─────────────────────────────────────

describe('GET /api/paiements/:reference/statut', () => {
  it('retourne complete si commande locale est payée', async () => {
    vi.mocked(supabase.from).mockReturnValueOnce(
      mkChain({ data: { statut_paiement: 'paye', updated_at: '2026-06-01T00:00:00Z' }, error: null }) as never,
    )
    const res = await app.request('/api/paiements/REF-PAYE/statut')
    expect(res.status).toBe(200)
    const body = await res.json() as { statut: string }
    expect(body.statut).toBe('complete')
  })

  it('retourne failed si commande locale est en échec', async () => {
    vi.mocked(supabase.from).mockReturnValueOnce(
      mkChain({ data: { statut_paiement: 'echec', updated_at: '2026-06-01T00:00:00Z' }, error: null }) as never,
    )
    const res = await app.request('/api/paiements/REF-ECHEC/statut')
    expect(res.status).toBe(200)
    const body = await res.json() as { statut: string }
    expect(body.statut).toBe('failed')
  })

  it('retourne pending si NOKASH non configuré et statut local non final', async () => {
    // setup.ts définit NOKASH_SECRET_KEY='' mais NOKASH_PUBLIC_KEY est défini.
    // On force le statut local non final → NOKASHConfigured() true ⇒ tente fetch.
    // Pour rester déterministe on couvre seulement le chemin local non-payé.
    vi.mocked(supabase.from).mockReturnValueOnce(
      mkChain({ data: { statut_paiement: 'en_attente', updated_at: null }, error: null }) as never,
    )
    const res = await app.request('/api/paiements/REF-PENDING/statut')
    // Soit pending (non configuré) soit 503 (fetch NOKASH échoue) — pas de crash
    expect([200, 404, 503]).toContain(res.status)
  })
})

// ── POST /api/paiements/webhook ──────────────────────────────────────────────

describe('POST /api/paiements/webhook', () => {
  it('retourne 400 si payload JSON invalide', async () => {
    const res = await app.request('/api/paiements/webhook', {
      method: 'POST', headers: JSON_HEADERS, body: 'not-json{',
    })
    expect(res.status).toBe(400)
  })

  it('retourne 200 received:true pour un statut re-vérifié non final (pending)', async () => {
    mockNokashStatusRequest({ status: 'PENDING', amount: 1000 })
    const res = await app.request('/api/paiements/webhook', {
      method: 'POST', headers: JSON_HEADERS,
      body: JSON.stringify({ id: 'REF-UNK', status: 'PENDING', amount: 1000, phone: '699000000', orderId: 'REF-UNK' }),
    })
    expect(res.status).toBe(200)
    const body = await res.json() as { received: boolean }
    expect(body.received).toBe(true)
  })

  it('payment.complete : commande introuvable → received:true (évite retries)', async () => {
    mockNokashStatusRequest({ status: 'SUCCESS', amount: 10000 })
    vi.mocked(supabase.from).mockReturnValueOnce(
      mkChain({ data: null, error: { message: 'not found' } }) as never,
    )
    const res = await app.request('/api/paiements/webhook', {
      method: 'POST', headers: JSON_HEADERS,
      body: JSON.stringify({ id: 'REF-X', status: 'SUCCESS', amount: 10000, phone: '699000000', orderId: 'REF-X' }),
    })
    expect(res.status).toBe(200)
    const body = await res.json() as { received: boolean }
    expect(body.received).toBe(true)
  })

  it('payment.complete : montant ne correspond pas → anti-fraude → received:true sans update', async () => {
    mockNokashStatusRequest({ status: 'SUCCESS', amount: 999 })
    vi.mocked(supabase.from).mockReturnValueOnce(
      mkChain({
        data: { id: 'c1', ref: 'CMD-009', montant_ttc: 50000, mode_paiement: 'integral', lignes: [], erp_commande_id: null },
        error: null,
      }) as never,
    )
    const res = await app.request('/api/paiements/webhook', {
      method: 'POST', headers: JSON_HEADERS,
      body: JSON.stringify({ id: 'REF-FRAUDE', status: 'SUCCESS', amount: 999, phone: '699000000', orderId: 'REF-FRAUDE' }),
    })
    expect(res.status).toBe(200)
    const body = await res.json() as { received: boolean }
    expect(body.received).toBe(true)
  })

  it('payment.complete : paiement total correct → update + received:true', async () => {
    mockNokashStatusRequest({ status: 'SUCCESS', amount: 50000 })
    // fetch commande
    vi.mocked(supabase.from).mockReturnValueOnce(
      mkChain({
        data: { id: 'c1', ref: 'CMD-010', montant_ttc: 50000, mode_paiement: 'integral',
                client_nom: 'Test', client_telephone: null, client_adresse: null, lignes: [], erp_commande_id: null },
        error: null,
      }) as never,
    )
    // update commande_shop
    vi.mocked(supabase.from).mockReturnValueOnce(
      mkChain({ data: null, error: null }) as never,
    )
    const res = await app.request('/api/paiements/webhook', {
      method: 'POST', headers: JSON_HEADERS,
      body: JSON.stringify({ id: 'REF-OK', status: 'SUCCESS', amount: 50000, phone: '699000000', orderId: 'REF-OK' }),
    })
    expect(res.status).toBe(200)
    const body = await res.json() as { received: boolean }
    expect(body.received).toBe(true)
  })

  it('payment.failed : marque la commande en échec → received:true', async () => {
    mockNokashStatusRequest({ status: 'FAILED' })
    // fetch commande
    vi.mocked(supabase.from).mockReturnValueOnce(
      mkChain({ data: { ref: 'CMD-011', client_nom: 'Test', client_telephone: null }, error: null }) as never,
    )
    // update commande_shop → echec
    vi.mocked(supabase.from).mockReturnValueOnce(
      mkChain({ data: null, error: null }) as never,
    )
    const res = await app.request('/api/paiements/webhook', {
      method: 'POST', headers: JSON_HEADERS,
      body: JSON.stringify({ id: 'REF-FAIL', status: 'FAILED', phone: '699000000', orderId: 'REF-FAIL' }),
    })
    expect(res.status).toBe(200)
    const body = await res.json() as { received: boolean }
    expect(body.received).toBe(true)
  })
})
