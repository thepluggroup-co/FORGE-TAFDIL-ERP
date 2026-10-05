/**
 * formation-parcours.test.ts — Parcours de formation individuel du technicien
 *
 *  - GET   /api/formation/mon-parcours              (lié → son parcours ; non lié → 404)
 *  - GET   /api/formation/mon-parcours/attestation  (formation en cours → 422 ; diplômé → PDF)
 *  - GET   /api/rh/apprenants[/:id/historique]      (technicien → 403 : pas d'accès aux autres)
 *  - PATCH /api/rh/apprenants/:id/compte            (rôle invalide, compte déjà lié, succès)
 *
 * Mock Supabase piloté par table + filtres (et non par file mockReturnValueOnce) :
 * le vrai rbacService interroge aussi supabase.from() et décalerait une file.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { authHeaders } from './helpers'

type Filtres = Record<string, unknown>
type Resolver = (table: string, filtres: Filtres) => { data: unknown; error: unknown }

const etat = vi.hoisted(() => ({
  resolver: null as null | ((table: string, filtres: Record<string, unknown>) => { data: unknown; error: unknown }),
  updates:  [] as Array<{ table: string; payload: unknown; filtres: Record<string, unknown> }>,
}))

vi.mock('@forge/db/supabase', () => {
  const chain = (table: string) => {
    const filtres: Record<string, unknown> = {}
    let payload: unknown
    const c: Record<string, unknown> = {}
    for (const m of ['select', 'insert', 'upsert', 'delete', 'neq', 'in', 'or', 'gte', 'lte', 'lt', 'gt',
      'not', 'ilike', 'like', 'order', 'range', 'limit', 'head', 'filter'])
      c[m] = () => c
    c.eq = (k: string, v: unknown) => { filtres[k] = v; return c }
    c.update = (p: unknown) => { payload = p; return c }
    const res = () => {
      if (payload !== undefined) etat.updates.push({ table, payload, filtres })
      return etat.resolver?.(table, filtres) ?? { data: null, error: null }
    }
    c.single = () => Promise.resolve(res())
    c.maybeSingle = () => Promise.resolve(res())
    c.then = (ok: (v: unknown) => unknown) => Promise.resolve(res()).then(ok)
    return c
  }
  const client = { from: (t: string) => chain(t), rpc: () => Promise.resolve({ data: null, error: null }) }
  return { supabase: client, supabaseAdmin: client }
})

vi.mock('../services/pdf.service', () => ({
  generateAttestationPDF: vi.fn().mockResolvedValue(Buffer.from('%PDF-1.4 test')),
  generateDevisPDF:       vi.fn(),
  uploadPDF:              vi.fn(),
}))

import app from '../app'

const TECH_ID       = '00000000-0000-4000-8000-0000000000a1'
const AUTRE_TECH_ID = '00000000-0000-4000-8000-0000000000a2'
const ADMIN_ID      = '00000000-0000-4000-8000-0000000000ad'
const APPRENANT_ID  = '00000000-0000-4000-8000-0000000000b1'
const AUTRE_APP_ID  = '00000000-0000-4000-8000-0000000000b2'

const APPRENANT = { id: APPRENANT_ID, nom: 'Paul Essomba', specialite: 'Soudure', niveau: 2, duree_mois: 4, statut: 'actif', profile_id: TECH_ID }

function base(statut = 'actif'): Resolver {
  return (table, f) => {
    if (table === 'apprenants') {
      if (f.profile_id === TECH_ID) return { data: { id: APPRENANT_ID }, error: null }
      if (f.profile_id)             return { data: null, error: null }
      if (f.id === APPRENANT_ID)    return { data: { ...APPRENANT, statut }, error: null }
    }
    if (table === 'validations_niveau')     return { data: [{ niveau: 2, date_validation: '2026-08-01', commentaire: 'OK' }], error: null }
    if (table === 'formation_inscriptions') return { data: [{ id: 'i1', statut: 'termine', formation_sessions: { module: 'Soudure MIG' } }], error: null }
    return { data: null, error: null }
  }
}

beforeEach(() => { etat.resolver = base(); etat.updates = [] })

describe('GET /api/formation/mon-parcours', () => {
  it('renvoie le parcours de l\'apprenant rattaché au compte, et seulement lui', async () => {
    const res = await app.request('/api/formation/mon-parcours', { headers: authHeaders('apprenant', TECH_ID) })
    expect(res.status).toBe(200)
    const body = await res.json() as { apprenant: { id: string }; validations: unknown[]; inscriptions: unknown[] }
    expect(body.apprenant.id).toBe(APPRENANT_ID)
    expect(body.validations).toHaveLength(1)
    expect(body.inscriptions).toHaveLength(1)
  })

  it('404 APPRENANT_NON_LIE si aucun apprenant n\'est rattaché', async () => {
    const res = await app.request('/api/formation/mon-parcours', { headers: authHeaders('apprenant', AUTRE_TECH_ID) })
    expect(res.status).toBe(404)
    expect((await res.json() as { code: string }).code).toBe('APPRENANT_NON_LIE')
  })

  it('401 sans jeton', async () => {
    const res = await app.request('/api/formation/mon-parcours')
    expect(res.status).toBe(401)
  })
})

describe('GET /api/formation/mon-parcours/attestation', () => {
  it('422 FORMATION_EN_COURS tant que l\'apprenant est actif', async () => {
    const res = await app.request('/api/formation/mon-parcours/attestation', { headers: authHeaders('apprenant', TECH_ID) })
    expect(res.status).toBe(422)
    expect((await res.json() as { code: string }).code).toBe('FORMATION_EN_COURS')
  })

  it('PDF une fois diplômé', async () => {
    etat.resolver = base('diplome')
    const res = await app.request('/api/formation/mon-parcours/attestation', { headers: authHeaders('apprenant', TECH_ID) })
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('application/pdf')
  })
})

describe('Technicien : aucun accès aux parcours des autres', () => {
  it('403 sur la liste RH des apprenants', async () => {
    const res = await app.request('/api/rh/apprenants', { headers: authHeaders('apprenant', TECH_ID) })
    expect(res.status).toBe(403)
  })

  it('403 sur l\'historique d\'un autre apprenant', async () => {
    const res = await app.request(`/api/rh/apprenants/${AUTRE_APP_ID}/historique`, { headers: authHeaders('apprenant', TECH_ID) })
    expect(res.status).toBe(403)
  })

  it('403 sur l\'attestation d\'un autre apprenant', async () => {
    const res = await app.request(`/api/apprenants/${AUTRE_APP_ID}/attestation`, { headers: authHeaders('apprenant', TECH_ID) })
    expect(res.status).toBe(403)
  })
})

describe('PATCH /api/rh/apprenants/:id/compte', () => {
  const patch = (body: unknown) => app.request(`/api/rh/apprenants/${AUTRE_APP_ID}/compte`, {
    method: 'PATCH', headers: authHeaders('admin', ADMIN_ID), body: JSON.stringify(body),
  })

  it('422 si le compte n\'est pas technicien', async () => {
    const prev = base()
    etat.resolver = (t, f) => t === 'profiles' ? { data: { id: AUTRE_TECH_ID, role: 'operateur' }, error: null } : prev(t, f)
    const res = await patch({ profile_id: AUTRE_TECH_ID })
    expect(res.status).toBe(422)
    expect(etat.updates).toHaveLength(0)
  })

  it('409 si le compte est déjà rattaché à un autre apprenant', async () => {
    const prev = base()
    etat.resolver = (t, f) => t === 'profiles' ? { data: { id: TECH_ID, role: 'technicien' }, error: null } : prev(t, f)
    const res = await patch({ profile_id: TECH_ID })
    expect(res.status).toBe(409)
    expect((await res.json() as { code: string }).code).toBe('COMPTE_DEJA_LIE')
  })

  it('200 et met à jour profile_id', async () => {
    const prev = base()
    etat.resolver = (t, f) => {
      if (t === 'profiles') return { data: { id: AUTRE_TECH_ID, role: 'technicien' }, error: null }
      if (t === 'apprenants' && f.id === AUTRE_APP_ID) return { data: { id: AUTRE_APP_ID, profile_id: AUTRE_TECH_ID }, error: null }
      return prev(t, f)
    }
    const res = await patch({ profile_id: AUTRE_TECH_ID })
    expect(res.status).toBe(200)
    const maj = etat.updates.find(u => u.table === 'apprenants')
    expect(maj?.payload).toMatchObject({ profile_id: AUTRE_TECH_ID })
    expect(maj?.filtres).toMatchObject({ id: AUTRE_APP_ID })
  })

  it('403 pour un technicien', async () => {
    const res = await app.request(`/api/rh/apprenants/${APPRENANT_ID}/compte`, {
      method: 'PATCH', headers: authHeaders('apprenant', TECH_ID), body: JSON.stringify({ profile_id: TECH_ID }),
    })
    expect(res.status).toBe(403)
  })
})
