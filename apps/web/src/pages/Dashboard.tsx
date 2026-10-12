import React, { useMemo } from 'react'
import { motion } from 'framer-motion'
import { useNavigate } from 'react-router-dom'
import { ArrowRight, RefreshCw } from 'lucide-react'
import { PageHeader } from '@forge/ui'
import { useAuth } from '@/context/AuthContext'
import { usePermissions } from '@/hooks/useRbac'
import { resolveDashboardLayout } from '@/features/dashboard/layouts'
import { KPI_COMPONENTS, PANEL_COMPONENTS } from '@/features/dashboard/widgets'

function Skeleton({ className }: { className?: string }) {
  return <div className={`animate-pulse bg-gray-100 rounded ${className ?? ''}`} />
}

// Colonnes de la rangée d'indicateurs selon leur nombre (6 → 2 rangées de 3).
const KPI_GRID: Record<number, string> = {
  1: 'sm:grid-cols-2 xl:grid-cols-4',
  2: 'sm:grid-cols-2 xl:grid-cols-4',
  3: 'sm:grid-cols-3',
  4: 'sm:grid-cols-2 xl:grid-cols-4',
  5: 'sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5',
  6: 'sm:grid-cols-2 xl:grid-cols-3',
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function Dashboard() {
  const { user, role, displayName: authName } = useAuth()
  const navigate = useNavigate()
  const { data: permissions, loading, hasPermission, refetch } = usePermissions()

  // Le rôle choisit et ordonne les widgets ; les permissions réelles filtrent.
  const layout = useMemo(
    () => resolveDashboardLayout(permissions?.rbacRoleName, permissions?.legacyRole ?? role, hasPermission),
    [permissions, role, hasPermission],
  )

  const userName = authName ?? user?.email?.split('@')[0] ?? 'Utilisateur'
  const today = new Date().toLocaleDateString('fr-CM', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  })
  const hour     = new Date().getHours()
  const greeting = hour < 12 ? 'Bonjour' : hour < 18 ? 'Bon après-midi' : 'Bonsoir'

  const isEmpty = layout.kpis.length === 0 && layout.panels.length === 0

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

      {/* Welcome + raccourcis du poste */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
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
            {!loading && (
              <div className="text-xs text-gray-400 mt-0.5">
                <span className="font-semibold text-[#C62828]">{layout.label}</span> · {layout.subtitle}
              </div>
            )}
          </div>
        </div>

        {!loading && layout.actions.length > 0 && (
          <div className="flex flex-wrap gap-2 sm:ml-auto">
            {layout.actions.map((action, i) => (
              <button
                key={action.label}
                type="button"
                onClick={() => navigate(action.path)}
                className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  i === 0
                    ? 'bg-[#C62828] text-white hover:bg-[#B71C1C]'
                    : 'bg-white border border-gray-200 text-[#212121] hover:border-[#C62828] hover:text-[#C62828]'
                }`}
              >
                {action.label}
                <ArrowRight className="h-3.5 w-3.5" />
              </button>
            ))}
          </div>
        )}
      </div>

      {loading ? (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
            {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-24 w-full rounded-xl" />)}
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {[1, 2].map((i) => <Skeleton key={i} className="h-64 w-full rounded-xl" />)}
          </div>
        </>
      ) : isEmpty ? (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm px-6 py-12 text-center">
          <p className="text-sm text-[#212121] font-medium">
            {permissions
              ? "Aucun indicateur n'est disponible pour votre profil."
              : 'Impossible de charger vos permissions.'}
          </p>
          <p className="text-sm text-gray-400 mt-1">
            {permissions
              ? 'Utilisez le menu pour accéder à vos modules, ou contactez un administrateur.'
              : 'Vérifiez votre connexion puis réessayez.'}
          </p>
          {!permissions && (
            <button
              type="button"
              onClick={() => void refetch()}
              className="inline-flex items-center gap-1.5 mt-4 px-3 py-2 rounded-lg text-sm font-medium bg-[#C62828] text-white hover:bg-[#B71C1C]"
            >
              <RefreshCw className="h-3.5 w-3.5" /> Réessayer
            </button>
          )}
        </div>
      ) : (
        <>
          {layout.kpis.length > 0 && (
            <div className={`grid grid-cols-1 gap-4 ${KPI_GRID[layout.kpis.length] ?? KPI_GRID[4]}`}>
              {layout.kpis.map((id, i) => {
                const Kpi = KPI_COMPONENTS[id]
                return <Kpi key={id} delay={i * 0.05} />
              })}
            </div>
          )}

          {layout.panels.length > 0 && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
              {layout.panels.map((id, i) => {
                const Panel = PANEL_COMPONENTS[id]
                // Un panneau seul sur sa rangée prend toute la largeur.
                const seul = layout.panels.length % 2 === 1 && i === layout.panels.length - 1
                return (
                  <div key={id} className={seul ? 'lg:col-span-2' : undefined}>
                    <Panel delay={0.2 + i * 0.05} can={hasPermission} />
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}
    </motion.div>
  )
}
