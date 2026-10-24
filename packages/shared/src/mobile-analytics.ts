// ── Agrégations de l'écran « Analytique » mobile (pures, testées) ────────────
// Rien n'est inventé : les chiffres viennent des factures réelles. « Chiffre d'affaires » =
// factures émises (valide, envoyée, payée) par date d'émission, en TTC. Les brouillons et les
// factures annulées ne comptent pas.

export type FactureEtat = 'payee' | 'attente' | 'retard' | 'annulee' | 'brouillon'
export type AnalyticsPeriod = 'mois' | 'trimestre' | 'annee'

export interface AnalyticsFacture {
  statut: 'brouillon' | 'valide' | 'envoye' | 'paye' | 'annule'
  date_emission: string
  date_echeance: string
  total_ttc_xaf: number
}

/** « En retard » = émise, non payée, échéance dépassée (dates AAAA-MM-JJ). */
export function factureEtat(
  f: Pick<AnalyticsFacture, 'statut' | 'date_echeance'>,
  today: string = new Date().toISOString().slice(0, 10),
): FactureEtat {
  if (f.statut === 'paye') return 'payee'
  if (f.statut === 'annule') return 'annulee'
  if (f.statut === 'brouillon') return 'brouillon'
  return f.date_echeance < today ? 'retard' : 'attente'
}

const MOIS = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Juin', 'Juil', 'Août', 'Sep', 'Oct', 'Nov', 'Déc']

function periodIndex(date: string, period: AnalyticsPeriod): number {
  const year = Number(date.slice(0, 4))
  const month = Number(date.slice(5, 7))
  if (period === 'mois') return year * 12 + (month - 1)
  if (period === 'trimestre') return year * 4 + Math.floor((month - 1) / 3)
  return year
}

function periodLabel(index: number, period: AnalyticsPeriod): string {
  if (period === 'mois') return MOIS[index % 12]!
  if (period === 'trimestre') return `T${(index % 4) + 1} ${String(Math.floor(index / 4)).slice(2)}`
  return String(index)
}

const BUCKETS: Record<AnalyticsPeriod, number> = { mois: 6, trimestre: 4, annee: 3 }

export interface AnalyticsResult {
  labels: string[]
  values: number[]
  /** Chiffre d'affaires de la période en cours (dernier point). */
  current: number
  /** Période précédente ; 0 si aucune facture. */
  previous: number
  /** Variation en % ; null quand la période précédente est vide (rien d'inventé). */
  trend: number | null
  /** Répartition de la période en cours par état de paiement (montants TTC). */
  breakdown: { payee: number; attente: number; retard: number }
}

export function analyticsFromFactures(
  factures: readonly AnalyticsFacture[],
  period: AnalyticsPeriod,
  today: string = new Date().toISOString().slice(0, 10),
): AnalyticsResult {
  const n = BUCKETS[period]
  const cur = periodIndex(today, period)
  const keys = Array.from({ length: n }, (_, i) => cur - (n - 1 - i))
  const sums = new Map<number, number>(keys.map((k) => [k, 0]))
  const breakdown = { payee: 0, attente: 0, retard: 0 }

  for (const f of factures) {
    if (f.statut === 'brouillon' || f.statut === 'annule') continue
    const idx = periodIndex(f.date_emission, period)
    if (!sums.has(idx)) continue
    sums.set(idx, (sums.get(idx) ?? 0) + f.total_ttc_xaf)
    if (idx === cur) {
      const etat = factureEtat(f, today)
      if (etat === 'payee' || etat === 'attente' || etat === 'retard') breakdown[etat] += f.total_ttc_xaf
    }
  }

  const values = keys.map((k) => sums.get(k) ?? 0)
  const current = values[values.length - 1] ?? 0
  const previous = values[values.length - 2] ?? 0
  return {
    labels: keys.map((k) => periodLabel(k, period)),
    values,
    current,
    previous,
    trend: previous > 0 ? Math.round(((current - previous) / previous) * 100) : null,
    breakdown,
  }
}
