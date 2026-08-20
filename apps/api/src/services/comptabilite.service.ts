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
// Sans remise : Dr 411 TTC = Cr 701 HT NET + Cr 4431 TVA
// Avec remise (OHADA 7098) :
//   Dr 411 Clients          NET TTC
//   Cr 701/705 Ventes       BRUT HT
//   Dr 7098 Remises accordées REMISE HT
//   Cr 4431 TVA             TVA sur NET HT
// Équilibre : 411 + 7098 = 701 + 4431 ✓

export async function genererEcritureVente(facture: {
  id:                    string
  numero:                string
  date_emission:         string
  client_nom:            string
  total_ht_xaf:          number   // NET HT après remises = base imposable
  tva_xaf:               number
  frais_livraison_xaf?:  number | null
  total_ttc_xaf:         number   // NET TTC
  brut_ht_xaf?:          number   // BRUT HT avant remises (pour Cr 701)
  remise_totale_ht_xaf?: number   // Total remises HT (pour Dr 7098)
  created_by?:           string
  type_vente?:           'marchandises' | 'travaux' | 'services'
}): Promise<ComptaResult> {
  if (await ecrituresExistent('facture_id', facture.id)) {
    return { ok: true, inserts: 0 }
  }

  const compteVente = facture.type_vente === 'travaux'
    ? '705'
    : facture.type_vente === 'services'
    ? '706'
    : '701'

  const libelle          = `Vente — ${facture.numero} — ${facture.client_nom}`
  const date             = facture.date_emission.slice(0, 10)
  const fraisLivraison   = Math.round(Number(facture.frais_livraison_xaf ?? 0))
  const remiseHt         = Math.round(Number(facture.remise_totale_ht_xaf ?? 0))
  const brutHt           = remiseHt > 0 ? Math.round(Number(facture.brut_ht_xaf ?? facture.total_ht_xaf)) : facture.total_ht_xaf
  const creditVente      = remiseHt > 0 ? brutHt : facture.total_ht_xaf

  const common = { reference_doc: facture.numero, facture_id: facture.id, created_by: facture.created_by }

  const ecritures = [
    { date, libelle, compte_syscohada: '411', compte_label: libelleCompte('411'),
      debit_xaf: facture.total_ttc_xaf, credit_xaf: 0, ...common },
    { date, libelle, compte_syscohada: compteVente, compte_label: libelleCompte(compteVente),
      debit_xaf: 0, credit_xaf: creditVente, ...common },
    { date, libelle: `TVA collectée — ${facture.numero}`, compte_syscohada: '4431',
      compte_label: libelleCompte('4431'), debit_xaf: 0, credit_xaf: facture.tva_xaf, ...common },
  ]

  // Remise accordée : OHADA compte 7098 (débiteur — réduit les produits)
  if (remiseHt > 0) {
    ecritures.push({
      date, libelle: `Remises accordées — ${facture.numero}`,
      compte_syscohada: '7098', compte_label: libelleCompte('7098'),
      debit_xaf: remiseHt, credit_xaf: 0, ...common,
    })
  }

  if (fraisLivraison > 0) {
    ecritures.push({
      date, libelle: `Frais de livraison - ${facture.numero}`,
      compte_syscohada: '706', compte_label: libelleCompte('706'),
      debit_xaf: 0, credit_xaf: fraisLivraison, ...common,
    })
  }

  return insertEcritures(ecritures)
}

// ══════════════════════════════════════════════════════════════════════════════
// ÉCRITURES D'ENCAISSEMENT
// ══════════════════════════════════════════════════════════════════════════════
//
// Règlement d'une créance client
//   Dr 521 Banque, 571 Caisse ou 552x Mobile Money (montant encaissé)
//   Cr 411 Clients                                      (montant encaissé)

export type ModeEncaissementComptable =
  | 'banque'
  | 'caisse'
  | 'virement'
  | 'especes'
  | 'mtn_momo'
  | 'orange_money'
  | 'cheque'
  | 'autre'

export function compteEncaissement(mode: ModeEncaissementComptable = 'banque'): string {
  if (mode === 'caisse' || mode === 'especes') return '571'
  if (mode === 'mtn_momo') return '5521'
  if (mode === 'orange_money') return '5522'
  return '521'
}

export async function genererEcritureEncaissement(params: {
  facture_id?:  string
  credit_id?:   string
  reference:    string
  date:         string
  montant_xaf:  number
  client_nom:   string
  mode?:        ModeEncaissementComptable
  created_by?:  string
}): Promise<ComptaResult> {
  const ref   = `ENC-${params.reference}`
  const dejaFait = await ecrituresExistent('reference_doc', ref)
  if (dejaFait) return { ok: true, inserts: 0 }

  const compteTreso = compteEncaissement(params.mode)
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

export async function genererEcritureCharge(charge: {
  id:                  string
  numero:              string
  date_charge:         string
  fournisseur_nom:     string
  compte_charge:       string
  compte_charge_label: string
  montant_ht_xaf:      number
  tva_xaf?:            number
  montant_ttc_xaf:     number
  created_by?:         string
}): Promise<ComptaResult> {
  const refDoc = `CHG-${charge.numero}`
  if (await ecrituresExistent('reference_doc', refDoc)) return { ok: true, inserts: 0 }

  const date = charge.date_charge.slice(0, 10)
  const libelle = `Charge - ${charge.numero} - ${charge.fournisseur_nom}`
  const tva = Math.round(Number(charge.tva_xaf ?? 0))
  const ecritures: EcritureInsert[] = [
    {
      date,
      libelle,
      compte_syscohada: charge.compte_charge,
      compte_label:     charge.compte_charge_label,
      debit_xaf:        Math.round(Number(charge.montant_ht_xaf ?? 0)),
      credit_xaf:       0,
      reference_doc:    refDoc,
      created_by:       charge.created_by,
    },
  ]

  if (tva > 0) {
    ecritures.push({
      date,
      libelle:          `TVA deductible - ${charge.numero}`,
      compte_syscohada: '4432',
      compte_label:     libelleCompte('4432'),
      debit_xaf:        tva,
      credit_xaf:       0,
      reference_doc:    refDoc,
      created_by:       charge.created_by,
    })
  }

  ecritures.push({
    date,
    libelle,
    compte_syscohada: '401',
    compte_label:     libelleCompte('401'),
    debit_xaf:        0,
    credit_xaf:       Math.round(Number(charge.montant_ttc_xaf ?? 0)),
    reference_doc:    refDoc,
    created_by:       charge.created_by,
  })

  return insertEcritures(ecritures)
}

export async function genererEcritureSortieTresorerie(sortie: {
  id:                string
  numero:            string
  date_sortie:       string
  beneficiaire:      string
  motif:             string
  montant_xaf:       number
  compte_tresorerie: string
  charge_id?:        string | null
  compte_debit?:     string
  created_by?:       string
}): Promise<ComptaResult> {
  const refDoc = `SOR-${sortie.numero}`
  if (await ecrituresExistent('reference_doc', refDoc)) return { ok: true, inserts: 0 }

  const date = sortie.date_sortie.slice(0, 10)
  const libelle = `Sortie d'argent - ${sortie.numero} - ${sortie.beneficiaire}`
  const compteDebit = sortie.compte_debit ?? (sortie.charge_id ? '401' : '471')

  return insertEcritures([
    {
      date,
      libelle,
      compte_syscohada: compteDebit,
      compte_label:     libelleCompte(compteDebit),
      debit_xaf:        Math.round(Number(sortie.montant_xaf ?? 0)),
      credit_xaf:       0,
      reference_doc:    refDoc,
      created_by:       sortie.created_by,
    },
    {
      date,
      libelle,
      compte_syscohada: sortie.compte_tresorerie,
      compte_label:     libelleCompte(sortie.compte_tresorerie),
      debit_xaf:        0,
      credit_xaf:       Math.round(Number(sortie.montant_xaf ?? 0)),
      reference_doc:    refDoc,
      created_by:       sortie.created_by,
    },
  ])
}

export async function genererEcrituresPaieValidation(paie: {
  mois: string
  total_brut_xaf: number
  cnps_salarie_xaf: number
  cnps_employeur_xaf: number
  irpp_xaf: number
  total_avances_deduites_xaf: number
  total_retenues_deduites_xaf: number
  total_autres_deductions_xaf: number
  net_a_payer_xaf: number
  created_by?: string
}): Promise<ComptaResult> {
  const refDoc = `PAIE-${paie.mois}`
  if (await ecrituresExistent('reference_doc', refDoc)) return { ok: true, inserts: 0 }

  const date = `${paie.mois}-28`
  const libelle = `Paie mensuelle - ${paie.mois}`
  const ecritures: EcritureInsert[] = [
    {
      date,
      libelle,
      compte_syscohada: '641',
      compte_label:     libelleCompte('641'),
      debit_xaf:        Math.round(Number(paie.total_brut_xaf ?? 0)),
      credit_xaf:       0,
      reference_doc:    refDoc,
      created_by:       paie.created_by,
    },
    {
      date,
      libelle:          `Charges sociales employeur - ${paie.mois}`,
      compte_syscohada: '645',
      compte_label:     libelleCompte('645'),
      debit_xaf:        Math.round(Number(paie.cnps_employeur_xaf ?? 0)),
      credit_xaf:       0,
      reference_doc:    refDoc,
      created_by:       paie.created_by,
    },
    {
      date,
      libelle,
      compte_syscohada: '421',
      compte_label:     libelleCompte('421'),
      debit_xaf:        0,
      credit_xaf:       Math.round(Number(paie.net_a_payer_xaf ?? 0)),
      reference_doc:    refDoc,
      created_by:       paie.created_by,
    },
    {
      date,
      libelle:          `CNPS a reverser - ${paie.mois}`,
      compte_syscohada: '431',
      compte_label:     libelleCompte('431'),
      debit_xaf:        0,
      credit_xaf:       Math.round(Number(paie.cnps_salarie_xaf ?? 0) + Number(paie.cnps_employeur_xaf ?? 0)),
      reference_doc:    refDoc,
      created_by:       paie.created_by,
    },
    {
      date,
      libelle:          `IRPP a reverser - ${paie.mois}`,
      compte_syscohada: '447',
      compte_label:     libelleCompte('447'),
      debit_xaf:        0,
      credit_xaf:       Math.round(Number(paie.irpp_xaf ?? 0)),
      reference_doc:    refDoc,
      created_by:       paie.created_by,
    },
  ]

  if (paie.total_avances_deduites_xaf > 0) {
    ecritures.push({
      date,
      libelle:          `Avances deduites - ${paie.mois}`,
      compte_syscohada: '422',
      compte_label:     libelleCompte('422'),
      debit_xaf:        0,
      credit_xaf:       Math.round(Number(paie.total_avances_deduites_xaf ?? 0)),
      reference_doc:    refDoc,
      created_by:       paie.created_by,
    })
  }

  const autresRetenues = Math.round(Number(paie.total_retenues_deduites_xaf ?? 0) + Number(paie.total_autres_deductions_xaf ?? 0))
  if (autresRetenues > 0) {
    ecritures.push({
      date,
      libelle:          `Retenues salariales - ${paie.mois}`,
      compte_syscohada: '472',
      compte_label:     libelleCompte('472'),
      debit_xaf:        0,
      credit_xaf:       autresRetenues,
      reference_doc:    refDoc,
      created_by:       paie.created_by,
    })
  }

  return insertEcritures(ecritures)
}

export async function genererEcrituresPaiePaiement(paiement: {
  mois: string
  date: string
  montant_xaf: number
  compte_tresorerie: string
  created_by?: string
}): Promise<ComptaResult> {
  const refDoc = `PAY-PAIE-${paiement.mois}`
  if (await ecrituresExistent('reference_doc', refDoc)) return { ok: true, inserts: 0 }

  const date = paiement.date.slice(0, 10)
  const libelle = `Paiement salaires - ${paiement.mois}`
  return insertEcritures([
    {
      date,
      libelle,
      compte_syscohada: '421',
      compte_label:     libelleCompte('421'),
      debit_xaf:        Math.round(Number(paiement.montant_xaf ?? 0)),
      credit_xaf:       0,
      reference_doc:    refDoc,
      created_by:       paiement.created_by,
    },
    {
      date,
      libelle,
      compte_syscohada: paiement.compte_tresorerie,
      compte_label:     libelleCompte(paiement.compte_tresorerie),
      debit_xaf:        0,
      credit_xaf:       Math.round(Number(paiement.montant_xaf ?? 0)),
      reference_doc:    refDoc,
      created_by:       paiement.created_by,
    },
  ])
}

export async function annulerEcrituresReference(params: {
  reference_doc: string
  date: string
  created_by?: string
}): Promise<ComptaResult> {
  const refAnnulation = `ANN-${params.reference_doc}`
  if (await ecrituresExistent('reference_doc', refAnnulation)) return { ok: true, inserts: 0 }

  const { data, error } = await db
    .from('ecritures_comptables')
    .select('libelle, compte_syscohada, compte_label, debit_xaf, credit_xaf')
    .eq('reference_doc', params.reference_doc)

  if (error) return { ok: false, inserts: 0, error: error.message }

  const originals = (data ?? []) as Array<{
    libelle: string
    compte_syscohada: string
    compte_label: string
    debit_xaf: number
    credit_xaf: number
  }>

  if (originals.length === 0) return { ok: true, inserts: 0 }

  return insertEcritures(originals.map((e) => ({
    date:             params.date.slice(0, 10),
    libelle:          `Annulation - ${e.libelle}`,
    compte_syscohada: e.compte_syscohada,
    compte_label:     e.compte_label,
    debit_xaf:        Math.round(Number(e.credit_xaf ?? 0)),
    credit_xaf:       Math.round(Number(e.debit_xaf ?? 0)),
    reference_doc:    refAnnulation,
    created_by:       params.created_by,
  })))
}

export { PLAN_RAW as planComptable, libelleCompte }

// ══════════════════════════════════════════════════════════════════════════════
// ÉCRITURE BON DE SORTIE INTERNE (vente boutique → atelier/admin)
// ══════════════════════════════════════════════════════════════════════════════
//
//   comptant        : Dr 512 Banque      / Cr 701 Ventes
//   credit          : Dr 411 Clients     / Cr 701 Ventes  (créance ouverte)
//   deduction_acompte: Dr 419 Avances reçues / Cr 701 Ventes (acompte consommé)

export async function genererEcritureBonSortieInterne(bon: {
  numero:             string
  date:               string
  montant_xaf:        number
  nature_transaction: 'comptant' | 'credit' | 'deduction_acompte'
  imputation_payeur:  string
  commande_id?:       string | null
  created_by?:        string
}): Promise<ComptaResult> {
  if (!bon.montant_xaf || bon.montant_xaf <= 0) return { ok: true, inserts: 0 }

  const refDoc = `BON-${bon.numero}`
  if (await ecrituresExistent('reference_doc', refDoc)) return { ok: true, inserts: 0 }

  const date    = bon.date.slice(0, 10)
  const payeur  = bon.imputation_payeur.replace(/_/g, ' ')
  const libelle = `Sortie stock interne ${bon.nature_transaction} — ${bon.numero} — ${payeur}`
  const montant = Math.round(bon.montant_xaf)

  const cptContre =
    bon.nature_transaction === 'comptant'          ? '512'  // Banque
    : bon.nature_transaction === 'credit'          ? '411'  // Clients — créance
    :                                                '419'  // Avances et acomptes reçus

  const common = {
    date,
    libelle,
    reference_doc: refDoc,
    commande_id:   bon.commande_id ?? undefined,
    created_by:    bon.created_by,
  }

  const ecritures: EcritureInsert[] = [
    {
      ...common,
      compte_syscohada: cptContre,
      compte_label:     libelleCompte(cptContre),
      debit_xaf:        montant,
      credit_xaf:       0,
    },
    {
      ...common,
      compte_syscohada: '701',
      compte_label:     libelleCompte('701'),
      debit_xaf:        0,
      credit_xaf:       montant,
    },
  ]

  return insertEcritures(ecritures)
}

// ══════════════════════════════════════════════════════════════════════════════
// ÉCRITURE VENTE CAISSE (comptoir) — vente et encaissement en un seul passage
// ══════════════════════════════════════════════════════════════════════════════
//
// Contrairement à une facture (vente à crédit, encaissée plus tard via
// genererEcritureEncaissement), un ticket de caisse est déjà réglé au moment
// de l'émission — sauf la part éventuellement payée en mode 'credit', qui
// reste une créance client (411), exactement comme une facture non soldée.
//
//   par mode de paiement espèces/mobile money/carte : Dr 571/552x/521 (montant)
//   par part payée en 'credit'                       : Dr 411 Clients (montant)
//   Cr 701 Ventes marchandises                        HT
//   Cr 4431 TVA collectée                              TVA
//
// Équilibré par construction : somme(paiements) = total_ttc_xaf = HT + TVA
// (déjà garanti par apps/api/src/routes/caisse.ts avant l'appel).

function compteEncaissementCaisse(mode: 'espece' | 'orange_money' | 'mtn_momo' | 'carte'): ModeEncaissementComptable {
  if (mode === 'espece') return 'especes'
  if (mode === 'carte')  return 'banque'
  return mode
}

export async function genererEcritureVenteCaisse(ticket: {
  id:            string
  numero:        string
  date:          string
  client_nom?:   string | null
  total_ht_xaf:  number
  tva_xaf:       number
  created_by?:   string
  paiements:     Array<{ mode: 'espece' | 'orange_money' | 'mtn_momo' | 'credit' | 'carte'; montant_xaf: number }>
}): Promise<ComptaResult> {
  const refDoc = `CAI-${ticket.numero}`
  if (await ecrituresExistent('reference_doc', refDoc)) return { ok: true, inserts: 0 }

  const date    = ticket.date.slice(0, 10)
  const libelle = `Vente comptoir — ${ticket.numero}${ticket.client_nom ? ` — ${ticket.client_nom}` : ''}`
  const common  = { date, libelle, reference_doc: refDoc, created_by: ticket.created_by }

  const ecritures: EcritureInsert[] = []

  for (const p of ticket.paiements) {
    const montant = Math.round(p.montant_xaf)
    if (montant <= 0) continue
    const compte = p.mode === 'credit' ? '411' : compteEncaissement(compteEncaissementCaisse(p.mode))
    ecritures.push({
      ...common,
      compte_syscohada: compte,
      compte_label:     libelleCompte(compte),
      debit_xaf:        montant,
      credit_xaf:       0,
    })
  }

  ecritures.push({
    ...common,
    compte_syscohada: '701',
    compte_label:     libelleCompte('701'),
    debit_xaf:        0,
    credit_xaf:       Math.round(ticket.total_ht_xaf),
  })

  // TVA désactivée temporairement côté Caisse (apps/api/src/routes/caisse.ts,
  // TVA_RATE = 0) — pas d'écriture 4431 à montant nul.
  if (ticket.tva_xaf > 0) {
    ecritures.push({
      ...common,
      libelle:          `TVA collectée — ${ticket.numero}`,
      compte_syscohada: '4431',
      compte_label:     libelleCompte('4431'),
      debit_xaf:        0,
      credit_xaf:       Math.round(ticket.tva_xaf),
    })
  }

  return insertEcritures(ecritures)
}
