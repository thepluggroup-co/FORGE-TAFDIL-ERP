/**
 * bons.test.ts — Tests 5 à 8
 *
 * 5. POST /api/bons crée un bon avec statut='soumis' et numéro TAF-YYYYMMDD-XXXX
 * 6. PUT /api/bons/:id/valider change le statut en 'valide'
 * 7. PUT /api/bons/:id/executer avec mauvais code_unique → 422 INVALID_CODE
 * 8. PUT /api/bons/:id/executer avec bon code_unique → succès via RPC atomique
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

const BON_ID  = 'bon-test-uuid-001'
const BON_NUM = 'TAF-20260518-0001'
const USER_ID = 'test-user-uid-001'

const BON_SOUMIS = {
  id:          BON_ID,
  numero:      BON_NUM,
  statut:      'soumis',
  demandeur:   'Jean Dupont',
  motif:       'Maintenance atelier',
  notes:       null,
  created_by:  USER_ID,
  sync_status: 'synced',
}

const BON_VALIDE = { ...BON_SOUMIS, statut: 'valide' }

const BON_LIGNES = [
  {
    id:                'ligne-001',
    bon_id:            BON_ID,
    produit_id:        null,
    designation:       'Vis M8',
    unite:             'pcs',
    quantite_demandee: 50,
    quantite_servie:   0,
  },
]

const CREATE_BON_BODY = {
  demandeur: 'Jean Dupont',
  motif:     'Maintenance atelier',
  lignes:    [{ designation: 'Vis M8', unite: 'pcs', quantite_demandee: 50 }],
}

describe('Test 5 — POST /api/bons crée un bon avec statut soumis', () => {
  beforeEach(() => vi.clearAllMocks())

  it('crée un bon, retourne 201 avec statut=soumis et numéro TAF-YYYYMMDD-XXXX', async () => {
    // genererNumeroBon : count des bons aujourd'hui → 0
    vi.mocked(supabase.from).mockReturnValueOnce(
      mkChain({ data: null, count: 0, error: null }) as never,
    )
    // Insert bon
    vi.mocked(supabase.from).mockReturnValueOnce(
      mkChain({ data: BON_SOUMIS, error: null }) as never,
    )
    // Insert lignes
    vi.mocked(supabase.from).mockReturnValueOnce(
      mkChain({ data: BON_LIGNES, error: null }) as never,
    )

    const res = await app.request('/api/bons', {
      method:  'POST',
      headers: new Headers(authHeaders('operateur')),
      body:    JSON.stringify(CREATE_BON_BODY),
    })

    expect(res.status).toBe(201)

    const body = await res.json() as {
      id:     string
      numero: string
      statut: string
      lignes: unknown[]
    }

    expect(body.statut).toBe('soumis')
    expect(body.numero).toMatch(/^TAF-\d{8}-\d{4}$/)
    expect(Array.isArray(body.lignes)).toBe(true)
    expect(body.lignes.length).toBeGreaterThanOrEqual(1)
  })

  it('retourne 400 si lignes est vide (Zod)', async () => {
    const res = await app.request('/api/bons', {
      method:  'POST',
      headers: new Headers(authHeaders('operateur')),
      body:    JSON.stringify({ demandeur: 'Test', motif: 'Test', lignes: [] }),
    })
    expect(res.status).toBe(400)
  })

  it('retourne 401 sans token', async () => {
    const res = await app.request('/api/bons', {
      method:  'POST',
      headers: new Headers({ 'Content-Type': 'application/json' }),
      body:    JSON.stringify(CREATE_BON_BODY),
    })
    expect(res.status).toBe(401)
  })
})

describe('Test 6 — PUT /api/bons/:id/valider change statut en valide', () => {
  beforeEach(() => vi.clearAllMocks())

  it('change statut soumis → valide avec décision=valide', async () => {
    // Fetch bon (statut: 'soumis')
    vi.mocked(supabase.from).mockReturnValueOnce(
      mkChain({
        data: { statut: 'soumis', demandeur: 'Jean Dupont', numero: BON_NUM, created_by: USER_ID },
        error: null,
      }) as never,
    )
    // Update bon → valide
    vi.mocked(supabase.from).mockReturnValueOnce(
      mkChain({ data: BON_VALIDE, error: null }) as never,
    )

    const res = await app.request(`/api/bons/${BON_ID}/valider`, {
      method:  'PUT',
      headers: new Headers(authHeaders('admin')),
      body:    JSON.stringify({ decision: 'valide', commentaire: 'Approuvé' }),
    })

    expect(res.status).toBe(200)

    const body = await res.json() as { statut: string }
    expect(body.statut).toBe('valide')
  })

  it('retourne 422 INVALID_TRANSITION si bon pas en statut soumis', async () => {
    vi.mocked(supabase.from).mockReturnValueOnce(
      mkChain({
        data: { statut: 'valide', demandeur: 'Jean', numero: BON_NUM, created_by: USER_ID },
        error: null,
      }) as never,
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

  it('retourne 403 FORBIDDEN si rôle operateur (directeur/admin requis)', async () => {
    const res = await app.request(`/api/bons/${BON_ID}/valider`, {
      method:  'PUT',
      headers: new Headers(authHeaders('operateur')),
      body:    JSON.stringify({ decision: 'valide' }),
    })
    expect(res.status).toBe(403)
  })
})

describe('Test 7 — PUT /api/bons/:id/executer avec mauvais code_unique → 422', () => {
  beforeEach(() => vi.clearAllMocks())

  it('retourne 422 INVALID_CODE quand code_unique ne correspond pas au numéro', async () => {
    vi.mocked(supabase.from).mockReturnValueOnce(
      mkChain({
        data:  { ...BON_VALIDE, bons_sortie_lignes: BON_LIGNES },
        error: null,
      }) as never,
    )

    const res = await app.request(`/api/bons/${BON_ID}/executer`, {
      method:  'PUT',
      headers: new Headers(authHeaders('operateur')),
      body:    JSON.stringify({ code_unique: 'MAUVAIS-CODE-XYZ' }),
    })

    expect(res.status).toBe(422)
    const body = await res.json() as { code: string }
    expect(body.code).toBe('INVALID_CODE')
  })

  it('retourne 422 INVALID_TRANSITION si bon pas en statut valide', async () => {
    // code_unique correct mais statut = 'soumis' (pas 'valide')
    vi.mocked(supabase.from).mockReturnValueOnce(
      mkChain({
        data:  { ...BON_SOUMIS, bons_sortie_lignes: BON_LIGNES },
        error: null,
      }) as never,
    )

    const res = await app.request(`/api/bons/${BON_ID}/executer`, {
      method:  'PUT',
      headers: new Headers(authHeaders('operateur')),
      body:    JSON.stringify({ code_unique: BON_NUM }),
    })

    expect(res.status).toBe(422)
    const body = await res.json() as { code: string }
    expect(body.code).toBe('INVALID_TRANSITION')
  })
})

describe('Test 8 — PUT /api/bons/:id/executer avec bon code_unique → succès', () => {
  beforeEach(() => vi.clearAllMocks())

  it('exécute le bon via fn_executer_bon et retourne success=true', async () => {
    // Fetch bon (statut: 'valide', numero = code_unique)
    vi.mocked(supabase.from).mockReturnValueOnce(
      mkChain({
        data:  { ...BON_VALIDE, bons_sortie_lignes: BON_LIGNES },
        error: null,
      }) as never,
    )

    // RPC fn_executer_bon → succès atomique
    vi.mocked(supabase.rpc).mockResolvedValueOnce({
      data:  { success: true, bon_id: BON_ID, numero: BON_NUM },
      error: null,
    } as never)

    const res = await app.request(`/api/bons/${BON_ID}/executer`, {
      method:  'PUT',
      headers: new Headers(authHeaders('operateur')),
      body:    JSON.stringify({ code_unique: BON_NUM }),
    })

    expect(res.status).toBe(200)

    const body = await res.json() as { success: boolean; bon_id?: string }
    expect(body.success).toBe(true)

    // RPC appelé avec le bon ID et user ID
    expect(vi.mocked(supabase.rpc)).toHaveBeenCalledWith('fn_executer_bon', expect.objectContaining({
      p_bon_id: BON_ID,
    }))
  })

  it('retourne 503 RPC_MISSING si fn_executer_bon absente', async () => {
    vi.mocked(supabase.from).mockReturnValueOnce(
      mkChain({
        data:  { ...BON_VALIDE, bons_sortie_lignes: BON_LIGNES },
        error: null,
      }) as never,
    )

    vi.mocked(supabase.rpc).mockResolvedValueOnce({
      data:  null,
      error: { code: '42883', message: 'function fn_executer_bon does not exist' },
    } as never)

    const res = await app.request(`/api/bons/${BON_ID}/executer`, {
      method:  'PUT',
      headers: new Headers(authHeaders('operateur')),
      body:    JSON.stringify({ code_unique: BON_NUM }),
    })

    expect(res.status).toBe(503)
    const body = await res.json() as { code: string }
    expect(body.code).toBe('RPC_MISSING')
  })
})
