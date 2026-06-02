/**
 * TEST-02 : Workflow complet bon de sortie
 *
 * soumis → valide → execute
 * Valide : création, broadcast Realtime, validation, exécution avec déduction stock.
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

// ── Fixtures ───────────────────────────────────────────────────────────────────

const BON_ID     = 'bon-uuid-test-001'
const BON_NUMERO = 'TAF-20260518-0001'
const PRODUIT_ID = 'prod-uuid-vis-m6'

const BON_SOUMIS = {
  id:         BON_ID,
  numero:     BON_NUMERO,
  statut:     'soumis',
  demandeur:  'Ali Technicien',
  motif:      'Maintenance préventive groupe électrogène',
  notes:      null,
  created_by: 'test-user-uid-001',
}

const LIGNES = [
  {
    id:                'ligne-001',
    bon_id:            BON_ID,
    produit_id:        PRODUIT_ID,
    designation:       'Vis M6 x 20mm',
    unite:             'pcs',
    quantite_demandee: 7,
    quantite_servie:   0,
  },
]

describe('TEST-02 : Workflow complet bon de sortie', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('cree un bon (soumis), le valide, puis l execute avec deduction de stock', async () => {
    const mockFrom    = vi.mocked(supabase.from)
    const mockRpc     = vi.mocked(supabase.rpc)
    const mockChannel = vi.mocked(supabase.channel)

    // ── Séquence des appels from() ─────────────────────────────────────────────
    // 1. genererNumeroBon : count des bons du jour
    mockFrom.mockReturnValueOnce(mkChain({ count: 0, data: [], error: null }) as never)
    // 2. insert bon
    mockFrom.mockReturnValueOnce(mkChain({ data: BON_SOUMIS, error: null }) as never)
    // 3. insert lignes
    mockFrom.mockReturnValueOnce(mkChain({ data: LIGNES, error: null }) as never)
    // 4. valider : select existant (statut check)
    mockFrom.mockReturnValueOnce(mkChain({ data: BON_SOUMIS, error: null }) as never)
    // 5. valider : update statut → 'valide'
    mockFrom.mockReturnValueOnce(
      mkChain({ data: { ...BON_SOUMIS, statut: 'valide' }, error: null }) as never,
    )
    // 6. executer : select bon avec lignes
    mockFrom.mockReturnValueOnce(
      mkChain({
        data:  { ...BON_SOUMIS, statut: 'valide', bons_sortie_lignes: LIGNES },
        error: null,
      }) as never,
    )
    // fallback : any remaining from() → succès neutre
    mockFrom.mockReturnValue(mkChain({ data: null, error: null }) as never)

    // RPC fn_executer_bon → succès direct (atomique PostgreSQL)
    mockRpc.mockResolvedValue({
      data:  { success: true, bon_id: BON_ID, statut: 'execute' },
      error: null,
    } as never)

    // ── ÉTAPE 1 : POST /api/bons ───────────────────────────────────────────────
    const createRes = await app.request('/api/bons', {
      method:  'POST',
      headers: new Headers(authHeaders('operateur')),
      body:    JSON.stringify({
        demandeur: 'Ali Technicien',
        motif:     'Maintenance préventive groupe électrogène',
        lignes: [
          { produit_id: PRODUIT_ID, designation: 'Vis M6 x 20mm', quantite_demandee: 7 },
        ],
      }),
    })

    expect(createRes.status).toBe(201)
    const createdBon = await createRes.json() as Record<string, unknown>
    expect(createdBon.statut).toBe('soumis')
    expect(createdBon.numero).toMatch(/^TAF-/)

    // ── ÉTAPE 2 : vérification broadcast Realtime ──────────────────────────────
    expect(mockChannel).toHaveBeenCalledWith('forge-bons')

    // ── ÉTAPE 3 : PUT /api/bons/:id/valider ───────────────────────────────────
    const validerRes = await app.request(`/api/bons/${BON_ID}/valider`, {
      method:  'PUT',
      headers: new Headers(authHeaders('admin')),
      body:    JSON.stringify({ decision: 'valide', commentaire: 'OK pour exécution' }),
    })

    expect(validerRes.status).toBe(200)
    const validatedBon = await validerRes.json() as Record<string, unknown>
    expect(validatedBon.statut).toBe('valide')

    // ── ÉTAPE 4 : PUT /api/bons/:id/executer ──────────────────────────────────
    const executerRes = await app.request(`/api/bons/${BON_ID}/executer`, {
      method:  'PUT',
      headers: new Headers(authHeaders('operateur')),
      body:    JSON.stringify({ code_unique: BON_NUMERO }),
    })

    expect(executerRes.status).toBe(200)
    const executedBon = await executerRes.json() as Record<string, unknown>

    // ── ÉTAPE 5 : assertions stock et mouvements ───────────────────────────────
    // La fonction atomique PostgreSQL a été appelée une fois
    expect(mockRpc).toHaveBeenCalledWith('fn_executer_bon', expect.objectContaining({
      p_bon_id: BON_ID,
    }))

    // Réponse indique succès
    expect(executedBon.success ?? executedBon.statut).toBeTruthy()

    // ── ÉTAPE 6 : écriture mouvements_stock vérifiée via RPC ──────────────────
    // La déduction de stock est gérée atomiquement par fn_executer_bon en PostgreSQL.
    // Le test valide que l'appel RPC a bien eu lieu avec les bons paramètres.
    expect(mockRpc).toHaveBeenCalledTimes(1)
  })

  it('refuse de valider un bon déjà exécuté (transition invalide)', async () => {
    const mockFrom = vi.mocked(supabase.from)
    mockFrom.mockReturnValue(
      mkChain({ data: { ...BON_SOUMIS, statut: 'execute' }, error: null }) as never,
    )

    const res = await app.request(`/api/bons/${BON_ID}/valider`, {
      method:  'PUT',
      headers: new Headers(authHeaders('admin')),
      body:    JSON.stringify({ decision: 'valide' }),
    })

    expect(res.status).toBe(422)
    const body = await res.json() as { code: string }
    expect(body.code).toBe('INVALID_TRANSITION')
  })
})
