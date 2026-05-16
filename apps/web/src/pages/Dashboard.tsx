import React from 'react'
import { motion } from 'framer-motion'
import { useNavigate } from 'react-router-dom'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts'
import { DollarSign, ShoppingCart, Package, GraduationCap, AlertTriangle, ArrowRight } from 'lucide-react'
import { KpiCard, PageHeader, StatusBadge } from '@forge/ui'
import { useAuth } from '@/context/AuthContext'
import { formatXAF, formatDate } from '@/lib/utils'

// ── Mock data ──────────────────────────────────────────────────────────────────

const CA_DATA = [
  { mois: 'Déc', ca: 850000 },
  { mois: 'Jan', ca: 920000 },
  { mois: 'Fév', ca: 780000 },
  { mois: 'Mar', ca: 1100000 },
  { mois: 'Avr', ca: 950000 },
  { mois: 'Mai', ca: 1250000 },
]

const RECENT_ORDERS = [
  { ref: 'CMD-2026-047', client: 'SODECOTON', montant: 450000, statut: 'in_production', date: '2026-05-15' },
  { ref: 'CMD-2026-046', client: 'Fouda Jean', montant: 85000, statut: 'confirmed', date: '2026-05-14' },
  { ref: 'CMD-2026-045', client: 'CAMRAIL SA', montant: 1200000, statut: 'delivered', date: '2026-05-12' },
  { ref: 'CMD-2026-044', client: 'Biyong & Fils', montant: 320000, statut: 'draft', date: '2026-05-11' },
  { ref: 'CMD-2026-043', client: 'MAETUR', montant: 750000, statut: 'shipped', date: '2026-05-10' },
]

const RECENT_MOVEMENTS = [
  { produit: 'Aluminium 6060 T5', type: 'sortie', quantite: 15, unite: 'kg', date: '2026-05-16 08:30' },
  { produit: 'Tôle galvanisée 2mm', type: 'entree', quantite: 200, unite: 'kg', date: '2026-05-15 14:15' },
  { produit: 'Câble électrique 2.5mm²', type: 'sortie', quantite: 50, unite: 'm', date: '2026-05-15 11:00' },
  { produit: 'Fer plat 40×4', type: 'sortie', quantite: 30, unite: 'kg', date: '2026-05-14 16:45' },
  { produit: 'Profilé U 100', type: 'entree', quantite: 100, unite: 'kg', date: '2026-05-14 09:00' },
]

const ALERTS = [
  {
    id: 1,
    level: 'critique' as const,
    message: 'Aluminium 6060 T5 : stock critique (2 unités restantes)',
    link: '/stocks',
  },
  {
    id: 2,
    level: 'danger' as const,
    message: 'Client Fouda Jean : crédit de 180 000 FCFA échu depuis 15 jours',
    link: '/finance',
  },
  {
    id: 3,
    level: 'warning' as const,
    message: '3 bons de sortie en attente de validation',
    link: '/stocks/bons-sortie',
  },
]

// ── Custom tooltip for chart ──────────────────────────────────────────────────

function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-white border border-gray-100 rounded-lg shadow-lg px-3 py-2">
      <p className="text-xs text-gray-500 mb-0.5">{label}</p>
      <p className="text-sm font-bold text-[#212121]">{formatXAF(payload[0].value)}</p>
    </div>
  )
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function Dashboard() {
  const { user } = useAuth()
  const navigate = useNavigate()

  const userName = (user?.user_metadata?.name as string) ?? user?.email?.split('@')[0] ?? 'Utilisateur'
  const today = new Date().toLocaleDateString('fr-CM', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })

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
        subtitle={`${today.charAt(0).toUpperCase() + today.slice(1)} · Bonjour, ${userName}`}
      />

      {/* KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <KpiCard
          title="Trésorerie actuelle"
          value="4 250 000"
          unit="FCFA"
          trend="up"
          trendValue="+8% ce mois"
          icon={<DollarSign className="h-5 w-5" />}
          color="#16a34a"
          delay={0}
        />
        <KpiCard
          title="Commandes en cours"
          value={12}
          trend="up"
          trendValue="+3 cette semaine"
          icon={<ShoppingCart className="h-5 w-5" />}
          color="#1d4ed8"
          delay={0.05}
        />
        <KpiCard
          title="Stocks critiques"
          value={3}
          unit="produits"
          trend="down"
          trendValue="Alerte active"
          icon={<Package className="h-5 w-5" />}
          color="#C62828"
          delay={0.1}
        />
        <KpiCard
          title="Apprenants actifs"
          value={7}
          trend="neutral"
          trendValue="Stable"
          icon={<GraduationCap className="h-5 w-5" />}
          color="#6d28d9"
          delay={0.15}
        />
      </div>

      {/* Main section: Alerts + Chart */}
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
            <span className="ml-auto flex items-center justify-center w-5 h-5 rounded-full bg-[#C62828] text-white text-xs font-bold">
              {ALERTS.length}
            </span>
          </div>
          <div className="divide-y divide-gray-50">
            {ALERTS.map((alert) => (
              <button
                key={alert.id}
                onClick={() => navigate(alert.link)}
                className="flex items-start gap-3 w-full px-5 py-4 text-left hover:bg-gray-50 transition-colors group"
              >
                <span
                  className="flex items-center justify-center w-7 h-7 rounded-full shrink-0 mt-0.5"
                  style={{
                    backgroundColor: alert.level === 'critique' ? '#fee2e2'
                      : alert.level === 'danger' ? '#fef3c7' : '#fff7ed',
                  }}
                >
                  <AlertTriangle
                    className="h-3.5 w-3.5"
                    style={{
                      color: alert.level === 'critique' ? '#dc2626'
                        : alert.level === 'danger' ? '#d97706' : '#ea580c',
                    }}
                  />
                </span>
                <span className="text-sm text-[#212121] flex-1 leading-snug">{alert.message}</span>
                <ArrowRight className="h-4 w-4 text-gray-300 group-hover:text-[#C62828] transition-colors shrink-0 mt-0.5" />
              </button>
            ))}
          </div>
        </motion.div>

        {/* Graphique CA */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.25, duration: 0.3 }}
          className="bg-white rounded-xl border border-gray-100 shadow-sm p-5"
        >
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-sm font-semibold text-[#212121]">Chiffre d'affaires — 6 derniers mois</h2>
            <span className="text-xs font-semibold text-green-600 bg-green-50 px-2 py-0.5 rounded-full">
              +47% vs N-1
            </span>
          </div>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={CA_DATA} barSize={32}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
              <XAxis dataKey="mois" tick={{ fontSize: 12, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
              <YAxis
                tick={{ fontSize: 11, fill: '#9ca3af' }}
                axisLine={false}
                tickLine={false}
                tickFormatter={(v) => `${(v / 1000000).toFixed(1)}M`}
              />
              <Tooltip content={<ChartTooltip />} cursor={{ fill: '#f8f8f8' }} />
              <Bar dataKey="ca" fill="#C62828" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </motion.div>
      </div>

      {/* Bottom: Orders + Movements */}
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
              onClick={() => navigate('/commandes')}
              className="text-xs text-[#C62828] hover:underline font-medium"
            >
              Voir tout →
            </button>
          </div>
          <div className="divide-y divide-gray-50">
            {RECENT_ORDERS.map((order) => (
              <div key={order.ref} className="flex items-center gap-3 px-5 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono text-gray-400">{order.ref}</span>
                    <StatusBadge status={order.statut} />
                  </div>
                  <div className="text-sm font-medium text-[#212121] mt-0.5">{order.client}</div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-sm font-semibold text-[#212121]">{formatXAF(order.montant)}</div>
                  <div className="text-xs text-gray-400">{formatDate(order.date)}</div>
                </div>
              </div>
            ))}
          </div>
        </motion.div>

        {/* Derniers mouvements */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.35, duration: 0.3 }}
          className="bg-white rounded-xl border border-gray-100 shadow-sm"
        >
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
            <h2 className="text-sm font-semibold text-[#212121]">Derniers mouvements stock</h2>
            <button
              onClick={() => navigate('/stocks')}
              className="text-xs text-[#C62828] hover:underline font-medium"
            >
              Voir tout →
            </button>
          </div>
          <div className="divide-y divide-gray-50">
            {RECENT_MOVEMENTS.map((mv, i) => (
              <div key={i} className="flex items-center gap-3 px-5 py-3">
                <span
                  className="flex items-center justify-center w-7 h-7 rounded-full text-xs font-bold shrink-0"
                  style={{
                    backgroundColor: mv.type === 'entree' ? '#dcfce7' : '#fee2e2',
                    color: mv.type === 'entree' ? '#15803d' : '#dc2626',
                  }}
                >
                  {mv.type === 'entree' ? '↓' : '↑'}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-[#212121] truncate">{mv.produit}</div>
                  <div className="text-xs text-gray-400">{mv.date}</div>
                </div>
                <div className="text-sm font-semibold shrink-0" style={{
                  color: mv.type === 'entree' ? '#15803d' : '#dc2626',
                }}>
                  {mv.type === 'entree' ? '+' : '-'}{mv.quantite} {mv.unite}
                </div>
              </div>
            ))}
          </div>
        </motion.div>
      </div>
    </motion.div>
  )
}
