/**
 * phase6-devis-commande.test.ts — Master Prompt V3, Phase 6
 *
 * Comble deux trous de couverture identifiés au §47 en reprenant la Phase 6 :
 *
 *  - Test 11 (§37) : double conversion d'un devis en commande. Le verrou
 *    d'idempotence de POST /devis/:id/transformer-commande (commerce.ts,
 *    commentaire "Test 11") réclame atomiquement le devis via un
 *    UPDATE ... WHERE statut IN (...) avant de créer la commande. Si une
 *    requête concurrente a déjà consommé ce verrou (la UPDATE ne retourne
 *    aucune ligne), la route doit répondre 409 ALREADY_TRANSFORMED et NE
 *    JAMAIS insérer de commande. On simule ce cas en faisant résoudre le
 *    SELECT initial avec statut='accepte' (pour passer les gardes en tête
 *    de route) puis en faisant résoudre l'UPDATE-claim avec
 *    { data: null, error: null } — exactement la même réponse que
 *    Supabase renverrait si une autre requête avait déjà gagné la course.
 *
 *  - Tests 17/18 (source_demande) : POST /devis doit fidèlement persister
 *    et refléter le canal d'origine de la demande, aussi bien pour un
 *    client connecté (client_id renseigné) que pour un client hors
 *    plateforme (client_id absent, uniquement un nom + un canal texte).
 *
 * Fichier volontairement isolé de commerce.test.ts : il mocke intégralement
 * `rbacService` (checkPermission) et `client-sync.service` (ensureClient)
 * pour contrôler avec certitude la séquence exacte des appels `.from()`,
 * plutôt que de dépendre du fallback RBAC réel (cause des 8 échecs déjà
 * documentés dans commerce.test.ts — voir docs/DETTE-TESTS-2026-09-26.md).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mkChain, authHeaders } from './helpers'

vi.mock('../services/rbacService', () => ({
  checkPermission:           vi.fn(),
  writeAuditLog:             vi.fn(),
  invalidatePermissionCache: vi.fn(),
}))

vi.mock('../services/client-sync.service', () => ({
  ensureClient: vi.fn(),
}))

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

vi.mock('../services/pdf.service', () => ({
  generateDevisPDF:       vi.fn().mockResolvedValue(Buffer.alloc(512)),
  generateAttestationPDF: vi.fn().mockResolvedValue(Buffer.alloc(512)),
  uploadPDF:              vi.fn().mockResolvedValue('https://test.supabase.co/devis/DEV-2026-0001.pdf'),
}))

vi.mock('../services/email-queue.service', () => ({
  enqueueEmail:    vi.fn().mockResolvedValue(null),
  notifyWhatsApp:  vi.fn().mockResolvedValue(null),
  sendEmailDirect: vi.fn().mockResolvedValue(null),
}))

vi.mock('../services/notifications', () => ({
  notifyStatutChange: vi.fn().mockResolvedValue(null),
}))

vi.mock('../services/sms.service', () => ({
  notifyCommandeSms: vi.fn().mockResolvedValue({ ok: true, message: 'SMS envoyé' }),
}))

vi.mock('../services/finance-core.service', () => ({
  enregistrerPaiementCommande: vi.fn().mockResolvedValue({ ok: true }),
  ensureFactureForCommande:    vi.fn().mockResolvedValue({ id: 'fac-test-001' }),
  syncCreditForCommande:       vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../services/credit-eligibility.service', () => ({
  verifierEligibiliteCredit: vi.fn().mockResolvedValue({ eligible: true }),
}))

vi.mock('../services/db-local', () => ({
  localCreateDevis:    vi.fn().mockResolvedValue({ id: 'local-devis-001', numero: 'DEV-LOCAL-0001', statut: 'brouillon', lignes: [] }),
  localCreateCommande: vi.fn().mockResolvedValue({ id: 'local-cmd-001', ref: 'CMD-LOCAL-0001', statut: 'confirmed', lignes: [] }),
  getClientsLocal:     vi.fn().mockReturnValue({ data: [], total: 0, page: 1, per_page: 20 }),
  getCommandesLocal:   vi.fn().mockReturnValue({ data: [], total: 0, page: 1, per_page: 20 }),
}))

vi.mock('../services/offline-fallback', () => ({
  withOfflineFallback: vi.fn().mockImplementation(
    (_label: string, onlineFn: () => unknown) => onlineFn(),
  ),
  isNetworkError: vi.fn().mockReturnValue(false),
}))

import app from '../app'
import { supabase } from '@forge/db/supabase'
import { checkPermission } from '../services/rbacService'
import { ensureClient } from '../services/client-sync.service'

const ALLOWED = { allowed: true, roleName: 'operateur' }

// ── Fixtures ──────────────────────────────────────────────────────────────────

const CLIENT_ID = 'cli-test-uuid-001'
const DEVIS_ID  = 'dev-test-uuid-001'

const DEVIS_ACCEPTE = {
  id:                    DEVIS_ID,
  numero:                'DEV-2026-0042',
  statut:                'accepte',
  approuve_par_client:   true,
  client_id:             null,           // pas de blocage crédit/client à vérifier
  client_nom:            'Client comptoir',
  date_validite:         '2099-12-31',   // jamais expiré dans ce test
  acompte_pct:           0,
  conditions_paiement:   'comptant',
  condition_paiement_id: null,           // évite tout appel conditions_paiement supplémentaire
  notes:                 null,
  total_ht_xaf:          500_000,
  tva_xaf:               0,
  total_ttc_xaf:         500_000,
  net_a_payer_xaf:       500_000,
  remise_globale_xaf:    0,
  remise_globale_motif:  null,
  devis_lignes:          [],
}

const DEVIS_CREATE_BODY_BASE = {
  client_nom:            'SODECOTON',
  condition_paiement_id: '11111111-1111-1111-1111-111111111111',
  date_emission:         '2026-06-01',
  date_validite:         '2026-06-30',
  lignes: [{ designation: 'Aluminium 6060', unite: 'kg', quantite: 100, prix_unitaire_ht_xaf: 5_000 }],
}

// ── Test 11 (§37) — double conversion / verrou d'idempotence ────────────────────

describe('Phase 6 / Test 11 — POST /devis/:id/transformer-commande : conversion concurrente', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(checkPermission).mockResolvedValue(ALLOWED)
  })

  it('retourne 409 ALREADY_TRANSFORMED si le verrou UPDATE...WHERE statut IN (...) ne réclame aucune ligne, et ne crée aucune commande', async () => {
    // 1) SELECT devis initial — passe tous les gardes (statut accepte, approuvé, pas de client à vérifier)
    vi.mocked(supabase.from).mockReturnValueOnce(
      mkChain({ data: DEVIS_ACCEPTE, error: null }) as never,
    )
    // 2) genererNumero('commandes', 'CMD') → count
    vi.mocked(supabase.from).mockReturnValueOnce(
      mkChain({ data: null, count: 3, error: null }) as never,
    )
    // 3) Le verrou d'idempotence : une autre requête a déjà réclamé ce devis entre
    //    temps → l'UPDATE ... WHERE statut IN (...) ne retourne aucune ligne.
    vi.mocked(supabase.from).mockReturnValueOnce(
      mkChain({ data: null, error: null }) as never,
    )

    const res = await app.request(`/api/devis/${DEVIS_ID}/transformer-commande`, {
      method:  'POST',
      headers: new Headers(authHeaders('operateur')),
      body:    JSON.stringify({}),
    })

    expect(res.status).toBe(409)
    const body = await res.json() as { code: string }
    expect(body.code).toBe('ALREADY_TRANSFORMED')

    // Aucun appel .from() au-delà des 3 attendus : en particulier, jamais
    // d'INSERT dans `commandes` — la double conversion ne doit produire
    // aucune commande fantôme.
    expect(vi.mocked(supabase.from)).toHaveBeenCalledTimes(3)
  })

  it('retourne 201 et crée la commande quand le verrou est bien réclamé (cas nominal, non concurrent)', async () => {
    vi.mocked(supabase.from).mockReturnValueOnce(
      mkChain({ data: DEVIS_ACCEPTE, error: null }) as never,
    )
    vi.mocked(supabase.from).mockReturnValueOnce(
      mkChain({ data: null, count: 3, error: null }) as never,
    )
    // Cette fois, le claim aboutit : la ligne est bien réclamée.
    vi.mocked(supabase.from).mockReturnValueOnce(
      mkChain({ data: { id: DEVIS_ID }, error: null }) as never,
    )
    // Insert commandes
    vi.mocked(supabase.from).mockReturnValueOnce(
      mkChain({ data: { id: 'cmd-new-001', numero: 'CMD-2026-0004' }, error: null }) as never,
    )
    // Insert commandes_lignes
    vi.mocked(supabase.from).mockReturnValueOnce(
      mkChain({ data: [], error: null }) as never,
    )

    const res = await app.request(`/api/devis/${DEVIS_ID}/transformer-commande`, {
      method:  'POST',
      headers: new Headers(authHeaders('operateur')),
      body:    JSON.stringify({}),
    })

    expect(res.status).toBe(201)
  })
})

// ── Tests 17/18 — source_demande (client connecté vs hors plateforme) ───────────

describe('Phase 6 / Tests 17-18 — POST /devis : traçabilité du canal (source_demande)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(checkPermission).mockResolvedValue(ALLOWED)
  })

  it('Test 17 — client connecté (client_id renseigné) : source_demande est persisté et reflété dans la réponse', async () => {
    vi.mocked(ensureClient).mockResolvedValueOnce(CLIENT_ID)

    let insertedPayload: Record<string, unknown> | undefined
    // 1) genererNumero('devis', 'DEV')
    vi.mocked(supabase.from).mockReturnValueOnce(
      mkChain({ data: null, count: 41, error: null }) as never,
    )
    // 2) insert devis — capture le payload envoyé
    const insertChain: Record<string, unknown> = {}
    insertChain['insert'] = vi.fn().mockImplementation((payload: Record<string, unknown>) => {
      insertedPayload = payload
      return insertChain
    })
    insertChain['select'] = vi.fn().mockReturnValue(insertChain)
    insertChain['single'] = vi.fn().mockResolvedValue({
      data: { id: DEVIS_ID, numero: 'DEV-2026-0042', total_ht_xaf: 500_000, tva_xaf: 0, total_ttc_xaf: 500_000, source_demande: 'app_client' },
      error: null,
    })
    vi.mocked(supabase.from).mockReturnValueOnce(insertChain as never)
    // 3) insert devis_lignes
    vi.mocked(supabase.from).mockReturnValueOnce(
      mkChain({ data: [{ id: 'dl-1' }], error: null }) as never,
    )
    // 4) update pdf_url (uploadPDF mocké renvoie une URL non-nulle)
    vi.mocked(supabase.from).mockReturnValueOnce(
      mkChain({ data: null, error: null }) as never,
    )

    const res = await app.request('/api/devis', {
      method:  'POST',
      headers: new Headers(authHeaders('operateur')),
      body:    JSON.stringify({ ...DEVIS_CREATE_BODY_BASE, client_id: CLIENT_ID, source_demande: 'app_client' }),
    })

    expect(res.status).toBe(201)
    expect(insertedPayload?.source_demande).toBe('app_client')
    expect(insertedPayload?.client_id).toBe(CLIENT_ID)
    const body = await res.json() as { source_demande: string }
    expect(body.source_demande).toBe('app_client')
  })

  it('Test 18 — client hors plateforme (pas de client_id, juste un nom + canal) : source_demande est persisté malgré tout', async () => {
    // Client inconnu du système → ensureClient (mocké ici) crée / retourne null selon
    // l'implémentation réelle ; ce test vérifie seulement que la route n'exige PAS
    // de client_id pour tracer le canal, et transmet bien source_demande tel quel.
    vi.mocked(ensureClient).mockResolvedValueOnce(null)

    let insertedPayload: Record<string, unknown> | undefined
    vi.mocked(supabase.from).mockReturnValueOnce(
      mkChain({ data: null, count: 42, error: null }) as never,
    )
    const insertChain: Record<string, unknown> = {}
    insertChain['insert'] = vi.fn().mockImplementation((payload: Record<string, unknown>) => {
      insertedPayload = payload
      return insertChain
    })
    insertChain['select'] = vi.fn().mockReturnValue(insertChain)
    insertChain['single'] = vi.fn().mockResolvedValue({
      data: { id: 'dev-hors-plateforme-001', numero: 'DEV-2026-0043', total_ht_xaf: 500_000, tva_xaf: 0, total_ttc_xaf: 500_000, source_demande: 'whatsapp' },
      error: null,
    })
    vi.mocked(supabase.from).mockReturnValueOnce(insertChain as never)
    vi.mocked(supabase.from).mockReturnValueOnce(
      mkChain({ data: [{ id: 'dl-1' }], error: null }) as never,
    )
    vi.mocked(supabase.from).mockReturnValueOnce(
      mkChain({ data: null, error: null }) as never,
    )

    const res = await app.request('/api/devis', {
      method:  'POST',
      headers: new Headers(authHeaders('operateur')),
      body:    JSON.stringify({
        ...DEVIS_CREATE_BODY_BASE,
        client_nom:     'Client de passage (WhatsApp)',
        source_demande: 'whatsapp',
      }),
    })

    expect(res.status).toBe(201)
    expect(insertedPayload?.source_demande).toBe('whatsapp')
    expect(insertedPayload?.client_id).toBeNull()
    const body = await res.json() as { source_demande: string }
    expect(body.source_demande).toBe('whatsapp')
  })
})
