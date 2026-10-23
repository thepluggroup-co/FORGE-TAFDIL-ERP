import React, { useEffect, useMemo, useState } from 'react'
import { TopBar } from '../components/TopBar'
import { Card, Donut, EmptyState, Sparkline, Spinner, Trend, formatCompact, formatXAF } from '../components/ui'
import { fetchFactures, type ApiFacture } from '../lib/api'
import { analyticsFromFactures, type AnalyticsPeriod } from '@forge/shared'

const PERIODS: Array<{ value: AnalyticsPeriod; label: string }> = [
  { value: 'mois', label: 'Mois' },
  { value: 'trimestre', label: 'Trimestre' },
  { value: 'annee', label: 'Année' },
]

const PERIOD_HINT: Record<AnalyticsPeriod, string> = {
  mois: 'vs mois dernier', trimestre: 'vs trimestre dernier', annee: 'vs année dernière',
}

export function PerformancePage() {
  const [factures, setFactures] = useState<ApiFacture[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [period, setPeriod] = useState<AnalyticsPeriod>('mois')

  useEffect(() => {
    let cancelled = false
    fetchFactures({ per_page: 500 })
      .then((r) => { if (!cancelled) setFactures(r.data) })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : 'Erreur de chargement') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  const stats = useMemo(() => analyticsFromFactures(factures, period), [factures, period])
  const parts = [
    { label: 'Payées',     value: stats.breakdown.payee,   color: '#2E7D32' },
    { label: 'En attente', value: stats.breakdown.attente, color: '#F59E0B' },
    { label: 'En retard',  value: stats.breakdown.retard,  color: '#C62828' },
  ]
  const totalParts = parts.reduce((s, p) => s + p.value, 0)

  return (
    <div>
      <TopBar title="Performance financière" back />
      <div className="px-4 py-4 space-y-4">
        <div className="grid grid-cols-3 bg-gray-100 rounded-xl p-1">
          {PERIODS.map((p) => (
            <button
              key={p.value}
              type="button"
              onClick={() => setPeriod(p.value)}
              className={`rounded-lg py-2 text-xs font-semibold ${period === p.value ? 'bg-[#C62828] text-white' : 'text-gray-600'}`}
            >
              {p.label}
            </button>
          ))}
        </div>

        {loading ? <Spinner /> : error ? (
          <p className="text-sm text-red-600 bg-red-50 rounded-xl px-4 py-3">{error}</p>
        ) : factures.length === 0 ? (
          <EmptyState title="Pas encore de données" hint="Le chiffre d'affaires apparaîtra dès la première facture émise." />
        ) : (
          <>
            <Card className="p-4">
              <p className="text-xs text-gray-500">Chiffre d'affaires</p>
              <p className="text-2xl font-extrabold text-gray-900 mt-0.5">{formatXAF(stats.current)}</p>
              <div className="flex items-center gap-1.5 mt-0.5">
                <Trend pct={stats.trend} />
                {stats.trend !== null && <span className="text-[11px] text-gray-400">{PERIOD_HINT[period]}</span>}
              </div>
              <div className="mt-3">
                <Sparkline values={stats.values} labels={stats.labels} height={110} />
              </div>
            </Card>

            <Card className="p-4">
              <p className="text-sm font-bold text-gray-900 mb-3">État des paiements</p>
              <div className="flex items-center gap-5">
                <Donut parts={parts} centerTop={formatCompact(totalParts)} centerBottom="FCFA" />
                <ul className="flex-1 space-y-2">
                  {parts.map((p) => (
                    <li key={p.label} className="flex items-center justify-between text-xs">
                      <span className="flex items-center gap-2 text-gray-600">
                        <span className="w-2.5 h-2.5 rounded-full" style={{ background: p.color }} />
                        {p.label}
                      </span>
                      <span className="font-semibold text-gray-800">
                        {totalParts > 0 ? Math.round((p.value / totalParts) * 100) : 0}%
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
              <p className="text-[10px] text-gray-400 mt-3">
                Factures émises sur la période en cours, montants TTC. « En retard » : échéance dépassée et non payée.
              </p>
            </Card>
          </>
        )}
      </div>
    </div>
  )
}
