import React, { useMemo } from 'react'
import { motion } from 'framer-motion'
import { useNavigate } from 'react-router-dom'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts'
import { TrendingUp, ShoppingCart, Package, GraduationCap, AlertTriangle, ArrowRight, Loader2 } from 'lucide-react'
import { KpiCard, PageHeader, StatusBadge } from '@forge/ui'
import { useAuth } from '@/context/AuthContext'
import { formatXAF, formatDate } from '@/lib/utils'
import { useDashboardKpis } from '@/hooks/useFinance'
import { useAiAlertes } from '@/hooks/useAI'

// ── Custom tooltip ─────────────────────────────────────────────────────────────

function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: { value: number }[]; label?: string }) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-white border border-gray-100 rounded-lg shadow-lg px-3 py-2">
      <p className="text-xs text-gray-500 mb-0.5">{label}</p>
      <p className="text-sm font-bold text-[#212121]">{formatXAF(payload[0].value)}</p>
    </div>
  )
}

function Skeleton({ className }: { className?: string }) {
  return <div className={`animate-pulse bg-gray-100 rounded ${className ?? ''}`} />
}

type DashboardAlert = {
  id: string
  level: 'critique' | 'danger' | 'warning'
  message: string
  link: string
}

function alertLevel(severite: string): DashboardAlert['level'] {
  if (severite === 'critique') return 'critique'
  if (severite === 'alerte') return 'danger'
  return 'warning'
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function Dashboard() {
  const { user, displayName: authName } = useAuth()
  const navigate = useNavigate()
  const { data: dashboard, isLoading } = useDashboardKpis()
  const { data: aiAlertesData, isLoading: aiAlertesLoading } = useAiAlertes()

  const userName = authName ?? user?.email?.split('@')[0] ?? 'Utilisateur'
  const today = new Date().toLocaleDateString('fr-CM', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  })
  const hour     = new Date().getHours()
  const greeting = hour < 12 ? 'Bonjour' : hour < 18 ? 'Bon après-midi' : 'Bonsoir'

  // CA du mois en cours (dernier point du graphique)
  const caMoisActuel = dashboard?.ca_mensuel?.at(-1)?.ca ?? 0

  // Tendance CA : 3 derniers mois vs 3 premiers mois
  const chartTrend = useMemo(() => {
    const series = dashboard?.ca_mensuel
    if (!series || series.length < 6) return null
    const recent = series.slice(3).reduce((s, m) => s + m.ca, 0)
    const old    = series.slice(0, 3).reduce((s, m) => s + m.ca, 0)
    if (old === 0) return null
    const pct = Math.round(((recent - old) / old) * 100)
    return pct >= 0 ? `+${pct}% vs M-3` : `${pct}% vs M-3`
  }, [dashboard?.ca_mensuel])

  // Alertes dynamiques dérivées des KPIs réels
  const alertes = useMemo(() => {
    if (!dashboard?.kpis) return []
    const { stocks_en_alerte, credits_echus, bons_en_attente } = dashboard.kpis
    const result: { id: string; level: 'critique' | 'danger' | 'warning'; message: string; link: string }[] = []
    if (stocks_en_alerte > 0)
      result.push({ id: 'stock',  level: 'critique', message: `${stocks_en_alerte} produit(s) en alerte de stock`, link: '/stocks' })
    if (credits_echus > 0)
      result.push({ id: 'credit', level: 'danger',   message: `${credits_echus} crédit(s) client échu(s) en attente`, link: '/finance' })
    if (bons_en_attente > 0)
      result.push({ id: 'bons',   level: 'warning',  message: `${bons_en_attente} bon(s) de sortie en attente de validation`, link: '/stocks/bons-sortie' })
    return result
  }, [dashboard?.kpis])

  const priorityAlertes = useMemo(() => {
    const aiAlertes = aiAlertesData?.alertes ?? []
    if (aiAlertes.length === 0) return alertes

    const result: DashboardAlert[] = aiAlertes.slice(0, 6).map((alerte) => ({
      id:      alerte.id,
      level:   alertLevel(alerte.severite),
      message: `${alerte.titre} - ${alerte.description}`,
      link:    alerte.lien ?? '/intelligence',
    }))

    const bonsAlert = alertes.find((alerte) => alerte.id === 'bons')
    if (bonsAlert && !result.some((alerte) => alerte.id === bonsAlert.id)) {
      result.push(bonsAlert)
    }

    return result.slice(0, 6)
  }, [aiAlertesData?.alertes, alertes])

  const alertesLoading = isLoading || (aiAlertesLoading && priorityAlertes.length === 0)

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3, ease: 'easeOut' }}
      className="space-y-6"
    >
      <PageHeader
        title="Tableau de Bord FORGE — TAFDIL"
        subtitle={today.charAt(0).toUpperCase() + today.slice(1)}
      />

      {/* Welcome */}
      <div className="flex items-center gap-3">
        <div
          className="flex items-center justify-center rounded-full shrink-0 text-white text-base font-bold"
          style={{ width: 40, height: 40, backgroundColor: '#C62828' }}
        >
          {userName.charAt(0).toUpperCase()}
        </div>
        <div>
          <div className="text-sm text-gray-400">{greeting},</div>
          <div className="text-lg font-bold text-[#212121] leading-tight">{userName}</div>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <KpiCard
          title="CA du mois"
          value={isLoading ? '…' : formatXAF(caMoisActuel)}
          trend={caMoisActuel > 0 ? 'up' : 'neutral'}
          trendValue={isLoading ? '' : chartTrend ?? 'Aucune donnée'}
          icon={<TrendingUp className="h-5 w-5" />}
          color="#16a34a"
          delay={0}
        />
        <KpiCard
          title="Commandes en cours"
          value={isLoading ? '…' : dashboard?.kpis.commandes_actives ?? 0}
          trend="up"
          trendValue={isLoading ? '' : `Confirmed + En prod + Prêt`}
          icon={<ShoppingCart className="h-5 w-5" />}
          color="#1d4ed8"
          delay={0.05}
        />
        <KpiCard
          title="Stocks critiques"
          value={isLoading ? '…' : dashboard?.kpis.stocks_en_alerte ?? 0}
          unit="produits"
          trend={dashboard?.kpis.stocks_en_alerte ? 'down' : 'neutral'}
          trendValue={isLoading ? '' : dashboard?.kpis.stocks_en_alerte ? 'Alerte active' : 'Niveaux OK'}
          icon={<Package className="h-5 w-5" />}
          color="#C62828"
          delay={0.1}
        />
        <KpiCard
          title="Apprenants actifs"
          value={isLoading ? '…' : dashboard?.kpis.apprenants_actifs ?? 0}
          trend="neutral"
          trendValue="En formation TAFDIL"
          icon={<GraduationCap className="h-5 w-5" />}
          color="#6d28d9"
          delay={0.15}
        />
      </div>

      {/* Alertes + Graphique CA */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* Alertes prioritaires */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2, duration: 0.3 }}
          className="bg-white rounded-xl border border-gray-100 shadow-sm"
        >
          <div className="flex items-center gap-2 px-5 py-4 border-b border-gray-100">
            <AlertTriangle className="h-4 w-4 text-[#C62828]" />
            <h2 className="text-sm font-semibold text-[#212121]">Alertes prioritaires</h2>
            {priorityAlertes.length > 0 && (
              <span className="ml-auto flex items-center justify-center w-5 h-5 rounded-full bg-[#C62828] text-white text-xs font-bold">
                {priorityAlertes.length}
              </span>
            )}
          </div>

          {alertesLoading ? (
            <div className="p-5 space-y-3">
              {[1, 2, 3].map((i) => <Skeleton key={i} className="h-10 w-full" />)}
            </div>
          ) : priorityAlertes.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-gray-400">
              <Package className="h-8 w-8 mb-2 opacity-30" />
              <p className="text-sm">Aucune alerte active</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-50">
              {priorityAlertes.map((alert) => (
                <button
                  key={alert.id}
                  type="button"
                  onClick={() => navigate(alert.link)}
                  className="flex items-start gap-3 w-full px-5 py-4 text-left hover:bg-gray-50 transition-colors group"
                >
                  <span className={`flex items-center justify-center w-7 h-7 rounded-full shrink-0 mt-0.5 ${
                    alert.level === 'critique' ? 'bg-red-100'
                    : alert.level === 'danger'  ? 'bg-amber-100'
                    : 'bg-orange-50'
                  }`}>
                    <AlertTriangle className={`h-3.5 w-3.5 ${
                      alert.level === 'critique' ? 'text-red-600'
                      : alert.level === 'danger'  ? 'text-amber-600'
                      : 'text-orange-600'
                    }`} />
                  </span>
                  <span className="text-sm text-[#212121] flex-1 leading-snug">{alert.message}</span>
                  <ArrowRight className="h-4 w-4 text-gray-300 group-hover:text-[#C62828] transition-colors shrink-0 mt-0.5" />
                </button>
              ))}
            </div>
          )}
        </motion.div>

        {/* Graphique CA 6 mois */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.25, duration: 0.3 }}
          className="bg-white rounded-xl border border-gray-100 shadow-sm p-5"
        >
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-sm font-semibold text-[#212121]">Chiffre d'affaires — 6 derniers mois</h2>
            {chartTrend && (
              <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                chartTrend.startsWith('+')
                  ? 'text-green-600 bg-green-50'
                  : 'text-red-600 bg-red-50'
              }`}>
                {chartTrend}
              </span>
            )}
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center h-[200px]">
              <Loader2 className="h-6 w-6 text-gray-300 animate-spin" />
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={dashboard?.ca_mensuel ?? []} barSize={32}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                <XAxis dataKey="mois" tick={{ fontSize: 12, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
                <YAxis
                  tick={{ fontSize: 11, fill: '#9ca3af' }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v: number) => v >= 1_000_000 ? `${(v / 1_000_000).toFixed(1)}M` : `${Math.round(v / 1000)}k`}
                />
                <Tooltip content={<ChartTooltip />} cursor={{ fill: '#f8f8f8' }} />
                <Bar dataKey="ca" fill="#C62828" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </motion.div>
      </div>

      {/* Commandes récentes + Mouvements stock */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* Dernières commandes */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3, duration: 0.3 }}
          className="bg-white rounded-xl border border-gray-100 shadow-sm"
        >
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
            <h2 className="text-sm font-semibold text-[#212121]">Dernières commandes</h2>
            <button
              type="button"
              onClick={() => navigate('/commandes')}
              className="text-xs text-[#C62828] hover:underline font-medium"
            >
              Voir tout →
            </button>
          </div>

          {isLoading ? (
            <div className="p-4 space-y-3">
              {[1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-12 w-full" />)}
            </div>
          ) : !dashboard?.recent_commandes?.length ? (
            <div className="flex items-center justify-center py-10 text-sm text-gray-400">
              Aucune commande
            </div>
          ) : (
            <div className="divide-y divide-gray-50">
              {dashboard.recent_commandes.map((order) => (
                <div key={order.id} className="flex items-center gap-3 px-5 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono text-gray-400">{order.numero}</span>
                      <StatusBadge status={order.statut} />
                    </div>
                    <div className="text-sm font-medium text-[#212121] mt-0.5">{order.client_nom}</div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-sm font-semibold text-[#212121]">{formatXAF(order.total_ttc_xaf)}</div>
                    <div className="text-xs text-gray-400">{formatDate(order.date_commande)}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </motion.div>

        {/* Derniers mouvements stock */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.35, duration: 0.3 }}
          className="bg-white rounded-xl border border-gray-100 shadow-sm"
        >
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
            <h2 className="text-sm font-semibold text-[#212121]">Derniers mouvements stock</h2>
            <button
              type="button"
              onClick={() => navigate('/stocks')}
              className="text-xs text-[#C62828] hover:underline font-medium"
            >
              Voir tout →
            </button>
          </div>

          {isLoading ? (
            <div className="p-4 space-y-3">
              {[1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-12 w-full" />)}
            </div>
          ) : !dashboard?.recent_mouvements?.length ? (
            <div className="flex items-center justify-center py-10 text-sm text-gray-400">
              Aucun mouvement récent
            </div>
          ) : (
            <div className="divide-y divide-gray-50">
              {dashboard.recent_mouvements.map((mv) => (
                <div key={mv.id} className="flex items-center gap-3 px-5 py-3">
                  <span className={`flex items-center justify-center w-7 h-7 rounded-full text-xs font-bold shrink-0 ${
                    mv.type === 'entree'
                      ? 'bg-green-100 text-green-700'
                      : 'bg-red-100 text-red-600'
                  }`}>
                    {mv.type === 'entree' ? '↓' : '↑'}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-[#212121] truncate">
                      {mv.produits?.designation ?? 'Produit supprimé'}
                    </div>
                    <div className="text-xs text-gray-400">
                      {new Date(mv.created_at).toLocaleString('fr-CM', {
                        day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
                      })}
                    </div>
                  </div>
                  <div className={`text-sm font-semibold shrink-0 ${
                    mv.type === 'entree' ? 'text-green-700' : 'text-red-600'
                  }`}>
                    {mv.type === 'entree' ? '+' : '-'}{mv.quantite} {mv.produits?.unite ?? ''}
                  </div>
                </div>
              ))}
            </div>
          )}
        </motion.div>
      </div>
    </motion.div>
  )
}
