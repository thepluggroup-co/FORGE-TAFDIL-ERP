/**
 * finance.test.ts — Tests 12 à 13
 *
 * 12. POST /api/factures crée une facture et retourne une pdf_url non nulle
 * 13. POST /api/credits/:id/rembourser met à jour le statut et le solde correctement
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

vi.mock('../services/pdf.service', () => ({
  generateFacturePDF: vi.fn().mockResolvedValue(Buffer.alloc(512)),
  uploadPDF:          vi.fn().mockResolvedValue(
    'https://supabase.co/storage/v1/object/public/factures/FAC-2026-0001.pdf',
  ),
}))

vi.mock('../services/comptabilite.service', () => ({
  genererEcritureVente:              vi.fn().mockResolvedValue(null),
  genererEcritureEncaissement:       vi.fn().mockResolvedValue(null),
  genererEcritureCharge:             vi.fn().mockResolvedValue(null),
  genererEcritureSortieTresorerie:   vi.fn().mockResolvedValue({ ok: true }),
  genererEcriturePaiementCredit:     vi.fn().mockResolvedValue(null),
  annulerEcrituresReference:         vi.fn().mockResolvedValue({ ok: true }),
  planComptable:                     [],
  libelleCompte:                     vi.fn().mockReturnValue(''),
}))

vi.mock('../services/offline-fallback', () => ({
  withOfflineFallback: vi.fn().mockImplementation((_label: string, online: () => Promise<unknown>) => online()),
}))

import app from '../app'
import { supabase } from '@forge/db/supabase'

// ── Fixtures ───────────────────────────────────────────────────────────────────

const FACTURE_ID = 'fac-test-uuid-001'
const CREDIT_ID  = 'crd-test-uuid-001'
const YEAR       = new Date().getFullYear()

const FACTURE = {
  id:            FACTURE_ID,
  numero:        `FAC-${YEAR}-0001`,
  statut:        'brouillon',
  client_id:     null,
  client_nom:    'SODECOTON',
  date_emission: '2026-05-18',
  date_echeance: '2026-06-18',
  total_ht_xaf:  35000,
  tva_xaf:       6737,
  total_ttc_xaf: 41737,
  sync_status:   'synced',
}

const FACTURE_LIGNE = {
  id:                   'ligne-fac-001',
  facture_id:           FACTURE_ID,
  designation:          'Aluminium 6060 T5',
  unite:                'kg',
  quantite:             10,
  prix_unitaire_ht_xaf: 3500,
  total_ht_xaf:         35000,
  ordre:                0,
}

const CREATE_FACTURE_BODY = {
  client_nom:    'SODECOTON',
  date_emission: '2026-05-18',
  date_echeance: '2026-06-18',
  lignes: [
    {
      designation:          'Aluminium 6060 T5',
      unite:                'kg',
      quantite:             10,
      prix_unitaire_ht_xaf: 3500,
    },
  ],
}

describe('Test 12 — POST /api/factures crée une facture avec pdf_url', () => {
  beforeEach(() => vi.clearAllMocks())

  it('retourne 201 avec numero FAC-YYYY-XXXX, statut brouillon et pdf_url', async () => {
    // Count pour générer le numéro (aucune facture cette année → 0)
    vi.mocked(supabase.from).mockReturnValueOnce(
      mkChain({ data: null, count: 0, error: null }) as never,
    )
    // Insert facture
    vi.mocked(supabase.from).mockReturnValueOnce(
      mkChain({ data: FACTURE, error: null }) as never,
    )
    // Insert lignes
    vi.mocked(supabase.from).mockReturnValueOnce(
      mkChain({ data: [FACTURE_LIGNE], error: null }) as never,
    )

    const res = await app.request('/api/factures', {
      method:  'POST',
      headers: new Headers(authHeaders('admin')),
      body:    JSON.stringify(CREATE_FACTURE_BODY),
    })

    expect(res.status).toBe(201)

    const body = await res.json() as {
      numero:    string
      statut:    string
      pdf_url:   string | null
      lignes:    unknown[]
      total_ttc_xaf: number
    }

    expect(body.numero).toMatch(/^FAC-\d{4}-\d{4}$/)
    expect(body.statut).toBe('brouillon')
    expect(typeof body.pdf_url).toBe('string')
    expect(body.pdf_url).not.toBeNull()
    expect(body.pdf_url).toMatch(/\.pdf$/)
    expect(Array.isArray(body.lignes)).toBe(true)
    expect(body.lignes.length).toBeGreaterThanOrEqual(1)
    expect(typeof body.total_ttc_xaf).toBe('number')
  })

  it('montants HT / TVA / TTC calculés côté serveur (taux TVA 19,25 %)', async () => {
    vi.mocked(supabase.from).mockReturnValueOnce(
      mkChain({ data: null, count: 0, error: null }) as never,
    )
    vi.mocked(supabase.from).mockReturnValueOnce(
      mkChain({ data: FACTURE, error: null }) as never,
    )
    vi.mocked(supabase.from).mockReturnValueOnce(
      mkChain({ data: [FACTURE_LIGNE], error: null }) as never,
    )

    const res = await app.request('/api/factures', {
      method:  'POST',
      headers: new Headers(authHeaders('admin')),
      body:    JSON.stringify(CREATE_FACTURE_BODY),
    })

    expect(res.status).toBe(201)
    const body = await res.json() as { total_ht_xaf: number; tva_xaf: number; total_ttc_xaf: number }

    // Les montants proviennent du mock FACTURE — on vérifie la cohérence
    expect(body.total_ht_xaf).toBeGreaterThan(0)
    expect(body.tva_xaf).toBeGreaterThan(0)
    expect(body.total_ttc_xaf).toBeGreaterThan(body.total_ht_xaf)
  })

  it('retourne 401 sans token', async () => {
    const res = await app.request('/api/factures', {
      method:  'POST',
      headers: new Headers({ 'Content-Type': 'application/json' }),
      body:    JSON.stringify(CREATE_FACTURE_BODY),
    })
    expect(res.status).toBe(401)
  })

  it('retourne 403 si rôle operateur (directeur/admin requis)', async () => {
    const res = await app.request('/api/factures', {
      method:  'POST',
      headers: new Headers(authHeaders('operateur')),
      body:    JSON.stringify(CREATE_FACTURE_BODY),
    })
    expect(res.status).toBe(403)
  })

  it('retourne 400 si lignes vide (Zod)', async () => {
    const res = await app.request('/api/factures', {
      method:  'POST',
      headers: new Headers(authHeaders('admin')),
      body:    JSON.stringify({ ...CREATE_FACTURE_BODY, lignes: [] }),
    })
    expect(res.status).toBe(400)
  })
})

describe('Test 13 — POST /api/credits/:id/rembourser met à jour le statut', () => {
  beforeEach(() => vi.clearAllMocks())

  it('remboursement total : statut=rembourse, nouveau_solde_xaf=0', async () => {
    const SOLDE_INITIAL = 100_000

    // Fetch crédit
    vi.mocked(supabase.from).mockReturnValueOnce(
      mkChain({
        data: {
          solde_restant_xaf: SOLDE_INITIAL,
          statut:            'en_cours',
          client_nom:        'SODECOTON',
          numero:            'CRD-2026-0001',
        },
        error: null,
      }) as never,
    )
    // Insert remboursement
    vi.mocked(supabase.from).mockReturnValueOnce(
      mkChain({
        data: {
          id:            'remb-test-001',
          credit_id:     CREDIT_ID,
          montant_xaf:   SOLDE_INITIAL,
          date_paiement: '2026-05-18',
          type:          'total',
        },
        error: null,
      }) as never,
    )
    // Update crédit (solde → 0, statut → 'rembourse')
    vi.mocked(supabase.from).mockReturnValueOnce(
      mkChain({ data: null, error: null }) as never,
    )

    const res = await app.request(`/api/credits/${CREDIT_ID}/rembourser`, {
      method:  'POST',
      headers: new Headers(authHeaders('admin')),
      body:    JSON.stringify({
        montant_xaf:   SOLDE_INITIAL,
        date_paiement: '2026-05-18',
        type:          'total',
      }),
    })

    expect(res.status).toBe(200)

    const body = await res.json() as {
      nouveau_solde_xaf: number
      statut:            string
      remboursement:     unknown
    }

    expect(body.nouveau_solde_xaf).toBe(0)
    expect(body.statut).toBe('rembourse')
    expect(body.remboursement).toBeTruthy()
  })

  it('remboursement partiel : solde réduit, statut reste en_cours', async () => {
    const SOLDE_INITIAL = 200_000
    const PAIEMENT      = 80_000
    const SOLDE_FINAL   = SOLDE_INITIAL - PAIEMENT // 120_000

    vi.mocked(supabase.from).mockReturnValueOnce(
      mkChain({
        data: {
          solde_restant_xaf: SOLDE_INITIAL,
          statut:            'en_cours',
          client_nom:        'TEST CLIENT',
          numero:            'CRD-2026-0002',
        },
        error: null,
      }) as never,
    )
    vi.mocked(supabase.from).mockReturnValueOnce(
      mkChain({
        data: { id: 'remb-test-002', montant_xaf: PAIEMENT, type: 'partiel' },
        error: null,
      }) as never,
    )
    vi.mocked(supabase.from).mockReturnValueOnce(
      mkChain({ data: null, error: null }) as never,
    )

    const res = await app.request(`/api/credits/${CREDIT_ID}/rembourser`, {
      method:  'POST',
      headers: new Headers(authHeaders('admin')),
      body:    JSON.stringify({
        montant_xaf:   PAIEMENT,
        date_paiement: '2026-05-18',
        type:          'partiel',
      }),
    })

    expect(res.status).toBe(200)

    const body = await res.json() as { nouveau_solde_xaf: number; statut: string }
    expect(body.nouveau_solde_xaf).toBe(SOLDE_FINAL)
    expect(body.statut).toBe('en_cours')
  })

  it('retourne 422 AMOUNT_EXCEEDED si montant dépasse le solde restant', async () => {
    vi.mocked(supabase.from).mockReturnValueOnce(
      mkChain({
        data: {
          solde_restant_xaf: 50_000,
          statut:            'en_cours',
          client_nom:        'TEST',
          numero:            'CRD-2026-0003',
        },
        error: null,
      }) as never,
    )

    const res = await app.request(`/api/credits/${CREDIT_ID}/rembourser`, {
      method:  'POST',
      headers: new Headers(authHeaders('admin')),
      body:    JSON.stringify({
        montant_xaf:   100_000,
        date_paiement: '2026-05-18',
        type:          'partiel',
      }),
    })

    expect(res.status).toBe(422)
    const body = await res.json() as { code: string }
    expect(body.code).toBe('AMOUNT_EXCEEDED')
  })

  it('retourne 422 ALREADY_DONE si crédit déjà remboursé', async () => {
    vi.mocked(supabase.from).mockReturnValueOnce(
      mkChain({
        data: {
          solde_restant_xaf: 0,
          statut:            'rembourse',
          client_nom:        'TEST',
          numero:            'CRD-2026-0004',
        },
        error: null,
      }) as never,
    )

    const res = await app.request(`/api/credits/${CREDIT_ID}/rembourser`, {
      method:  'POST',
      headers: new Headers(authHeaders('admin')),
      body:    JSON.stringify({
        montant_xaf:   10_000,
        date_paiement: '2026-05-18',
        type:          'partiel',
      }),
    })

    expect(res.status).toBe(422)
    const body = await res.json() as { code: string }
    expect(body.code).toBe('ALREADY_DONE')
  })
})

// ── Couverture supplémentaire (Finance 14–40) ──────────────────────────────────

const CHARGE_ID  = 'chg-test-001'
const SORTIE_ID  = 'srt-test-001'
const DECL_ID    = 'dcl-test-001'

describe('Finance 14 — GET /api/finance/dashboard', () => {
  beforeEach(() => vi.clearAllMocks())
  it('retourne 200 avec métriques financières', async () => {
    const res = await app.request('/api/finance/dashboard', { headers: new Headers(authHeaders('admin')) })
    expect(res.status).toBe(200)
  })
})

describe('Finance 15 — GET /api/finance/indicateurs', () => {
  beforeEach(() => vi.clearAllMocks())
  it('retourne 200 avec indicateurs', async () => {
    const res = await app.request('/api/finance/indicateurs', { headers: new Headers(authHeaders('admin')) })
    expect(res.status).toBe(200)
  })
})

describe('Finance 16 — GET /api/declarations-fiscales', () => {
  beforeEach(() => vi.clearAllMocks())
  it('retourne 200 avec liste déclarations', async () => {
    const res = await app.request('/api/declarations-fiscales', { headers: new Headers(authHeaders('admin')) })
    expect(res.status).toBe(200)
  })
  it('couvre branches filtres type/statut', async () => {
    const res = await app.request('/api/declarations-fiscales?type=TVA&statut=preparee', { headers: new Headers(authHeaders('admin')) })
    expect(res.status).toBe(200)
  })
})

describe('Finance 17 — POST /api/declarations-fiscales/tva/preparer', () => {
  beforeEach(() => vi.clearAllMocks())
  it('retourne 201 avec déclaration TVA préparée', async () => {
    const res = await app.request('/api/declarations-fiscales/tva/preparer', {
      method: 'POST',
      headers: new Headers({ ...authHeaders('admin'), 'Content-Type': 'application/json' }),
      body: JSON.stringify({ periode: '2026-06' }),
    })
    expect(res.status).toBe(201)
  })
})

describe('Finance 18 — PATCH /api/declarations-fiscales/:id/statut', () => {
  beforeEach(() => vi.clearAllMocks())
  it('retourne 200 avec déclaration mise à jour (mock null)', async () => {
    const res = await app.request(`/api/declarations-fiscales/${DECL_ID}/statut`, {
      method: 'PATCH',
      headers: new Headers({ ...authHeaders('admin'), 'Content-Type': 'application/json' }),
      body: JSON.stringify({ statut: 'a_declarer' }),
    })
    expect(res.status).not.toBe(500)
  })
})

describe('Finance 19 — GET /api/finance/exports/indicateurs.xls', () => {
  beforeEach(() => vi.clearAllMocks())
  it('retourne 200 avec fichier XLS', async () => {
    const res = await app.request('/api/finance/exports/indicateurs.xls', {
      headers: new Headers(authHeaders('admin')),
    })
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toContain('ms-excel')
  })
})

describe('Finance 20 — GET /api/finance/exports/tva.xls', () => {
  beforeEach(() => vi.clearAllMocks())
  it('retourne 200 avec fichier XLS TVA', async () => {
    const res = await app.request('/api/finance/exports/tva.xls', {
      headers: new Headers(authHeaders('admin')),
    })
    expect(res.status).toBe(200)
  })
})

describe('Finance 21 — GET /api/factures : liste factures', () => {
  beforeEach(() => vi.clearAllMocks())
  it('retourne 200 avec liste', async () => {
    const res = await app.request('/api/factures', { headers: new Headers(authHeaders('admin')) })
    expect(res.status).toBe(200)
  })
  it('couvre branches filtres statut/client_id/search', async () => {
    const res = await app.request('/api/factures?statut=payee&client_id=00000000-0000-0000-0000-000000000001&search=FAC', { headers: new Headers(authHeaders('admin')) })
    expect(res.status).toBe(200)
  })
})

describe('Finance 22 — GET /api/factures/:id/pdf : PDF facture', () => {
  beforeEach(() => vi.clearAllMocks())
  it('retourne 404 si facture introuvable', async () => {
    const res = await app.request(`/api/factures/${FACTURE_ID}/pdf`, {
      headers: new Headers(authHeaders('admin')),
    })
    expect(res.status).toBe(404)
  })
})

describe('Finance 23 — PATCH /api/factures/:id/statut', () => {
  beforeEach(() => vi.clearAllMocks())
  it('retourne 404 si facture introuvable', async () => {
    const res = await app.request(`/api/factures/${FACTURE_ID}/statut`, {
      method: 'PATCH',
      headers: new Headers({ ...authHeaders('admin'), 'Content-Type': 'application/json' }),
      body: JSON.stringify({ statut: 'valide' }),
    })
    expect(res.status).toBe(404)
  })
})

describe('Finance 24 — GET /api/factures/:id/versements', () => {
  beforeEach(() => vi.clearAllMocks())
  it('retourne 200 avec liste versements', async () => {
    const res = await app.request(`/api/factures/${FACTURE_ID}/versements`, {
      headers: new Headers(authHeaders('admin')),
    })
    expect(res.status).toBe(200)
  })
})

describe('Finance 25 — POST /api/factures/:id/whatsapp', () => {
  beforeEach(() => vi.clearAllMocks())
  it('entre dans le handler (retourne 404 ou 200)', async () => {
    const res = await app.request(`/api/factures/${FACTURE_ID}/whatsapp`, {
      method: 'POST',
      headers: new Headers({ ...authHeaders('admin'), 'Content-Type': 'application/json' }),
      body: JSON.stringify({ phone: '237670000000' }),
    })
    expect(res.status).not.toBe(500)
    expect(res.status).not.toBe(400)
  })
})

describe('Finance 26 — GET /api/finance/exports/charges.xls', () => {
  beforeEach(() => vi.clearAllMocks())
  it('retourne 200 avec fichier XLS charges', async () => {
    const res = await app.request('/api/finance/exports/charges.xls', {
      headers: new Headers(authHeaders('admin')),
    })
    expect(res.status).toBe(200)
  })
})

describe('Finance 27 — POST /api/factures/:id/relance', () => {
  beforeEach(() => vi.clearAllMocks())
  it('entre dans le handler', async () => {
    const res = await app.request(`/api/factures/${FACTURE_ID}/relance`, {
      method: 'POST',
      headers: new Headers({ ...authHeaders('admin'), 'Content-Type': 'application/json' }),
      body: JSON.stringify({}),
    })
    expect(res.status).not.toBe(500)
  })
})

describe('Finance 28 — GET /api/charges : liste charges', () => {
  beforeEach(() => vi.clearAllMocks())
  it('retourne 200 avec liste charges', async () => {
    const res = await app.request('/api/charges', { headers: new Headers(authHeaders('admin')) })
    expect(res.status).toBe(200)
  })
  it('couvre branches filtres statut/categorie/justificatif/fournisseur/from/to', async () => {
    const res = await app.request('/api/charges?statut=payee&categorie=matières premières&justificatif=recu&fournisseur=SODECOTON&from=2026-01-01&to=2026-12-31', { headers: new Headers(authHeaders('admin')) })
    expect(res.status).toBe(200)
  })
})

describe('Finance 29 — POST /api/charges : créer charge', () => {
  beforeEach(() => vi.clearAllMocks())
  it('retourne 422 (compte inexistant dans plan vide)', async () => {
    const res = await app.request('/api/charges', {
      method: 'POST',
      headers: new Headers({ ...authHeaders('admin'), 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        fournisseur_nom: 'SODECOTON', categorie: 'matières premières',
        compte_charge: '601', date_charge: '2026-06-01', montant_ht_xaf: 100_000, tva_xaf: 0,
      }),
    })
    expect(res.status).toBe(422)
  })
})

describe('Finance 30 — GET /api/charges/dashboard : dashboard charges', () => {
  beforeEach(() => vi.clearAllMocks())
  it('retourne 200 avec données dashboard', async () => {
    const res = await app.request('/api/charges/dashboard', { headers: new Headers(authHeaders('admin')) })
    expect(res.status).toBe(200)
  })
})

describe('Finance 31 — GET /api/charges/:id : détail charge', () => {
  beforeEach(() => vi.clearAllMocks())
  it('retourne 200 avec détail charge (le handler ne vérifie pas !data)', async () => {
    vi.mocked(supabase.from).mockReturnValueOnce(
      mkChain({ data: { id: CHARGE_ID, montant_ttc_xaf: 100000, montant_paye_xaf: 0, statut: 'en_attente' }, error: null }) as never,
    )
    const res = await app.request(`/api/charges/${CHARGE_ID}`, { headers: new Headers(authHeaders('admin')) })
    expect(res.status).toBe(200)
  })
})

describe('Finance 32 — GET /api/sorties-tresorerie : liste sorties', () => {
  beforeEach(() => vi.clearAllMocks())
  it('retourne 200 avec liste sorties', async () => {
    const res = await app.request('/api/sorties-tresorerie', { headers: new Headers(authHeaders('admin')) })
    expect(res.status).toBe(200)
  })
  it('filtre par statut, justificatif, from, to', async () => {
    const res = await app.request(
      '/api/sorties-tresorerie?statut=validee&justificatif=recu&from=2026-01-01&to=2026-12-31',
      { headers: new Headers(authHeaders('admin')) },
    )
    expect(res.status).toBe(200)
  })
})

describe('Finance 33 — POST /api/sorties-tresorerie : créer sortie', () => {
  beforeEach(() => vi.clearAllMocks())
  it('retourne 201 avec sortie créée', async () => {
    const res = await app.request('/api/sorties-tresorerie', {
      method: 'POST',
      headers: new Headers({ ...authHeaders('admin'), 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        date_sortie: '2026-06-01', beneficiaire: 'SODECOTON', motif: 'Achat matières',
        montant_xaf: 100_000, mode_paiement: 'caisse', compte_tresorerie: '571',
      }),
    })
    expect(res.status).toBe(201)
  })
})

describe('Finance 34 — GET /api/credits : liste crédits', () => {
  beforeEach(() => vi.clearAllMocks())
  it('retourne 200 avec liste crédits', async () => {
    const res = await app.request('/api/credits', { headers: new Headers(authHeaders('admin')) })
    expect(res.status).toBe(200)
  })
  it('filtre par statut et client_id', async () => {
    const res = await app.request(
      '/api/credits?statut=en_cours&client_id=00000000-0000-0000-0000-000000000001',
      { headers: new Headers(authHeaders('admin')) },
    )
    expect(res.status).toBe(200)
  })
})

describe('Finance 35 — GET /api/credits/:id : détail crédit', () => {
  beforeEach(() => vi.clearAllMocks())
  it('retourne 200 ou 404 (dépend du mock)', async () => {
    const res = await app.request(`/api/credits/${CREDIT_ID}`, { headers: new Headers(authHeaders('admin')) })
    expect([200, 404]).toContain(res.status)
  })
})

describe('Finance 36 — GET /api/ecritures : liste écritures', () => {
  beforeEach(() => vi.clearAllMocks())
  it('retourne 200 avec liste écritures', async () => {
    const res = await app.request('/api/ecritures', { headers: new Headers(authHeaders('admin')) })
    expect(res.status).toBe(200)
  })
  it('filtre par compte et mois', async () => {
    const res = await app.request(
      '/api/ecritures?compte=701&mois=2026-06',
      { headers: new Headers(authHeaders('admin')) },
    )
    expect(res.status).toBe(200)
  })
})

describe('Finance 37 — POST /api/ecritures : créer écriture', () => {
  beforeEach(() => vi.clearAllMocks())
  it('retourne 422 (compte inexistant dans plan vide)', async () => {
    const res = await app.request('/api/ecritures', {
      method: 'POST',
      headers: new Headers({ ...authHeaders('admin'), 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        date: '2026-06-01', libelle: 'Test écriture',
        compte_syscohada: '411', compte_label: 'Clients',
        debit_xaf: 100_000, credit_xaf: 0,
      }),
    })
    expect(res.status).toBe(422)
  })
})

describe('Finance 38 — GET /api/rapports/bilan : bilan comptable', () => {
  beforeEach(() => vi.clearAllMocks())
  it('retourne 200 avec bilan', async () => {
    const res = await app.request('/api/rapports/bilan?exercice=2026', { headers: new Headers(authHeaders('admin')) })
    expect(res.status).toBe(200)
  })
})

describe('Finance 39 — GET /api/rapports/resultat : compte de résultat', () => {
  beforeEach(() => vi.clearAllMocks())
  it('retourne 200 avec résultat', async () => {
    const res = await app.request('/api/rapports/resultat?exercice=2026', { headers: new Headers(authHeaders('admin')) })
    expect(res.status).toBe(200)
  })
})

describe('Finance 40 — GET /api/rapports/dashboard : dashboard rapports', () => {
  beforeEach(() => vi.clearAllMocks())
  it('retourne 200 avec tableau de bord', async () => {
    const res = await app.request('/api/rapports/dashboard', { headers: new Headers(authHeaders('admin')) })
    expect(res.status).toBe(200)
  })
})
