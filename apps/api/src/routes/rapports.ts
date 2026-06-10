import { Hono, type Context } from 'hono'
import { supabaseAdmin } from '@forge/db'

const db = supabaseAdmin!
import { requireRole } from '../middleware/rbac'
import { planComptable } from '../services/comptabilite.service'
import type { HonoVariables } from '../types'

const router = new Hono<{ Variables: HonoVariables }>()
type RapportsContext = Context<{ Variables: HonoVariables }>

// ── Types internes ─────────────────────────────────────────────────────────────

interface Ecriture {
  id?:               string
  date:             string
  libelle:          string
  compte_syscohada: string
  compte_label:     string
  debit_xaf:        number
  credit_xaf:       number
  reference_doc:    string | null
}

// ── Helper: plage de dates ─────────────────────────────────────────────────────

function exercicePlage(exercice: string) {
  return { debut: `${exercice}-01-01`, fin: `${exercice}-12-31` }
}

function moisPlage(mois: string) {
  const [year, m] = mois.split('-').map(Number)
  const lastDay   = new Date(year, m, 0).getDate()
  return { debut: `${mois}-01`, fin: `${mois}-${String(lastDay).padStart(2, '0')}` }
}

function metaCompte(compte: string) {
  const classe = compte[0]
  if (classe === '1') return { categorie: 'capitaux_dettes', nature: 'passif', sens_normal: 'credit', rubrique: 'Bilan - Passif' }
  if (classe === '2') return { categorie: 'immobilisations', nature: 'actif', sens_normal: 'debit', rubrique: 'Bilan - Actif immobilise' }
  if (classe === '3') return { categorie: 'stocks', nature: 'actif', sens_normal: 'debit', rubrique: 'Bilan - Stocks' }
  if (classe === '4') {
    if (compte.startsWith('401') || compte.startsWith('419') || compte.startsWith('4431') || compte.startsWith('4446')) {
      return { categorie: 'tiers', nature: 'passif', sens_normal: 'credit', rubrique: 'Bilan - Dettes tiers/taxes' }
    }
    return { categorie: 'tiers', nature: 'actif', sens_normal: 'debit', rubrique: 'Bilan - Creances tiers/taxes' }
  }
  if (classe === '5') return { categorie: 'tresorerie', nature: 'actif', sens_normal: 'debit', rubrique: 'Bilan - Tresorerie' }
  if (classe === '6') return { categorie: 'charge', nature: 'charge', sens_normal: 'debit', rubrique: 'Compte de resultat - Charges' }
  if (classe === '7') return { categorie: 'produit', nature: 'produit', sens_normal: 'credit', rubrique: 'Compte de resultat - Produits' }
  if (classe === '8') return { categorie: 'resultat', nature: 'resultat', sens_normal: 'credit', rubrique: 'Resultat' }
  return { categorie: 'autre', nature: 'autre', sens_normal: 'debit', rubrique: 'Autre' }
}

function escapeXml(value: unknown) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function xlsResponse(c: RapportsContext, filename: string, html: string) {
  c.header('Content-Type', 'application/vnd.ms-excel; charset=utf-8')
  c.header('Content-Disposition', `attachment; filename="${filename}"`)
  c.header('Cache-Control', 'no-store')
  return c.body('\ufeff' + html)
}

// ══════════════════════════════════════════════════════════════════════════════
// GRAND LIVRE
// GET /api/rapports/grand-livre?compte=411&debut=2026-01-01&fin=2026-12-31
// ══════════════════════════════════════════════════════════════════════════════

type EcritureAgg = {
  compte_syscohada: string
  compte_label: string
  debit_xaf: number
  credit_xaf: number
}

type CompteRapport = {
  compte: string
  compte_label: string
  total_debit_xaf: number
  total_credit_xaf: number
  solde_xaf: number
  solde_debiteur_xaf: number
  solde_crediteur_xaf: number
  categorie: string
  nature: string
  rubrique: string
}

async function comptesAgreges(debut: string, fin: string) {
  const { data, error } = await db
    .from('ecritures_comptables')
    .select('compte_syscohada, compte_label, debit_xaf, credit_xaf')
    .gte('date', debut)
    .lte('date', fin)

  if (error) throw error

  const planMap = new Map(
    (planComptable as { compte: string; libelle: string }[]).map((p) => [p.compte, p.libelle]),
  )
  const map = new Map<string, { label: string; debit: number; credit: number }>()

  for (const e of (data ?? []) as EcritureAgg[]) {
    const ex = map.get(e.compte_syscohada) ?? { label: e.compte_label, debit: 0, credit: 0 }
    ex.debit += Number(e.debit_xaf ?? 0)
    ex.credit += Number(e.credit_xaf ?? 0)
    map.set(e.compte_syscohada, ex)
  }

  return Array.from(map.entries())
    .map(([compte, { label, debit, credit }]) => {
      const solde = debit - credit
      return {
        compte,
        compte_label: planMap.get(compte) ?? label,
        total_debit_xaf: Math.round(debit),
        total_credit_xaf: Math.round(credit),
        solde_xaf: Math.round(solde),
        solde_debiteur_xaf: solde >= 0 ? Math.round(solde) : 0,
        solde_crediteur_xaf: solde < 0 ? Math.round(-solde) : 0,
        ...metaCompte(compte),
      } as CompteRapport
    })
    .sort((a, b) => a.compte.localeCompare(b.compte))
}

function groupeComptes(comptes: CompteRapport[], sens: 'actif' | 'passif' | 'charge' | 'produit') {
  const map = new Map<string, { rubrique: string; total_xaf: number; comptes: Array<CompteRapport & { montant_xaf: number }> }>()

  for (const compte of comptes) {
    let montant = 0
    if (sens === 'actif') montant = compte.solde_xaf
    if (sens === 'passif') montant = -compte.solde_xaf
    if (sens === 'charge') montant = Math.max(0, compte.total_debit_xaf - compte.total_credit_xaf)
    if (sens === 'produit') montant = Math.max(0, compte.total_credit_xaf - compte.total_debit_xaf)
    if (montant <= 0) continue

    const current = map.get(compte.rubrique) ?? { rubrique: compte.rubrique, total_xaf: 0, comptes: [] }
    current.total_xaf += Math.round(montant)
    current.comptes.push({ ...compte, montant_xaf: Math.round(montant) })
    map.set(compte.rubrique, current)
  }

  return Array.from(map.values()).map((g) => ({ ...g, total_xaf: Math.round(g.total_xaf) }))
}

function resultatDepuisComptes(comptes: CompteRapport[]) {
  const produits = comptes.filter((c) => c.compte.startsWith('7'))
  const charges = comptes.filter((c) => c.compte.startsWith('6'))
  const totalProduits = produits.reduce((s, c) => s + Math.max(0, c.total_credit_xaf - c.total_debit_xaf), 0)
  const totalCharges = charges.reduce((s, c) => s + Math.max(0, c.total_debit_xaf - c.total_credit_xaf), 0)

  return {
    produits,
    charges,
    total_produits_xaf: Math.round(totalProduits),
    total_charges_xaf: Math.round(totalCharges),
    resultat_net_xaf: Math.round(totalProduits - totalCharges),
  }
}

async function financeAgregee(debut: string, fin: string) {
  const { data, error } = await db
    .from('factures')
    .select('statut, total_ht_xaf, tva_xaf, total_ttc_xaf, montant_paye_xaf')
    .neq('statut', 'annule')
    .gte('date_emission', debut)
    .lte('date_emission', fin)

  if (error) throw error

  return ((data ?? []) as Array<Record<string, unknown>>).reduce<{
    factures: number
    ca_facture_ht_xaf: number
    tva_facturee_xaf: number
    ca_facture_ttc_xaf: number
    encaisse_xaf: number
    reste_a_encaisser_xaf: number
  }>((acc, facture) => {
    const totalTtc = Number(facture.total_ttc_xaf ?? 0)
    const montantPaye = Number(facture.montant_paye_xaf ?? 0)
    acc.factures += 1
    acc.ca_facture_ht_xaf += Number(facture.total_ht_xaf ?? 0)
    acc.tva_facturee_xaf += Number(facture.tva_xaf ?? 0)
    acc.ca_facture_ttc_xaf += totalTtc
    acc.encaisse_xaf += montantPaye
    acc.reste_a_encaisser_xaf += Math.max(0, totalTtc - montantPaye)
    return acc
  }, {
    factures: 0,
    ca_facture_ht_xaf: 0,
    tva_facturee_xaf: 0,
    ca_facture_ttc_xaf: 0,
    encaisse_xaf: 0,
    reste_a_encaisser_xaf: 0,
  })
}

async function chargesAgregees(debut: string, fin: string) {
  const [chargesRes, sortiesRes, ecrituresRes] = await Promise.all([
    db
      .from('charges')
      .select('id, numero, statut, montant_ht_xaf, tva_xaf, montant_paye_xaf, justificatif_statut')
      .neq('statut', 'annulee')
      .gte('date_charge', debut)
      .lte('date_charge', fin),
    db
      .from('sorties_tresorerie')
      .select('id, numero, charge_id, montant_xaf, justificatif_statut')
      .neq('statut', 'annulee')
      .gte('date_sortie', debut)
      .lte('date_sortie', fin),
    db
      .from('ecritures_comptables')
      .select('reference_doc, compte_syscohada, debit_xaf, credit_xaf')
      .gte('date', debut)
      .lte('date', fin),
  ])

  if (chargesRes.error) throw chargesRes.error
  if (sortiesRes.error) throw sortiesRes.error
  if (ecrituresRes.error) throw ecrituresRes.error

  type Charge = {
    id: string
    numero: string
    statut: string
    montant_ht_xaf: number
    tva_xaf: number
    montant_paye_xaf: number
    justificatif_statut: string
  }
  type Sortie = {
    numero: string
    charge_id?: string | null
    montant_xaf: number
    justificatif_statut: string
  }
  type EcritureControle = {
    reference_doc?: string | null
    compte_syscohada: string
    debit_xaf: number
    credit_xaf: number
  }

  const charges = (chargesRes.data ?? []) as Charge[]
  const sorties = (sortiesRes.data ?? []) as Sortie[]
  const ecritures = (ecrituresRes.data ?? []) as EcritureControle[]
  const refs = new Set(ecritures.map((e) => e.reference_doc).filter(Boolean) as string[])
  const sortiesParCharge = new Map<string, number>()
  for (const sortie of sorties) {
    if (!sortie.charge_id) continue
    sortiesParCharge.set(sortie.charge_id, (sortiesParCharge.get(sortie.charge_id) ?? 0) + Number(sortie.montant_xaf ?? 0))
  }

  const chargesValidees = charges.filter((charge) => ['validee', 'payee'].includes(charge.statut))
  const chargesHtValidees = chargesValidees.reduce((s, charge) => s + Number(charge.montant_ht_xaf ?? 0), 0)
  const tvaDeductible = chargesValidees.reduce((s, charge) => s + Number(charge.tva_xaf ?? 0), 0)
  const chargesComptables = ecritures
    .filter((e) => e.compte_syscohada.startsWith('6'))
    .reduce((s, e) => s + Number(e.debit_xaf ?? 0) - Number(e.credit_xaf ?? 0), 0)
  const tvaDeductibleComptable = ecritures
    .filter((e) => e.compte_syscohada.startsWith('4432'))
    .reduce((s, e) => s + Number(e.debit_xaf ?? 0) - Number(e.credit_xaf ?? 0), 0)

  return {
    charges_total: charges.length,
    charges_validees: chargesValidees.length,
    sorties_total: sorties.length,
    charges_ht_validees_xaf: Math.round(chargesHtValidees),
    tva_deductible_xaf: Math.round(tvaDeductible),
    charges_comptables_xaf: Math.round(chargesComptables),
    tva_deductible_comptable_xaf: Math.round(tvaDeductibleComptable),
    ecart_charges_ht_xaf: Math.round(chargesComptables - chargesHtValidees),
    ecart_tva_deductible_xaf: Math.round(tvaDeductibleComptable - tvaDeductible),
    charges_sans_ecriture: chargesValidees.filter((charge) => !refs.has(`CHG-${charge.numero}`)).map((charge) => charge.numero),
    sorties_sans_ecriture: sorties.filter((sortie) => !refs.has(`SOR-${sortie.numero}`)).map((sortie) => sortie.numero),
    paiements_incoherents: chargesValidees
      .filter((charge) => Math.abs(Math.round(sortiesParCharge.get(charge.id) ?? 0) - Number(charge.montant_paye_xaf ?? 0)) > 1)
      .map((charge) => charge.numero),
    justificatifs_manquants: [
      ...charges.filter((charge) => charge.justificatif_statut === 'manquant').map((charge) => charge.numero),
      ...sorties.filter((sortie) => sortie.justificatif_statut === 'manquant').map((sortie) => sortie.numero),
    ],
  }
}

router.get('/grand-livre', requireRole(['admin', 'superviseur']), async (c) => {
  const { compte, debut, fin, exercice } = c.req.query()

  if (!compte) {
    return c.json({ error: 'Paramètre compte requis (ex: ?compte=411)', code: 'MISSING_PARAM' }, 400)
  }

  const dateDebut = debut ?? (exercice ? exercicePlage(exercice).debut : `${new Date().getFullYear()}-01-01`)
  const dateFin   = fin   ?? (exercice ? exercicePlage(exercice).fin   : `${new Date().getFullYear()}-12-31`)

  const { data, error } = await db
    .from('ecritures_comptables')
    .select('id, date, libelle, compte_syscohada, compte_label, debit_xaf, credit_xaf, reference_doc')
    .eq('compte_syscohada', compte)
    .gte('date', dateDebut)
    .lte('date', dateFin)
    .order('date', { ascending: true })
    .order('created_at', { ascending: true })

  if (error) return c.json({ error: error.message }, 500)

  const ecritures = (data ?? []) as Ecriture[]
  const plan = (planComptable as { compte: string; libelle: string }[]).find((p) => p.compte === compte)
  const meta = metaCompte(compte)

  // Calcul du solde progressif
  let solde = 0
  const lignes = ecritures.map(e => {
    solde = solde + e.debit_xaf - e.credit_xaf
    return {
      id:            e.id,
      date:          e.date,
      libelle:       e.libelle,
      reference:     e.reference_doc,
      debit_xaf:     e.debit_xaf,
      credit_xaf:    e.credit_xaf,
      solde_xaf:     solde,
      sens:          solde >= 0 ? 'D' : 'C',
    }
  })

  const total_debit  = ecritures.reduce((s, e) => s + e.debit_xaf, 0)
  const total_credit = ecritures.reduce((s, e) => s + e.credit_xaf, 0)

  return c.json({
    compte,
    compte_label: plan?.libelle ?? ecritures[0]?.compte_label ?? `Compte ${compte}`,
    ...meta,
    periode:      { debut: dateDebut, fin: dateFin },
    lignes,
    total_debit_xaf:  Math.round(total_debit),
    total_credit_xaf: Math.round(total_credit),
    solde_final_xaf:  Math.round(total_debit - total_credit),
    solde_sens:       total_debit >= total_credit ? 'Débiteur' : 'Créditeur',
  })
})

router.get('/grand-livre.xls', requireRole(['admin', 'superviseur']), async (c) => {
  const { compte, debut, fin, exercice } = c.req.query()
  if (!compte) return c.json({ error: 'Parametre compte requis', code: 'MISSING_PARAM' }, 400)

  const dateDebut = debut ?? (exercice ? exercicePlage(exercice).debut : `${new Date().getFullYear()}-01-01`)
  const dateFin   = fin   ?? (exercice ? exercicePlage(exercice).fin   : `${new Date().getFullYear()}-12-31`)

  const { data, error } = await db
    .from('ecritures_comptables')
    .select('date, libelle, compte_syscohada, compte_label, debit_xaf, credit_xaf, reference_doc')
    .eq('compte_syscohada', compte)
    .gte('date', dateDebut)
    .lte('date', dateFin)
    .order('date', { ascending: true })
    .order('created_at', { ascending: true })

  if (error) return c.json({ error: error.message }, 500)

  const ecritures = (data ?? []) as Ecriture[]
  let solde = 0
  const rows = ecritures.map((e) => {
    solde += Number(e.debit_xaf ?? 0) - Number(e.credit_xaf ?? 0)
    return `<tr>
      <td>${escapeXml(e.date)}</td>
      <td>${escapeXml(e.reference_doc)}</td>
      <td>${escapeXml(e.libelle)}</td>
      <td>${escapeXml(e.compte_syscohada)}</td>
      <td>${escapeXml(e.compte_label)}</td>
      <td>${Math.round(Number(e.debit_xaf ?? 0))}</td>
      <td>${Math.round(Number(e.credit_xaf ?? 0))}</td>
      <td>${Math.round(solde)}</td>
      <td>${solde >= 0 ? 'Debiteur' : 'Crediteur'}</td>
    </tr>`
  }).join('')

  const totalDebit = ecritures.reduce((s, e) => s + Number(e.debit_xaf ?? 0), 0)
  const totalCredit = ecritures.reduce((s, e) => s + Number(e.credit_xaf ?? 0), 0)
  const label = (planComptable as { compte: string; libelle: string }[]).find((p) => p.compte === compte)?.libelle ?? ecritures[0]?.compte_label ?? `Compte ${compte}`
  const html = `<html><head><meta charset="utf-8" /></head><body>
    <h1>Grand livre general</h1>
    <p>Compte : ${escapeXml(compte)} - ${escapeXml(label)} | Periode : ${escapeXml(dateDebut)} au ${escapeXml(dateFin)} | Devise : XAF</p>
    <table border="1">
      <thead><tr><th>Date</th><th>Reference</th><th>Libelle</th><th>Compte</th><th>Libelle compte</th><th>Debit</th><th>Credit</th><th>Solde progressif</th><th>Sens</th></tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr><th colspan="5">Totaux</th><th>${Math.round(totalDebit)}</th><th>${Math.round(totalCredit)}</th><th>${Math.round(totalDebit - totalCredit)}</th><th>${totalDebit >= totalCredit ? 'Debiteur' : 'Crediteur'}</th></tr></tfoot>
    </table>
  </body></html>`

  return xlsResponse(c, `grand-livre-${compte}-${dateDebut}-${dateFin}.xls`, html)
})

// ══════════════════════════════════════════════════════════════════════════════
// BALANCE DES COMPTES
// GET /api/rapports/balance?exercice=2026
// ══════════════════════════════════════════════════════════════════════════════

router.get('/balance', requireRole(['admin', 'superviseur']), async (c) => {
  const exercice = c.req.query('exercice') ?? String(new Date().getFullYear())
  const { debut, fin } = exercicePlage(exercice)

  const { data, error } = await db
    .from('ecritures_comptables')
    .select('compte_syscohada, compte_label, debit_xaf, credit_xaf')
    .gte('date', debut)
    .lte('date', fin)

  if (error) return c.json({ error: error.message }, 500)

  type EC = { compte_syscohada: string; compte_label: string; debit_xaf: number; credit_xaf: number }
  const map = new Map<string, { label: string; debit: number; credit: number }>()

  for (const e of (data ?? []) as EC[]) {
    const ex = map.get(e.compte_syscohada) ?? { label: e.compte_label, debit: 0, credit: 0 }
    ex.debit  += e.debit_xaf
    ex.credit += e.credit_xaf
    map.set(e.compte_syscohada, ex)
  }

  // Enrichir avec les libellés du plan comptable pour les comptes sans écriture
  const planMap = new Map(
    (planComptable as { compte: string; libelle: string }[]).map(p => [p.compte, p.libelle]),
  )

  const comptes = Array.from(map.entries())
    .map(([compte, { label, debit, credit }]) => {
      const solde = debit - credit
      return {
        compte,
        compte_label:       planMap.get(compte) ?? label,
        total_debit_xaf:    Math.round(debit),
        total_credit_xaf:   Math.round(credit),
        solde_debiteur_xaf: solde >= 0 ? Math.round(solde) : 0,
        solde_crediteur_xaf:solde <  0 ? Math.round(-solde) : 0,
      }
    })
    .sort((a, b) => a.compte.localeCompare(b.compte))

  const totaux = comptes.reduce(
    (acc, c) => ({
      debit:     acc.debit     + c.total_debit_xaf,
      credit:    acc.credit    + c.total_credit_xaf,
      debiteur:  acc.debiteur  + c.solde_debiteur_xaf,
      crediteur: acc.crediteur + c.solde_crediteur_xaf,
    }),
    { debit: 0, credit: 0, debiteur: 0, crediteur: 0 },
  )

  return c.json({
    exercice,
    periode:                { debut, fin },
    comptes,
    total_debit_xaf:        totaux.debit,
    total_credit_xaf:       totaux.credit,
    total_solde_debiteur:   totaux.debiteur,
    total_solde_crediteur:  totaux.crediteur,
    equilibre:              Math.abs(totaux.debit - totaux.credit) < 1,
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// DÉCLARATION TVA MENSUELLE
// GET /api/rapports/declarations/tva?mois=2026-05
// ══════════════════════════════════════════════════════════════════════════════

router.get('/bilan', requireRole(['admin', 'superviseur']), async (c) => {
  const exercice = c.req.query('exercice') ?? String(new Date().getFullYear())
  const { debut, fin } = exercicePlage(exercice)

  try {
    const comptes = await comptesAgreges(debut, fin)
    const bilanComptes = comptes.filter((cpt) => ['1', '2', '3', '4', '5'].includes(cpt.compte[0]))
    const resultat = resultatDepuisComptes(comptes)

    const actif = groupeComptes(bilanComptes.filter((cpt) => cpt.nature === 'actif'), 'actif')
    const passif = groupeComptes(bilanComptes.filter((cpt) => cpt.nature === 'passif'), 'passif')

    if (resultat.resultat_net_xaf > 0) {
      passif.unshift({
        rubrique: 'Bilan - Resultat de l exercice',
        total_xaf: resultat.resultat_net_xaf,
        comptes: [{
          compte: '129',
          compte_label: 'Resultat beneficiaire de l exercice',
          total_debit_xaf: 0,
          total_credit_xaf: resultat.resultat_net_xaf,
          solde_xaf: -resultat.resultat_net_xaf,
          solde_debiteur_xaf: 0,
          solde_crediteur_xaf: resultat.resultat_net_xaf,
          categorie: 'resultat',
          nature: 'passif',
          rubrique: 'Bilan - Resultat de l exercice',
          montant_xaf: resultat.resultat_net_xaf,
        }],
      })
    } else if (resultat.resultat_net_xaf < 0) {
      actif.unshift({
        rubrique: 'Bilan - Perte de l exercice',
        total_xaf: Math.abs(resultat.resultat_net_xaf),
        comptes: [{
          compte: '129',
          compte_label: 'Perte de l exercice',
          total_debit_xaf: Math.abs(resultat.resultat_net_xaf),
          total_credit_xaf: 0,
          solde_xaf: Math.abs(resultat.resultat_net_xaf),
          solde_debiteur_xaf: Math.abs(resultat.resultat_net_xaf),
          solde_crediteur_xaf: 0,
          categorie: 'resultat',
          nature: 'actif',
          rubrique: 'Bilan - Perte de l exercice',
          montant_xaf: Math.abs(resultat.resultat_net_xaf),
        }],
      })
    }

    const totalActif = actif.reduce((s, g) => s + g.total_xaf, 0)
    const totalPassif = passif.reduce((s, g) => s + g.total_xaf, 0)

    return c.json({
      exercice,
      periode: { debut, fin },
      actif,
      passif,
      resultat_exercice_xaf: resultat.resultat_net_xaf,
      total_actif_xaf: Math.round(totalActif),
      total_passif_xaf: Math.round(totalPassif),
      ecart_xaf: Math.round(totalActif - totalPassif),
      equilibre: Math.abs(totalActif - totalPassif) < 1,
    })
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Erreur bilan' }, 500)
  }
})

router.get('/bilan.xls', requireRole(['admin', 'superviseur']), async (c) => {
  const exercice = c.req.query('exercice') ?? String(new Date().getFullYear())
  const { debut, fin } = exercicePlage(exercice)

  try {
    const comptes = await comptesAgreges(debut, fin)
    const bilanComptes = comptes.filter((cpt) => ['1', '2', '3', '4', '5'].includes(cpt.compte[0]))
    const resultat = resultatDepuisComptes(comptes)
    const actif = groupeComptes(bilanComptes.filter((cpt) => cpt.nature === 'actif'), 'actif')
    const passif = groupeComptes(bilanComptes.filter((cpt) => cpt.nature === 'passif'), 'passif')

    if (resultat.resultat_net_xaf > 0) {
      passif.unshift({ rubrique: 'Bilan - Resultat de l exercice', total_xaf: resultat.resultat_net_xaf, comptes: [] })
    } else if (resultat.resultat_net_xaf < 0) {
      actif.unshift({ rubrique: 'Bilan - Perte de l exercice', total_xaf: Math.abs(resultat.resultat_net_xaf), comptes: [] })
    }

    const sectionRows = (titre: string, sections: typeof actif) => sections.map((section) => `
      <tr><th colspan="4">${escapeXml(titre)} - ${escapeXml(section.rubrique)}</th></tr>
      ${section.comptes.map((compte) => `<tr><td>${escapeXml(compte.compte)}</td><td>${escapeXml(compte.compte_label)}</td><td>${escapeXml(section.rubrique)}</td><td>${compte.montant_xaf}</td></tr>`).join('')}
      <tr><th colspan="3">Total ${escapeXml(section.rubrique)}</th><th>${section.total_xaf}</th></tr>
    `).join('')

    const totalActif = actif.reduce((s, g) => s + g.total_xaf, 0)
    const totalPassif = passif.reduce((s, g) => s + g.total_xaf, 0)
    const html = `<html><head><meta charset="utf-8" /></head><body>
      <h1>Bilan comptable</h1>
      <p>Exercice : ${escapeXml(exercice)} | Periode : ${escapeXml(debut)} au ${escapeXml(fin)} | Devise : XAF</p>
      <table border="1">
        <thead><tr><th>Compte</th><th>Libelle</th><th>Rubrique</th><th>Montant</th></tr></thead>
        <tbody>${sectionRows('Actif', actif)}${sectionRows('Passif', passif)}</tbody>
        <tfoot><tr><th colspan="3">Total actif</th><th>${Math.round(totalActif)}</th></tr><tr><th colspan="3">Total passif</th><th>${Math.round(totalPassif)}</th></tr><tr><th colspan="3">Ecart</th><th>${Math.round(totalActif - totalPassif)}</th></tr></tfoot>
      </table>
    </body></html>`

    return xlsResponse(c, `bilan-${exercice}.xls`, html)
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Erreur export bilan' }, 500)
  }
})

router.get('/resultat', requireRole(['admin', 'superviseur']), async (c) => {
  const exercice = c.req.query('exercice') ?? String(new Date().getFullYear())
  const { debut, fin } = exercicePlage(exercice)

  try {
    const comptes = await comptesAgreges(debut, fin)
    const resultat = resultatDepuisComptes(comptes)
    const produits = groupeComptes(resultat.produits, 'produit')
    const charges = groupeComptes(resultat.charges, 'charge')

    const finance = await financeAgregee(debut, fin)

    return c.json({
      exercice,
      periode: { debut, fin },
      produits,
      charges,
      total_produits_xaf: resultat.total_produits_xaf,
      total_charges_xaf: resultat.total_charges_xaf,
      resultat_net_xaf: resultat.resultat_net_xaf,
      beneficiaire: resultat.resultat_net_xaf >= 0,
      finance: {
        ca_facture_ht_xaf: Math.round(finance.ca_facture_ht_xaf),
        tva_facturee_xaf: Math.round(finance.tva_facturee_xaf),
        ca_facture_ttc_xaf: Math.round(finance.ca_facture_ttc_xaf),
        encaisse_xaf: Math.round(finance.encaisse_xaf),
        reste_a_encaisser_xaf: Math.round(finance.reste_a_encaisser_xaf),
        ecart_ca_comptable_vs_facture_ht_xaf: Math.round(resultat.total_produits_xaf - finance.ca_facture_ht_xaf),
      },
    })
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Erreur resultat' }, 500)
  }
})

router.get('/resultat.xls', requireRole(['admin', 'superviseur']), async (c) => {
  const exercice = c.req.query('exercice') ?? String(new Date().getFullYear())
  const { debut, fin } = exercicePlage(exercice)

  try {
    const comptes = await comptesAgreges(debut, fin)
    const resultat = resultatDepuisComptes(comptes)
    const produits = groupeComptes(resultat.produits, 'produit')
    const charges = groupeComptes(resultat.charges, 'charge')
    const rows = (titre: string, sections: typeof produits) => sections.map((section) => `
      <tr><th colspan="4">${escapeXml(titre)} - ${escapeXml(section.rubrique)}</th></tr>
      ${section.comptes.map((compte) => `<tr><td>${escapeXml(compte.compte)}</td><td>${escapeXml(compte.compte_label)}</td><td>${escapeXml(section.rubrique)}</td><td>${compte.montant_xaf}</td></tr>`).join('')}
      <tr><th colspan="3">Total ${escapeXml(section.rubrique)}</th><th>${section.total_xaf}</th></tr>
    `).join('')

    const html = `<html><head><meta charset="utf-8" /></head><body>
      <h1>Compte de resultat analytique</h1>
      <p>Exercice : ${escapeXml(exercice)} | Periode : ${escapeXml(debut)} au ${escapeXml(fin)} | Devise : XAF</p>
      <table border="1">
        <thead><tr><th>Compte</th><th>Libelle</th><th>Rubrique</th><th>Montant</th></tr></thead>
        <tbody>${rows('Produits', produits)}${rows('Charges', charges)}</tbody>
        <tfoot><tr><th colspan="3">Total produits</th><th>${resultat.total_produits_xaf}</th></tr><tr><th colspan="3">Total charges</th><th>${resultat.total_charges_xaf}</th></tr><tr><th colspan="3">Resultat net</th><th>${resultat.resultat_net_xaf}</th></tr></tfoot>
      </table>
    </body></html>`

    return xlsResponse(c, `resultat-${exercice}.xls`, html)
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Erreur export resultat' }, 500)
  }
})

router.get('/synthese', requireRole(['admin', 'superviseur']), async (c) => {
  const exercice = c.req.query('exercice') ?? String(new Date().getFullYear())
  const { debut, fin } = exercicePlage(exercice)

  try {
    const comptes = await comptesAgreges(debut, fin)
    const resultat = resultatDepuisComptes(comptes)
    const finance = await financeAgregee(debut, fin)
    const bilanComptes = comptes.filter((cpt) => ['1', '2', '3', '4', '5'].includes(cpt.compte[0]))
    const actif = groupeComptes(bilanComptes.filter((cpt) => cpt.nature === 'actif'), 'actif')
    const passif = groupeComptes(bilanComptes.filter((cpt) => cpt.nature === 'passif'), 'passif')
    const totalActif = actif.reduce((s, g) => s + g.total_xaf, 0)
    const totalPassif = passif.reduce((s, g) => s + g.total_xaf, 0) + Math.max(0, resultat.resultat_net_xaf)

    const totalDebit = comptes.reduce((s, cpt) => s + cpt.total_debit_xaf, 0)
    const totalCredit = comptes.reduce((s, cpt) => s + cpt.total_credit_xaf, 0)

    return c.json({
      exercice,
      periode: { debut, fin },
      comptabilite: {
        comptes_mouvementes: comptes.length,
        total_debit_xaf: Math.round(totalDebit),
        total_credit_xaf: Math.round(totalCredit),
        balance_equilibree: Math.abs(totalDebit - totalCredit) < 1,
        total_actif_xaf: Math.round(totalActif),
        total_passif_xaf: Math.round(totalPassif),
        resultat_net_xaf: resultat.resultat_net_xaf,
      },
      finance: {
        factures: finance.factures,
        ca_facture_ht_xaf: Math.round(finance.ca_facture_ht_xaf),
        tva_facturee_xaf: Math.round(finance.tva_facturee_xaf),
        ca_facture_ttc_xaf: Math.round(finance.ca_facture_ttc_xaf),
        encaisse_xaf: Math.round(finance.encaisse_xaf),
        reste_a_encaisser_xaf: Math.round(finance.reste_a_encaisser_xaf),
      },
      rapprochement: {
        ca_comptable_xaf: resultat.total_produits_xaf,
        ca_facture_ht_xaf: Math.round(finance.ca_facture_ht_xaf),
        ecart_ca_xaf: Math.round(resultat.total_produits_xaf - finance.ca_facture_ht_xaf),
      },
      exports: [
        { label: 'Grand livre', endpoint: '/api/rapports/grand-livre.xls' },
        { label: 'Bilan', endpoint: `/api/rapports/bilan.xls?exercice=${exercice}` },
        { label: 'Resultat', endpoint: `/api/rapports/resultat.xls?exercice=${exercice}` },
      ],
    })
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Erreur synthese comptable' }, 500)
  }
})

router.get('/controles', requireRole(['admin', 'superviseur']), async (c) => {
  const exercice = c.req.query('exercice') ?? String(new Date().getFullYear())
  const { debut, fin } = exercicePlage(exercice)

  try {
    const comptes = await comptesAgreges(debut, fin)
    const resultat = resultatDepuisComptes(comptes)
    const finance = await financeAgregee(debut, fin)
    const charges = await chargesAgregees(debut, fin)
    const planSet = new Set((planComptable as { compte: string }[]).map((p) => p.compte))

    const totalDebit = comptes.reduce((s, cpt) => s + cpt.total_debit_xaf, 0)
    const totalCredit = comptes.reduce((s, cpt) => s + cpt.total_credit_xaf, 0)
    const tvaCollecteeComptable = comptes
      .filter((cpt) => cpt.compte.startsWith('4431'))
      .reduce((s, cpt) => s + Math.max(0, cpt.total_credit_xaf - cpt.total_debit_xaf), 0)
    const comptesInconnus = comptes.filter((cpt) => !planSet.has(cpt.compte))
    const ecartCa = Math.round(resultat.total_produits_xaf - finance.ca_facture_ht_xaf)
    const ecartTva = Math.round(tvaCollecteeComptable - finance.tva_facturee_xaf)

    const controles = [
      {
        code: 'BALANCE_EQUILIBREE',
        label: 'Balance débit/crédit',
        statut: Math.abs(totalDebit - totalCredit) < 1 ? 'ok' : 'alerte',
        details: `Débit ${Math.round(totalDebit)} / Crédit ${Math.round(totalCredit)}`,
        ecart_xaf: Math.round(totalDebit - totalCredit),
      },
      {
        code: 'PLAN_COMPTABLE',
        label: 'Comptes du plan SYSCOHADA',
        statut: comptesInconnus.length === 0 ? 'ok' : 'alerte',
        details: comptesInconnus.length === 0 ? 'Tous les comptes mouvementés existent dans le plan' : `${comptesInconnus.length} compte(s) hors plan`,
        ecart_xaf: 0,
      },
      {
        code: 'CA_FINANCE_COMPTA',
        label: 'CA comptable vs factures HT',
        statut: Math.abs(ecartCa) <= 1 ? 'ok' : 'attention',
        details: `Produits comptables ${resultat.total_produits_xaf} / CA facturé HT ${Math.round(finance.ca_facture_ht_xaf)}`,
        ecart_xaf: ecartCa,
      },
      {
        code: 'TVA_COLLECTEE',
        label: 'TVA collectée vs factures',
        statut: Math.abs(ecartTva) <= 1 ? 'ok' : 'attention',
        details: `TVA comptable ${Math.round(tvaCollecteeComptable)} / TVA facturée ${Math.round(finance.tva_facturee_xaf)}`,
        ecart_xaf: ecartTva,
      },
      {
        code: 'CHARGES_ECRITURES',
        label: 'Charges validées comptabilisées',
        statut: charges.charges_sans_ecriture.length === 0 ? 'ok' : 'alerte',
        details: charges.charges_sans_ecriture.length === 0
          ? `${charges.charges_validees} charge(s) validée(s) rapprochée(s)`
          : `${charges.charges_sans_ecriture.length} charge(s) validée(s) sans écriture : ${charges.charges_sans_ecriture.slice(0, 5).join(', ')}`,
        ecart_xaf: charges.charges_sans_ecriture.length,
      },
      {
        code: 'SORTIES_ECRITURES',
        label: 'Sorties de trésorerie comptabilisées',
        statut: charges.sorties_sans_ecriture.length === 0 ? 'ok' : 'alerte',
        details: charges.sorties_sans_ecriture.length === 0
          ? `${charges.sorties_total} sortie(s) rapprochée(s)`
          : `${charges.sorties_sans_ecriture.length} sortie(s) sans écriture : ${charges.sorties_sans_ecriture.slice(0, 5).join(', ')}`,
        ecart_xaf: charges.sorties_sans_ecriture.length,
      },
      {
        code: 'CHARGES_METIER_COMPTA',
        label: 'Charges métier vs comptes classe 6',
        statut: Math.abs(charges.ecart_charges_ht_xaf) <= 1 ? 'ok' : 'attention',
        details: `Charges HT validées ${charges.charges_ht_validees_xaf} / Comptes classe 6 ${charges.charges_comptables_xaf}`,
        ecart_xaf: charges.ecart_charges_ht_xaf,
      },
      {
        code: 'TVA_DEDUCTIBLE',
        label: 'TVA déductible vs charges',
        statut: Math.abs(charges.ecart_tva_deductible_xaf) <= 1 ? 'ok' : 'attention',
        details: `TVA charges ${charges.tva_deductible_xaf} / TVA comptable 4432 ${charges.tva_deductible_comptable_xaf}`,
        ecart_xaf: charges.ecart_tva_deductible_xaf,
      },
      {
        code: 'JUSTIFICATIFS_CHARGES',
        label: 'Justificatifs charges et sorties',
        statut: charges.justificatifs_manquants.length === 0 ? 'ok' : 'attention',
        details: charges.justificatifs_manquants.length === 0
          ? 'Tous les justificatifs requis sont présents'
          : `${charges.justificatifs_manquants.length} justificatif(s) manquant(s) : ${charges.justificatifs_manquants.slice(0, 5).join(', ')}`,
        ecart_xaf: charges.justificatifs_manquants.length,
      },
      {
        code: 'PAIEMENTS_CHARGES',
        label: 'Montants payés des charges',
        statut: charges.paiements_incoherents.length === 0 ? 'ok' : 'attention',
        details: charges.paiements_incoherents.length === 0
          ? 'Montants payés cohérents avec les sorties rattachées'
          : `${charges.paiements_incoherents.length} charge(s) avec paiement à recalculer : ${charges.paiements_incoherents.slice(0, 5).join(', ')}`,
        ecart_xaf: charges.paiements_incoherents.length,
      },
    ]

    const alertes = controles.filter((controle) => controle.statut !== 'ok')

    return c.json({
      exercice,
      periode: { debut, fin },
      statut_global: alertes.some((a) => a.statut === 'alerte') ? 'alerte' : alertes.length > 0 ? 'attention' : 'ok',
      controles,
      comptes_inconnus: comptesInconnus.map((cpt) => ({
        compte: cpt.compte,
        compte_label: cpt.compte_label,
        total_debit_xaf: cpt.total_debit_xaf,
        total_credit_xaf: cpt.total_credit_xaf,
      })),
      recommandations: alertes.length === 0
        ? ['Les contrôles de cohérence principaux sont satisfaits pour cet exercice.']
        : [
            'Vérifier les écritures manuelles et les comptes hors plan.',
            'Comparer les factures validées avec les écritures de vente générées.',
            'Contrôler la TVA collectée avant déclaration fiscale.',
            'Rapprocher les charges validées, sorties de trésorerie et justificatifs.',
          ],
    })
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Erreur controles comptables' }, 500)
  }
})

router.get('/cloture', requireRole(['admin', 'superviseur']), async (c) => {
  const exercice = c.req.query('exercice') ?? String(new Date().getFullYear())
  const { debut, fin } = exercicePlage(exercice)

  try {
    const comptes = await comptesAgreges(debut, fin)
    const resultat = resultatDepuisComptes(comptes)
    const finance = await financeAgregee(debut, fin)
    const charges = await chargesAgregees(debut, fin)
    const planSet = new Set((planComptable as { compte: string }[]).map((p) => p.compte))
    const totalDebit = comptes.reduce((s, cpt) => s + cpt.total_debit_xaf, 0)
    const totalCredit = comptes.reduce((s, cpt) => s + cpt.total_credit_xaf, 0)
    const comptesInconnus = comptes.filter((cpt) => !planSet.has(cpt.compte))
    const ecartBalance = Math.round(totalDebit - totalCredit)
    const ecartCa = Math.round(resultat.total_produits_xaf - finance.ca_facture_ht_xaf)
    const tvaCollecteeComptable = comptes
      .filter((cpt) => cpt.compte.startsWith('4431'))
      .reduce((s, cpt) => s + Math.max(0, cpt.total_credit_xaf - cpt.total_debit_xaf), 0)
    const ecartTva = Math.round(tvaCollecteeComptable - finance.tva_facturee_xaf)

    const etapes = [
      {
        code: 'ECRITURES_EQUILIBREES',
        label: 'Balance débit/crédit équilibrée',
        statut: Math.abs(ecartBalance) < 1 ? 'ok' : 'bloquant',
        details: `Écart balance ${ecartBalance} XAF`,
      },
      {
        code: 'PLAN_COMPTABLE_VALIDE',
        label: 'Tous les comptes mouvementés sont dans le plan',
        statut: comptesInconnus.length === 0 ? 'ok' : 'bloquant',
        details: comptesInconnus.length === 0 ? 'Aucun compte hors plan' : `${comptesInconnus.length} compte(s) hors plan`,
      },
      {
        code: 'CA_RAPPROCHE',
        label: 'CA comptable rapproché aux factures',
        statut: Math.abs(ecartCa) <= 1 ? 'ok' : 'a_revoir',
        details: `Écart CA ${ecartCa} XAF`,
      },
      {
        code: 'TVA_RAPPROCHEE',
        label: 'TVA collectée rapprochée aux factures',
        statut: Math.abs(ecartTva) <= 1 ? 'ok' : 'a_revoir',
        details: `Écart TVA ${ecartTva} XAF`,
      },
      {
        code: 'CHARGES_RAPPROCHEES',
        label: 'Charges et sorties rapprochées',
        statut: charges.charges_sans_ecriture.length === 0 && charges.sorties_sans_ecriture.length === 0 ? 'ok' : 'bloquant',
        details: charges.charges_sans_ecriture.length === 0 && charges.sorties_sans_ecriture.length === 0
          ? `${charges.charges_validees} charge(s) et ${charges.sorties_total} sortie(s) rapprochée(s)`
          : `${charges.charges_sans_ecriture.length} charge(s) / ${charges.sorties_sans_ecriture.length} sortie(s) sans écriture`,
      },
      {
        code: 'JUSTIFICATIFS_CHARGES',
        label: 'Justificatifs charges',
        statut: charges.justificatifs_manquants.length === 0 ? 'ok' : 'a_revoir',
        details: charges.justificatifs_manquants.length === 0
          ? 'Aucun justificatif manquant'
          : `${charges.justificatifs_manquants.length} justificatif(s) manquant(s)`,
      },
      {
        code: 'ETATS_GENERES',
        label: 'États annuels générés',
        statut: comptes.length > 0 ? 'ok' : 'a_revoir',
        details: comptes.length > 0 ? `${comptes.length} compte(s) mouvementé(s)` : 'Aucune écriture sur l exercice',
      },
    ]

    const bloquants = etapes.filter((e) => e.statut === 'bloquant')
    const aRevoir = etapes.filter((e) => e.statut === 'a_revoir')

    return c.json({
      exercice,
      periode: { debut, fin },
      statut: bloquants.length > 0 ? 'bloque' : aRevoir.length > 0 ? 'pret_avec_reserves' : 'pret',
      cloturable: bloquants.length === 0,
      etapes,
      resume: {
        comptes_mouvementes: comptes.length,
        total_debit_xaf: Math.round(totalDebit),
        total_credit_xaf: Math.round(totalCredit),
        resultat_net_xaf: resultat.resultat_net_xaf,
        ca_facture_ht_xaf: Math.round(finance.ca_facture_ht_xaf),
        encaisse_xaf: Math.round(finance.encaisse_xaf),
        reste_a_encaisser_xaf: Math.round(finance.reste_a_encaisser_xaf),
        charges_ht_validees_xaf: charges.charges_ht_validees_xaf,
        tva_deductible_xaf: charges.tva_deductible_xaf,
      },
      actions_recommandees: bloquants.length > 0
        ? ['Corriger les éléments bloquants avant de valider la clôture.', 'Exporter le dossier uniquement après correction des écarts critiques.']
        : aRevoir.length > 0
          ? ['Revoir les écarts de rapprochement avant validation finale.', 'Documenter les réserves si la clôture doit être poursuivie.']
          : ['Le dossier comptable est prêt pour revue et archivage.'],
    })
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Erreur pre-cloture' }, 500)
  }
})

router.get('/dossier-cloture.xls', requireRole(['admin', 'superviseur']), async (c) => {
  const exercice = c.req.query('exercice') ?? String(new Date().getFullYear())
  const { debut, fin } = exercicePlage(exercice)

  try {
    const comptes = await comptesAgreges(debut, fin)
    const resultat = resultatDepuisComptes(comptes)
    const finance = await financeAgregee(debut, fin)
    const bilanComptes = comptes.filter((cpt) => ['1', '2', '3', '4', '5'].includes(cpt.compte[0]))
    const actif = groupeComptes(bilanComptes.filter((cpt) => cpt.nature === 'actif'), 'actif')
    const passif = groupeComptes(bilanComptes.filter((cpt) => cpt.nature === 'passif'), 'passif')
    const produits = groupeComptes(resultat.produits, 'produit')
    const charges = groupeComptes(resultat.charges, 'charge')
    const totalDebit = comptes.reduce((s, cpt) => s + cpt.total_debit_xaf, 0)
    const totalCredit = comptes.reduce((s, cpt) => s + cpt.total_credit_xaf, 0)

    const balanceRows = comptes.map((cpt) => `<tr>
      <td>${escapeXml(cpt.compte)}</td>
      <td>${escapeXml(cpt.compte_label)}</td>
      <td>${cpt.total_debit_xaf}</td>
      <td>${cpt.total_credit_xaf}</td>
      <td>${cpt.solde_debiteur_xaf}</td>
      <td>${cpt.solde_crediteur_xaf}</td>
    </tr>`).join('')
    const sectionRows = (sections: typeof actif) => sections.map((section) => `
      <tr><th colspan="4">${escapeXml(section.rubrique)}</th></tr>
      ${section.comptes.map((compte) => `<tr><td>${escapeXml(compte.compte)}</td><td>${escapeXml(compte.compte_label)}</td><td>${escapeXml(section.rubrique)}</td><td>${compte.montant_xaf}</td></tr>`).join('')}
      <tr><th colspan="3">Total ${escapeXml(section.rubrique)}</th><th>${section.total_xaf}</th></tr>
    `).join('')

    const html = `<html><head><meta charset="utf-8" /></head><body>
      <h1>Dossier de cloture comptable</h1>
      <p>Exercice : ${escapeXml(exercice)} | Periode : ${escapeXml(debut)} au ${escapeXml(fin)} | Devise : XAF</p>
      <h2>Synthese</h2>
      <table border="1">
        <tr><th>Comptes mouvementes</th><td>${comptes.length}</td></tr>
        <tr><th>Total debit</th><td>${Math.round(totalDebit)}</td></tr>
        <tr><th>Total credit</th><td>${Math.round(totalCredit)}</td></tr>
        <tr><th>Resultat net</th><td>${resultat.resultat_net_xaf}</td></tr>
        <tr><th>CA facture HT</th><td>${Math.round(finance.ca_facture_ht_xaf)}</td></tr>
        <tr><th>Encaisse</th><td>${Math.round(finance.encaisse_xaf)}</td></tr>
        <tr><th>Reste a encaisser</th><td>${Math.round(finance.reste_a_encaisser_xaf)}</td></tr>
      </table>
      <h2>Balance generale</h2>
      <table border="1">
        <thead><tr><th>Compte</th><th>Libelle</th><th>Debit</th><th>Credit</th><th>Solde debiteur</th><th>Solde crediteur</th></tr></thead>
        <tbody>${balanceRows}</tbody>
        <tfoot><tr><th colspan="2">Totaux</th><th>${Math.round(totalDebit)}</th><th>${Math.round(totalCredit)}</th><th></th><th></th></tr></tfoot>
      </table>
      <h2>Bilan - Actif</h2>
      <table border="1"><thead><tr><th>Compte</th><th>Libelle</th><th>Rubrique</th><th>Montant</th></tr></thead><tbody>${sectionRows(actif)}</tbody></table>
      <h2>Bilan - Passif</h2>
      <table border="1"><thead><tr><th>Compte</th><th>Libelle</th><th>Rubrique</th><th>Montant</th></tr></thead><tbody>${sectionRows(passif)}</tbody></table>
      <h2>Compte de resultat - Produits</h2>
      <table border="1"><thead><tr><th>Compte</th><th>Libelle</th><th>Rubrique</th><th>Montant</th></tr></thead><tbody>${sectionRows(produits)}</tbody></table>
      <h2>Compte de resultat - Charges</h2>
      <table border="1"><thead><tr><th>Compte</th><th>Libelle</th><th>Rubrique</th><th>Montant</th></tr></thead><tbody>${sectionRows(charges)}</tbody></table>
    </body></html>`

    return xlsResponse(c, `dossier-cloture-${exercice}.xls`, html)
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Erreur dossier cloture' }, 500)
  }
})

router.get('/declarations/tva', requireRole(['admin', 'superviseur']), async (c) => {
  const mois = c.req.query('mois') ?? new Date().toISOString().slice(0, 7)
  const { debut, fin } = moisPlage(mois)

  const { data, error } = await db
    .from('ecritures_comptables')
    .select('compte_syscohada, debit_xaf, credit_xaf, date, libelle, reference_doc')
    .in('compte_syscohada', ['4431', '4432', '4433', '4434', '4441', '4446'])
    .gte('date', debut)
    .lte('date', fin)
    .order('date')

  if (error) return c.json({ error: error.message }, 500)

  type EC = { compte_syscohada: string; debit_xaf: number; credit_xaf: number; date: string; libelle: string; reference_doc: string | null }
  const ecritures = (data ?? []) as EC[]

  // TVA collectée = total crédits compte 4431
  const tva_collectee = ecritures
    .filter(e => e.compte_syscohada === '4431')
    .reduce((s, e) => s + e.credit_xaf, 0)

  // TVA déductible = total débits comptes 4432/4433/4434
  const tva_deductible = ecritures
    .filter(e => ['4432', '4433', '4434'].includes(e.compte_syscohada))
    .reduce((s, e) => s + e.debit_xaf, 0)

  // Acomptes déjà versés (4441)
  const acomptes_verses = ecritures
    .filter(e => e.compte_syscohada === '4441')
    .reduce((s, e) => s + e.debit_xaf, 0)

  const tva_nette     = tva_collectee - tva_deductible - acomptes_verses
  const a_decaisser   = tva_nette > 0
  const credit_reporte = tva_nette < 0 ? Math.abs(tva_nette) : 0

  // Détail des opérations
  const operations_collectee = ecritures
    .filter(e => e.compte_syscohada === '4431')
    .map(e => ({ date: e.date, libelle: e.libelle, reference: e.reference_doc, montant_xaf: Math.round(e.credit_xaf) }))

  const operations_deductible = ecritures
    .filter(e => ['4432', '4433', '4434'].includes(e.compte_syscohada))
    .map(e => ({ date: e.date, libelle: e.libelle, reference: e.reference_doc, montant_xaf: Math.round(e.debit_xaf) }))

  return c.json({
    mois,
    periode:                   { debut, fin },
    taux_tva_pct:              19.25,

    // Formulaire pré-rempli DGI Cameroun
    tva_collectee_xaf:         Math.round(tva_collectee),
    tva_deductible_xaf:        Math.round(tva_deductible),
    acomptes_verses_xaf:       Math.round(acomptes_verses),
    tva_nette_xaf:             Math.round(Math.abs(tva_nette)),
    situation:                 tva_nette > 0 ? 'à_decaisser' : tva_nette < 0 ? 'credit_reporte' : 'neant',
    a_payer_xaf:               a_decaisser ? Math.round(tva_nette) : 0,
    credit_reporte_xaf:        Math.round(credit_reporte),
    date_limite_paiement:      `${mois.split('-')[0]}-${String(Number(mois.split('-')[1]) + 1).padStart(2, '0')}-15`,

    // Détail
    operations_collectee,
    operations_deductible,
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// PLAN COMPTABLE SYSCOHADA
// GET /api/rapports/plan-comptable?classe=4
// ══════════════════════════════════════════════════════════════════════════════

router.get('/plan-comptable', async (c) => {
  const classeParam = c.req.query('classe')
  type PlanEntry = { compte: string; libelle: string; classe: number }
  let comptes = planComptable as PlanEntry[]

  if (classeParam) {
    const classe = parseInt(classeParam)
    comptes = comptes.filter(p => p.classe === classe)
  }

  return c.json({
    total: comptes.length,
    comptes: comptes.map((p) => ({ ...p, ...metaCompte(p.compte) })),
    classes: [
      { classe: 1, label: 'Capitaux propres et dettes financières' },
      { classe: 2, label: 'Immobilisations' },
      { classe: 3, label: 'Stocks' },
      { classe: 4, label: 'Tiers et taxes' },
      { classe: 5, label: 'Trésorerie' },
      { classe: 6, label: 'Charges' },
      { classe: 7, label: 'Produits' },
      { classe: 8, label: 'Résultat' },
    ],
  })
})

router.get('/journaux-comptables', requireRole(['admin', 'superviseur']), async (c) => {
  return c.json({
    data: [
      { code: 'VT', label: 'Journal des ventes', source: 'Factures', comptes_usuels: ['411', '701', '705', '706', '4431'] },
      { code: 'BQ', label: 'Journal banque', source: 'Encaissements banque', comptes_usuels: ['521', '411'] },
      { code: 'CA', label: 'Journal caisse', source: 'Encaissements caisse', comptes_usuels: ['571', '411'] },
      { code: 'AC', label: 'Journal achats', source: 'Achats et fournisseurs', comptes_usuels: ['401', '601', '602', '4432'] },
      { code: 'OD', label: 'Opérations diverses', source: 'Corrections et ajustements', comptes_usuels: ['471', '472'] },
    ],
    regles: [
      'Chaque piece comptable doit etre equilibree : total debit = total credit.',
      'Chaque ligne doit utiliser un compte existant dans le plan comptable.',
      'Une ligne ne peut pas porter debit et credit simultanement.',
      'Les factures et paiements generent leurs ecritures automatiquement depuis Finance.',
    ],
  })
})

export { router as rapportsRouter }
