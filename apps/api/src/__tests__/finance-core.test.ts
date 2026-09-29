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
 *
 * Mock DB routé PAR TABLE (pas par position) : depuis l'ajout du moteur de
 * crédit client (syncCreditForFacture / getCreditByFactureOrCommande, appelé
 * automatiquement dès qu'une facture "engageante" est créée/mise à jour),
 * ensureFactureForCommande et enregistrerPaiementCommande font des appels
 * .from('credits') supplémentaires et imprévisibles en nombre. Une file
 * positionnelle unique (mockImplementationOnce en séquence) se désynchronise
 * dès qu'un appel de plus apparaît quelque part au milieu. Une file par
 * table isole cette interférence : les appels vers 'credits' qu'on ne
 * mocke jamais explicitement retombent sur la réponse par défaut (aucun
 * crédit existant), sans jamais consommer un slot destiné à 'commandes' /
 * 'factures' / 'paiements_commande'.
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

type Chain = ReturnType<typeof mkChain>

let queues: Record<string, Chain[]>

/** Enfile la prochaine réponse pour un appel à `db.from(table)`, et retourne
 * la chaîne mockée (pour asserter dessus, ex. `expect(chain.insert).not.toHaveBeenCalled()`). */
function queueFrom(table: string, response: Record<string, unknown>): Chain {
  const chain = mkChain(response)
  ;(queues[table] ??= []).push(chain)
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
  queues = {}
  // Réponse par défaut pour toute table non explicitement enfilée (notamment
  // 'credits' : aucun crédit existant, le moteur de crédit s'arrête vite).
  db.from.mockImplementation((table: string) => {
    const q = queues[table]
    if (q && q.length > 0) return q.shift()!
    return mkChain({ data: null, error: null })
  })
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
    queueFrom('factures', { data: FAC_BASE, error: null })
    const result = await getFactureActiveByCommande(CMD_ID)
    expect(result).toMatchObject({ id: FAC_ID })
  })

  it('retourne null si aucune facture', async () => {
    queueFrom('factures', { data: null, error: null })
    const result = await getFactureActiveByCommande(CMD_ID)
    expect(result).toBeNull()
  })

  it('lève une erreur si DB échoue', async () => {
    queueFrom('factures', { data: null, error: { message: 'DB error' } })
    await expect(getFactureActiveByCommande(CMD_ID)).rejects.toThrow('DB error')
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// ensureFactureForCommande
// ═══════════════════════════════════════════════════════════════════════════════

describe('ensureFactureForCommande', () => {
  it('retourne la facture existante sans la créer si elle existe déjà', async () => {
    // getFactureActiveByCommande → existing (statut brouillon : le moteur de
    // crédit s'arrête après la lecture, sans update/insert — cf. syncCreditForFacture)
    const facturesChain = queueFrom('factures', { data: FAC_BASE, error: null })

    const result = await ensureFactureForCommande({ commandeId: CMD_ID })
    expect(result.created).toBe(false)
    expect(result.facture).toMatchObject({ id: FAC_ID })
    expect(facturesChain.update).not.toHaveBeenCalled()
    expect(facturesChain.insert).not.toHaveBeenCalled()
  })

  it('crée une facture quand aucune facture existante', async () => {
    queueFrom('factures', { data: null, error: null }) // getFactureActiveByCommande → aucune
    queueFrom('commandes', { data: CMD_BASE, error: null })
    queueFrom('factures', { data: null, count: 0, error: null }) // genererNumero
    queueFrom('factures', {
      data: { id: FAC_ID, numero: `FAC-${YEAR}-0001`, total_ttc_xaf: 119_250, montant_paye_xaf: 0 },
      error: null,
    })
    queueFrom('factures_lignes', { data: null, error: null })

    const result = await ensureFactureForCommande({ commandeId: CMD_ID })
    expect(result.created).toBe(true)
    expect(result.facture).toMatchObject({ id: FAC_ID })
    expect(result.facture.solde_restant_xaf).toBe(119_250)
  })

  it('recalcule la TVA au stade facture pour une commande issue d\'un devis (tva_xaf=0 en base)', async () => {
    // §19 : le devis est brut (TVA=0) ; transformer-commande copie ce 0 sur la commande.
    // Sans le recalcul, la facture générée héritait de ce 0 — jamais de TVA facturée.
    const CMD_DEPUIS_DEVIS = { ...CMD_BASE, tva_xaf: 0, total_ttc_xaf: 100_000, net_a_payer_xaf: 100_000 }

    queueFrom('factures', { data: null, error: null }) // getFactureActiveByCommande → aucune
    queueFrom('commandes', { data: CMD_DEPUIS_DEVIS, error: null })
    queueFrom('factures', { data: null, count: 0, error: null }) // genererNumero
    const factureInsertChain = queueFrom('factures', {
      data: { id: FAC_ID, numero: `FAC-${YEAR}-0001`, total_ttc_xaf: 119_250, montant_paye_xaf: 0 },
      error: null,
    })
    queueFrom('factures_lignes', { data: null, error: null })

    const result = await ensureFactureForCommande({ commandeId: CMD_ID, statut: 'valide' })

    expect(result.created).toBe(true)
    // 100_000 HT × 19,25 % = 19_250 XAF de TVA, jamais 0
    expect(factureInsertChain.insert).toHaveBeenCalledWith(
      expect.objectContaining({ total_ht_xaf: 100_000, tva_xaf: 19_250, total_ttc_xaf: 119_250 }),
    )

    const { genererEcritureVente } = await import('../services/comptabilite.service')
    expect(genererEcritureVente).toHaveBeenCalledWith(
      expect.objectContaining({ tva_xaf: 19_250, total_ttc_xaf: 119_250 }),
    )
  })

  it('statut="paye" quand montantPayeXaf >= total_ttc', async () => {
    queueFrom('factures', { data: null, error: null })
    queueFrom('commandes', { data: CMD_BASE, error: null })
    queueFrom('factures', { data: null, count: 0, error: null })
    queueFrom('factures', {
      data: { id: FAC_ID, numero: `FAC-${YEAR}-0001`, total_ttc_xaf: 119_250, montant_paye_xaf: 119_250 },
      error: null,
    })
    queueFrom('factures_lignes', { data: null, error: null })

    const result = await ensureFactureForCommande({
      commandeId: CMD_ID,
      montantPayeXaf: 119_250,
    })
    expect(result.created).toBe(true)
    expect(result.facture.solde_restant_xaf).toBe(0)
  })

  it('lève une erreur si commande introuvable', async () => {
    queueFrom('factures', { data: null, error: null }) // no existing facture
    queueFrom('commandes', { data: null, error: { message: 'NOT_FOUND' } })

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
    queueFrom('commandes', { data: null, error: { message: 'Not found' } })
    await expect(enregistrerPaiementCommande(BASE_OPTS))
      .rejects.toMatchObject({ httpStatus: 404 })
  })

  it('lève 422 AMOUNT_EXCEEDED si montant > solde', async () => {
    queueFrom('commandes', {
      data: { id: CMD_ID, numero: 'CMD-2026-0001', client_id: null, client_nom: 'X', total_ttc_xaf: 100_000, montant_paye_xaf: 80_000 },
      error: null,
    })
    // ensureFactureForCommande (ensureFacture !== false par défaut) → facture
    // existante déjà à 80 000/100 000 : le paiement de 30 000 dépasserait le solde.
    queueFrom('factures', {
      data: { id: FAC_ID, commande_id: CMD_ID, client_id: null, statut: 'envoye', total_ttc_xaf: 100_000, montant_paye_xaf: 80_000 },
      error: null,
    })
    await expect(enregistrerPaiementCommande({ ...BASE_OPTS, montantXaf: 30_000 }))
      .rejects.toMatchObject({ code: 'AMOUNT_EXCEEDED' })
  })

  it('enregistre un paiement et met à jour la commande + facture', async () => {
    queueFrom('commandes', {
      data: { id: CMD_ID, numero: 'CMD-2026-0001', client_id: null, client_nom: 'SODECOTON', total_ttc_xaf: 119_250, montant_paye_xaf: 0 },
      error: null,
    })
    queueFrom('factures', { data: null, error: null }) // getFactureActiveByCommande → aucune
    queueFrom('commandes', { data: CMD_BASE, error: null }) // ensureFactureForCommande : refetch commande
    queueFrom('factures', { data: null, count: 0, error: null }) // genererNumero
    // Facture fraîchement créée, non payée (le paiement est enregistré ensuite) —
    // montant_paye_xaf doit être 0 ici, pas la valeur post-paiement.
    queueFrom('factures', { data: { id: FAC_ID, numero: `FAC-${YEAR}-0001`, total_ttc_xaf: 119_250, montant_paye_xaf: 0 }, error: null })
    queueFrom('factures_lignes', { data: null, error: null })
    queueFrom('paiements_commande', { data: { id: 'p1', montant_xaf: 50_000 }, error: null })
    queueFrom('commandes', { data: null, error: null }) // commande update
    queueFrom('factures', { data: { id: FAC_ID, total_ttc_xaf: 119_250, montant_paye_xaf: 50_000 }, error: null }) // facture update

    const result = await enregistrerPaiementCommande(BASE_OPTS)
    expect(result.montant_paye_xaf).toBe(50_000)
    expect(result.solde_restant_xaf).toBe(69_250)
    expect(result.paiement).toMatchObject({ id: 'p1' })
  })

  it('solde_restant = 0 quand paiement complet', async () => {
    queueFrom('commandes', {
      data: { id: CMD_ID, numero: 'CMD-2026-0001', client_id: null, client_nom: 'X', total_ttc_xaf: 119_250, montant_paye_xaf: 0 },
      error: null,
    })
    queueFrom('factures', { data: null, error: null }) // aucune facture existante
    queueFrom('commandes', { data: CMD_BASE, error: null }) // commande detail
    queueFrom('factures', { data: null, count: 0, error: null }) // count
    queueFrom('factures', { data: { id: FAC_ID, total_ttc_xaf: 119_250, montant_paye_xaf: 0 }, error: null }) // insert facture (non payée)
    queueFrom('factures_lignes', { data: null, error: null })
    queueFrom('paiements_commande', { data: { id: 'p1' }, error: null })
    queueFrom('commandes', { data: null, error: null }) // commande update
    queueFrom('factures', { data: { id: FAC_ID, total_ttc_xaf: 119_250, montant_paye_xaf: 119_250 }, error: null }) // facture update

    const result = await enregistrerPaiementCommande({ ...BASE_OPTS, montantXaf: 119_250 })
    expect(result.solde_restant_xaf).toBe(0)
  })

  it('ensureFacture=false : utilise getFactureActiveByCommande sans en créer', async () => {
    queueFrom('commandes', {
      data: { id: CMD_ID, numero: 'CMD-2026-0001', client_id: null, client_nom: 'X', total_ttc_xaf: 100_000, montant_paye_xaf: 0 },
      error: null,
    })
    // getFactureActiveByCommande → facture existante (appelée directement, pas via ensureFactureForCommande)
    const facturesChain = queueFrom('factures', { data: FAC_BASE, error: null })
    queueFrom('paiements_commande', { data: { id: 'p1', montant_xaf: 50_000 }, error: null })
    queueFrom('commandes', { data: null, error: null }) // commande update
    queueFrom('factures', { data: { id: FAC_ID, total_ttc_xaf: 119_250, montant_paye_xaf: 50_000 }, error: null }) // facture update

    const result = await enregistrerPaiementCommande({ ...BASE_OPTS, ensureFacture: false })
    expect(result.paiement).toMatchObject({ id: 'p1' })
    expect(facturesChain.insert).not.toHaveBeenCalled()
  })
})
