/**
 * caisse-credit.service.test.ts — score de fiabilité crédit comptoir.
 *
 * Couvre verifierEligibiliteCreditCaisse (client introuvable, blocage actif,
 * blocage expiré/reset, score insuffisant, éligible), penaliserRetardCaisse
 * (pénalité simple, pénalité → blocage, client absent) et
 * checkOverdueCaisseCredits (erreur lecture, aucune échéance, échec update
 * ligne, vente anonyme, pénalité qui bloque).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@forge/db', () => ({
  supabaseAdmin: { from: vi.fn() },
}))

import { supabaseAdmin } from '@forge/db'
import {
  verifierEligibiliteCreditCaisse,
  penaliserRetardCaisse,
  checkOverdueCaisseCredits,
  SCORE_INITIAL,
  SCORE_SEUIL_BLOCAGE,
} from '../services/caisse-credit.service'

type MockFn = ReturnType<typeof vi.fn>
const db = supabaseAdmin as unknown as { from: MockFn }

function makeThenable(response: unknown) {
  const builder: Record<string, unknown> = {}
  const chain = () => builder
  Object.assign(builder, {
    select: chain, eq: chain, in: chain, neq: chain, order: chain, lt: chain,
    update: chain, insert: chain, upsert: chain, delete: chain,
    single: () => Promise.resolve(response),
    maybeSingle: () => Promise.resolve(response),
    then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve(response).then(resolve, reject),
  })
  return builder
}

function mockFrom(responses: Record<string, unknown>) {
  db.from.mockImplementation((table: string) => makeThenable(responses[table] ?? { data: null, error: null }))
}

describe('caisse-credit.service', () => {
  beforeEach(() => vi.clearAllMocks())

  describe('verifierEligibiliteCreditCaisse', () => {
    it('client introuvable : refuse avec raison explicite', async () => {
      mockFrom({ clients: { data: null, error: { message: 'not found' } } })
      const res = await verifierEligibiliteCreditCaisse('client-x')
      expect(res).toEqual({ eligible: false, raison: 'Client introuvable' })
    })

    it('blocage actif (date future) : refuse en citant la date limite', async () => {
      const future = new Date(Date.now() + 10 * 86_400_000).toISOString()
      mockFrom({
        clients: { data: { score_fiabilite_caisse: 2, credit_caisse_bloque_jusqu_au: future }, error: null },
      })
      const res = await verifierEligibiliteCreditCaisse('client-1')
      expect(res.eligible).toBe(false)
      expect(res.score).toBe(2)
      expect(res.raison).toContain('bloqué jusqu')
    })

    it('blocage expiré : remet le score à SCORE_INITIAL et redevient éligible', async () => {
      const past = new Date(Date.now() - 1 * 86_400_000).toISOString()
      mockFrom({
        clients: { data: { score_fiabilite_caisse: 2, credit_caisse_bloque_jusqu_au: past }, error: null },
      })
      const res = await verifierEligibiliteCreditCaisse('client-1')
      expect(res).toEqual({ eligible: true, score: SCORE_INITIAL })
    })

    it('score sous le seuil, pas de blocage enregistré : refuse', async () => {
      mockFrom({
        clients: { data: { score_fiabilite_caisse: 4, credit_caisse_bloque_jusqu_au: null }, error: null },
      })
      const res = await verifierEligibiliteCreditCaisse('client-1')
      expect(res.eligible).toBe(false)
      expect(res.raison).toContain('insuffisant')
      expect(res.score).toBe(4)
    })

    it('score suffisant, pas de blocage : éligible', async () => {
      mockFrom({
        clients: { data: { score_fiabilite_caisse: 8, credit_caisse_bloque_jusqu_au: null }, error: null },
      })
      const res = await verifierEligibiliteCreditCaisse('client-1')
      expect(res).toEqual({ eligible: true, score: 8 })
    })
  })

  describe('penaliserRetardCaisse', () => {
    it('pénalité simple : décrémente le score sans bloquer', async () => {
      mockFrom({ clients: { data: { score_fiabilite_caisse: 10 }, error: null } })
      const res = await penaliserRetardCaisse('client-1', 'FAC-001')
      expect(res).toEqual({ nouveauScore: 9, bloque: false })
    })

    it('pénalité qui fait tomber sous le seuil : bloque le client', async () => {
      mockFrom({ clients: { data: { score_fiabilite_caisse: SCORE_SEUIL_BLOCAGE }, error: null } })
      const res = await penaliserRetardCaisse('client-1')
      expect(res.nouveauScore).toBe(SCORE_SEUIL_BLOCAGE - 1)
      expect(res.bloque).toBe(true)
    })

    it('le score ne descend jamais sous 0', async () => {
      mockFrom({ clients: { data: { score_fiabilite_caisse: 0 }, error: null } })
      const res = await penaliserRetardCaisse('client-1')
      expect(res.nouveauScore).toBe(0)
      expect(res.bloque).toBe(true)
    })

    it('client absent : part de SCORE_INITIAL par défaut', async () => {
      mockFrom({ clients: { data: null, error: null } })
      const res = await penaliserRetardCaisse('client-1')
      expect(res.nouveauScore).toBe(SCORE_INITIAL - 1)
    })
  })

  describe('checkOverdueCaisseCredits', () => {
    it('erreur de lecture des échéances : retourne l\'erreur sans planter', async () => {
      mockFrom({ paiements_ticket: { data: null, error: { message: 'table absente' } } })
      const res = await checkOverdueCaisseCredits()
      expect(res).toEqual({ marked: 0, blocked: 0, errors: ['table absente'] })
    })

    it('aucune échéance en retard : no-op', async () => {
      mockFrom({ paiements_ticket: { data: [], error: null } })
      const res = await checkOverdueCaisseCredits()
      expect(res).toEqual({ marked: 0, blocked: 0, errors: [] })
    })

    it('vente comptoir anonyme (sans client_id) : marquée mais pas pénalisée', async () => {
      mockFrom({
        paiements_ticket: {
          data: [{ id: 'pay-1', ticket_id: 'tk-1', montant_xaf: 5000, tickets_vente: { client_id: null, numero_facture: 'F-1' } }],
          error: null,
        },
      })
      const res = await checkOverdueCaisseCredits()
      expect(res.marked).toBe(1)
      expect(res.blocked).toBe(0)
      expect(res.errors).toEqual([])
      expect(db.from).not.toHaveBeenCalledWith('clients')
    })

    it('échec du marquage en_retard d\'une ligne : collecte l\'erreur et continue', async () => {
      let paiementsCall = 0
      db.from.mockImplementation((table: string) => {
        if (table === 'paiements_ticket') {
          paiementsCall++
          const response = paiementsCall === 1
            ? { data: [{ id: 'pay-1', ticket_id: 'tk-1', montant_xaf: 1000, tickets_vente: { client_id: 'c-1', numero_facture: 'F-1' } }], error: null }
            : { data: null, error: { message: 'update refusé' } }
          return makeThenable(response)
        }
        return makeThenable({ data: null, error: null })
      })

      const res = await checkOverdueCaisseCredits()
      expect(res.marked).toBe(0)
      expect(res.errors).toEqual(['paiement pay-1: update refusé'])
      expect(db.from).not.toHaveBeenCalledWith('clients')
    })

    it('client en retard dont la pénalité déclenche un blocage : incrémente blocked', async () => {
      db.from.mockImplementation((table: string) => {
        if (table === 'paiements_ticket') {
          return makeThenable({
            data: [{ id: 'pay-1', ticket_id: 'tk-1', montant_xaf: 2000, tickets_vente: { client_id: 'c-1', numero_facture: 'F-1' } }],
            error: null,
          })
        }
        if (table === 'clients') {
          return makeThenable({ data: { score_fiabilite_caisse: SCORE_SEUIL_BLOCAGE }, error: null })
        }
        return makeThenable({ data: null, error: null })
      })

      const res = await checkOverdueCaisseCredits()
      expect(res.marked).toBe(1)
      expect(res.blocked).toBe(1)
      expect(res.errors).toEqual([])
    })
  })
})
