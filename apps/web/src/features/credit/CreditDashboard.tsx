import React from 'react'
import { motion } from 'framer-motion'
import { TrendingUp, Users, AlertTriangle, DollarSign, RefreshCw } from 'lucide-react'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { PageHeader, KpiCard, Button } from '@forge/ui'
import { formatXAF } from '@/lib/utils'
import { useCreditDashboard } from '@/hooks/useCredit'
import { CreditOverdueList } from './CreditOverdueList'

export function CreditDashboard() {
  const { data, loading, refetch } = useCreditDashboard()

  const kpis = [
    {
      title:   'Total encours',
      value:   data ? formatXAF(data.totalEncours) : '—',
      icon:    <DollarSign className="w-5 h-5" />,
      color:   'blue' as const,
    },
    {
      title:   'Clients actifs',
      value:   data ? String(data.activeClients) : '—',
      icon:    <Users className="w-5 h-5" />,
      color:   'green' as const,
    },
    {
      title:   'Échéances en retard',
      value:   data ? String(data.overdueCount) : '—',
      icon:    <AlertTriangle className="w-5 h-5" />,
      color:   data && data.overdueCount > 0 ? 'red' as const : 'green' as const,
    },
    {
      title:   'Taux de recouvrement',
      value:   data ? `${data.recoveryRate} %` : '—',
      icon:    <TrendingUp className="w-5 h-5" />,
      color:   data && data.recoveryRate >= 80 ? 'green' as const : 'yellow' as const,
    },
  ]

  const chartData = (data?.monthlyTrend ?? []).map(({ month, amount }) => ({
    mois:   month,
    montant: amount,
  }))

  return (
    <div className="space-y-6">
      <PageHeader
        title="Tableau de bord Crédit"
        subtitle="Suivi des créances et plans de paiement"
        actions={
          <Button variant="outline" size="sm" onClick={refetch} disabled={loading}>
            <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
            Actualiser
          </Button>
        }
      />

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {kpis.map((kpi, i) => (
          <motion.div
            key={kpi.title}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.08 }}
          >
            <KpiCard
              title={kpi.title}
              value={kpi.value}
              icon={kpi.icon}
              color={kpi.color}
              loading={loading}
            />
          </motion.div>
        ))}
      </div>

      {/* Graphique encours par mois */}
      {chartData.length > 0 && (
        <motion.div
          className="bg-white rounded-xl border border-gray-200 p-6"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.35 }}
        >
          <h3 className="text-sm font-semibold text-gray-700 mb-4">
            Paiements reçus — 6 derniers mois (FCFA)
          </h3>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={chartData} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
              <XAxis
                dataKey="mois"
                tick={{ fontSize: 11, fill: '#6b7280' }}
                tickFormatter={v => v.slice(0, 7)}
              />
              <YAxis
                tick={{ fontSize: 11, fill: '#6b7280' }}
                tickFormatter={v => `${(v / 1000).toFixed(0)}k`}
                width={48}
              />
              <Tooltip
                formatter={(v: number) => [formatXAF(v), 'Reçu']}
                contentStyle={{ fontSize: 12, borderRadius: 8 }}
              />
              <Bar dataKey="montant" fill="#3b82f6" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </motion.div>
      )}

      {/* Table des impayés */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.45 }}
      >
        <CreditOverdueList compact />
      </motion.div>
    </div>
  )
}
