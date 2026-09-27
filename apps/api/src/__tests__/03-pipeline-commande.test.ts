/**
 * TEST-03 : Pipeline commande web avec paiement NOKASH
 *
 * Réécrit le 26/09/2026 (cf. docs/DETTE-TESTS-2026-09-26.md, Découverte n°5) :
 * routes/paiements.ts est passé d'un stub générique mock-friendly à une vraie
 * intégration NOKASH — contrat de requête/réponse différent, et surtout un
 * webhook qui NE VÉRIFIE PLUS AUCUNE SIGNATURE par choix de conception assumé
 * (NOKASH ne documente aucune signature sur son callback ; la route revérifie
 * donc systématiquement le statut réel via l'API NOKASH — status-request —
 * avant de considérer un paiement comme confirmé, plutôt que de faire
 * confiance au corps reçu). L'ancien test "signature invalide → 401" teste un
 * comportement qui n'existe plus intentionnellement ; remplacé par un test de
 * la propriété de sécurité qui l'a remplacé (test 4 ci-dessous).
 *
 * 1. POST /api/paiements/initier → appel NOKASH réel (mocké via fetch)
 * 2. POST /api/paiements/webhook → confirmation via revérification NOKASH
 * 3. Assert : commande confirmée, notifications émises
 * 4. Assert : revérification impossible → dégradation gracieuse, pas de confirmation prématurée
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkChain } from './helpers'

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

// resolveCommandeContext / enregistrerPaiementCommande ne sont exercés qu'en
// cas de paiement confirmé ET de commande ERP liée (erp_commande_id) — hors
// scope de ces tests (commande web pure) ; mockés pour éviter de rejouer leur
// propre cascade de requêtes DB (cf. pattern déjà utilisé dans tout ce fichier
// de dette, docs/DETTE-TESTS-2026-09-26.md).
vi.mock('../services/commande-workflow.service', () => ({
  resolveCommandeContext: vi.fn().mockResolvedValue(null),
}))
vi.mock('../services/finance-core.service', () => ({
  enregistrerPaiementCommande: vi.fn().mockResolvedValue({ facture: null, montant_paye_xaf: 0, solde_restant_xaf: 0 }),
}))
vi.mock('../services/workflow-notifications.service', () => ({
  notifyWorkflow: vi.fn().mockResolvedValue(undefined),
}))

import app from '../app'
import { supabase } from '@forge/db/supabase'

// ── Fixtures ───────────────────────────────────────────────────────────────────

const COMMANDE_REF = 'CMD-20260518-0042'
const COMMANDE_ID  = 'cmd-uuid-0042'
const PAYMENT_REF  = 'pay-nokash-ref-0042'
const MONTANT      = 50_000
const PRODUIT_ID   = 'prod-uuid-tole-3mm'

const COMMANDE_SHOP = {
  id:                COMMANDE_ID,
  ref:               COMMANDE_REF,
  montant_ttc:       MONTANT,
  statut_paiement:   'en_attente',
  statut_commande:   'nouvelle',
  mode_paiement:     'direct',
  client_nom:        'Kouam Pierre',
  client_telephone:  null,
  client_email:      'kouam@example.cm',
  client_adresse:    'Douala, Bonanjo',
  erp_commande_id:   null,
  payment_reference: PAYMENT_REF,
  lignes: [
    { product_id: PRODUIT_ID, designation: 'Tôle 3mm', quantite: 2 },
  ],
}

/** Réponse NOKASH pour l'INIT (POST .../api-payin-request/407). */
function nokashInitResponse(status: string, id: string) {
  return { status: 'REQUEST_OK', message: '', data: { id, status } }
}

/** Réponse NOKASH pour la revérification (POST .../status-request), utilisée
 * à la fois par GET /statut et par le webhook (qui ne fait jamais confiance
 * au corps reçu et revérifie systématiquement ce statut réel). */
function nokashStatusResponse(status: string, amount: number) {
  return { status: 'REQUEST_OK', message: '', data: { status, amount } }
}

describe('TEST-03 : Pipeline commande web avec paiement NOKASH', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // nokashConfigured() exige ces deux clés — sans elles, /initier répond
    // 503 PAYMENT_NOT_CONFIGURED avant même de tenter l'appel réseau.
    // vi.stubEnv (plutôt que process.env.X = ...) garantit un nettoyage fiable
    // via vi.unstubAllEnvs() ci-dessous, même en cas d'échec de test — sans quoi
    // ces clés fuitent vers paiements.test.ts (qui suppose NOKASH non configuré
    // par défaut) quand la suite tourne en séquence (--no-file-parallelism).
    vi.stubEnv('NOKASH_APPLICATION_KEY', 'test-app-key')
    vi.stubEnv('NOKASH_INTEGRATION_KEY', 'test-integration-key')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  it('initie un paiement NOKASH pour une commande web existante', async () => {
    const mockFrom = vi.mocked(supabase.from)
    // 1. fetch commande_shop par ref
    mockFrom.mockReturnValueOnce(mkChain({ data: COMMANDE_SHOP, error: null }) as never)
    // 2. update payment_reference (résultat ignoré par la route)
    mockFrom.mockReturnValue(mkChain({ data: null, error: null }) as never)

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok:   true,
      json: () => Promise.resolve(nokashInitResponse('PENDING', PAYMENT_REF)),
    }))

    const res = await app.request('/api/paiements/initier', {
      method:  'POST',
      headers: new Headers({ 'Content-Type': 'application/json' }),
      body:    JSON.stringify({
        commande_ref: COMMANDE_REF,
        montant:      MONTANT,
        email:        'kouam@example.cm',
        canal:        'cm.mtn',
        telephone:    '651234567',
      }),
    })

    expect(res.status).toBe(201)
    const body = await res.json() as Record<string, unknown>
    expect(body.payment_reference).toBe(PAYMENT_REF)
    // Le contrat réel n'a pas de checkout_url (Mobile Money direct, pas de
    // redirection navigateur) — le client poll GET /:reference/statut.
    expect(body.checkout_url).toBeNull()
    expect(body.status).toBe('pending')

    // Vérifie que l'appel NOKASH a bien été signé (hmac-signature) plutôt que
    // de faire confiance à une simple présence de header.
    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      expect.stringContaining('/api-payin-request/407'),
      expect.objectContaining({
        headers: expect.objectContaining({ 'hmac-signature': expect.any(String) }),
      }),
    )
  })

  it('webhook : paiement confirmé (revérifié) → commande confirmée + notifications émises', async () => {
    const mockFrom    = vi.mocked(supabase.from)
    const mockChannel = vi.mocked(supabase.channel)

    // 1. fetch commande_shop par payment_reference
    mockFrom.mockReturnValueOnce(mkChain({ data: COMMANDE_SHOP, error: null }) as never)
    // 2. update statut_paiement/statut_commande (résultat ignoré, error: null)
    mockFrom.mockReturnValue(mkChain({ data: null, error: null }) as never)

    // Le corps du webhook n'est jamais synonyme de confirmation : c'est la
    // revérification NOKASH (status-request) ci-dessous qui fait foi.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok:   true,
      json: () => Promise.resolve(nokashStatusResponse('SUCCESS', MONTANT)),
    }))

    const payload = JSON.stringify({
      id: PAYMENT_REF, status: 'SUCCESS', amount: MONTANT,
      phone: '651234567', orderId: COMMANDE_REF,
    })

    const res = await app.request('/api/paiements/webhook', {
      method:  'POST',
      headers: new Headers({ 'Content-Type': 'application/json' }),
      body:    payload,
    })

    expect(res.status).toBe(200)
    const body = await res.json() as { received: boolean }
    expect(body.received).toBe(true)

    // Revérification effectuée auprès de NOKASH avant toute confirmation
    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      expect.stringContaining('/status-request'),
      expect.anything(),
    )

    const updateCall = mockFrom.mock.calls.find((c) => c[0] === 'commandes_shop')
    expect(updateCall).toBeDefined()
    expect(mockChannel).toHaveBeenCalledWith('erp-notifications')
  })

  it('webhook : paiement échoué (revérifié) → statut_paiement → echec', async () => {
    const mockFrom = vi.mocked(supabase.from)
    mockFrom.mockReturnValueOnce(
      mkChain({ data: { ref: COMMANDE_REF, client_nom: 'Kouam Pierre', client_telephone: null }, error: null }) as never,
    )
    mockFrom.mockReturnValue(mkChain({ data: null, error: null }) as never)

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok:   true,
      json: () => Promise.resolve(nokashStatusResponse('FAILED', MONTANT)),
    }))

    const payload = JSON.stringify({ id: PAYMENT_REF, status: 'FAILED', orderId: COMMANDE_REF })

    const res = await app.request('/api/paiements/webhook', {
      method:  'POST',
      headers: new Headers({ 'Content-Type': 'application/json' }),
      body:    payload,
    })

    expect(res.status).toBe(200)
    const updateCallArgs = mockFrom.mock.calls.map((c) => c[0])
    expect(updateCallArgs).toContain('commandes_shop')
  })

  it('webhook : revérification NOKASH impossible → dégradation gracieuse, aucune confirmation prématurée', async () => {
    // Propriété de sécurité qui a remplacé la vérification de signature (cf.
    // en-tête de fichier) : si on ne peut pas revérifier indépendamment le
    // statut auprès de NOKASH, on ne fait JAMAIS confiance au corps reçu —
    // ni mise à jour de commande, ni notification. Le prochain poll client
    // (GET /:reference/statut) retentera la revérification.
    const mockFrom = vi.mocked(supabase.from)

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('NOKASH injoignable')))

    const payload = JSON.stringify({ id: PAYMENT_REF, status: 'SUCCESS', amount: MONTANT, orderId: COMMANDE_REF })

    const res = await app.request('/api/paiements/webhook', {
      method:  'POST',
      headers: new Headers({ 'Content-Type': 'application/json' }),
      body:    payload,
    })

    expect(res.status).toBe(200)
    const body = await res.json() as { received: boolean }
    expect(body.received).toBe(true)

    // Aucune lecture/écriture DB : la route retourne avant même de consulter
    // commandes_shop, précisément parce qu'elle n'a pas pu revérifier le statut.
    expect(mockFrom).not.toHaveBeenCalled()
  })
})
