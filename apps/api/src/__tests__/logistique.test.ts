/**
 * logistique.test.ts — Tests router /api/logistique/livraisons
 *
 * Ordre des mocks DB : doit correspondre EXACTEMENT à l'ordre d'appel dans la route.
 *
 *   L1. GET  /livraisons                    → liste paginée
 *   L2. GET  /livraisons/mes-livraisons     → filtré livreur_id (avant /:id)
 *   L3. GET  /livraisons/:id                → détail 200 + 404
 *   L4. POST /livraisons                    → création 201 / 422 / 403 / 400
 *   L5. PATCH /livraisons/:id/statut        → state machine (200/422/403/404)
 *   L6. PATCH /livraisons/:id/assigner      → 200 admin / 403 operateur / 422 livreur inconnu
 *   L7. GET  /preparation/resume            → dashboard 4 compteurs
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mkChain, authHeaders } from './helpers'

// Mocker rbacService au niveau service pour éviter le cache permCache inter-tests
vi.mock('../services/rbacService', () => ({
  checkPermission:           vi.fn(),
  writeAuditLog:             vi.fn(),
  invalidatePermissionCache: vi.fn(),
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

import app from '../app'
import { supabase } from '@forge/db/supabase'
import { checkPermission } from '../services/rbacService'

// ── Fixtures ─────────────────────────────────────────────────────────────────

const LIV_ID     = 'liv-test-uuid-001'                      // paramètre URL — pas validé par Zod
const LIV_NUM    = 'LIV-20260619-0001'
const USER_ID    = 'test-user-uid-001'                      // provient du JWT — pas validé par Zod
const CMD_ID     = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'  // UUID valide — corps Zod createLivraisonSchema
const LIVREUR_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'  // UUID valide — corps Zod assignerSchema

const LIVRAISON_BASE = {
  id:                    LIV_ID,
  numero:                LIV_NUM,
  commande_id:           CMD_ID,
  client_id:             null,
  client_nom:            'Dupont SA',
  destination:           'Douala, Akwa',
  transporteur:          null,
  livreur_id:            null,
  statut:                'planifiee',
  date_depart:           null,
  date_livraison_prevue: null,
  date_livraison_reelle: null,
  notes:                 null,
  created_by:            USER_ID,
  sync_status:           'pending',
}

const CREATE_BODY = {
  commande_id: CMD_ID,
  client_nom:  'Dupont SA',
  destination: 'Douala, Akwa',
}

// checkPermission est mocké au niveau service (vi.mock('../services/rbacService'))
// — pas de mocks DB nécessaires pour L6, et le cache permCache est contourné.

// ─────────────────────────────────────────────────────────────────────────────

describe('L1 — GET /api/logistique/livraisons : liste paginée', () => {
  beforeEach(() => vi.clearAllMocks())

  it('retourne 200 avec data + pagination', async () => {
    // Séquence DB : 1 appel → livraisons list
    vi.mocked(supabase.from).mockReturnValueOnce(
      mkChain({ data: [LIVRAISON_BASE], count: 1, error: null }) as never,
    )

    const res = await app.request('/api/logistique/livraisons', {
      headers: new Headers(authHeaders('operateur')),
    })

    expect(res.status).toBe(200)
    const body = await res.json() as { data: unknown[]; total: number }
    expect(Array.isArray(body.data)).toBe(true)
    expect(body.total).toBe(1)
  })

  it('retourne 401 sans token', async () => {
    const res = await app.request('/api/logistique/livraisons')
    expect(res.status).toBe(401)
  })

  it('retourne 403 pour apprenant', async () => {
    const res = await app.request('/api/logistique/livraisons', {
      headers: new Headers(authHeaders('apprenant')),
    })
    expect(res.status).toBe(403)
  })
})

// ─────────────────────────────────────────────────────────────────────────────

describe('L2 — GET /api/logistique/livraisons/mes-livraisons : route mobile', () => {
  beforeEach(() => vi.clearAllMocks())

  it('retourne 200 avec les livraisons assignées au user courant', async () => {
    // Séquence DB : 1 appel → livraisons WHERE livreur_id = user.id
    vi.mocked(supabase.from).mockReturnValueOnce(
      mkChain({ data: [{ ...LIVRAISON_BASE, livreur_id: USER_ID }], count: 1, error: null }) as never,
    )

    const res = await app.request('/api/logistique/livraisons/mes-livraisons', {
      headers: new Headers(authHeaders('operateur')),
    })

    expect(res.status).toBe(200)
    const body = await res.json() as { data: unknown[]; total: number }
    expect(body.total).toBe(1)
    expect(Array.isArray(body.data)).toBe(true)
  })

  it('n\'est pas capturé par GET /livraisons/:id (ordre des routes)', async () => {
    // Si /mes-livraisons était après /:id, "mes-livraisons" serait traité comme un :id
    // et retournerait 404 (PGRST116 ou similaire)
    vi.mocked(supabase.from).mockReturnValueOnce(
      mkChain({ data: [], count: 0, error: null }) as never,
    )

    const res = await app.request('/api/logistique/livraisons/mes-livraisons', {
      headers: new Headers(authHeaders('admin')),
    })

    // 200 = la route spécifique a bien été matchée, pas /:id
    expect(res.status).toBe(200)
  })
})

// ─────────────────────────────────────────────────────────────────────────────

describe('L3 — GET /api/logistique/livraisons/:id : détail', () => {
  beforeEach(() => vi.clearAllMocks())

  it('retourne 200 avec la livraison complète', async () => {
    // Séquence DB : 1 appel → livraison single
    vi.mocked(supabase.from).mockReturnValueOnce(
      mkChain({ data: LIVRAISON_BASE, error: null }) as never,
    )

    const res = await app.request(`/api/logistique/livraisons/${LIV_ID}`, {
      headers: new Headers(authHeaders('operateur')),
    })

    expect(res.status).toBe(200)
    const body = await res.json() as { id: string; statut: string }
    expect(body.id).toBe(LIV_ID)
    expect(body.statut).toBe('planifiee')
  })

  it('retourne 404 si livraison inconnue', async () => {
    vi.mocked(supabase.from).mockReturnValueOnce(
      mkChain({ data: null, error: { code: 'PGRST116', message: 'not found' } }) as never,
    )

    const res = await app.request('/api/logistique/livraisons/unknown-uuid', {
      headers: new Headers(authHeaders('admin')),
    })

    expect(res.status).toBe(404)
    const body = await res.json() as { code: string }
    expect(body.code).toBe('NOT_FOUND')
  })
})

// ─────────────────────────────────────────────────────────────────────────────

describe('L4 — POST /api/logistique/livraisons : création', () => {
  beforeEach(() => vi.clearAllMocks())

  it('crée une livraison 201 avec statut planifiee et numéro LIV-YYYYMMDD-XXXX', async () => {
    // Séquence DB (ordre exact de la route) :
    //   1. commandes check (single)
    //   2. livraisons count pour genererNumeroLivraison (then)
    //   3. livraisons insert (single)
    //   4. livraisons_historique insert (then)
    vi.mocked(supabase.from).mockReturnValueOnce(
      mkChain({ data: { id: CMD_ID, numero: 'CMD-001' }, error: null }) as never,
    )
    vi.mocked(supabase.from).mockReturnValueOnce(
      mkChain({ data: null, count: 0, error: null }) as never,
    )
    vi.mocked(supabase.from).mockReturnValueOnce(
      mkChain({ data: LIVRAISON_BASE, error: null }) as never,
    )
    vi.mocked(supabase.from).mockReturnValueOnce(
      mkChain({ data: null, error: null }) as never,
    )

    const res = await app.request('/api/logistique/livraisons', {
      method:  'POST',
      headers: new Headers(authHeaders('admin')),
      body:    JSON.stringify(CREATE_BODY),
    })

    expect(res.status).toBe(201)
    const body = await res.json() as { statut: string; numero: string }
    expect(body.statut).toBe('planifiee')
    expect(body.numero).toMatch(/^LIV-\d{8}-\d{4}$/)
  })

  it('retourne 422 COMMANDE_NOT_FOUND si commande inconnue', async () => {
    // Séquence DB : 1 appel → commandes check retourne null
    vi.mocked(supabase.from).mockReturnValueOnce(
      mkChain({ data: null, error: { code: 'PGRST116', message: 'not found' } }) as never,
    )

    const res = await app.request('/api/logistique/livraisons', {
      method:  'POST',
      headers: new Headers(authHeaders('admin')),
      body:    JSON.stringify(CREATE_BODY),
    })

    expect(res.status).toBe(422)
    const body = await res.json() as { code: string }
    expect(body.code).toBe('COMMANDE_NOT_FOUND')
  })

  it('retourne 403 si rôle operateur (admin/superviseur requis)', async () => {
    // Pas de DB calls — bloqué par requireRole avant même d'arriver au handler
    const res = await app.request('/api/logistique/livraisons', {
      method:  'POST',
      headers: new Headers(authHeaders('operateur')),
      body:    JSON.stringify(CREATE_BODY),
    })
    expect(res.status).toBe(403)
  })

  it('retourne 400 si commande_id manquant (Zod)', async () => {
    // Zod rejette avant DB
    const res = await app.request('/api/logistique/livraisons', {
      method:  'POST',
      headers: new Headers(authHeaders('admin')),
      body:    JSON.stringify({ client_nom: 'X', destination: 'Y' }),
    })
    expect(res.status).toBe(400)
  })
})

// ─────────────────────────────────────────────────────────────────────────────

describe('L5 — PATCH /api/logistique/livraisons/:id/statut : state machine', () => {
  beforeEach(() => vi.clearAllMocks())

  it('planifiee → en_route : 200', async () => {
    // Séquence DB :
    //   1. livraisons fetch (single)
    //   2. livraisons update (single)
    //   3. livraisons_historique insert (then)
    vi.mocked(supabase.from).mockReturnValueOnce(
      mkChain({ data: { ...LIVRAISON_BASE, statut: 'planifiee' }, error: null }) as never,
    )
    vi.mocked(supabase.from).mockReturnValueOnce(
      mkChain({ data: { ...LIVRAISON_BASE, statut: 'en_route' }, error: null }) as never,
    )
    vi.mocked(supabase.from).mockReturnValueOnce(
      mkChain({ data: null, error: null }) as never,
    )

    const res = await app.request(`/api/logistique/livraisons/${LIV_ID}/statut`, {
      method:  'PATCH',
      headers: new Headers(authHeaders('admin')),
      body:    JSON.stringify({ statut: 'en_route' }),
    })

    expect(res.status).toBe(200)
    const body = await res.json() as { statut: string }
    expect(body.statut).toBe('en_route')
  })

  it('en_preparation → planifiee : 200 (auto-créée → confirmée)', async () => {
    vi.mocked(supabase.from).mockReturnValueOnce(
      mkChain({ data: { ...LIVRAISON_BASE, statut: 'en_preparation' }, error: null }) as never,
    )
    vi.mocked(supabase.from).mockReturnValueOnce(
      mkChain({ data: { ...LIVRAISON_BASE, statut: 'planifiee' }, error: null }) as never,
    )
    vi.mocked(supabase.from).mockReturnValueOnce(
      mkChain({ data: null, error: null }) as never,
    )

    const res = await app.request(`/api/logistique/livraisons/${LIV_ID}/statut`, {
      method:  'PATCH',
      headers: new Headers(authHeaders('admin')),
      body:    JSON.stringify({ statut: 'planifiee', commentaire: 'Livraison prévue demain' }),
    })

    expect(res.status).toBe(200)
    const body = await res.json() as { statut: string }
    expect(body.statut).toBe('planifiee')
  })

  it('en_route → livree : 200', async () => {
    vi.mocked(supabase.from).mockReturnValueOnce(
      mkChain({ data: { ...LIVRAISON_BASE, statut: 'en_route' }, error: null }) as never,
    )
    vi.mocked(supabase.from).mockReturnValueOnce(
      mkChain({ data: { ...LIVRAISON_BASE, statut: 'livree' }, error: null }) as never,
    )
    vi.mocked(supabase.from).mockReturnValueOnce(
      mkChain({ data: null, error: null }) as never,
    )

    const res = await app.request(`/api/logistique/livraisons/${LIV_ID}/statut`, {
      method:  'PATCH',
      headers: new Headers(authHeaders('admin')),
      body:    JSON.stringify({ statut: 'livree' }),
    })

    expect(res.status).toBe(200)
  })

  it('livree → en_route : 422 INVALID_TRANSITION', async () => {
    // 1 seul appel DB — la state machine rejette après le fetch
    vi.mocked(supabase.from).mockReturnValueOnce(
      mkChain({ data: { ...LIVRAISON_BASE, statut: 'livree' }, error: null }) as never,
    )

    const res = await app.request(`/api/logistique/livraisons/${LIV_ID}/statut`, {
      method:  'PATCH',
      headers: new Headers(authHeaders('admin')),
      body:    JSON.stringify({ statut: 'en_route' }),
    })

    expect(res.status).toBe(422)
    const body = await res.json() as { code: string }
    expect(body.code).toBe('INVALID_TRANSITION')
  })

  it('echec_livraison → en_route : 422 INVALID_TRANSITION', async () => {
    vi.mocked(supabase.from).mockReturnValueOnce(
      mkChain({ data: { ...LIVRAISON_BASE, statut: 'echec_livraison' }, error: null }) as never,
    )

    const res = await app.request(`/api/logistique/livraisons/${LIV_ID}/statut`, {
      method:  'PATCH',
      headers: new Headers(authHeaders('admin')),
      body:    JSON.stringify({ statut: 'en_route' }),
    })

    expect(res.status).toBe(422)
    const body = await res.json() as { code: string }
    expect(body.code).toBe('INVALID_TRANSITION')
  })

  it('operateur 403 si livraison ne lui est pas assignée', async () => {
    // livreur_id différent de l'utilisateur courant (test-user-uid-001)
    vi.mocked(supabase.from).mockReturnValueOnce(
      mkChain({
        data: { ...LIVRAISON_BASE, statut: 'planifiee', livreur_id: 'autre-uuid', created_by: 'autre-uuid' },
        error: null,
      }) as never,
    )

    const res = await app.request(`/api/logistique/livraisons/${LIV_ID}/statut`, {
      method:  'PATCH',
      headers: new Headers(authHeaders('operateur')),
      body:    JSON.stringify({ statut: 'en_route' }),
    })

    expect(res.status).toBe(403)
    const body = await res.json() as { code: string }
    expect(body.code).toBe('FORBIDDEN')
  })

  it('retourne 404 si livraison inconnue', async () => {
    vi.mocked(supabase.from).mockReturnValueOnce(
      mkChain({ data: null, error: { code: 'PGRST116', message: 'not found' } }) as never,
    )

    const res = await app.request(`/api/logistique/livraisons/unknown-id/statut`, {
      method:  'PATCH',
      headers: new Headers(authHeaders('admin')),
      body:    JSON.stringify({ statut: 'en_route' }),
    })

    expect(res.status).toBe(404)
  })
})

// ─────────────────────────────────────────────────────────────────────────────

describe('L6 — PATCH /api/logistique/livraisons/:id/assigner : attribution livreur', () => {
  beforeEach(() => vi.clearAllMocks())

  it('assigne un livreur 200 — admin (SUPER_ADMIN via mock service)', async () => {
    // checkPermission est mocké au niveau service → pas de mocks DB pour le RBAC
    // Séquence DB (4 appels) : livraisons fetch → profiles livreur → livraisons update → historique
    vi.mocked(checkPermission).mockResolvedValueOnce({ allowed: true, roleName: 'SUPER_ADMIN' } as never)

    vi.mocked(supabase.from).mockReturnValueOnce(
      mkChain({ data: LIVRAISON_BASE, error: null }) as never,
    )
    vi.mocked(supabase.from).mockReturnValueOnce(
      mkChain({ data: { id: LIVREUR_ID, nom: 'Paul Mbarga' }, error: null }) as never,
    )
    vi.mocked(supabase.from).mockReturnValueOnce(
      mkChain({ data: { ...LIVRAISON_BASE, livreur_id: LIVREUR_ID }, error: null }) as never,
    )
    vi.mocked(supabase.from).mockReturnValueOnce(
      mkChain({ data: null, error: null }) as never,
    )

    const res = await app.request(`/api/logistique/livraisons/${LIV_ID}/assigner`, {
      method:  'PATCH',
      headers: new Headers(authHeaders('admin')),
      body:    JSON.stringify({ livreur_id: LIVREUR_ID }),
    })

    expect(res.status).toBe(200)
    const body = await res.json() as { livreur_id: string }
    expect(body.livreur_id).toBe(LIVREUR_ID)
  })

  it('retourne 403 si operateur (COMMERCIAL → pas LOGISTICS:UPDATE)', async () => {
    // checkPermission retourne allowed:false → 0 appels DB supplémentaires
    vi.mocked(checkPermission).mockResolvedValueOnce({ allowed: false, roleName: 'COMMERCIAL' } as never)

    const res = await app.request(`/api/logistique/livraisons/${LIV_ID}/assigner`, {
      method:  'PATCH',
      headers: new Headers(authHeaders('operateur')),
      body:    JSON.stringify({ livreur_id: LIVREUR_ID }),
    })

    expect(res.status).toBe(403)
    const body = await res.json() as { code: string }
    expect(body.code).toBe('FORBIDDEN')
  })

  it('retourne 422 LIVREUR_NOT_FOUND si profil inconnu', async () => {
    // Séquence DB (2 appels) : livraisons fetch → profiles null → 422
    vi.mocked(checkPermission).mockResolvedValueOnce({ allowed: true, roleName: 'SUPER_ADMIN' } as never)

    vi.mocked(supabase.from).mockReturnValueOnce(
      mkChain({ data: LIVRAISON_BASE, error: null }) as never,
    )
    vi.mocked(supabase.from).mockReturnValueOnce(
      mkChain({ data: null, error: { code: 'PGRST116', message: 'not found' } }) as never,
    )

    const res = await app.request(`/api/logistique/livraisons/${LIV_ID}/assigner`, {
      method:  'PATCH',
      headers: new Headers(authHeaders('admin')),
      body:    JSON.stringify({ livreur_id: 'dddddddd-dddd-dddd-dddd-dddddddddddd' }),
    })

    expect(res.status).toBe(422)
    const body = await res.json() as { code: string }
    expect(body.code).toBe('LIVREUR_NOT_FOUND')
  })

  it('retourne 400 si livreur_id absent (Zod)', async () => {
    // Zod rejette avant toute DB call ou checkPermission
    const res = await app.request(`/api/logistique/livraisons/${LIV_ID}/assigner`, {
      method:  'PATCH',
      headers: new Headers(authHeaders('admin')),
      body:    JSON.stringify({ transporteur: 'DHL' }),
    })
    expect(res.status).toBe(400)
  })
})

// ─────────────────────────────────────────────────────────────────────────────

describe('L7 — GET /api/logistique/preparation/resume : dashboard', () => {
  beforeEach(() => vi.clearAllMocks())

  it('retourne 200 avec 4 compteurs numériques', async () => {
    // 4 requêtes count en parallèle — toutes sur safe chain (count:0 par défaut)
    const res = await app.request('/api/logistique/preparation/resume', {
      headers: new Headers(authHeaders('admin')),
    })

    expect(res.status).toBe(200)
    const body = await res.json() as {
      a_preparer: number; en_cours: number; pret_a_livrer: number; planifiee: number
    }
    expect(typeof body.a_preparer).toBe('number')
    expect(typeof body.en_cours).toBe('number')
    expect(typeof body.pret_a_livrer).toBe('number')
    expect(typeof body.planifiee).toBe('number')
  })

  it('retourne 401 sans token', async () => {
    const res = await app.request('/api/logistique/preparation/resume')
    expect(res.status).toBe(401)
  })
})
