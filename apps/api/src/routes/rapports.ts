import { Hono } from 'hono'
import { supabaseAdmin } from '@forge/db'

const db = supabaseAdmin!
import { requireRole } from '../middleware/rbac'
import { planComptable } from '../services/comptabilite.service'
import type { HonoVariables } from '../types'

const router = new Hono<{ Variables: HonoVariables }>()

// ── Types internes ─────────────────────────────────────────────────────────────

interface Ecriture {
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

// ══════════════════════════════════════════════════════════════════════════════
// GRAND LIVRE
// GET /api/rapports/grand-livre?compte=411&debut=2026-01-01&fin=2026-12-31
// ══════════════════════════════════════════════════════════════════════════════

router.get('/grand-livre', requireRole(['admin', 'superviseur']), async (c) => {
  const { compte, debut, fin, exercice } = c.req.query()

  if (!compte) {
    return c.json({ error: 'Paramètre compte requis (ex: ?compte=411)', code: 'MISSING_PARAM' }, 400)
  }

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

  // Calcul du solde progressif
  let solde = 0
  const lignes = ecritures.map(e => {
    solde = solde + e.debit_xaf - e.credit_xaf
    return {
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
    compte_label: ecritures[0]?.compte_label ?? `Compte ${compte}`,
    periode:      { debut: dateDebut, fin: dateFin },
    lignes,
    total_debit_xaf:  Math.round(total_debit),
    total_credit_xaf: Math.round(total_credit),
    solde_final_xaf:  Math.round(total_debit - total_credit),
    solde_sens:       total_debit >= total_credit ? 'Débiteur' : 'Créditeur',
  })
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

  return c.json({ total: comptes.length, comptes })
})

export { router as rapportsRouter }
