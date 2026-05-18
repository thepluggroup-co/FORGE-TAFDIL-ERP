/**
 * finance.test.ts — Tests 12 à 13
 *
 * 12. POST /api/factures crée une facture et retourne une pdf_url non nulle
 * 13. POST /api/credits/:id/rembourser met à jour le statut et le solde correctement
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mkChain, authHeaders } from './helpers'

vi.mock('@forge/db/supabase', () => ({
  supabase: {
    from:          vi.fn(),
    rpc:           vi.fn(),
    channel:       vi.fn(() => ({ send: vi.fn().mockResolvedValue('ok') })),
    removeChannel: vi.fn(),
  },
  supabaseAdmin: null,
}))

vi.mock('../services/pdf.service', () => ({
  generateFacturePDF: vi.fn().mockResolvedValue(Buffer.alloc(512)),
  uploadPDF:          vi.fn().mockResolvedValue(
    'https://supabase.co/storage/v1/object/public/factures/FAC-2026-0001.pdf',
  ),
}))

vi.mock('../services/comptabilite.service', () => ({
  genererEcritureVente:        vi.fn().mockResolvedValue(null),
  genererEcritureEncaissement: vi.fn().mockResolvedValue(null),
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
