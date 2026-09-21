/**
 * auth.test.ts — Tests 9 à 11
 *
 * 9.  Requête sans token sur route protégée → 401 MISSING_TOKEN
 * 10. Requête avec token expiré ou signature invalide → 401 INVALID_TOKEN
 * 11. Requête avec rôle insuffisant (viewer / operateur) → 403 FORBIDDEN
 */

import { describe, it, expect, vi } from 'vitest'
import jwt from 'jsonwebtoken'
import { TEST_JWT_SECRET } from './helpers'

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

// Route protégée : POST /api/stocks/:id/mouvement (requireRole operateur+)
const PROTECTED_POST = '/api/stocks/some-id/mouvement'

// Route admin/directeur seulement : POST /api/factures
const ADMIN_ONLY_POST = '/api/factures'

const ADMIN_ONLY_BODY = JSON.stringify({
  client_nom:    'SODECOTON',
  date_emission: '2026-05-18',
  date_echeance: '2026-06-18',
  lignes: [{ designation: 'Test', quantite: 1, prix_unitaire_ht_xaf: 1000 }],
})

describe('Test 9 — Requête sans token → 401 MISSING_TOKEN', () => {
  it('retourne 401 MISSING_TOKEN sans header Authorization', async () => {
    const res = await app.request(PROTECTED_POST, {
      method:  'POST',
      headers: new Headers({ 'Content-Type': 'application/json' }),
      body:    JSON.stringify({ type: 'sortie', quantite: 1 }),
    })

    expect(res.status).toBe(401)
    const body = await res.json() as { code: string; error: string }
    expect(body.code).toBe('MISSING_TOKEN')
    expect(typeof body.error).toBe('string')
  })

  it('retourne 401 MISSING_TOKEN si Authorization ne commence pas par Bearer', async () => {
    const res = await app.request(PROTECTED_POST, {
      method:  'POST',
      headers: new Headers({
        'Content-Type':  'application/json',
        'Authorization': 'Basic dXNlcjpwYXNz',
      }),
      body: JSON.stringify({ type: 'sortie', quantite: 1 }),
    })

    expect(res.status).toBe(401)
    const body = await res.json() as { code: string }
    expect(body.code).toBe('MISSING_TOKEN')
  })

  it('retourne 401 MISSING_TOKEN si Authorization est vide', async () => {
    const res = await app.request(PROTECTED_POST, {
      method:  'POST',
      headers: new Headers({
        'Content-Type':  'application/json',
        'Authorization': '',
      }),
      body: JSON.stringify({ type: 'sortie', quantite: 1 }),
    })

    expect(res.status).toBe(401)
    const body = await res.json() as { code: string }
    expect(body.code).toBe('MISSING_TOKEN')
  })
})

describe('Test 10 — Token invalide ou expiré → 401 INVALID_TOKEN', () => {
  it('retourne 401 INVALID_TOKEN avec un token expiré (exp dans le passé)', async () => {
    const expiredToken = jwt.sign(
      {
        sub:          'user-expired',
        email:        'expired@tafdil.cm',
        app_metadata: { role: 'operateur' },
        aud:          'authenticated',
        exp:          Math.floor(Date.now() / 1000) - 3600, // expiré il y a 1h
      },
      TEST_JWT_SECRET,
    )

    const res = await app.request(PROTECTED_POST, {
      method:  'POST',
      headers: new Headers({
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${expiredToken}`,
      }),
      body: JSON.stringify({ type: 'sortie', quantite: 1 }),
    })

    expect(res.status).toBe(401)
    const body = await res.json() as { code: string; error: string }
    expect(body.code).toBe('INVALID_TOKEN')
  })

  it('retourne 401 INVALID_TOKEN avec un token signé avec un mauvais secret', async () => {
    const wrongToken = jwt.sign(
      {
        sub:          'user-wrong-secret',
        email:        'wrong@tafdil.cm',
        app_metadata: { role: 'admin' },
        aud:          'authenticated',
      },
      'completely-wrong-secret-that-will-fail-verification',
      { expiresIn: '1h' },
    )

    const res = await app.request(PROTECTED_POST, {
      method:  'POST',
      headers: new Headers({
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${wrongToken}`,
      }),
      body: JSON.stringify({ type: 'sortie', quantite: 1 }),
    })

    expect(res.status).toBe(401)
    const body = await res.json() as { code: string }
    expect(body.code).toBe('INVALID_TOKEN')
  })

  it('retourne 401 INVALID_TOKEN avec une chaîne aléatoire non-JWT', async () => {
    const res = await app.request(PROTECTED_POST, {
      method:  'POST',
      headers: new Headers({
        'Content-Type':  'application/json',
        'Authorization': 'Bearer not-a-jwt-token-at-all',
      }),
      body: JSON.stringify({ type: 'sortie', quantite: 1 }),
    })

    expect(res.status).toBe(401)
    const body = await res.json() as { code: string }
    expect(body.code).toBe('INVALID_TOKEN')
  })
})

describe('Test 11 — Rôle insuffisant → 403 FORBIDDEN', () => {
  it('retourne 403 FORBIDDEN : viewer sur route directeur/admin (POST /api/factures)', async () => {
    const viewerToken = jwt.sign(
      {
        sub:          'viewer-user',
        email:        'viewer@tafdil.cm',
        app_metadata: { role: 'apprenant' },
        aud:          'authenticated',
      },
      TEST_JWT_SECRET,
      { expiresIn: '1h' },
    )

    const res = await app.request(ADMIN_ONLY_POST, {
      method:  'POST',
      headers: new Headers({
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${viewerToken}`,
      }),
      body: ADMIN_ONLY_BODY,
    })

    expect(res.status).toBe(403)
    const body = await res.json() as { code: string; error: string }
    expect(body.code).toBe('FORBIDDEN')
    expect(body.error).toMatch(/accès refusé/i)
  })

  it('retourne 403 FORBIDDEN : operateur sur route directeur/admin (POST /api/factures)', async () => {
    const operateurToken = jwt.sign(
      {
        sub:          'operateur-user',
        email:        'operateur@tafdil.cm',
        app_metadata: { role: 'operateur' },
        aud:          'authenticated',
      },
      TEST_JWT_SECRET,
      { expiresIn: '1h' },
    )

    const res = await app.request(ADMIN_ONLY_POST, {
      method:  'POST',
      headers: new Headers({
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${operateurToken}`,
      }),
      body: ADMIN_ONLY_BODY,
    })

    expect(res.status).toBe(403)
    const body = await res.json() as { code: string }
    expect(body.code).toBe('FORBIDDEN')
  })

  it('opérateur accède normalement aux routes opérateur (GET /api/stocks)', async () => {
    const { supabase } = await import('@forge/db/supabase')
    const { mkChain }  = await import('./helpers')

    vi.mocked(supabase.from).mockReturnValueOnce(
      mkChain({ data: [], count: 0, error: null }) as never,
    )

    const operateurToken = jwt.sign(
      {
        sub:          'operateur-ok',
        email:        'ok@tafdil.cm',
        app_metadata: { role: 'operateur' },
        aud:          'authenticated',
      },
      TEST_JWT_SECRET,
      { expiresIn: '1h' },
    )

    const res = await app.request('/api/stocks', {
      method:  'GET',
      headers: new Headers({ 'Authorization': `Bearer ${operateurToken}` }),
    })

    expect(res.status).toBe(200)
  })
})
