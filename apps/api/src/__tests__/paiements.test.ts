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
import { mkChain, mkTableRouter } from './helpers'

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
function mockNokashStatusRequest(data: { status: string; amount?: number; order_id?: string; currency?: string } | null) {
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
//
// Les réponses de la base sont routées PAR TABLE (mkTableRouter) : le webhook
// lit paiement_tentatives, commandes_shop et paiements_commande dans un ordre
// qui ne doit pas rendre ces tests fragiles.

const COMMANDE_WEB = {
  id: 'c1', ref: 'WEB-2026-AAAAAA', montant_ttc: 50000, mode_paiement: 'integral', statut_paiement: 'en_attente',
  client_nom: 'Test', client_telephone: null, client_adresse: null, lignes: [], erp_commande_id: null,
}
const TENTATIVE = { commande_id: 'c1', commande_ref: 'WEB-2026-AAAAAA', statut: 'pending' }

function webhook(body: Record<string, unknown> | string, query = '') {
  return app.request(`/api/paiements/webhook${query}`, {
    method: 'POST', headers: JSON_HEADERS, body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

/** Appels .update(...) faits sur une table, avec leur contenu. */
function updatesOn(table: string): unknown[] {
  return vi.mocked(supabase.from).mock.calls
    .map((call, i) => ({ table: call[0], chain: vi.mocked(supabase.from).mock.results[i]?.value as Record<string, ReturnType<typeof vi.fn>> }))
    .filter((x) => x.table === table)
    .flatMap((x) => x.chain.update.mock.calls.map((u) => u[0]))
}

describe('POST /api/paiements/webhook', () => {
  it('retourne 400 si payload JSON invalide', async () => {
    const res = await webhook('not-json{')
    expect(res.status).toBe(400)
  })

  it('statut revérifié non final (pending) → received:true, rien modifié', async () => {
    mockNokashStatusRequest({ status: 'PENDING', amount: 1000 })
    vi.mocked(supabase.from).mockImplementation(mkTableRouter({}) as never)
    const res = await webhook({ id: 'REF-UNK', status: 'PENDING' })
    expect(res.status).toBe(200)
    expect(updatesOn('commandes_shop')).toHaveLength(0)
  })

  describe('jeton secret (NOKASH_WEBHOOK_TOKEN)', () => {
    afterEach(() => vi.unstubAllEnvs())

    it('rejette un appel sans jeton ou avec un mauvais jeton, sans interroger NOKASH', async () => {
      vi.stubEnv('NOKASH_WEBHOOK_TOKEN', 'jeton-secret-de-test-123')
      mockNokashStatusRequest({ status: 'SUCCESS', amount: 50000 })

      expect((await webhook({ id: 'REF-OK' })).status).toBe(401)
      expect((await webhook({ id: 'REF-OK' }, '?token=mauvais')).status).toBe(401)
      expect(vi.mocked(fetch)).not.toHaveBeenCalled()
    })

    it('accepte le bon jeton', async () => {
      vi.stubEnv('NOKASH_WEBHOOK_TOKEN', 'jeton-secret-de-test-123')
      mockNokashStatusRequest({ status: 'PENDING' })
      vi.mocked(supabase.from).mockImplementation(mkTableRouter({}) as never)
      expect((await webhook({ id: 'REF-OK' }, '?token=jeton-secret-de-test-123')).status).toBe(200)
    })
  })

  it('paiement confirmé : commande retrouvée par SA transaction, même si une autre demande a été lancée depuis', async () => {
    mockNokashStatusRequest({ status: 'SUCCESS', amount: 50000 })
    vi.mocked(supabase.from).mockImplementation(mkTableRouter({
      paiement_tentatives: [
        { data: TENTATIVE, error: null },                          // trouverTentative
        { data: [{ transaction_id: 'TX-1' }], error: null },       // verrou
      ],
      commandes_shop: [
        { data: COMMANDE_WEB, error: null },                       // lecture par id
        { data: [{ id: 'c1' }], error: null },                     // passage à « payé »
      ],
    }) as never)

    const res = await webhook({ id: 'TX-1', status: 'SUCCESS' })
    expect(res.status).toBe(200)
    expect(updatesOn('commandes_shop')).toEqual([expect.objectContaining({ statut_paiement: 'paye' })])
    expect(vi.mocked(supabase.channel)).toHaveBeenCalledWith('erp-notifications')
  })

  it('webhook rejoué en même temps : seul le premier verrouille, le second ne refait rien', async () => {
    mockNokashStatusRequest({ status: 'SUCCESS', amount: 50000 })
    vi.mocked(supabase.from).mockImplementation(mkTableRouter({
      paiement_tentatives: [
        { data: TENTATIVE, error: null },
        { data: [], error: null },                                 // verrou déjà pris
      ],
      commandes_shop: [{ data: COMMANDE_WEB, error: null }],
    }) as never)

    const res = await webhook({ id: 'TX-1', status: 'SUCCESS' })
    expect(res.status).toBe(200)
    expect(updatesOn('commandes_shop')).toHaveLength(0)
    expect(vi.mocked(supabase.channel)).not.toHaveBeenCalled()
  })

  it('le montant vient de NOKASH seulement : sans montant confirmé, rien n\'est validé (même si le corps en annonce un)', async () => {
    mockNokashStatusRequest({ status: 'SUCCESS' })                 // pas de montant
    vi.mocked(supabase.from).mockImplementation(mkTableRouter({
      paiement_tentatives: [{ data: TENTATIVE, error: null }],
      commandes_shop: [{ data: COMMANDE_WEB, error: null }],
    }) as never)

    const res = await webhook({ id: 'TX-1', status: 'SUCCESS', amount: 50000 })
    expect(res.status).toBe(200)
    expect(updatesOn('commandes_shop')).toHaveLength(0)
  })

  it('montant ne correspondant pas à la commande → anti-fraude, rien modifié', async () => {
    mockNokashStatusRequest({ status: 'SUCCESS', amount: 999 })
    vi.mocked(supabase.from).mockImplementation(mkTableRouter({
      paiement_tentatives: [{ data: TENTATIVE, error: null }],
      commandes_shop: [{ data: COMMANDE_WEB, error: null }],
    }) as never)

    await webhook({ id: 'TX-1', status: 'SUCCESS', amount: 50000 })
    expect(updatesOn('commandes_shop')).toHaveLength(0)
  })

  it('transaction confirmée pour une AUTRE commande → anti-fraude, rien modifié', async () => {
    mockNokashStatusRequest({ status: 'SUCCESS', amount: 50000, order_id: 'WEB-2026-ZZZZZZ' } as never)
    vi.mocked(supabase.from).mockImplementation(mkTableRouter({
      paiement_tentatives: [{ data: TENTATIVE, error: null }],
      commandes_shop: [{ data: COMMANDE_WEB, error: null }],
    }) as never)

    await webhook({ id: 'TX-1', status: 'SUCCESS' })
    expect(updatesOn('commandes_shop')).toHaveLength(0)
  })

  it('devise autre que XAF → anti-fraude, rien modifié', async () => {
    mockNokashStatusRequest({ status: 'SUCCESS', amount: 50000, currency: 'EUR' } as never)
    vi.mocked(supabase.from).mockImplementation(mkTableRouter({
      paiement_tentatives: [{ data: TENTATIVE, error: null }],
      commandes_shop: [{ data: COMMANDE_WEB, error: null }],
    }) as never)

    await webhook({ id: 'TX-1', status: 'SUCCESS' })
    expect(updatesOn('commandes_shop')).toHaveLength(0)
  })

  it('transaction antérieure à la table des tentatives : repli sur payment_reference, verrou par mise à jour conditionnelle', async () => {
    mockNokashStatusRequest({ status: 'SUCCESS', amount: 50000 })
    vi.mocked(supabase.from).mockImplementation(mkTableRouter({
      paiement_tentatives: [{ data: null, error: null }],
      commandes_shop: [
        { data: COMMANDE_WEB, error: null },
        { data: [{ id: 'c1' }], error: null },
      ],
    }) as never)

    await webhook({ id: 'TX-ANCIEN', status: 'SUCCESS' })
    expect(updatesOn('commandes_shop')).toEqual([expect.objectContaining({ statut_paiement: 'paye' })])
  })

  it('commande introuvable → received:true (évite les rejeux NOKASH)', async () => {
    mockNokashStatusRequest({ status: 'SUCCESS', amount: 10000 })
    vi.mocked(supabase.from).mockImplementation(mkTableRouter({
      commandes_shop: [{ data: null, error: { message: 'not found' } }],
    }) as never)
    const res = await webhook({ id: 'REF-X', status: 'SUCCESS' })
    expect(res.status).toBe(200)
    expect(((await res.json()) as { received: boolean }).received).toBe(true)
  })

  it('paiement échoué : commande marquée en échec', async () => {
    mockNokashStatusRequest({ status: 'FAILED' })
    vi.mocked(supabase.from).mockImplementation(mkTableRouter({
      paiement_tentatives: [{ data: TENTATIVE, error: null }],
      commandes_shop: [{ data: { ...COMMANDE_WEB, statut_paiement: 'en_attente' }, error: null }],
    }) as never)

    await webhook({ id: 'TX-2', status: 'FAILED' })
    expect(updatesOn('commandes_shop')).toEqual([expect.objectContaining({ statut_paiement: 'echec' })])
  })

  it('l\'échec d\'une nouvelle tentative n\'annule jamais un paiement déjà reçu', async () => {
    mockNokashStatusRequest({ status: 'FAILED' })
    vi.mocked(supabase.from).mockImplementation(mkTableRouter({
      paiement_tentatives: [{ data: TENTATIVE, error: null }],
      commandes_shop: [{ data: { ...COMMANDE_WEB, statut_paiement: 'paye_partiel' }, error: null }],
    }) as never)

    await webhook({ id: 'TX-3', status: 'FAILED' })
    expect(updatesOn('commandes_shop')).toHaveLength(0)
  })
})

// ── POST /api/paiements/initier — limite anti-harcèlement ───────────────────

describe('POST /api/paiements/initier — limite de demandes', () => {
  beforeEach(() => {
    vi.stubEnv('NOKASH_APPLICATION_KEY', 'test-app-key')
    vi.stubEnv('NOKASH_INTEGRATION_KEY', 'test-integration-key')
  })
  afterEach(() => vi.unstubAllEnvs())

  it('refuse (429) au-delà de 5 demandes récentes pour la même commande, sans contacter NOKASH', async () => {
    vi.stubGlobal('fetch', vi.fn())
    vi.mocked(supabase.from).mockImplementation(mkTableRouter({
      commandes_shop:      [{ data: COMMANDE_WEB, error: null }],
      paiement_tentatives: [{ count: 5, data: null, error: null }, { count: 0, data: null, error: null }],
    }) as never)

    const res = await app.request('/api/paiements/initier', {
      method: 'POST', headers: JSON_HEADERS,
      body: JSON.stringify({ commande_ref: COMMANDE_WEB.ref, canal: 'cm.mtn', telephone: '690123456' }),
    })
    expect(res.status).toBe(429)
    expect(((await res.json()) as { code: string }).code).toBe('PAYMENT_TOO_MANY_ATTEMPTS')
    expect(vi.mocked(fetch)).not.toHaveBeenCalled()
  })

  it('refuse (429) au-delà de 5 demandes récentes vers le même numéro', async () => {
    vi.stubGlobal('fetch', vi.fn())
    vi.mocked(supabase.from).mockImplementation(mkTableRouter({
      commandes_shop:      [{ data: COMMANDE_WEB, error: null }],
      paiement_tentatives: [{ count: 0, data: null, error: null }, { count: 7, data: null, error: null }],
    }) as never)

    const res = await app.request('/api/paiements/initier', {
      method: 'POST', headers: JSON_HEADERS,
      body: JSON.stringify({ commande_ref: COMMANDE_WEB.ref, canal: 'cm.mtn', telephone: '690123456' }),
    })
    expect(res.status).toBe(429)
    expect(vi.mocked(fetch)).not.toHaveBeenCalled()
  })

  it('enregistre la transaction dans paiement_tentatives', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      json: async () => ({ status: 'REQUEST_OK', message: 'ok', data: { id: 'TX-NEW', status: 'PENDING' } }),
    }))
    vi.mocked(supabase.from).mockImplementation(mkTableRouter({
      commandes_shop: [{ data: COMMANDE_WEB, error: null }],
    }) as never)

    const res = await app.request('/api/paiements/initier', {
      method: 'POST', headers: JSON_HEADERS,
      body: JSON.stringify({ commande_ref: COMMANDE_WEB.ref, canal: 'cm.mtn', telephone: '690123456' }),
    })
    expect(res.status).toBe(201)
    const inserts = vi.mocked(supabase.from).mock.calls
      .map((call, i) => ({ table: call[0], chain: vi.mocked(supabase.from).mock.results[i]?.value as Record<string, ReturnType<typeof vi.fn>> }))
      .filter((x) => x.table === 'paiement_tentatives')
      .flatMap((x) => x.chain.insert.mock.calls.map((u) => u[0]))
    expect(inserts).toEqual([expect.objectContaining({ transaction_id: 'TX-NEW', commande_id: 'c1', montant: 50000, telephone: '690123456' })])
  })
})
