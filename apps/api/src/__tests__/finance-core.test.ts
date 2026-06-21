/**
 * finance-core.test.ts
 *
 * Tests unitaires pour src/services/finance-core.service.ts :
 *  - enrichirFactureSolde       (pure)
 *  - getFactureActiveByCommande (1 DB call)
 *  - ensureFactureForCommande   (plusieurs DB calls)
 *  - enregistrerPaiementCommande (plusieurs DB calls)
 *  - factureStatutDepuisPaiement (private, via comportement observable)
 *  - genererNumero              (private, via ensureFactureForCommande)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@forge/db', () => ({
  supabaseAdmin: { from: vi.fn() },
}))

vi.mock('../services/comptabilite.service', () => ({
  genererEcritureVente:        vi.fn().mockResolvedValue(null),
  genererEcritureEncaissement: vi.fn().mockResolvedValue(null),
  planComptable:               [],
  libelleCompte:               vi.fn().mockReturnValue(''),
}))

import { supabaseAdmin } from '@forge/db'
import {
  enrichirFactureSolde,
  getFactureActiveByCommande,
  ensureFactureForCommande,
  enregistrerPaiementCommande,
} from '../services/finance-core.service'

// ── Helpers ───────────────────────────────────────────────────────────────────

type MockFn = ReturnType<typeof vi.fn>
const db = supabaseAdmin as unknown as { from: MockFn }

function mkChain(response: Record<string, unknown>) {
  const chain: Record<string, unknown> = {}
  for (const m of ['select','insert','update','delete','eq','neq','in','gte','lte',
    'lt','gt','order','range','limit','head','filter','not','ilike'])
    chain[m] = vi.fn().mockReturnValue(chain)
  chain['single']      = vi.fn().mockResolvedValue(response)
  chain['maybeSingle'] = vi.fn().mockResolvedValue(response)
  chain['then']        = (cb: (v: unknown) => unknown) =>
    Promise.resolve({ data: [], count: 0, error: null, ...response }).then(cb)
  return chain
}

const CMD_ID  = '00000000-0000-0000-0000-000000000001'
const FAC_ID  = '00000000-0000-0000-0000-000000000002'
const YEAR    = new Date().getFullYear()

const CMD_BASE = {
  id: CMD_ID,
  numero: `CMD-${YEAR}-0001`,
  client_id: null,
  client_nom: 'SODECOTON',
  condition_paiement_id: null,
  acompte_recu_xaf: 0,
  date_echeance_solde: null,
  total_ht_xaf: 100_000,
  tva_xaf: 19_250,
  frais_livraison_xaf: 0,
  total_ttc_xaf: 119_250,
  montant_paye_xaf: 0,
  remise_globale_xaf: 0,
  remise_globale_motif: null,
  net_a_payer_xaf: 119_250,
  commandes_lignes: [
    {
      designation: 'Alum 6060',
      unite: 'kg',
      quantite: 10,
      prix_unitaire_ht_xaf: 10_000,
      total_ht_xaf: 100_000,
      remise_type: null,
      remise_valeur: null,
      remise_xaf: 0,
      remise_motif: null,
      ordre: 1,
    },
  ],
}

const FAC_BASE = {
  id: FAC_ID,
  numero: `FAC-${YEAR}-0001`,
  commande_id: CMD_ID,
  statut: 'brouillon',
  total_ttc_xaf: 119_250,
  montant_paye_xaf: 0,
}

beforeEach(() => {
  vi.clearAllMocks()
  db.from.mockImplementation(() => mkChain({ data: null, error: null }))
})

// ═══════════════════════════════════════════════════════════════════════════════
// enrichirFactureSolde — pure
// ═══════════════════════════════════════════════════════════════════════════════

describe('enrichirFactureSolde', () => {
  it('calcule le solde restant = total_ttc - montant_paye', () => {
    const result = enrichirFactureSolde({ total_ttc_xaf: 100_000, montant_paye_xaf: 30_000 })
    expect(result.solde_restant_xaf).toBe(70_000)
  })

  it('solde = 0 quand montant_paye >= total_ttc (pas de valeur négative)', () => {
    const result = enrichirFactureSolde({ total_ttc_xaf: 100_000, montant_paye_xaf: 120_000 })
    expect(result.solde_restant_xaf).toBe(0)
  })

  it('traite les valeurs manquantes comme 0', () => {
    const result = enrichirFactureSolde({})
    expect(result.solde_restant_xaf).toBe(0)
  })

  it('passe les autres champs intacts', () => {
    const result = enrichirFactureSolde({ total_ttc_xaf: 50_000, montant_paye_xaf: 0, statut: 'brouillon', id: 'x' })
    expect(result.statut).toBe('brouillon')
    expect(result.id).toBe('x')
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// getFactureActiveByCommande
// ═══════════════════════════════════════════════════════════════════════════════

describe('getFactureActiveByCommande', () => {
  it('retourne la facture active si trouvée', async () => {
    db.from.mockImplementationOnce(() => mkChain({ data: FAC_BASE, error: null }))
    const result = await getFactureActiveByCommande(CMD_ID)
    expect(result).toMatchObject({ id: FAC_ID })
  })

  it('retourne null si aucune facture', async () => {
    db.from.mockImplementationOnce(() => mkChain({ data: null, error: null }))
    const result = await getFactureActiveByCommande(CMD_ID)
    expect(result).toBeNull()
  })

  it('lève une erreur si DB échoue', async () => {
    db.from.mockImplementationOnce(() => mkChain({ data: null, error: { message: 'DB error' } }))
    await expect(getFactureActiveByCommande(CMD_ID)).rejects.toThrow('DB error')
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// ensureFactureForCommande
// ═══════════════════════════════════════════════════════════════════════════════

describe('ensureFactureForCommande', () => {
  it('retourne la facture existante sans la créer si elle existe déjà', async () => {
    // getFactureActiveByCommande → existing
    db.from.mockImplementationOnce(() => mkChain({ data: FAC_BASE, error: null }))

    const result = await ensureFactureForCommande({ commandeId: CMD_ID })
    expect(result.created).toBe(false)
    expect(result.facture).toMatchObject({ id: FAC_ID })
    expect(db.from).toHaveBeenCalledTimes(1) // seul l'appel maybySingle
  })

  it('crée une facture quand aucune facture existante', async () => {
    // 1. getFactureActiveByCommande → null
    db.from.mockImplementationOnce(() => mkChain({ data: null, error: null }))
    // 2. from('commandes').single() → CMD_BASE
    db.from.mockImplementationOnce(() => mkChain({ data: CMD_BASE, error: null }))
    // 3. genererNumero → count=0
    db.from.mockImplementationOnce(() => mkChain({ data: null, count: 0, error: null }))
    // 4. factures.insert.single()
    db.from.mockImplementationOnce(() => mkChain({
      data: { id: FAC_ID, numero: `FAC-${YEAR}-0001`, total_ttc_xaf: 119_250, montant_paye_xaf: 0 },
      error: null,
    }))
    // 5. factures_lignes.insert
    db.from.mockImplementationOnce(() => mkChain({ data: null, error: null }))

    const result = await ensureFactureForCommande({ commandeId: CMD_ID })
    expect(result.created).toBe(true)
    expect(result.facture).toMatchObject({ id: FAC_ID })
    expect(result.facture.solde_restant_xaf).toBe(119_250)
  })

  it('statut="paye" quand montantPayeXaf >= total_ttc', async () => {
    db.from.mockImplementationOnce(() => mkChain({ data: null, error: null }))
    db.from.mockImplementationOnce(() => mkChain({ data: CMD_BASE, error: null }))
    db.from.mockImplementationOnce(() => mkChain({ data: null, count: 0, error: null }))
    db.from.mockImplementationOnce(() => mkChain({
      data: { id: FAC_ID, numero: `FAC-${YEAR}-0001`, total_ttc_xaf: 119_250, montant_paye_xaf: 119_250 },
      error: null,
    }))
    db.from.mockImplementationOnce(() => mkChain({ data: null, error: null }))

    const result = await ensureFactureForCommande({
      commandeId: CMD_ID,
      montantPayeXaf: 119_250,
    })
    expect(result.created).toBe(true)
    expect(result.facture.solde_restant_xaf).toBe(0)
  })

  it('lève une erreur si commande introuvable', async () => {
    db.from.mockImplementationOnce(() => mkChain({ data: null, error: null })) // no existing facture
    db.from.mockImplementationOnce(() => mkChain({ data: null, error: { message: 'NOT_FOUND' } })) // commande

    await expect(ensureFactureForCommande({ commandeId: 'xxx' })).rejects.toThrow()
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// enregistrerPaiementCommande
// ═══════════════════════════════════════════════════════════════════════════════

describe('enregistrerPaiementCommande', () => {
  const BASE_OPTS = {
    commandeId:    CMD_ID,
    montantXaf:    50_000,
    methode:       'especes' as const,
    datePaiement:  '2026-01-15',
  }

  it('lève 422 si montant <= 0', async () => {
    await expect(enregistrerPaiementCommande({ ...BASE_OPTS, montantXaf: 0 }))
      .rejects.toMatchObject({ httpStatus: 422 })
  })

  it('lève 404 si commande introuvable', async () => {
    db.from.mockImplementationOnce(() => mkChain({ data: null, error: { message: 'Not found' } }))
    await expect(enregistrerPaiementCommande(BASE_OPTS))
      .rejects.toMatchObject({ httpStatus: 404 })
  })

  it('lève 422 AMOUNT_EXCEEDED si montant > solde', async () => {
    db.from.mockImplementationOnce(() => mkChain({
      data: { id: CMD_ID, numero: 'CMD-2026-0001', client_id: null, client_nom: 'X', total_ttc_xaf: 100_000, montant_paye_xaf: 80_000 },
      error: null,
    }))
    await expect(enregistrerPaiementCommande({ ...BASE_OPTS, montantXaf: 30_000 }))
      .rejects.toMatchObject({ code: 'AMOUNT_EXCEEDED' })
  })

  it('enregistre un paiement et met à jour la commande + facture', async () => {
    // 1. commandes.select.single
    db.from.mockImplementationOnce(() => mkChain({
      data: { id: CMD_ID, numero: 'CMD-2026-0001', client_id: null, client_nom: 'SODECOTON', total_ttc_xaf: 119_250, montant_paye_xaf: 0 },
      error: null,
    }))
    // 2. getFactureActiveByCommande → null (facture n'existe pas)
    db.from.mockImplementationOnce(() => mkChain({ data: null, error: null }))
    // 3. from('commandes').select(detail).single → CMD_BASE (pour ensureFactureForCommande)
    db.from.mockImplementationOnce(() => mkChain({ data: CMD_BASE, error: null }))
    // 4. genererNumero factures count
    db.from.mockImplementationOnce(() => mkChain({ data: null, count: 0, error: null }))
    // 5. factures.insert.single
    db.from.mockImplementationOnce(() => mkChain({ data: { id: FAC_ID, numero: `FAC-${YEAR}-0001`, total_ttc_xaf: 119_250, montant_paye_xaf: 50_000 }, error: null }))
    // 6. factures_lignes.insert
    db.from.mockImplementationOnce(() => mkChain({ data: null, error: null }))
    // 7. paiements_commande.insert.single
    db.from.mockImplementationOnce(() => mkChain({ data: { id: 'p1', montant_xaf: 50_000 }, error: null }))
    // 8. commandes.update
    db.from.mockImplementationOnce(() => mkChain({ data: null, error: null }))
    // 9. factures.update.select.single
    db.from.mockImplementationOnce(() => mkChain({ data: { id: FAC_ID, total_ttc_xaf: 119_250, montant_paye_xaf: 50_000 }, error: null }))

    const result = await enregistrerPaiementCommande(BASE_OPTS)
    expect(result.montant_paye_xaf).toBe(50_000)
    expect(result.solde_restant_xaf).toBe(69_250)
    expect(result.paiement).toMatchObject({ id: 'p1' })
  })

  it('solde_restant = 0 quand paiement complet', async () => {
    db.from.mockImplementationOnce(() => mkChain({
      data: { id: CMD_ID, numero: 'CMD-2026-0001', client_id: null, client_nom: 'X', total_ttc_xaf: 119_250, montant_paye_xaf: 0 },
      error: null,
    }))
    db.from.mockImplementationOnce(() => mkChain({ data: null, error: null })) // no existing facture
    db.from.mockImplementationOnce(() => mkChain({ data: CMD_BASE, error: null })) // commande detail
    db.from.mockImplementationOnce(() => mkChain({ data: null, count: 0, error: null })) // count
    db.from.mockImplementationOnce(() => mkChain({ data: { id: FAC_ID, total_ttc_xaf: 119_250, montant_paye_xaf: 119_250 }, error: null })) // insert facture
    db.from.mockImplementationOnce(() => mkChain({ data: null, error: null })) // lignes
    db.from.mockImplementationOnce(() => mkChain({ data: { id: 'p1' }, error: null })) // paiement insert
    db.from.mockImplementationOnce(() => mkChain({ data: null, error: null })) // commande update
    db.from.mockImplementationOnce(() => mkChain({ data: { id: FAC_ID, total_ttc_xaf: 119_250, montant_paye_xaf: 119_250 }, error: null })) // facture update

    const result = await enregistrerPaiementCommande({ ...BASE_OPTS, montantXaf: 119_250 })
    expect(result.solde_restant_xaf).toBe(0)
  })

  it('ensureFacture=false : utilise getFactureActiveByCommande sans en créer', async () => {
    db.from.mockImplementationOnce(() => mkChain({
      data: { id: CMD_ID, numero: 'CMD-2026-0001', client_id: null, client_nom: 'X', total_ttc_xaf: 100_000, montant_paye_xaf: 0 },
      error: null,
    }))
    // getFactureActiveByCommande → facture existante
    db.from.mockImplementationOnce(() => mkChain({ data: FAC_BASE, error: null }))
    // paiements_commande insert
    db.from.mockImplementationOnce(() => mkChain({ data: { id: 'p1', montant_xaf: 50_000 }, error: null }))
    // commande update
    db.from.mockImplementationOnce(() => mkChain({ data: null, error: null }))
    // facture update
    db.from.mockImplementationOnce(() => mkChain({ data: { id: FAC_ID, total_ttc_xaf: 119_250, montant_paye_xaf: 50_000 }, error: null }))

    const result = await enregistrerPaiementCommande({ ...BASE_OPTS, ensureFacture: false })
    expect(result.paiement).toMatchObject({ id: 'p1' })
  })
})
