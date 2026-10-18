/**
 * finance-coherence.test.ts
 *
 * Revue de cohérence Finance (recette AD-18) — garde-fous sur les défauts
 * constatés en base :
 *  - paiement d'une commande avec frais de livraison (facture hors livraison) ;
 *  - 2e encaissement d'une même facture jamais comptabilisé ;
 *  - mobile money imputé à la banque ;
 *  - facture restée « à encaisser » après annulation de la commande.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@forge/db', () => ({
  supabaseAdmin: { from: vi.fn() },
}))

import { supabaseAdmin } from '@forge/db'
import {
  compteEncaissement,
  genererEcritureEncaissement,
  genererEcritureFraisLivraison,
} from '../services/comptabilite.service'
import {
  enregistrerPaiementCommande,
  repartitionReglementCommande,
  solderCreditsForCommande,
} from '../services/finance-core.service'

type MockFn = ReturnType<typeof vi.fn>
const db = supabaseAdmin as unknown as { from: MockFn }

function mkChain(response: Record<string, unknown>) {
  const chain: Record<string, unknown> = {}
  for (const m of ['select', 'insert', 'update', 'delete', 'eq', 'neq', 'in', 'gte', 'lte',
    'lt', 'gt', 'order', 'range', 'limit', 'head', 'filter', 'not', 'ilike'])
    chain[m] = vi.fn().mockReturnValue(chain)
  chain['single']      = vi.fn().mockResolvedValue(response)
  chain['maybeSingle'] = vi.fn().mockResolvedValue(response)
  chain['then']        = (cb: (v: unknown) => unknown) =>
    Promise.resolve({ data: [], count: 0, error: null, ...response }).then(cb)
  return chain as Record<string, MockFn>
}

type Chain = ReturnType<typeof mkChain>
let queues: Record<string, Chain[]>
let appels: Record<string, Chain[]>

function queueFrom(table: string, response: Record<string, unknown>): Chain {
  const chain = mkChain(response)
  ;(queues[table] ??= []).push(chain)
  return chain
}

/** Lignes insérées dans une table pendant le test (tous appels confondus). */
function inserts(table: string): Array<Record<string, unknown>> {
  return (appels[table] ?? [])
    .flatMap(chain => chain.insert.mock.calls.map(call => call[0]))
    .flat() as Array<Record<string, unknown>>
}

beforeEach(() => {
  queues = {}
  appels = {}
  db.from.mockReset()
  db.from.mockImplementation((table: string) => {
    const chain = queues[table]?.shift() ?? mkChain({ data: null, count: 0, error: null })
    ;(appels[table] ??= []).push(chain)
    return chain
  })
})

const CMD_ID = '00000000-0000-0000-0000-000000000001'
const FAC_ID = '00000000-0000-0000-0000-000000000002'
const PAY_ID = 'aaaaaaaa-0000-0000-0000-000000000003'

// ── Ventilation facture / frais de livraison ──────────────────────────────────

describe('repartitionReglementCommande', () => {
  it('sépare le solde de la facture des frais de livraison', () => {
    expect(repartitionReglementCommande(
      { total_ttc_xaf: 47_315, frais_livraison_xaf: 2_000, montant_paye_xaf: 0 },
      { total_ttc_xaf: 45_315, montant_paye_xaf: 0 },
    )).toMatchObject({ soldeFacture: 45_315, fraisRestants: 2_000 })
  })

  it('ne redemande pas des frais de livraison déjà réglés', () => {
    expect(repartitionReglementCommande(
      { total_ttc_xaf: 47_315, frais_livraison_xaf: 2_000, montant_paye_xaf: 47_315 },
      { total_ttc_xaf: 45_315, montant_paye_xaf: 45_315 },
    )).toMatchObject({ soldeFacture: 0, fraisDejaPayes: 2_000, fraisRestants: 0 })
  })

  it('plafonne une facture « payée » au-delà de son total (données anciennes)', () => {
    expect(repartitionReglementCommande(
      { total_ttc_xaf: 47_315, frais_livraison_xaf: 2_000, montant_paye_xaf: 47_315 },
      { total_ttc_xaf: 45_315, montant_paye_xaf: 47_315 },
    )).toMatchObject({ dejaPayeFacture: 45_315, soldeFacture: 0, fraisRestants: 0 })
  })

  it('sans facture, raisonne sur le total de la commande', () => {
    expect(repartitionReglementCommande(
      { total_ttc_xaf: 100_000, frais_livraison_xaf: 2_000, montant_paye_xaf: 80_000 },
      null,
    )).toMatchObject({ soldeFacture: 20_000, fraisRestants: 0 })
  })
})

// ── Paiement d'une commande web livrée ────────────────────────────────────────

describe('enregistrerPaiementCommande — commande avec frais de livraison', () => {
  function preparer(montantPayeFacture = 0, montantPayeCommande = 0) {
    const facture = {
      id: FAC_ID, numero: 'FAC-2026-0013', statut: 'envoye', commande_id: CMD_ID,
      client_id: null, client_nom: 'Client Web', total_ttc_xaf: 45_315, montant_paye_xaf: montantPayeFacture,
    }
    queueFrom('commandes', {
      data: {
        id: CMD_ID, numero: 'WEB-2026-7125', client_id: null, client_nom: 'Client Web',
        total_ttc_xaf: 47_315, frais_livraison_xaf: 2_000, montant_paye_xaf: montantPayeCommande,
      },
      error: null,
    })
    queueFrom('factures', { data: facture, error: null })
    queueFrom('paiements_commande', { data: { id: PAY_ID }, error: null })
    return facture
  }

  it('accepte le total commande : la facture est soldée à son montant, la livraison passe en produit', async () => {
    const facture = preparer()
    queueFrom('factures', { data: { ...facture, statut: 'paye', montant_paye_xaf: 45_315 }, error: null })

    const result = await enregistrerPaiementCommande({
      commandeId: CMD_ID, montantXaf: 47_315, methode: 'mobile_money', modeComptable: 'mtn_momo',
      datePaiement: '2026-10-12', ensureFacture: false,
    })

    expect(result.montant_paye_xaf).toBe(45_315)
    expect(result.frais_livraison_encaisses_xaf).toBe(2_000)
    expect(result.solde_restant_xaf).toBe(0)

    // Facture jamais « payée » au-delà de son total ; la commande, elle, a tout reçu
    const majFacture = appels['factures'].flatMap(c => c.update.mock.calls.map(call => call[0]))
    expect(majFacture).toEqual([expect.objectContaining({ montant_paye_xaf: 45_315, statut: 'paye' })])
    const majCommande = appels['commandes'].flatMap(c => c.update.mock.calls.map(call => call[0]))
    expect(majCommande).toEqual([expect.objectContaining({ montant_paye_xaf: 47_315, statut_paiement: 'solde_recu' })])

    const ecritures = inserts('ecritures_comptables')
    // Encaissement de la facture : Dr 5521 MTN / Cr 411, pour le montant de la facture
    expect(ecritures).toContainEqual(expect.objectContaining({ compte_syscohada: '5521', debit_xaf: 45_315, reference_doc: 'ENC-FAC-2026-0013-aaaaaaaa' }))
    expect(ecritures).toContainEqual(expect.objectContaining({ compte_syscohada: '411', credit_xaf: 45_315 }))
    // Frais de livraison : Dr 5521 / Cr 706, sans toucher au compte client
    expect(ecritures).toContainEqual(expect.objectContaining({ compte_syscohada: '5521', debit_xaf: 2_000, reference_doc: 'LIV-WEB-2026-7125-aaaaaaaa' }))
    expect(ecritures).toContainEqual(expect.objectContaining({ compte_syscohada: '706', credit_xaf: 2_000 }))
    // Écritures équilibrées
    const debit = ecritures.reduce((s, e) => s + Number(e.debit_xaf), 0)
    const credit = ecritures.reduce((s, e) => s + Number(e.credit_xaf), 0)
    expect(debit).toBe(credit)
    expect(debit).toBe(47_315)
  })

  it('refuse un montant supérieur à facture + livraison', async () => {
    preparer()
    await expect(enregistrerPaiementCommande({
      commandeId: CMD_ID, montantXaf: 50_000, methode: 'especes', datePaiement: '2026-10-12', ensureFacture: false,
    })).rejects.toMatchObject({ code: 'AMOUNT_EXCEEDED', httpStatus: 422 })
    expect(inserts('paiements_commande')).toHaveLength(0)
  })

  it('un acompte ne règle que la facture, sans écriture de livraison', async () => {
    const facture = preparer()
    queueFrom('factures', { data: { ...facture, montant_paye_xaf: 20_000 }, error: null })

    const result = await enregistrerPaiementCommande({
      commandeId: CMD_ID, montantXaf: 20_000, methode: 'especes', datePaiement: '2026-10-12', ensureFacture: false,
    })

    expect(result.frais_livraison_encaisses_xaf).toBe(0)
    expect(result.solde_restant_xaf).toBe(25_315)
    const ecritures = inserts('ecritures_comptables')
    expect(ecritures).toHaveLength(2)
    expect(ecritures).toContainEqual(expect.objectContaining({ compte_syscohada: '571', debit_xaf: 20_000 }))
  })
})

// ── Écritures d'encaissement ──────────────────────────────────────────────────

describe('écritures d\'encaissement', () => {
  it('deux règlements de la même facture ont chacun leur pièce comptable', async () => {
    const base = { facture_id: FAC_ID, reference: 'FAC-2026-0001', date: '2026-10-12', montant_xaf: 10_000, client_nom: 'X' }
    await genererEcritureEncaissement({ ...base, piece_id: 'aaaaaaaa-1111' })
    await genererEcritureEncaissement({ ...base, piece_id: 'bbbbbbbb-2222' })

    const refs = new Set(inserts('ecritures_comptables').map(e => e.reference_doc))
    expect(refs).toEqual(new Set(['ENC-FAC-2026-0001-aaaaaaaa', 'ENC-FAC-2026-0001-bbbbbbbb']))
    expect(inserts('ecritures_comptables')).toHaveLength(4)
  })

  it('ne rejoue pas un règlement déjà comptabilisé', async () => {
    queueFrom('ecritures_comptables', { count: 2, error: null })
    const result = await genererEcritureEncaissement({
      facture_id: FAC_ID, reference: 'FAC-2026-0001', piece_id: 'aaaaaaaa-1111',
      date: '2026-10-12', montant_xaf: 10_000, client_nom: 'X',
    })
    expect(result).toEqual({ ok: true, inserts: 0 })
    expect(inserts('ecritures_comptables')).toHaveLength(0)
  })

  it('le mobile money sans opérateur va au compte 552, pas à la banque', () => {
    expect(compteEncaissement('mobile_money')).toBe('552')
  })

  it('aucune écriture pour des frais de livraison nuls', async () => {
    const result = await genererEcritureFraisLivraison({
      commande_id: CMD_ID, reference: 'WEB-1', piece_id: 'aaaaaaaa', date: '2026-10-12', montant_xaf: 0, client_nom: 'X',
    })
    expect(result).toEqual({ ok: true, inserts: 0 })
    expect(db.from).not.toHaveBeenCalled()
  })
})

// ── Annulation de commande ────────────────────────────────────────────────────

describe('solderCreditsForCommande — commande annulée', () => {
  const FACTURE = {
    id: FAC_ID, numero: 'FAC-2026-0037', statut: 'valide', commande_id: CMD_ID,
    client_id: null, client_nom: 'X', total_ttc_xaf: 35_775, montant_paye_xaf: 0,
  }

  it('annule la facture impayée et contre-passe son écriture de vente', async () => {
    queueFrom('factures', { data: FACTURE, error: null })
    // annulerEcrituresReference : pas d'annulation existante, puis écritures d'origine
    queueFrom('ecritures_comptables', { count: 0, error: null })
    queueFrom('ecritures_comptables', {
      data: [
        { libelle: 'Vente', compte_syscohada: '411', compte_label: 'Clients', debit_xaf: 35_775, credit_xaf: 0 },
        { libelle: 'Vente', compte_syscohada: '701', compte_label: 'Ventes', debit_xaf: 0, credit_xaf: 30_000 },
        { libelle: 'TVA', compte_syscohada: '4431', compte_label: 'TVA', debit_xaf: 0, credit_xaf: 5_775 },
      ],
      error: null,
    })

    await solderCreditsForCommande(CMD_ID, 'user-1')

    const majFacture = appels['factures'].flatMap(c => c.update.mock.calls.map(call => call[0]))
    expect(majFacture).toEqual([expect.objectContaining({ statut: 'annule' })])
    const contrePassation = inserts('ecritures_comptables')
    expect(contrePassation).toHaveLength(3)
    expect(contrePassation).toContainEqual(expect.objectContaining({
      compte_syscohada: '411', debit_xaf: 0, credit_xaf: 35_775, reference_doc: 'ANN-FAC-2026-0037',
    }))
  })

  it('laisse intacte une facture déjà encaissée (remboursement à traiter par la Finance)', async () => {
    queueFrom('factures', { data: { ...FACTURE, statut: 'paye', montant_paye_xaf: 35_775 }, error: null })

    await solderCreditsForCommande(CMD_ID, 'user-1')

    const majFacture = appels['factures'].flatMap(c => c.update.mock.calls.map(call => call[0]))
    expect(majFacture).toHaveLength(0)
    expect(inserts('ecritures_comptables')).toHaveLength(0)
  })
})
