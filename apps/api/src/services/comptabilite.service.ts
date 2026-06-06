import { supabaseAdmin } from '@forge/db'

const db = supabaseAdmin!
import PLAN_RAW from '../data/plan-comptable.json'

// ── Plan comptable SYSCOHADA (lookup) ──────────────────────────────────────────

const PLAN_MAP = new Map(
  (PLAN_RAW as { compte: string; libelle: string }[]).map(c => [c.compte, c.libelle]),
)

function libelleCompte(compte: string): string {
  return PLAN_MAP.get(compte) ?? `Compte ${compte}`
}

// ── Types internes ─────────────────────────────────────────────────────────────

interface EcritureInsert {
  date:             string
  libelle:          string
  compte_syscohada: string
  compte_label:     string
  debit_xaf:        number
  credit_xaf:       number
  reference_doc?:   string
  facture_id?:      string
  commande_id?:     string
  created_by?:      string
}

export interface ComptaResult {
  ok:      boolean
  inserts: number
  error?:  string
}

// ── Insertion batch ────────────────────────────────────────────────────────────

async function insertEcritures(ecritures: EcritureInsert[]): Promise<ComptaResult> {
  if (ecritures.length === 0) return { ok: true, inserts: 0 }

  const { error } = await db
    .from('ecritures_comptables')
    .insert(ecritures.map(e => ({ ...e, sync_status: 'synced' })))

  if (error) {
    console.error('[compta] insert error:', error.message, { ecritures })
    return { ok: false, inserts: 0, error: error.message }
  }

  return { ok: true, inserts: ecritures.length }
}

// ── Garde-fou: vérifier si les écritures existent déjà ────────────────────────

async function ecrituresExistent(
  champ: 'facture_id' | 'commande_id' | 'reference_doc',
  valeur: string,
): Promise<boolean> {
  const { count } = await db
    .from('ecritures_comptables')
    .select('*', { count: 'exact', head: true })
    .eq(champ, valeur)
  return (count ?? 0) > 0
}

// ══════════════════════════════════════════════════════════════════════════════
// ÉCRITURES DE VENTE
// ══════════════════════════════════════════════════════════════════════════════
//
// Vente de marchandises / services TAFDIL (BTP, usinage, …)
//   Dr 411 Clients              (montant TTC)
//   Cr 701/705 Ventes / Travaux (montant HT)
//   Cr 4431 TVA facturée        (montant TVA)
//
// Équilibre : 411 TTC = 701 HT + 4431 TVA ✓

export async function genererEcritureVente(facture: {
  id:            string
  numero:        string
  date_emission: string
  client_nom:    string
  total_ht_xaf:  number
  tva_xaf:       number
  frais_livraison_xaf?: number | null
  total_ttc_xaf: number
  created_by?:   string
  type_vente?:   'marchandises' | 'travaux' | 'services'
}): Promise<ComptaResult> {
  if (await ecrituresExistent('facture_id', facture.id)) {
    return { ok: true, inserts: 0 }
  }

  const compteVente = facture.type_vente === 'travaux'
    ? '705'
    : facture.type_vente === 'services'
    ? '706'
    : '701'

  const libelle = `Vente — ${facture.numero} — ${facture.client_nom}`
  const date    = facture.date_emission.slice(0, 10)

  const fraisLivraison = Math.round(Number(facture.frais_livraison_xaf ?? 0))
  const ecritures = [
    {
      date, libelle,
      compte_syscohada: '411',
      compte_label:     libelleCompte('411'),
      debit_xaf:        facture.total_ttc_xaf,
      credit_xaf:       0,
      reference_doc:    facture.numero,
      facture_id:       facture.id,
      created_by:       facture.created_by,
    },
    {
      date, libelle,
      compte_syscohada: compteVente,
      compte_label:     libelleCompte(compteVente),
      debit_xaf:        0,
      credit_xaf:       facture.total_ht_xaf,
      reference_doc:    facture.numero,
      facture_id:       facture.id,
      created_by:       facture.created_by,
    },
    {
      date,
      libelle:          `TVA collectée — ${facture.numero}`,
      compte_syscohada: '4431',
      compte_label:     libelleCompte('4431'),
      debit_xaf:        0,
      credit_xaf:       facture.tva_xaf,
      reference_doc:    facture.numero,
      facture_id:       facture.id,
      created_by:       facture.created_by,
    },
  ]

  if (fraisLivraison > 0) {
    ecritures.push({
      date,
      libelle:          `Frais de livraison - ${facture.numero}`,
      compte_syscohada: '706',
      compte_label:     libelleCompte('706'),
      debit_xaf:        0,
      credit_xaf:       fraisLivraison,
      reference_doc:    facture.numero,
      facture_id:       facture.id,
      created_by:       facture.created_by,
    })
  }

  return insertEcritures(ecritures)
}

// ══════════════════════════════════════════════════════════════════════════════
// ÉCRITURES D'ENCAISSEMENT
// ══════════════════════════════════════════════════════════════════════════════
//
// Règlement d'une créance client
//   Dr 521 Banque (ou 571 Caisse)  (montant encaissé)
//   Cr 411 Clients                 (montant encaissé)

export async function genererEcritureEncaissement(params: {
  facture_id?:  string
  credit_id?:   string
  reference:    string
  date:         string
  montant_xaf:  number
  client_nom:   string
  mode?:        'banque' | 'caisse'
  created_by?:  string
}): Promise<ComptaResult> {
  const ref   = `ENC-${params.reference}`
  const dejaFait = await ecrituresExistent('reference_doc', ref)
  if (dejaFait) return { ok: true, inserts: 0 }

  const compteTreso = params.mode === 'caisse' ? '571' : '521'
  const libelle = `Encaissement — ${params.reference} — ${params.client_nom}`

  return insertEcritures([
    {
      date:             params.date.slice(0, 10),
      libelle,
      compte_syscohada: compteTreso,
      compte_label:     libelleCompte(compteTreso),
      debit_xaf:        params.montant_xaf,
      credit_xaf:       0,
      reference_doc:    ref,
      facture_id:       params.facture_id,
      created_by:       params.created_by,
    },
    {
      date:             params.date.slice(0, 10),
      libelle,
      compte_syscohada: '411',
      compte_label:     libelleCompte('411'),
      debit_xaf:        0,
      credit_xaf:       params.montant_xaf,
      reference_doc:    ref,
      facture_id:       params.facture_id,
      created_by:       params.created_by,
    },
  ])
}

// ══════════════════════════════════════════════════════════════════════════════
// ÉCRITURES D'ACHAT
// ══════════════════════════════════════════════════════════════════════════════
//
// Achat de marchandises / matières premières
//   Dr 601/602 Achats            (montant HT)
//   Dr 4432 TVA déductible       (montant TVA si applicable)
//   Cr 401 Fournisseurs          (montant TTC)

export async function genererEcritureAchat(bon: {
  reference:       string
  date:            string
  fournisseur:     string
  montant_ht_xaf:  number
  tva_xaf?:        number
  type?:           'marchandises' | 'matieres' | 'fournitures'
  commande_id?:    string
  created_by?:     string
}): Promise<ComptaResult> {
  const refDoc = `ACH-${bon.reference}`
  if (await ecrituresExistent('reference_doc', refDoc)) {
    return { ok: true, inserts: 0 }
  }

  const compteAchat = bon.type === 'matieres'
    ? '602'
    : bon.type === 'fournitures'
    ? '604'
    : '601'

  const tva        = bon.tva_xaf ?? 0
  const montantTtc = bon.montant_ht_xaf + tva
  const libelle    = `Achat — ${bon.reference} — ${bon.fournisseur}`
  const date       = bon.date.slice(0, 10)

  const ecritures: EcritureInsert[] = [
    {
      date, libelle,
      compte_syscohada: compteAchat,
      compte_label:     libelleCompte(compteAchat),
      debit_xaf:        bon.montant_ht_xaf,
      credit_xaf:       0,
      reference_doc:    refDoc,
      commande_id:      bon.commande_id,
      created_by:       bon.created_by,
    },
  ]

  if (tva > 0) {
    ecritures.push({
      date,
      libelle:          `TVA déductible — ${bon.reference}`,
      compte_syscohada: '4432',
      compte_label:     libelleCompte('4432'),
      debit_xaf:        tva,
      credit_xaf:       0,
      reference_doc:    refDoc,
      commande_id:      bon.commande_id,
      created_by:       bon.created_by,
    })
  }

  ecritures.push({
    date, libelle,
    compte_syscohada: '401',
    compte_label:     libelleCompte('401'),
    debit_xaf:        0,
    credit_xaf:       montantTtc,
    reference_doc:    refDoc,
    commande_id:      bon.commande_id,
    created_by:       bon.created_by,
  })

  return insertEcritures(ecritures)
}

// ══════════════════════════════════════════════════════════════════════════════
// EXPORT plan comptable (pour les routes de rapports)
// ══════════════════════════════════════════════════════════════════════════════

export { PLAN_RAW as planComptable, libelleCompte }
