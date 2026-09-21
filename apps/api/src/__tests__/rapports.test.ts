/**
 * rapports.test.ts — Couverture de apps/api/src/routes/rapports.ts
 *
 * Routeur monté sous /api/rapports avec authMiddleware global puis
 * requireRole(['admin','superviseur']) par endpoint.
 *
 * Endpoints couverts (lecture seule, comptabilité SYSCOHADA) :
 *  - GET /grand-livre        (param compte requis, agrégation, 403/401)
 *  - GET /balance            (équilibre débit/crédit)
 *  - GET /bilan, /resultat, /synthese, /controles, /cloture
 *  - GET /declarations/tva   (TVA collectée/déductible)
 *  - GET /plan-comptable     (filtre par classe, accessible tout rôle authentifié)
 *  - GET /remises
 *  - GET /grand-livre.xls    (export Excel)
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

import app from '../app'
import { supabase } from '@forge/db/supabase'

// Réinstalle la chaîne sûre par défaut + vide la file mockReturnValueOnce résiduelle
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

// Écritures comptables fixtures couvrant plusieurs classes SYSCOHADA
const ECRITURES = [
  { id: 'e1', date: '2026-03-01', libelle: 'Vente A', compte_syscohada: '411', compte_label: 'Clients', debit_xaf: 119250, credit_xaf: 0, reference_doc: 'FAC-2026-0001', created_at: '2026-03-01' },
  { id: 'e2', date: '2026-03-01', libelle: 'Vente A', compte_syscohada: '701', compte_label: 'Ventes', debit_xaf: 0, credit_xaf: 100000, reference_doc: 'FAC-2026-0001', created_at: '2026-03-01' },
  { id: 'e3', date: '2026-03-01', libelle: 'TVA Vente A', compte_syscohada: '4431', compte_label: 'TVA collectée', debit_xaf: 0, credit_xaf: 19250, reference_doc: 'FAC-2026-0001', created_at: '2026-03-01' },
  { id: 'e4', date: '2026-03-05', libelle: 'Achat fourniture', compte_syscohada: '601', compte_label: 'Achats', debit_xaf: 50000, credit_xaf: 0, reference_doc: 'CHG-CHG-01', created_at: '2026-03-05' },
  { id: 'e5', date: '2026-03-05', libelle: 'TVA déductible', compte_syscohada: '4432', compte_label: 'TVA déductible', debit_xaf: 9625, credit_xaf: 0, reference_doc: 'CHG-CHG-01', created_at: '2026-03-05' },
  { id: 'e6', date: '2026-03-05', libelle: 'Trésorerie', compte_syscohada: '521', compte_label: 'Banque', debit_xaf: 0, credit_xaf: 59625, reference_doc: 'CHG-CHG-01', created_at: '2026-03-05' },
]

beforeEach(() => { vi.clearAllMocks(); resetFromDefault() })

// ── Auth & RBAC ──────────────────────────────────────────────────────────────

describe('RBAC rapports', () => {
  it('retourne 401 sans token', async () => {
    const res = await app.request('/api/rapports/balance')
    expect(res.status).toBe(401)
  })

  it('retourne 403 pour un rôle operateur', async () => {
    const res = await app.request('/api/rapports/balance', { headers: new Headers(authHeaders('operateur')) })
    expect(res.status).toBe(403)
    const body = await res.json() as { code: string }
    expect(body.code).toBe('FORBIDDEN')
  })
})

// ── GET /grand-livre ─────────────────────────────────────────────────────────

describe('GET /api/rapports/grand-livre', () => {
  it('retourne 400 MISSING_PARAM si compte absent', async () => {
    const res = await app.request('/api/rapports/grand-livre', { headers: new Headers(authHeaders('admin')) })
    expect(res.status).toBe(400)
    const body = await res.json() as { code: string }
    expect(body.code).toBe('MISSING_PARAM')
  })

  it('retourne le grand livre avec solde progressif et totaux pour un compte', async () => {
    const lignes411 = ECRITURES.filter(e => e.compte_syscohada === '411')
    vi.mocked(supabase.from).mockReturnValueOnce(mkChain({ data: lignes411, error: null }) as never)

    const res = await app.request('/api/rapports/grand-livre?compte=411&exercice=2026', {
      headers: new Headers(authHeaders('admin')),
    })
    expect(res.status).toBe(200)
    const body = await res.json() as {
      compte: string; lignes: Array<{ solde_xaf: number }>; total_debit_xaf: number; solde_final_xaf: number
    }
    expect(body.compte).toBe('411')
    expect(body.lignes.length).toBe(1)
    expect(body.total_debit_xaf).toBe(119250)
    expect(body.solde_final_xaf).toBe(119250)
  })
})

// ── GET /balance ─────────────────────────────────────────────────────────────

describe('GET /api/rapports/balance', () => {
  it('agrège les comptes et indique l équilibre débit/crédit', async () => {
    vi.mocked(supabase.from).mockReturnValueOnce(mkChain({ data: ECRITURES, error: null }) as never)

    const res = await app.request('/api/rapports/balance?exercice=2026', {
      headers: new Headers(authHeaders('superviseur')),
    })
    expect(res.status).toBe(200)
    const body = await res.json() as {
      comptes: unknown[]; total_debit_xaf: number; total_credit_xaf: number; equilibre: boolean
    }
    // 411,701,4431,601,4432,521 = 6 comptes
    expect(body.comptes.length).toBe(6)
    expect(body.total_debit_xaf).toBe(178875)
    expect(body.total_credit_xaf).toBe(178875)
    expect(body.equilibre).toBe(true)
  })
})

// NOTE : /api/rapports/bilan et /api/rapports/resultat sont définis À LA FOIS
// dans finance.ts (monté sur /api/) et rapports.ts (monté sur /api/rapports).
// finance.ts est enregistré en premier dans app.ts → il intercepte ces deux
// chemins. Les handlers bilan/resultat de rapports.ts sont donc inatteignables
// en runtime ; on couvre ici uniquement les endpoints rapports.ts réellement
// routés (grand-livre, balance, synthese, controles, cloture, tva, etc.).

// ── GET /synthese ────────────────────────────────────────────────────────────

describe('GET /api/rapports/synthese', () => {
  it('retourne le bloc comptabilité + finance + rapprochement', async () => {
    // comptesAgreges
    vi.mocked(supabase.from).mockReturnValueOnce(mkChain({ data: ECRITURES, error: null }) as never)
    // financeAgregee
    vi.mocked(supabase.from).mockReturnValueOnce(mkChain({ data: [], error: null }) as never)

    const res = await app.request('/api/rapports/synthese?exercice=2026', {
      headers: new Headers(authHeaders('admin')),
    })
    expect(res.status).toBe(200)
    const body = await res.json() as { comptabilite: { balance_equilibree: boolean }; exports: unknown[] }
    expect(body.comptabilite.balance_equilibree).toBe(true)
    expect(body.exports.length).toBe(3)
  })
})

// ── GET /controles ───────────────────────────────────────────────────────────

describe('GET /api/rapports/controles', () => {
  it('retourne la liste des contrôles de cohérence comptable', async () => {
    // comptesAgreges
    vi.mocked(supabase.from).mockReturnValueOnce(mkChain({ data: ECRITURES, error: null }) as never)
    // financeAgregee
    vi.mocked(supabase.from).mockReturnValueOnce(mkChain({ data: [], error: null }) as never)
    // chargesAgregees → 3 requêtes Promise.all (charges, sorties, ecritures)
    vi.mocked(supabase.from).mockReturnValueOnce(mkChain({ data: [], error: null }) as never)
    vi.mocked(supabase.from).mockReturnValueOnce(mkChain({ data: [], error: null }) as never)
    vi.mocked(supabase.from).mockReturnValueOnce(mkChain({ data: ECRITURES, error: null }) as never)

    const res = await app.request('/api/rapports/controles?exercice=2026', {
      headers: new Headers(authHeaders('admin')),
    })
    expect(res.status).toBe(200)
    const body = await res.json() as { controles: Array<{ code: string }>; statut_global: string }
    expect(Array.isArray(body.controles)).toBe(true)
    expect(body.controles.some(c => c.code === 'BALANCE_EQUILIBREE')).toBe(true)
  })
})

// ── GET /cloture ─────────────────────────────────────────────────────────────

describe('GET /api/rapports/cloture', () => {
  it('retourne les étapes de pré-clôture et le statut clôturable', async () => {
    vi.mocked(supabase.from).mockReturnValueOnce(mkChain({ data: ECRITURES, error: null }) as never) // comptes
    vi.mocked(supabase.from).mockReturnValueOnce(mkChain({ data: [], error: null }) as never)         // finance
    vi.mocked(supabase.from).mockReturnValueOnce(mkChain({ data: [], error: null }) as never)         // charges
    vi.mocked(supabase.from).mockReturnValueOnce(mkChain({ data: [], error: null }) as never)         // sorties
    vi.mocked(supabase.from).mockReturnValueOnce(mkChain({ data: ECRITURES, error: null }) as never)  // ecritures

    const res = await app.request('/api/rapports/cloture?exercice=2026', {
      headers: new Headers(authHeaders('admin')),
    })
    expect(res.status).toBe(200)
    const body = await res.json() as { etapes: unknown[]; cloturable: boolean; statut: string }
    expect(Array.isArray(body.etapes)).toBe(true)
    expect(typeof body.cloturable).toBe('boolean')
  })
})

// ── GET /declarations/tva ────────────────────────────────────────────────────

describe('GET /api/rapports/declarations/tva', () => {
  it('calcule TVA collectée, déductible et nette', async () => {
    const tvaEcritures = ECRITURES.filter(e => ['4431', '4432'].includes(e.compte_syscohada))
    vi.mocked(supabase.from).mockReturnValueOnce(mkChain({ data: tvaEcritures, error: null }) as never)

    const res = await app.request('/api/rapports/declarations/tva?mois=2026-03', {
      headers: new Headers(authHeaders('admin')),
    })
    expect(res.status).toBe(200)
    const body = await res.json() as {
      tva_collectee_xaf: number; tva_deductible_xaf: number; taux_tva_pct: number; situation: string
    }
    expect(body.tva_collectee_xaf).toBe(19250)
    expect(body.tva_deductible_xaf).toBe(9625)
    expect(body.taux_tva_pct).toBe(19.25)
    expect(body.situation).toBe('à_decaisser')
  })
})

// ── GET /plan-comptable (accessible tout rôle authentifié) ────────────────────

describe('GET /api/rapports/plan-comptable', () => {
  it('retourne le plan complet pour un opérateur (pas de requireRole)', async () => {
    const res = await app.request('/api/rapports/plan-comptable', {
      headers: new Headers(authHeaders('operateur')),
    })
    expect(res.status).toBe(200)
    const body = await res.json() as { total: number; comptes: unknown[]; classes: unknown[] }
    expect(body.total).toBeGreaterThan(0)
    expect(body.classes.length).toBe(8)
  })

  it('filtre les comptes par classe', async () => {
    const res = await app.request('/api/rapports/plan-comptable?classe=4', {
      headers: new Headers(authHeaders('operateur')),
    })
    expect(res.status).toBe(200)
    const body = await res.json() as { comptes: Array<{ compte: string }> }
    expect(body.comptes.every(c => c.compte.startsWith('4'))).toBe(true)
  })
})

// ── GET /remises ─────────────────────────────────────────────────────────────

describe('GET /api/rapports/remises', () => {
  it('agrège les remises devis + commandes', async () => {
    // devis_lignes
    vi.mocked(supabase.from).mockReturnValueOnce(mkChain({
      data: [{ remise_type: 'pct', remise_valeur: 10, remise_xaf: 5000, remise_motif: 'fidélité',
               designation: 'Alu', quantite: 10, prix_unitaire_ht_xaf: 5000,
               devis: { numero: 'DEV-001', client_nom: 'X', client_id: null, date_emission: '2026-03-01' } }],
      error: null,
    }) as never)
    // commandes_lignes
    vi.mocked(supabase.from).mockReturnValueOnce(mkChain({ data: [], error: null }) as never)

    const res = await app.request('/api/rapports/remises', {
      headers: new Headers(authHeaders('admin')),
    })
    expect(res.status).toBe(200)
    const body = await res.json() as { data: unknown[]; total: number; total_remises_xaf: number }
    expect(body.total).toBe(1)
    expect(body.total_remises_xaf).toBe(5000)
  })
})

// ── GET /grand-livre.xls (export Excel) ──────────────────────────────────────

describe('GET /api/rapports/grand-livre.xls', () => {
  it('retourne un fichier Excel avec content-type ms-excel', async () => {
    vi.mocked(supabase.from).mockReturnValueOnce(
      mkChain({ data: ECRITURES.filter(e => e.compte_syscohada === '411'), error: null }) as never,
    )
    const res = await app.request('/api/rapports/grand-livre.xls?compte=411&exercice=2026', {
      headers: new Headers(authHeaders('admin')),
    })
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toContain('ms-excel')
    expect(res.headers.get('Content-Disposition')).toContain('attachment')
  })

  it('retourne 400 MISSING_PARAM si compte absent', async () => {
    const res = await app.request('/api/rapports/grand-livre.xls', {
      headers: new Headers(authHeaders('admin')),
    })
    expect(res.status).toBe(400)
  })
})
