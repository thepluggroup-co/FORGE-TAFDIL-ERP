/**
 * caisse.test.ts
 *
 * Cas obligatoire (PROMPT 3) : envoyer 2 fois le même op_id sur
 * POST /api/caisse/tickets → un seul décrément de stock (idempotence).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mkChain, authHeaders } from './helpers'

vi.mock('@forge/db/supabase', () => {
  const safeChain = () => {
    const c: Record<string, unknown> = {}
    for (const m of ['select', 'insert', 'update', 'delete', 'upsert', 'eq', 'neq', 'in',
      'or', 'gte', 'lte', 'lt', 'gt', 'not', 'ilike', 'like', 'order', 'range', 'limit', 'head', 'filter'])
      c[m] = vi.fn().mockReturnValue(c)
    c['single']      = vi.fn().mockResolvedValue({ data: null, error: null })
    c['maybeSingle'] = vi.fn().mockResolvedValue({ data: null, error: null })
    c['then']        = (res: (v: unknown) => unknown) =>
      Promise.resolve({ data: [], count: 0, error: null }).then(res)
    return c
  }
  const mockClient = {
    from:          vi.fn().mockImplementation(safeChain),
    rpc:           vi.fn().mockResolvedValue({ data: { success: true, oversell: false }, error: null }),
    channel:       vi.fn(() => ({ send: vi.fn().mockResolvedValue('ok') })),
    removeChannel: vi.fn(),
  }
  return { supabase: mockClient, supabaseAdmin: mockClient }
})

// rbacService fait un fetch réseau vers Supabase pour charger les permissions —
// on le mocke pour que CAISSIER/admin passent toujours requirePermission('CAISSE', ...).
vi.mock('../services/rbacService', () => ({
  checkPermission: vi.fn().mockResolvedValue({ allowed: true, roleName: 'CAISSIER' }),
  CAISSIER_REMISE_MAX_PCT: 5,
}))

vi.mock('../services/stock-alerts.service', () => ({
  creerBonApprovisionnementSiNecessaire: vi.fn().mockResolvedValue({ created: false }),
}))

import app from '../app'
import { supabase } from '@forge/db/supabase'

// zValidator exige des UUID valides pour session_id/produit_id/client_id.
const SESSION_ID  = '11111111-1111-4111-8111-111111111111'
const PRODUIT_ID  = '22222222-2222-4222-8222-222222222222'
const TICKET_ID   = '33333333-3333-4333-8333-333333333333'
const CAISSIER_ID = 'test-user-uid-001'
const OP_ID       = 'op-idempotence-test-001'
const YEAR        = new Date().getFullYear()

const SESSION_OUVERTE = {
  id: SESSION_ID, caissier_id: CAISSIER_ID, statut: 'ouverte',
}

const TICKET_PAYLOAD = {
  op_id:      OP_ID,
  session_id: SESSION_ID,
  lignes: [
    { produit_id: PRODUIT_ID, designation: 'Fer plat 40x5', unite: 'pièce', quantite: 2, prix_unitaire_xaf: 5000 },
  ],
  // total_ht = 10000, TVA désactivée (TVA_RATE=0), total_ttc = 10000
  paiements: [
    { mode: 'espece', montant_xaf: 10000, montant_recu_xaf: 10000 },
  ],
}

const TICKET_CREE = {
  id: TICKET_ID,
  op_id: OP_ID,
  numero_facture: `TCK-${YEAR}-0001`,
  session_id: SESSION_ID,
  caissier_id: CAISSIER_ID,
  total_ht_xaf: 10000,
  tva_xaf: 0,
  total_ttc_xaf: 10000,
  remise_xaf: 0,
  statut: 'paye',
  oversell: false,
  created_at: '2026-08-18T10:00:00.000Z',
}

describe('POST /api/caisse/tickets — idempotence op_id', () => {
  beforeEach(() => vi.clearAllMocks())

  it('1er appel : crée le ticket ET décrémente le stock (1 appel RPC)', async () => {
    // Séquençage précis des appels .from() dans l'ordre d'exécution de la route :
    // tickets_vente (idempotence check) → caisse_sessions (lookup session) →
    // tickets_vente (genererNumeroTicket — count) → tickets_vente (insert) →
    // lignes_ticket (insert) → paiements_ticket (insert)
    const fromMock = vi.mocked(supabase.from)
    fromMock
      .mockReturnValueOnce(mkChain({ data: null, error: null }) as never)                 // idempotence check
      .mockReturnValueOnce(mkChain({ data: SESSION_OUVERTE, error: null }) as never)       // session lookup
      .mockReturnValueOnce(mkChain({ data: null, count: 0, error: null }) as never)        // genererNumeroTicket
      .mockReturnValueOnce(mkChain({ data: TICKET_CREE, error: null }) as never)           // insert ticket
      .mockReturnValueOnce(mkChain({ data: null, error: null }) as never)                  // insert lignes
      .mockReturnValueOnce(mkChain({ data: null, error: null }) as never)                  // insert paiements

    const res = await app.request('/api/caisse/tickets', {
      method:  'POST',
      headers: new Headers(authHeaders('admin', CAISSIER_ID)),
      body:    JSON.stringify(TICKET_PAYLOAD),
    })

    expect(res.status).toBe(201)
    const body = await res.json() as { id: string; numero_facture: string; oversell: boolean }
    expect(body.id).toBe(TICKET_ID)
    expect(body.numero_facture).toBe(`TCK-${YEAR}-0001`)

    // Le décrément de stock passe par le RPC fn_mouvement_stock_vente — une
    // seule ligne avec produit_id dans ce ticket → un seul appel RPC.
    expect(supabase.rpc).toHaveBeenCalledTimes(1)
    expect(supabase.rpc).toHaveBeenCalledWith('fn_mouvement_stock_vente', expect.objectContaining({
      p_produit_id: PRODUIT_ID,
      p_quantite:   2,
    }))

    // Intégration comptabilité (genererEcritureVenteCaisse) — non bloquante,
    // mais bien tentée avant de répondre : au moins un accès à ecritures_comptables.
    expect(fromMock.mock.calls.some(([table]) => table === 'ecritures_comptables')).toBe(true)
  })

  it('2e appel avec le MÊME op_id : renvoie le ticket existant (200) SANS nouveau décrément de stock', async () => {
    const fromMock = vi.mocked(supabase.from)
    fromMock.mockImplementation((table: string) => {
      // Le check d'idempotence trouve directement le ticket déjà créé.
      if (table === 'tickets_vente') return mkChain({ data: TICKET_CREE, error: null }) as never
      if (table === 'lignes_ticket')   return mkChain({ data: [], error: null }) as never
      if (table === 'paiements_ticket') return mkChain({ data: [], error: null }) as never
      return mkChain({ data: null, error: null }) as never
    })

    const res = await app.request('/api/caisse/tickets', {
      method:  'POST',
      headers: new Headers(authHeaders('admin', CAISSIER_ID)),
      body:    JSON.stringify(TICKET_PAYLOAD),
    })

    expect(res.status).toBe(200)
    const body = await res.json() as { id: string; idempotent: boolean }
    expect(body.id).toBe(TICKET_ID)
    expect(body.idempotent).toBe(true)

    // AUCUN appel RPC — le stock n'a pas été re-décrémenté.
    expect(supabase.rpc).not.toHaveBeenCalled()
  })

  it('scénario complet : 2 POST identiques → un seul décrément net de stock au total', async () => {
    const fromMock = vi.mocked(supabase.from)

    // Appel 1 : création complète.
    fromMock
      .mockReturnValueOnce(mkChain({ data: null, error: null }) as never)
      .mockReturnValueOnce(mkChain({ data: SESSION_OUVERTE, error: null }) as never)
      .mockReturnValueOnce(mkChain({ data: null, count: 0, error: null }) as never)
      .mockReturnValueOnce(mkChain({ data: TICKET_CREE, error: null }) as never)
      .mockReturnValueOnce(mkChain({ data: null, error: null }) as never)
      .mockReturnValueOnce(mkChain({ data: null, error: null }) as never)

    const res1 = await app.request('/api/caisse/tickets', {
      method: 'POST', headers: new Headers(authHeaders('admin', CAISSIER_ID)), body: JSON.stringify(TICKET_PAYLOAD),
    })
    expect(res1.status).toBe(201)
    expect(supabase.rpc).toHaveBeenCalledTimes(1)

    // Appel 2 : même op_id, retrouvé dès le check d'idempotence.
    fromMock.mockReset()
    fromMock.mockImplementation((table: string) => {
      if (table === 'tickets_vente')   return mkChain({ data: TICKET_CREE, error: null }) as never
      if (table === 'lignes_ticket')   return mkChain({ data: [], error: null }) as never
      if (table === 'paiements_ticket') return mkChain({ data: [], error: null }) as never
      return mkChain({ data: null, error: null }) as never
    })

    const res2 = await app.request('/api/caisse/tickets', {
      method: 'POST', headers: new Headers(authHeaders('admin', CAISSIER_ID)), body: JSON.stringify(TICKET_PAYLOAD),
    })
    expect(res2.status).toBe(200)

    // Total sur les 2 appels : toujours 1 seul appel RPC cumulé → 1 seul décrément.
    expect(supabase.rpc).toHaveBeenCalledTimes(1)
  })
})
