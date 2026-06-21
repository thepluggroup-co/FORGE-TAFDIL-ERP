/**
 * rh.test.ts — Routes RH : employés, présences, apprenants, avances, paie
 * Couverture : CRUD employés/apprenants, présences, avances salaire, génération/validation paie
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mkChain, authHeaders } from './helpers'

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
  generateAttestationPDF: vi.fn().mockResolvedValue(Buffer.alloc(512)),
  generateDevisPDF:       vi.fn().mockResolvedValue(Buffer.alloc(512)),
  uploadPDF:              vi.fn().mockResolvedValue('https://test.supabase.co/rh/attestation.pdf'),
}))

vi.mock('../services/comptabilite.service', () => ({
  annulerEcrituresReference:       vi.fn().mockResolvedValue({ ok: true }),
  genererEcrituresPaiePaiement:    vi.fn().mockResolvedValue({ ok: true }),
  genererEcrituresPaieValidation:  vi.fn().mockResolvedValue({ ok: true }),
  genererEcritureSortieTresorerie: vi.fn().mockResolvedValue({ ok: true }),
  planComptable:                   [],
  libelleCompte:                   vi.fn().mockReturnValue(''),
}))

import app from '../app'
import { supabase } from '@forge/db/supabase'

// ── Fixtures ──────────────────────────────────────────────────────────────────

const EMPLOYE_ID   = '00000000-0000-0000-0000-000000000001'
const APPRENANT_ID = '00000000-0000-0000-0000-000000000002'

const EMPLOYE = {
  id:               EMPLOYE_ID,
  nom:              'Jean Mbarga',
  poste:            'Opérateur CNC',
  departement:      'Production',
  type_contrat:     'CDI',
  date_entree:      '2024-01-15',
  salaire_base_xaf: 250_000,
  statut:           'actif',
  sync_status:      'synced',
}

const APPRENANT = {
  id:         APPRENANT_ID,
  nom:        'Paul Biya Jr',
  specialite: 'Soudure TIG',
  niveau:     2,
  duree_mois: 12,
  statut:     'actif',
}

const CREATE_EMPLOYE_BODY = {
  nom:              'Jean Mbarga',
  poste:            'Opérateur CNC',
  departement:      'Production',
  type_contrat:     'CDI',
  date_entree:      '2024-01-15',
  salaire_base_xaf: 250_000,
}

// ── Tests EMPLOYÉS ────────────────────────────────────────────────────────────

describe('RH1 — GET /api/rh/employes : liste employés', () => {
  beforeEach(() => vi.clearAllMocks())

  it('retourne 200 avec data + total', async () => {
    vi.mocked(supabase.from).mockReturnValueOnce(
      mkChain({ data: [EMPLOYE], count: 1, error: null }) as never,
    )

    const res  = await app.request('/api/rh/employes', { headers: new Headers(authHeaders('admin')) })
    expect(res.status).toBe(200)
    const body = await res.json() as { data: unknown[]; total: number }
    expect(Array.isArray(body.data)).toBe(true)
  })

  it('couvre branches filtres statut/departement/search', async () => {
    const res = await app.request(`/api/rh/employes?statut=actif&departement=Production&search=Jean`, { headers: new Headers(authHeaders('admin')) })
    expect(res.status).toBe(200)
  })

  it('retourne 401 sans token', async () => {
    const res = await app.request('/api/rh/employes')
    expect(res.status).toBe(401)
  })
})

describe('RH2 — GET /api/rh/employes/:id : détail employé', () => {
  beforeEach(() => vi.clearAllMocks())

  it('retourne 200 avec le détail', async () => {
    vi.mocked(supabase.from).mockReturnValueOnce(
      mkChain({ data: EMPLOYE, error: null }) as never,
    )

    const res  = await app.request(`/api/rh/employes/${EMPLOYE_ID}`, { headers: new Headers(authHeaders('admin')) })
    expect(res.status).toBe(200)
  })

  it('retourne 404 si employé introuvable', async () => {
    vi.mocked(supabase.from).mockReturnValueOnce(
      mkChain({ data: null, error: { code: 'PGRST116', message: 'not found' } }) as never,
    )

    const res = await app.request(`/api/rh/employes/${EMPLOYE_ID}`, { headers: new Headers(authHeaders('admin')) })
    expect(res.status).toBe(404)
  })
})

describe('RH3 — POST /api/rh/employes : création employé', () => {
  beforeEach(() => vi.clearAllMocks())

  it('retourne 201 avec l\'employé créé (rôle admin)', async () => {
    vi.mocked(supabase.from).mockReturnValueOnce(
      mkChain({ data: EMPLOYE, error: null }) as never,
    )

    const res = await app.request('/api/rh/employes', {
      method:  'POST',
      headers: new Headers(authHeaders('admin')),
      body:    JSON.stringify(CREATE_EMPLOYE_BODY),
    })
    expect(res.status).toBe(201)
    const body = await res.json() as { nom: string }
    expect(body.nom).toBe('Jean Mbarga')
  })

  it('retourne 400 si nom manquant (Zod)', async () => {
    const res = await app.request('/api/rh/employes', {
      method:  'POST',
      headers: new Headers(authHeaders('admin')),
      body:    JSON.stringify({ poste: 'CNC', departement: 'Prod', type_contrat: 'CDI', date_entree: '2024-01-01', salaire_base_xaf: 200_000 }),
    })
    expect(res.status).toBe(400)
  })

  it('retourne 403 si rôle operateur (admin requis)', async () => {
    const res = await app.request('/api/rh/employes', {
      method:  'POST',
      headers: new Headers(authHeaders('operateur')),
      body:    JSON.stringify(CREATE_EMPLOYE_BODY),
    })
    expect(res.status).toBe(403)
  })

  it('retourne 401 sans token', async () => {
    const res = await app.request('/api/rh/employes', {
      method:  'POST',
      headers: new Headers({ 'Content-Type': 'application/json' }),
      body:    JSON.stringify(CREATE_EMPLOYE_BODY),
    })
    expect(res.status).toBe(401)
  })
})

// ── Tests PRÉSENCES ───────────────────────────────────────────────────────────

describe('RH4 — GET /api/rh/presences : liste présences', () => {
  beforeEach(() => vi.clearAllMocks())

  it('retourne 200 avec data', async () => {
    vi.mocked(supabase.from).mockReturnValueOnce(
      mkChain({ data: [{ id: 'pre-001', employe_id: EMPLOYE_ID, date: '2026-06-01', statut: 'present' }], count: 1, error: null }) as never,
    )

    const res  = await app.request('/api/rh/presences', { headers: new Headers(authHeaders('superviseur')) })
    expect(res.status).toBe(200)
    const body = await res.json() as { data: unknown[] }
    expect(Array.isArray(body.data)).toBe(true)
  })

  it('couvre branches filtres employe_id/date/statut', async () => {
    const res = await app.request(`/api/rh/presences?employe_id=${EMPLOYE_ID}&date=2026-06-01&statut=present`, { headers: new Headers(authHeaders('superviseur')) })
    expect(res.status).toBe(200)
  })
})

describe('RH5 — POST /api/rh/presences : enregistrer présence', () => {
  beforeEach(() => vi.clearAllMocks())

  const PRESENCE_BODY = {
    employe_id: EMPLOYE_ID,
    date:       '2026-06-01',
    heures:     8,
    statut:     'present',
  }

  it('retourne 201 avec la présence créée', async () => {
    vi.mocked(supabase.from).mockReturnValueOnce(
      mkChain({ data: { id: 'pre-001', ...PRESENCE_BODY }, error: null }) as never,
    )

    const res = await app.request('/api/rh/presences', {
      method:  'POST',
      headers: new Headers(authHeaders('operateur')),
      body:    JSON.stringify(PRESENCE_BODY),
    })
    expect(res.status).toBe(201)
  })

  it('retourne 400 si statut invalide (Zod)', async () => {
    const res = await app.request('/api/rh/presences', {
      method:  'POST',
      headers: new Headers(authHeaders('operateur')),
      body:    JSON.stringify({ employe_id: EMPLOYE_ID, date: '2026-06-01', heures: 8, statut: 'invalide' }),
    })
    expect(res.status).toBe(400)
  })
})

// ── Tests APPRENANTS ──────────────────────────────────────────────────────────

describe('RH6 — GET /api/rh/apprenants : liste apprenants', () => {
  beforeEach(() => vi.clearAllMocks())

  it('retourne 200 avec data', async () => {
    vi.mocked(supabase.from).mockReturnValueOnce(
      mkChain({ data: [APPRENANT], count: 1, error: null }) as never,
    )

    const res  = await app.request('/api/rh/apprenants', { headers: new Headers(authHeaders('admin')) })
    expect(res.status).toBe(200)
    const body = await res.json() as { data: unknown[] }
    expect(Array.isArray(body.data)).toBe(true)
  })

  it('couvre branches filtres statut/specialite', async () => {
    const res = await app.request('/api/rh/apprenants?statut=actif&specialite=Soudure', { headers: new Headers(authHeaders('admin')) })
    expect(res.status).toBe(200)
  })
})

describe('RH7 — POST /api/rh/apprenants : créer apprenant', () => {
  beforeEach(() => vi.clearAllMocks())

  const CREATE_APPRENANT = { nom: 'Paul Biya Jr', specialite: 'Soudure TIG', niveau: 2, duree_mois: 12 }

  it('retourne 201 avec l\'apprenant créé', async () => {
    vi.mocked(supabase.from).mockReturnValueOnce(
      mkChain({ data: APPRENANT, error: null }) as never,
    )

    const res = await app.request('/api/rh/apprenants', {
      method:  'POST',
      headers: new Headers(authHeaders('superviseur')),
      body:    JSON.stringify(CREATE_APPRENANT),
    })
    expect(res.status).toBe(201)
  })

  it('retourne 403 si rôle operateur (superviseur requis)', async () => {
    const res = await app.request('/api/rh/apprenants', {
      method:  'POST',
      headers: new Headers(authHeaders('operateur')),
      body:    JSON.stringify(CREATE_APPRENANT),
    })
    expect(res.status).toBe(403)
  })

  it('retourne 400 si spécialité manquante (Zod)', async () => {
    const res = await app.request('/api/rh/apprenants', {
      method:  'POST',
      headers: new Headers(authHeaders('superviseur')),
      body:    JSON.stringify({ nom: 'Test', niveau: 1 }),
    })
    expect(res.status).toBe(400)
  })
})

// ── Tests AVANCES SALAIRE ─────────────────────────────────────────────────────

describe('RH8 — POST /api/rh/avances-salaire : avance sur salaire', () => {
  beforeEach(() => vi.clearAllMocks())

  const AVANCE_BODY = {
    employe_id:         EMPLOYE_ID,
    date_avance:        '2026-06-01',
    mois_deduction:     '2026-06',
    montant_xaf:        50_000,
    mode_paiement:      'caisse',
    compte_tresorerie:  '571',
  }

  it('retourne 422 COMPTE_TRESORERIE_INVALIDE si compte ne correspond pas au mode', async () => {
    const res = await app.request('/api/rh/avances-salaire', {
      method:  'POST',
      headers: new Headers(authHeaders('admin')),
      body:    JSON.stringify({ ...AVANCE_BODY, mode_paiement: 'banque', compte_tresorerie: '571' }),
    })
    expect(res.status).toBe(422)
    const body = await res.json() as { code: string }
    expect(body.code).toBe('COMPTE_TRESORERIE_INVALIDE')
  })

  it('retourne 404 EMPLOYE_NOT_FOUND si employe inexistant', async () => {
    vi.mocked(supabase.from).mockReturnValueOnce(
      mkChain({ data: null, error: { code: 'PGRST116', message: 'not found' } }) as never,
    )

    const res = await app.request('/api/rh/avances-salaire', {
      method:  'POST',
      headers: new Headers(authHeaders('admin')),
      body:    JSON.stringify(AVANCE_BODY),
    })
    expect(res.status).toBe(404)
    const body = await res.json() as { code: string }
    expect(body.code).toBe('EMPLOYE_NOT_FOUND')
  })

  it('retourne 422 EMPLOYE_INACTIF si statut inactif', async () => {
    vi.mocked(supabase.from).mockReturnValueOnce(
      mkChain({ data: { ...EMPLOYE, statut: 'inactif' }, error: null }) as never,
    )

    const res = await app.request('/api/rh/avances-salaire', {
      method:  'POST',
      headers: new Headers(authHeaders('admin')),
      body:    JSON.stringify(AVANCE_BODY),
    })
    expect(res.status).toBe(422)
    const body = await res.json() as { code: string }
    expect(body.code).toBe('EMPLOYE_INACTIF')
  })

  it('retourne 403 si rôle non-admin', async () => {
    const res = await app.request('/api/rh/avances-salaire', {
      method:  'POST',
      headers: new Headers(authHeaders('superviseur')),
      body:    JSON.stringify(AVANCE_BODY),
    })
    expect(res.status).toBe(403)
  })

  it('couvre genererNumeroRh — employe actif trouvé, sortie échoue → 400', async () => {
    // Passe la vérification employe → genererNumeroRh est appelé ; sortie insert retourne null → 400
    vi.mocked(supabase.from).mockReturnValueOnce(
      mkChain({ data: { ...EMPLOYE, statut: 'actif' }, error: null }) as never,
    )
    const res = await app.request('/api/rh/avances-salaire', {
      method:  'POST',
      headers: new Headers(authHeaders('admin')),
      body:    JSON.stringify(AVANCE_BODY),
    })
    expect(res.status).toBe(400)
  })
})

// ── Tests PAIE ────────────────────────────────────────────────────────────────

describe('RH9 — GET /api/rh/paie : liste bulletins', () => {
  beforeEach(() => vi.clearAllMocks())

  it('retourne 200 avec data', async () => {
    vi.mocked(supabase.from).mockReturnValueOnce(
      mkChain({ data: [], count: 0, error: null }) as never,
    )

    const res  = await app.request('/api/rh/paie?mois=2026-06', { headers: new Headers(authHeaders('admin')) })
    expect(res.status).toBe(200)
    const body = await res.json() as { data: unknown[] }
    expect(Array.isArray(body.data)).toBe(true)
  })

  it('retourne 403 si rôle operateur', async () => {
    const res = await app.request('/api/rh/paie', { headers: new Headers(authHeaders('operateur')) })
    expect(res.status).toBe(403)
  })
})

describe('RH10 — POST /api/rh/paie/:mois/valider : validation paie', () => {
  beforeEach(() => vi.clearAllMocks())

  it('retourne 400 si format mois invalide', async () => {
    const res = await app.request('/api/rh/paie/2026-6/valider', {
      method:  'POST',
      headers: new Headers(authHeaders('admin')),
      body:    '{}',
    })
    expect(res.status).toBe(400)
    const body = await res.json() as { code: string }
    expect(body.code).toBe('INVALID_MOIS')
  })

  it('retourne 403 si rôle non-admin', async () => {
    const res = await app.request('/api/rh/paie/2026-06/valider', {
      method:  'POST',
      headers: new Headers(authHeaders('superviseur')),
      body:    '{}',
    })
    expect(res.status).toBe(403)
  })

  it('retourne 422 NO_BULLETINS si aucun bulletin en attente', async () => {
    // calculerPeriodePaie → bulletins_paie (seul appel from() avant retour anticipé)
    vi.mocked(supabase.from).mockReturnValueOnce(
      mkChain({ data: [], count: 0, error: null }) as never,
    )

    const res = await app.request('/api/rh/paie/2026-06/valider', {
      method:  'POST',
      headers: new Headers(authHeaders('admin')),
      body:    '{}',
    })
    expect(res.status).toBe(422)
    const body = await res.json() as { code: string }
    expect(body.code).toBe('NO_BULLETINS')
  })
})

describe('RH11 — POST /api/rh/paie : générer bulletins', () => {
  beforeEach(() => vi.clearAllMocks())

  it('retourne 403 si rôle non-admin', async () => {
    const res = await app.request('/api/rh/paie', {
      method:  'POST',
      headers: new Headers(authHeaders('superviseur')),
      body:    JSON.stringify({ mois: '2026-06' }),
    })
    expect(res.status).toBe(403)
  })

  it('retourne 400 si mois invalide (Zod)', async () => {
    const res = await app.request('/api/rh/paie', {
      method:  'POST',
      headers: new Headers(authHeaders('admin')),
      body:    JSON.stringify({ mois: 'invalid' }),
    })
    expect(res.status).toBe(400)
  })

  it('retourne 401 sans token', async () => {
    const res = await app.request('/api/rh/paie', {
      method:  'POST',
      headers: new Headers({ 'Content-Type': 'application/json' }),
      body:    JSON.stringify({ mois: '2026-06' }),
    })
    expect(res.status).toBe(401)
  })
})

describe('RH12 — GET /api/rh/avances-salaire : liste avances', () => {
  beforeEach(() => vi.clearAllMocks())

  it('retourne 200 avec data', async () => {
    vi.mocked(supabase.from).mockReturnValueOnce(
      mkChain({ data: [], count: 0, error: null }) as never,
    )

    const res  = await app.request('/api/rh/avances-salaire', { headers: new Headers(authHeaders('admin')) })
    expect(res.status).toBe(200)
    const body = await res.json() as { data: unknown[]; total_xaf: number }
    expect(Array.isArray(body.data)).toBe(true)
    expect(typeof body.total_xaf).toBe('number')
  })

  it('retourne 403 si rôle operateur (superviseur+ requis)', async () => {
    const res = await app.request('/api/rh/avances-salaire', { headers: new Headers(authHeaders('operateur')) })
    expect(res.status).toBe(403)
  })

  it('mappe mapAvanceSalaireDb avec données complètes + branches filtres mois/employe_id/statut', async () => {
    vi.mocked(supabase.from).mockReturnValueOnce(
      mkChain({ data: [{ id: AVANCE_ID, employe_id: EMPLOYE_ID, sortie_id: '00000000-0000-0000-0000-999999999999', date_avance: '2026-06-15', mois_deduction: '2026-06', montant_xaf: 50000, montant_deduit_xaf: 25000, statut: 'payee', mode_paiement: 'caisse', compte_tresorerie: '571', reference_paiement: 'REF001', motif: 'Test avance', notes: 'Note test', created_at: '2026-06-15T08:00:00Z', employes: { nom: 'Jean Mbarga', poste: 'Opérateur CNC', departement: 'Production' } }], count: 1, error: null }) as never,
    )
    const res = await app.request(`/api/rh/avances-salaire?mois=2026-06&employe_id=${EMPLOYE_ID}&statut=payee`, { headers: new Headers(authHeaders('admin')) })
    expect(res.status).toBe(200)
    const body = await res.json() as { data: Array<{ employe_nom: string; montant_xaf: number }> }
    expect(body.data[0].employe_nom).toBe('Jean Mbarga')
    expect(body.data[0].montant_xaf).toBe(50000)
  })

  it('mappe mapAvanceSalaireDb avec employes null (branches fallback)', async () => {
    vi.mocked(supabase.from).mockReturnValueOnce(
      mkChain({ data: [{ id: AVANCE_ID, employe_id: EMPLOYE_ID, date_avance: '2026-06-15', mois_deduction: '2026-06', mode_paiement: 'caisse', compte_tresorerie: '571', employes: null }], count: 1, error: null }) as never,
    )
    const res = await app.request('/api/rh/avances-salaire', { headers: new Headers(authHeaders('admin')) })
    expect(res.status).toBe(200)
    const body = await res.json() as { data: Array<{ employe_nom: string; montant_xaf: number; statut: string }> }
    expect(body.data[0].employe_nom).toBe('')
    expect(body.data[0].montant_xaf).toBe(0)
    expect(body.data[0].statut).toBe('payee')
  })
})

// ── Couverture supplémentaire (RH13–RH41) ──────────────────────────────────────

const SESSION_ID    = '00000000-0000-0000-0000-000000000003'
const CONGE_ID      = '00000000-0000-0000-0000-000000000004'
const RETENUE_ID    = '00000000-0000-0000-0000-000000000005'
const COTISATION_ID = '00000000-0000-0000-0000-000000000006'
const AVANCE_ID     = '00000000-0000-0000-0000-000000000007'
const BULLETIN_ID   = '00000000-0000-0000-0000-000000000008'
const PRES_ID       = '00000000-0000-0000-0000-000000000009'

describe('RH13 — PUT /api/rh/employes/:id : mise à jour', () => {
  beforeEach(() => vi.clearAllMocks())
  it('retourne 404 quand employé introuvable (mock null)', async () => {
    const res = await app.request(`/api/rh/employes/${EMPLOYE_ID}`, {
      method: 'PUT',
      headers: new Headers({ ...authHeaders('admin'), 'Content-Type': 'application/json' }),
      body: JSON.stringify({ nom: 'Bello Kadidja' }),
    })
    expect(res.status).toBe(404)
  })
})

describe('RH14 — DELETE /api/rh/employes/:id : désactiver', () => {
  beforeEach(() => vi.clearAllMocks())
  it('retourne 204 (marque inactif)', async () => {
    const res = await app.request(`/api/rh/employes/${EMPLOYE_ID}`, {
      method: 'DELETE',
      headers: new Headers(authHeaders('admin')),
    })
    expect(res.status).toBe(204)
  })
})

describe('RH15 — PUT /api/rh/presences/:id : mise à jour présence', () => {
  beforeEach(() => vi.clearAllMocks())
  it('retourne 404 quand présence introuvable', async () => {
    const res = await app.request(`/api/rh/presences/${PRES_ID}`, {
      method: 'PUT',
      headers: new Headers({ ...authHeaders('superviseur'), 'Content-Type': 'application/json' }),
      body: JSON.stringify({ heures: 9 }),
    })
    expect(res.status).toBe(404)
  })
})

describe('RH16 — POST /api/rh/apprenants/:id/progression', () => {
  beforeEach(() => vi.clearAllMocks())
  it('retourne 404 si apprenant introuvable', async () => {
    const res = await app.request(`/api/rh/apprenants/${APPRENANT_ID}/progression`, {
      method: 'POST',
      headers: new Headers({ ...authHeaders('admin'), 'Content-Type': 'application/json' }),
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(404)
  })
})

describe('RH17 — POST /api/rh/apprenants/:id/recruter', () => {
  beforeEach(() => vi.clearAllMocks())
  it('retourne 404 si apprenant introuvable', async () => {
    const res = await app.request(`/api/rh/apprenants/${APPRENANT_ID}/recruter`, {
      method: 'POST',
      headers: new Headers({ ...authHeaders('admin'), 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        poste: 'Soudeur', departement: 'Production', type_contrat: 'CDI',
        date_entree: '2026-07-01', salaire_base_xaf: 180_000,
      }),
    })
    expect(res.status).toBe(404)
  })
})

describe('RH18 — PATCH /api/rh/avances-salaire/:id/annuler', () => {
  beforeEach(() => vi.clearAllMocks())
  it('retourne 404 si avance introuvable', async () => {
    const res = await app.request(`/api/rh/avances-salaire/${AVANCE_ID}/annuler`, {
      method: 'PATCH',
      headers: new Headers(authHeaders('admin')),
    })
    expect(res.status).toBe(404)
  })
})

describe('RH19 — GET /api/rh/retenues-salaire : liste retenues', () => {
  beforeEach(() => vi.clearAllMocks())
  it('retourne 200 avec data', async () => {
    const res = await app.request('/api/rh/retenues-salaire', { headers: new Headers(authHeaders('admin')) })
    expect(res.status).toBe(200)
    const body = await res.json() as { data: unknown[] }
    expect(Array.isArray(body.data)).toBe(true)
  })

  it('mappe mapRetenueSalaireDb avec données complètes + branches filtres mois/employe_id/statut', async () => {
    vi.mocked(supabase.from).mockReturnValueOnce(
      mkChain({ data: [{ id: RETENUE_ID, employe_id: EMPLOYE_ID, mois_deduction: '2026-06', type: 'saisie', libelle: 'Saisie sur salaire', montant_xaf: 15000, montant_deduit_xaf: 0, statut: 'active', notes: 'Note retenue', created_at: '2026-06-01T08:00:00Z', employes: { nom: 'Jean Mbarga', poste: 'Opérateur CNC', departement: 'Production' } }], count: 1, error: null }) as never,
    )
    const res = await app.request(`/api/rh/retenues-salaire?mois=2026-06&employe_id=${EMPLOYE_ID}&statut=active`, { headers: new Headers(authHeaders('admin')) })
    expect(res.status).toBe(200)
    const body = await res.json() as { data: Array<{ employe_nom: string; type: string; montant_xaf: number }> }
    expect(body.data[0].employe_nom).toBe('Jean Mbarga')
    expect(body.data[0].type).toBe('saisie')
    expect(body.data[0].montant_xaf).toBe(15000)
  })

  it('mappe mapRetenueSalaireDb avec employes null (branches fallback)', async () => {
    vi.mocked(supabase.from).mockReturnValueOnce(
      mkChain({ data: [{ id: RETENUE_ID, employe_id: EMPLOYE_ID, mois_deduction: '2026-06', libelle: 'Retenue partielle', created_at: '2026-06-01T08:00:00Z', employes: null }], count: 1, error: null }) as never,
    )
    const res = await app.request('/api/rh/retenues-salaire', { headers: new Headers(authHeaders('admin')) })
    expect(res.status).toBe(200)
    const body = await res.json() as { data: Array<{ employe_nom: string; type: string; statut: string; montant_xaf: number }> }
    expect(body.data[0].employe_nom).toBe('')
    expect(body.data[0].type).toBe('autre')
    expect(body.data[0].statut).toBe('active')
    expect(body.data[0].montant_xaf).toBe(0)
  })
})

describe('RH20 — POST /api/rh/retenues-salaire : créer retenue', () => {
  beforeEach(() => vi.clearAllMocks())
  it('retourne 404 si employé introuvable', async () => {
    const res = await app.request('/api/rh/retenues-salaire', {
      method: 'POST',
      headers: new Headers({ ...authHeaders('admin'), 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        employe_id: EMPLOYE_ID, mois_deduction: '2026-06',
        type: 'autre', libelle: 'Test retenue', montant_xaf: 10_000,
      }),
    })
    expect(res.status).toBe(404)
  })
})

describe('RH21 — PATCH /api/rh/retenues-salaire/:id/annuler', () => {
  beforeEach(() => vi.clearAllMocks())
  it('retourne 404 si retenue introuvable', async () => {
    const res = await app.request(`/api/rh/retenues-salaire/${RETENUE_ID}/annuler`, {
      method: 'PATCH',
      headers: new Headers(authHeaders('admin')),
    })
    expect(res.status).toBe(404)
  })
})

describe('RH22 — GET /api/rh/cotisations-sociales : calculer cotisations', () => {
  beforeEach(() => vi.clearAllMocks())
  it('retourne 200 avec cotisations calculées', async () => {
    const res = await app.request('/api/rh/cotisations-sociales?mois=2026-06', {
      headers: new Headers(authHeaders('admin')),
    })
    expect(res.status).toBe(200)
    const body = await res.json() as { mois: string }
    expect(body.mois).toBe('2026-06')
  })
  it('retourne 400 si mois manquant', async () => {
    const res = await app.request('/api/rh/cotisations-sociales', { headers: new Headers(authHeaders('admin')) })
    expect(res.status).toBe(400)
  })
})

describe('RH23 — POST /api/rh/cotisations-sociales : persister', () => {
  beforeEach(() => vi.clearAllMocks())
  it('retourne 201 avec cotisations persistées', async () => {
    const res = await app.request('/api/rh/cotisations-sociales', {
      method: 'POST',
      headers: new Headers({ ...authHeaders('admin'), 'Content-Type': 'application/json' }),
      body: JSON.stringify({ mois: '2026-06' }),
    })
    expect(res.status).toBe(201)
  })
})

describe('RH24 — PATCH /api/rh/cotisations-sociales/:id/statut', () => {
  beforeEach(() => vi.clearAllMocks())
  it('retourne 404 si cotisation introuvable', async () => {
    const res = await app.request(`/api/rh/cotisations-sociales/${COTISATION_ID}/statut`, {
      method: 'PATCH',
      headers: new Headers({ ...authHeaders('admin'), 'Content-Type': 'application/json' }),
      body: JSON.stringify({ statut: 'validee' }),
    })
    expect(res.status).toBe(404)
  })
})

describe('RH25 — GET /api/rh/paie-periodes : liste périodes', () => {
  beforeEach(() => vi.clearAllMocks())
  it('retourne 200 avec data', async () => {
    const res = await app.request('/api/rh/paie-periodes', { headers: new Headers(authHeaders('admin')) })
    expect(res.status).toBe(200)
  })
  it('couvre branche filtre mois', async () => {
    const res = await app.request('/api/rh/paie-periodes?mois=2026-06', { headers: new Headers(authHeaders('admin')) })
    expect(res.status).toBe(200)
  })
})

describe('RH26 — GET /api/rh/paie/:mois/controle : tableau de contrôle', () => {
  beforeEach(() => vi.clearAllMocks())
  it('retourne 200 avec statut_global', async () => {
    const res = await app.request('/api/rh/paie/2026-06/controle', { headers: new Headers(authHeaders('admin')) })
    expect(res.status).toBe(200)
    const body = await res.json() as { statut_global: string }
    expect(['ok', 'warning', 'error']).toContain(body.statut_global)
  })
})

describe('RH27 — GET /api/rh/paie/:mois/export : export CSV', () => {
  beforeEach(() => vi.clearAllMocks())
  it('retourne 200 (Hono c.text() override Content-Type)', async () => {
    const res = await app.request('/api/rh/paie/2026-06/export', { headers: new Headers(authHeaders('admin')) })
    expect(res.status).toBe(200)
  })

  it('mappe mapBulletinDb avec données complètes (toutes les branches truthy)', async () => {
    vi.mocked(supabase.from).mockReturnValueOnce(
      mkChain({ data: [{ id: BULLETIN_ID, employe_id: EMPLOYE_ID, mois: '2026-06', salaire_base_xaf: 300000, heures_sup_xaf: 15000, primes_xaf: 10000, deductions_xaf: 5000, avance_deduite_xaf: 20000, retenue_deduite_xaf: 10000, cotisation_cnps_xaf: 12600, cnps_employeur_xaf: 21000, irpp_xaf: 8000, net_xaf: 270000, cout_employeur_xaf: 348000, pdf_url: 'https://example.com/bulletin.pdf', pdf_generated_at: '2026-06-21T10:00:00Z', statut: 'valide', employes: { nom: 'Jean Mbarga', poste: 'Opérateur CNC', departement: 'Production' } }], error: null }) as never,
    )
    const res = await app.request('/api/rh/paie/2026-06/export', { headers: new Headers(authHeaders('admin')) })
    expect(res.status).toBe(200)
    const text = await res.text()
    expect(text).toContain('Jean Mbarga')
    expect(text).toContain('300000')
  })

  it('mappe mapBulletinDb avec employes null (branches fallback)', async () => {
    vi.mocked(supabase.from).mockReturnValueOnce(
      mkChain({ data: [{ id: BULLETIN_ID, employe_id: EMPLOYE_ID, mois: '2026-06', employes: null }], error: null }) as never,
    )
    const res = await app.request('/api/rh/paie/2026-06/export', { headers: new Headers(authHeaders('admin')) })
    expect(res.status).toBe(200)
    const text = await res.text()
    expect(text).toContain('"2026-06"')
  })
})

describe('RH28 — GET /api/rh/paie/:annee/:mois : générer bulletins', () => {
  beforeEach(() => vi.clearAllMocks())
  it('retourne 200 (liste vide si aucun employé actif)', async () => {
    const res = await app.request('/api/rh/paie/2026/06', { headers: new Headers(authHeaders('admin')) })
    expect(res.status).toBe(200)
    const body = await res.json() as { data: unknown[] }
    expect(Array.isArray(body.data)).toBe(true)
  })

  it('couvre calculerBulletin/calculerCNPS/calculerIRPPMensuel avec 1 employé actif', async () => {
    // mock 1 : bulletins_paie count = 0 → aucun existant → genererBulletinsMois
    vi.mocked(supabase.from).mockReturnValueOnce(
      mkChain({ data: [], count: 0, error: null }) as never,
    )
    // mock 2 : employes dans genererBulletinsMois → 1 employé actif
    vi.mocked(supabase.from).mockReturnValueOnce(
      mkChain({ data: [EMPLOYE], error: null }) as never,
    )
    const res = await app.request('/api/rh/paie/2026/06', { headers: new Headers(authHeaders('admin')) })
    expect(res.status).toBe(200)
    const body = await res.json() as { recapitulatif: { masse_salariale_nette_xaf: number } }
    expect(typeof body.recapitulatif.masse_salariale_nette_xaf).toBe('number')
  })

  it('réutilise les bulletins existants (count>0 && !recalculer → true branch)', async () => {
    vi.mocked(supabase.from).mockReturnValueOnce(
      mkChain({ data: [{ id: BULLETIN_ID, employe_id: EMPLOYE_ID, mois: '2026-06', salaire_base_xaf: 250000, net_xaf: 220000, statut: 'en_attente', employes: { nom: 'Jean Mbarga', poste: 'Opérateur CNC', departement: 'Production' } }], count: 1, error: null }) as never,
    )
    const res = await app.request('/api/rh/paie/2026/06', { headers: new Headers(authHeaders('admin')) })
    expect(res.status).toBe(200)
    const body = await res.json() as { deja_genere: boolean }
    expect(body.deja_genere).toBe(true)
  })
})

describe('RH29 — PATCH /api/rh/paie/:id/statut : transition bulletin', () => {
  beforeEach(() => vi.clearAllMocks())
  it('retourne 404 si bulletin introuvable', async () => {
    const res = await app.request(`/api/rh/paie/${BULLETIN_ID}/statut`, {
      method: 'PATCH',
      headers: new Headers({ ...authHeaders('admin'), 'Content-Type': 'application/json' }),
      body: JSON.stringify({ statut: 'valide' }),
    })
    expect(res.status).toBe(404)
  })
})

describe('RH30 — GET /api/rh/formation/sessions : liste sessions', () => {
  beforeEach(() => vi.clearAllMocks())
  it('retourne 200 avec data', async () => {
    const res = await app.request('/api/rh/formation/sessions', { headers: new Headers(authHeaders('admin')) })
    expect(res.status).toBe(200)
    const body = await res.json() as { data: unknown[] }
    expect(Array.isArray(body.data)).toBe(true)
  })
  it('couvre branches filtres statut/niveau', async () => {
    const res = await app.request('/api/rh/formation/sessions?statut=active&niveau=2', { headers: new Headers(authHeaders('admin')) })
    expect(res.status).toBe(200)
  })
})

describe('RH31 — POST /api/rh/formation/sessions : créer session', () => {
  beforeEach(() => vi.clearAllMocks())
  it('retourne 201 avec session créée', async () => {
    const res = await app.request('/api/rh/formation/sessions', {
      method: 'POST',
      headers: new Headers({ ...authHeaders('admin'), 'Content-Type': 'application/json' }),
      body: JSON.stringify({ module: 'Soudure TIG avancée', niveau: 3 }),
    })
    expect(res.status).toBe(201)
  })
})

describe('RH32 — GET /api/rh/formation/sessions/:id : détail session', () => {
  beforeEach(() => vi.clearAllMocks())
  it('retourne 404 si session introuvable', async () => {
    const res = await app.request(`/api/rh/formation/sessions/${SESSION_ID}`, {
      headers: new Headers(authHeaders('admin')),
    })
    expect(res.status).toBe(404)
  })
})

describe('RH33 — PUT /api/rh/formation/sessions/:id : MAJ session', () => {
  beforeEach(() => vi.clearAllMocks())
  it('retourne 404 si session introuvable', async () => {
    const res = await app.request(`/api/rh/formation/sessions/${SESSION_ID}`, {
      method: 'PUT',
      headers: new Headers({ ...authHeaders('superviseur'), 'Content-Type': 'application/json' }),
      body: JSON.stringify({ module: 'Soudure avancée modifiée' }),
    })
    expect(res.status).toBe(404)
  })
})

describe('RH34 — DELETE /api/rh/formation/sessions/:id', () => {
  beforeEach(() => vi.clearAllMocks())
  it('retourne 204', async () => {
    const res = await app.request(`/api/rh/formation/sessions/${SESSION_ID}`, {
      method: 'DELETE',
      headers: new Headers(authHeaders('admin')),
    })
    expect(res.status).toBe(204)
  })
})

describe('RH35 — GET /api/rh/apprenants/:id/historique', () => {
  beforeEach(() => vi.clearAllMocks())
  it('retourne 404 si apprenant introuvable', async () => {
    const res = await app.request(`/api/rh/apprenants/${APPRENANT_ID}/historique`, {
      headers: new Headers(authHeaders('admin')),
    })
    expect(res.status).toBe(404)
  })
})

describe('RH36 — GET /api/rh/conges : liste congés', () => {
  beforeEach(() => vi.clearAllMocks())
  it('retourne 200 avec data', async () => {
    const res = await app.request('/api/rh/conges', { headers: new Headers(authHeaders('admin')) })
    expect(res.status).toBe(200)
  })
  it('couvre branches filtres employe_id/statut', async () => {
    const res = await app.request(`/api/rh/conges?employe_id=${EMPLOYE_ID}&statut=approuve`, { headers: new Headers(authHeaders('admin')) })
    expect(res.status).toBe(200)
  })
})

describe('RH37 — GET /api/rh/conges/soldes : soldes congés', () => {
  beforeEach(() => vi.clearAllMocks())
  it('retourne 200 avec soldes', async () => {
    const res = await app.request('/api/rh/conges/soldes', { headers: new Headers(authHeaders('admin')) })
    expect(res.status).toBe(200)
  })
})

describe('RH38 — POST /api/rh/conges : créer congé', () => {
  beforeEach(() => vi.clearAllMocks())
  it('retourne 201 après création', async () => {
    const res = await app.request('/api/rh/conges', {
      method: 'POST',
      headers: new Headers({ ...authHeaders('admin'), 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        employe_id: EMPLOYE_ID, type: 'conge_paye',
        date_debut: '2026-07-01', date_fin: '2026-07-15', jours_ouvres: 10,
      }),
    })
    expect(res.status).toBe(201)
  })
  it('retourne 422 si date_fin avant date_debut', async () => {
    const res = await app.request('/api/rh/conges', {
      method: 'POST',
      headers: new Headers({ ...authHeaders('admin'), 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        employe_id: EMPLOYE_ID, type: 'conge_paye',
        date_debut: '2026-07-15', date_fin: '2026-07-01', jours_ouvres: 10,
      }),
    })
    expect(res.status).toBe(422)
  })
})

describe('RH39 — PATCH /api/rh/conges/:id/statut : approuver/refuser', () => {
  beforeEach(() => vi.clearAllMocks())
  it('retourne 404 si congé introuvable', async () => {
    const res = await app.request(`/api/rh/conges/${CONGE_ID}/statut`, {
      method: 'PATCH',
      headers: new Headers({ ...authHeaders('admin'), 'Content-Type': 'application/json' }),
      body: JSON.stringify({ statut: 'approuve' }),
    })
    expect(res.status).toBe(404)
  })
})

describe('RH40 — DELETE /api/rh/conges/:id', () => {
  beforeEach(() => vi.clearAllMocks())
  it('retourne 404 si congé introuvable', async () => {
    const res = await app.request(`/api/rh/conges/${CONGE_ID}`, {
      method: 'DELETE',
      headers: new Headers(authHeaders('admin')),
    })
    expect(res.status).toBe(404)
  })
})

describe('RH41 — GET /api/rh/presences/recap : récap mensuel', () => {
  beforeEach(() => vi.clearAllMocks())
  it('retourne 200 avec recap par employé', async () => {
    const res = await app.request('/api/rh/presences/recap?mois=2026-06', {
      headers: new Headers(authHeaders('admin')),
    })
    expect(res.status).toBe(200)
    const body = await res.json() as { mois: string; data: unknown[] }
    expect(body.mois).toBe('2026-06')
    expect(Array.isArray(body.data)).toBe(true)
  })
  it('couvre branche filtre employe_id', async () => {
    const res = await app.request(`/api/rh/presences/recap?mois=2026-06&employe_id=${EMPLOYE_ID}`, { headers: new Headers(authHeaders('admin')) })
    expect(res.status).toBe(200)
  })
  it('retourne 400 si mois manquant', async () => {
    const res = await app.request('/api/rh/presences/recap', { headers: new Headers(authHeaders('admin')) })
    expect(res.status).toBe(400)
  })
})

describe('RH42 — GET /api/rh/cnps/rapport : rapport CNPS mensuel', () => {
  beforeEach(() => vi.clearAllMocks())
  it('retourne 200 avec rapport CNPS', async () => {
    const res = await app.request('/api/rh/cnps/rapport?mois=2026-06', {
      headers: new Headers(authHeaders('admin')),
    })
    expect(res.status).toBe(200)
    const body = await res.json() as { mois: string }
    expect(body.mois).toBe('2026-06')
  })
})
