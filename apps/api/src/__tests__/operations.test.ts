/**
 * operations.test.ts — Couverture de apps/api/src/routes/operations.ts
 *
 * Routeur monté sous /api/ (chemins préfixés /production, /projets,
 * /logistique, /marketing, /securite) derrière authMiddleware global +
 * requireRole par endpoint mutant.
 *
 * Endpoints couverts :
 *  - GET  /production/jobs            (liste paginée, en_retard)
 *  - GET  /production/jobs/:id        (404)
 *  - POST /production/jobs            (401, 403, Zod, MACHINE_PANNE)
 *  - GET  /projets                    (liste, alerte_budget)
 *  - POST /projets                    (403 operateur, Zod, happy path)
 *  - PATCH /projets/:id/statut        (404, INVALID_TRANSITION)
 *  - GET  /logistique/livraisons      (liste)
 *  - POST /logistique/livraisons      (Zod, COMMANDE_NOT_FOUND, happy path sans commande)
 *  - POST /marketing/campagnes        (403, happy path)
 *  - POST /securite/incidents         (Zod, happy path)
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

vi.mock('../services/sms.service', () => ({
  notifyCommandeSms: vi.fn().mockResolvedValue({ ok: true, skipped: false }),
}))
vi.mock('../services/finance-core.service', () => ({
  enregistrerPaiementCommande: vi.fn().mockResolvedValue({ id: 'p1' }),
  ensureFactureForCommande:    vi.fn().mockResolvedValue({ id: 'f1' }),
  getFactureActiveByCommande:  vi.fn().mockResolvedValue(null),
}))
vi.mock('../services/workflow-notifications.service', () => ({
  notifyWorkflow: vi.fn().mockResolvedValue(undefined),
}))
// POST /logistique/livraisons (servi par routes/logistique.ts, monté avant
// operationsRouter — cf. app.ts) appelle verifierCommandeLivrable(), qui
// dépend de ce service pour résoudre le bon de sortie livrable ; on mocke la
// fonction de haut niveau plutôt que de rejouer sa cascade de requêtes DB.
vi.mock('../services/commande-workflow.service', () => ({
  resolveBonSortieLivrableForCommande: vi.fn(),
  synchroniserCommandesWorkflow:       vi.fn().mockResolvedValue(undefined),
  resolveCommandeContext:              vi.fn().mockResolvedValue(null),
  ensureWorkflowApresExecutionBon:     vi.fn().mockResolvedValue(undefined),
  ensureWorkflowApresPreparationBon:   vi.fn().mockResolvedValue(undefined),
}))
// RBAC mocké directement (plutôt que de laisser tourner le vrai checkPermission
// contre la DB mockée) : ce fichier teste plusieurs rôles avec le MÊME userId
// (authHeaders() par défaut, cf. helpers.ts) — le cache mémoire de rbacService
// (_permCache, keyé par userId) survivrait donc entre tests et ferait fuiter
// les permissions d'un rôle vers les requêtes suivantes sous un autre rôle.
// Mocker checkPermission court-circuite aussi le vrai loadPermissionsFromDb,
// qui consommait par erreur les mockReturnValueOnce destinés à la logique
// métier (cause dominante documentée dans docs/DETTE-TESTS-2026-09-26.md).
vi.mock('../services/rbacService', () => ({
  checkPermission:           vi.fn(),
  writeAuditLog:             vi.fn(),
  invalidatePermissionCache: vi.fn(),
}))

import app from '../app'
import { supabase } from '@forge/db/supabase'
import { checkPermission } from '../services/rbacService'
import { resolveBonSortieLivrableForCommande } from '../services/commande-workflow.service'
import { getFactureActiveByCommande } from '../services/finance-core.service'

/** Autorise la requête suivante — à appeler juste avant chaque `app.request()` protégé. */
function allow(roleName = 'MANAGER') {
  vi.mocked(checkPermission).mockResolvedValueOnce({ allowed: true, roleName })
}
/** Refuse la requête suivante (403 attendu par le middleware). */
function deny(roleName = 'COMMERCIAL') {
  vi.mocked(checkPermission).mockResolvedValueOnce({ allowed: false, roleName, reason: 'TEST_DENY' })
}

function resetFromDefault() {
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
  vi.mocked(supabase.from).mockReset()
  vi.mocked(supabase.from).mockImplementation(safeChain as never)
}

beforeEach(() => { vi.clearAllMocks(); resetFromDefault() })

// ── Production jobs ──────────────────────────────────────────────────────────

describe('GET /api/production/jobs', () => {
  it('retourne 401 sans token', async () => {
    const res = await app.request('/api/production/jobs')
    expect(res.status).toBe(401)
  })

  it('retourne la liste paginée avec flag en_retard', async () => {
    allow('COMMERCIAL')
    vi.mocked(supabase.from).mockReturnValueOnce(mkChain({
      data: [{ id: 'j1', statut: 'in_production', date_fin_prevue: '2000-01-01', produit_designation: 'Portail' }],
      count: 1, error: null,
    }) as never)
    const res = await app.request('/api/production/jobs', { headers: new Headers(authHeaders('operateur')) })
    expect(res.status).toBe(200)
    const body = await res.json() as { data: Array<{ en_retard: boolean }>; total: number }
    expect(body.total).toBe(1)
    expect(body.data[0].en_retard).toBe(true)
  })
})

describe('GET /api/production/jobs/:id', () => {
  it('retourne 404 si job introuvable', async () => {
    allow('SUPER_ADMIN')
    vi.mocked(supabase.from).mockReturnValueOnce(mkChain({ data: null, error: { message: 'x' } }) as never)
    const res = await app.request('/api/production/jobs/unknown', { headers: new Headers(authHeaders('admin')) })
    expect(res.status).toBe(404)
  })
})

describe('POST /api/production/jobs', () => {
  it('retourne 400 si produit_designation manquant (Zod)', async () => {
    allow('COMMERCIAL')
    const res = await app.request('/api/production/jobs', {
      method: 'POST', headers: new Headers(authHeaders('operateur')),
      body: JSON.stringify({ type_job: 'commande' }),
    })
    expect(res.status).toBe(400)
  })

  it('retourne 422 MACHINE_PANNE si la machine (recopiée dans equipements, D5) est en panne', async () => {
    allow('COMMERCIAL')
    // ancien machine_id → équipement recopié (ancienne_machine_id) → statut en_panne
    vi.mocked(supabase.from).mockReturnValueOnce(mkChain({
      data: { id: 'eq-1', designation: 'CNC-1', statut: 'en_panne' }, error: null,
    }) as never)
    const res = await app.request('/api/production/jobs', {
      method: 'POST', headers: new Headers(authHeaders('operateur')),
      body: JSON.stringify({ produit_designation: 'Portail', machine_id: 'm1' }),
    })
    expect(res.status).toBe(422)
    const body = await res.json() as { code: string }
    expect(body.code).toBe('MACHINE_PANNE')
  })

  it('repli sur la table machines tant que la migration Phase 5 n’est pas passée', async () => {
    allow('COMMERCIAL')
    vi.mocked(supabase.from).mockReturnValueOnce(mkChain({ data: null, error: null }) as never)                            // equipements : rien
    vi.mocked(supabase.from).mockReturnValueOnce(mkChain({ data: { nom: 'CNC-1', statut: 'maintenance' }, error: null }) as never) // machines
    const res = await app.request('/api/production/jobs', {
      method: 'POST', headers: new Headers(authHeaders('operateur')),
      body: JSON.stringify({ produit_designation: 'Portail', machine_id: 'm1' }),
    })
    expect(res.status).toBe(422)
    expect((await res.json() as { code: string }).code).toBe('MACHINE_MAINTENANCE')
  })

  it('refuse un équipement hors service (422) ou inconnu (404)', async () => {
    const EQ = '66666666-6666-4666-8666-666666666666'
    allow('COMMERCIAL')
    vi.mocked(supabase.from).mockReturnValueOnce(mkChain({ data: { id: EQ, designation: 'Plieuse', statut: 'hors_service' }, error: null }) as never)
    const hs = await app.request('/api/production/jobs', {
      method: 'POST', headers: new Headers(authHeaders('operateur')),
      body: JSON.stringify({ produit_designation: 'Portail', equipement_id: EQ }),
    })
    expect(hs.status).toBe(422)
    expect((await hs.json() as { code: string }).code).toBe('EQUIPEMENT_HORS_SERVICE')

    allow('COMMERCIAL')
    vi.mocked(supabase.from).mockReturnValueOnce(mkChain({ data: null, error: null }) as never)
    const inconnu = await app.request('/api/production/jobs', {
      method: 'POST', headers: new Headers(authHeaders('operateur')),
      body: JSON.stringify({ produit_designation: 'Portail', equipement_id: EQ }),
    })
    expect(inconnu.status).toBe(404)
  })

  it('cree un job avec plusieurs ressources malgre categorie absente du schema cache', async () => {
    allow('COMMERCIAL')
    const countChain = mkChain({ data: null, count: 2, error: null })
    const firstInsertChain = mkChain({
      data: null,
      error: {
        code: 'PGRST204',
        message: "Could not find the 'categorie' column of 'jobs_production' in the schema cache",
      },
    })
    const retryInsertChain = mkChain({
      data: {
        id: 'j3',
        numero: 'JOB-2026-003',
        produit_designation: 'Portail',
        machine_nom: 'Pliage hydraulique, CNC Deckel',
        technicien_nom: 'Mvondo Serge, Nkolo Pierre',
      },
      error: null,
    })
    vi.mocked(supabase.from)
      .mockReturnValueOnce(countChain as never)
      .mockReturnValueOnce(firstInsertChain as never)
      .mockReturnValueOnce(retryInsertChain as never)

    const res = await app.request('/api/production/jobs', {
      method: 'POST', headers: new Headers(authHeaders('operateur')),
      body: JSON.stringify({
        type_job: 'stock',
        produit_designation: 'Portail',
        categorie: 'Ferronnerie',
        quantite_prevue: 2,
        machine_nom: 'Pliage hydraulique, CNC Deckel',
        technicien_nom: 'Mvondo Serge, Nkolo Pierre',
      }),
    })

    expect(res.status).toBe(201)
    expect(firstInsertChain.insert).toHaveBeenCalledWith(expect.objectContaining({ categorie: 'Ferronnerie' }))
    expect(retryInsertChain.insert).toHaveBeenCalledWith(expect.not.objectContaining({ categorie: expect.anything() }))
    expect(retryInsertChain.insert).toHaveBeenCalledWith(expect.objectContaining({
      machine_nom: 'Pliage hydraulique, CNC Deckel',
      technicien_nom: 'Mvondo Serge, Nkolo Pierre',
    }))
  })
})

// ── Projets ──────────────────────────────────────────────────────────────────

describe('GET /api/projets', () => {
  it('retourne la liste avec alerte_budget', async () => {
    allow('COMMERCIAL')
    vi.mocked(supabase.from).mockReturnValueOnce(mkChain({
      data: [{ id: 'pr1', nom: 'Chantier', budget_xaf: 1000, depense_xaf: 2000 }],
      count: 1, error: null,
    }) as never)
    const res = await app.request('/api/projets', { headers: new Headers(authHeaders('operateur')) })
    expect(res.status).toBe(200)
    const body = await res.json() as { data: Array<{ alerte_budget: boolean }> }
    expect(body.data[0].alerte_budget).toBe(true)
  })
})

describe('POST /api/projets', () => {
  it('retourne 403 pour un opérateur (admin/superviseur requis)', async () => {
    deny('COMMERCIAL')
    const res = await app.request('/api/projets', {
      method: 'POST', headers: new Headers(authHeaders('operateur')),
      body: JSON.stringify({ nom: 'Projet X' }),
    })
    expect(res.status).toBe(403)
  })

  it('retourne 400 si nom manquant (Zod)', async () => {
    allow('SUPER_ADMIN')
    const res = await app.request('/api/projets', {
      method: 'POST', headers: new Headers(authHeaders('admin')),
      body: JSON.stringify({ description: 'sans nom' }),
    })
    expect(res.status).toBe(400)
  })

  it('crée un projet et retourne 201', async () => {
    allow('SUPER_ADMIN')
    vi.mocked(supabase.from).mockReturnValueOnce(mkChain({
      data: { id: 'pr2', nom: 'Projet X', statut: 'planifie', budget_xaf: 500000 }, error: null,
    }) as never)
    const res = await app.request('/api/projets', {
      method: 'POST', headers: new Headers(authHeaders('admin')),
      body: JSON.stringify({ nom: 'Projet X', budget_xaf: 500000 }),
    })
    expect(res.status).toBe(201)
    const body = await res.json() as { id: string; nom: string }
    expect(body.nom).toBe('Projet X')
  })
})

describe('PATCH /api/projets/:id/statut', () => {
  it('retourne 404 si projet introuvable', async () => {
    allow('SUPER_ADMIN')
    vi.mocked(supabase.from).mockReturnValueOnce(mkChain({ data: null, error: null }) as never)
    const res = await app.request('/api/projets/pr1/statut', {
      method: 'PATCH', headers: new Headers(authHeaders('admin')),
      body: JSON.stringify({ statut: 'en_cours' }),
    })
    expect(res.status).toBe(404)
  })

  it('retourne 422 INVALID_TRANSITION si transition interdite', async () => {
    allow('SUPER_ADMIN')
    // projet livré → on tente en_cours (non autorisé)
    vi.mocked(supabase.from).mockReturnValueOnce(mkChain({
      data: { statut: 'livre', budget_xaf: 0, depense_xaf: 0 }, error: null,
    }) as never)
    const res = await app.request('/api/projets/pr1/statut', {
      method: 'PATCH', headers: new Headers(authHeaders('admin')),
      body: JSON.stringify({ statut: 'en_cours' }),
    })
    expect(res.status).toBe(422)
    const body = await res.json() as { code: string }
    expect(body.code).toBe('INVALID_TRANSITION')
  })
})

// ── Logistique livraisons ────────────────────────────────────────────────────

describe('GET /api/logistique/livraisons', () => {
  it('retourne la liste des livraisons', async () => {
    allow('COMMERCIAL')
    vi.mocked(supabase.from).mockReturnValueOnce(mkChain({
      data: [{ id: 'l1', numero: 'LIV-2026-001', statut: 'planifiee' }], count: 1, error: null,
    }) as never)
    const res = await app.request('/api/logistique/livraisons', { headers: new Headers(authHeaders('operateur')) })
    expect(res.status).toBe(200)
    const body = await res.json() as { data: unknown[]; total: number }
    expect(body.total).toBe(1)
  })
})

describe('POST /api/logistique/livraisons', () => {
  const CMD_UUID = '11111111-1111-1111-1111-111111111111'

  it('retourne 400 si commande_id manquant (Zod)', async () => {
    allow('MANAGER')
    const res = await app.request('/api/logistique/livraisons', {
      method: 'POST', headers: new Headers(authHeaders('superviseur')),
      body: JSON.stringify({ client_nom: 'X', destination: 'Douala' }),
    })
    expect(res.status).toBe(400)
  })

  it('retourne 422 COMMANDE_NOT_FOUND si commande introuvable', async () => {
    allow('MANAGER')
    vi.mocked(supabase.from).mockReturnValueOnce(mkChain({ data: null, error: { code: 'PGRST116' } }) as never)
    const res = await app.request('/api/logistique/livraisons', {
      method: 'POST', headers: new Headers(authHeaders('superviseur')),
      body: JSON.stringify({ client_nom: 'X', destination: 'Douala', commande_id: CMD_UUID }),
    })
    expect(res.status).toBe(422)
    const body = await res.json() as { code: string }
    expect(body.code).toBe('COMMANDE_NOT_FOUND')
  })

  it('crée une livraison liée à une commande (happy path)', async () => {
    allow('SUPER_ADMIN')
    // 1. fetch commande
    vi.mocked(supabase.from).mockReturnValueOnce(mkChain({ data: { id: CMD_UUID, numero: 'CMD-001' }, error: null }) as never)
    // verifierCommandeLivrable() : bon de sortie livrable + facture valide (§ logistique.ts)
    vi.mocked(resolveBonSortieLivrableForCommande).mockResolvedValueOnce({
      context:     { commandeId: CMD_UUID, ref: 'CMD-001', commande: { numero: 'CMD-001' } } as never,
      bonLivrable: { id: 'bs1', numero: 'BS-2026-001', statut: 'pret' } as never,
      dernierBon:  { id: 'bs1', numero: 'BS-2026-001', statut: 'pret' } as never,
    })
    vi.mocked(getFactureActiveByCommande).mockResolvedValueOnce({
      numero: 'FAC-2026-001', statut: 'valide', total_ttc_xaf: 500000, montant_paye_xaf: 0,
    } as never)
    // 2. count livraisons pour numéro
    vi.mocked(supabase.from).mockReturnValueOnce(mkChain({ data: null, count: 4, error: null }) as never)
    // 3. insert livraison
    vi.mocked(supabase.from).mockReturnValueOnce(mkChain({
      data: { id: 'l2', numero: 'LIV-2026-005', statut: 'planifiee', client_nom: 'X' }, error: null,
    }) as never)
    const res = await app.request('/api/logistique/livraisons', {
      method: 'POST', headers: new Headers(authHeaders('admin')),
      body: JSON.stringify({ client_nom: 'X', destination: 'Douala', commande_id: CMD_UUID }),
    })
    expect(res.status).toBe(201)
    const body = await res.json() as { numero: string; statut: string }
    expect(body.statut).toBe('planifiee')
  })

  it('retourne 403 pour un opérateur', async () => {
    deny('COMMERCIAL')
    const res = await app.request('/api/logistique/livraisons', {
      method: 'POST', headers: new Headers(authHeaders('operateur')),
      body: JSON.stringify({ client_nom: 'X', destination: 'Douala', commande_id: CMD_UUID }),
    })
    expect(res.status).toBe(403)
  })
})

// ── Marketing ────────────────────────────────────────────────────────────────

describe('POST /api/marketing/campagnes', () => {
  it('retourne 403 pour un opérateur', async () => {
    deny('COMMERCIAL')
    const res = await app.request('/api/marketing/campagnes', {
      method: 'POST', headers: new Headers(authHeaders('operateur')),
      body: JSON.stringify({ nom: 'Promo' }),
    })
    expect(res.status).toBe(403)
  })
})

// ── Sécurité incidents ───────────────────────────────────────────────────────

describe('POST /api/securite/incidents', () => {
  it('retourne 400 si payload invalide (Zod)', async () => {
    allow('COMMERCIAL')
    const res = await app.request('/api/securite/incidents', {
      method: 'POST', headers: new Headers(authHeaders('operateur')),
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(400)
  })
})
