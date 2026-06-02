import React, { useState, useRef, useEffect } from 'react'
import { useLocation, Link, useNavigate } from 'react-router-dom'
import { Bell, Search, Wifi, WifiOff, Menu, ChevronLeft, ChevronRight, AlertCircle, AlertTriangle, Info, Settings, LogOut, X } from 'lucide-react'
import { useAuth } from '@/context/AuthContext'
import { OfflineBanner } from '@forge/ui'
import { useAiAlertes } from '@/hooks/useAI'
import { useStockAlertes } from '@/hooks/useStocks'
import type { AlerteIA } from '@/hooks/useAI'

const ROUTE_LABELS: Record<string, string> = {
  production: 'Production', stocks: 'Stocks', commandes: 'Commandes',
  devis: 'Devis', finance: 'Finance', rh: 'RH', formation: 'Formation',
  projets: 'Projets', logistique: 'Logistique', marketing: 'Marketing',
  securite: 'Sécurité', intelligence: 'Intelligence', iot: 'IoT',
  boutique: 'Boutique', dashboard: 'Dashboard', clients: 'Clients',
  account: 'Mon compte', equipements: 'Équipements',
  admin:   'Administration',
}

// ── Notification panel ─────────────────────────────────────────────────────────

interface NotifItem {
  id: string
  titre: string
  description: string
  severite: 'critique' | 'alerte' | 'info'
  ts: string
}

const SEVERITE_STYLES = {
  critique: { color: '#dc2626', bg: '#fee2e2', Icon: AlertCircle  },
  alerte:   { color: '#d97706', bg: '#fef3c7', Icon: AlertTriangle },
  info:     { color: '#1d4ed8', bg: '#dbeafe', Icon: Info          },
}

function NotificationsPanel({ onClose }: { onClose: () => void }) {
  const { data: aiAlertesData, isLoading: aiLoading } = useAiAlertes()
  const { data: stockData,     isLoading: stockLoading } = useStockAlertes()

  // Build unified notification list
  const items: NotifItem[] = [
    // AI alerts
    ...(aiAlertesData?.alertes ?? []).map((a: AlerteIA): NotifItem => ({
      id:          a.id,
      titre:       a.titre,
      description: a.description,
      severite:    a.severite,
      ts:          a.ts,
    })),
    // Critical/alert stocks
    ...(stockData?.data ?? [])
      .filter((p) => p.statut === 'critique' || p.statut === 'rupture')
      .slice(0, 5)
      .map((p): NotifItem => ({
        id:          `stock-${p.id}`,
        titre:       `Stock ${p.statut === 'rupture' ? 'en rupture' : 'critique'} : ${p.designation}`,
        description: `Quantité actuelle : ${p.stock_actuel} ${p.unite} (seuil critique : ${p.stock_critique})`,
        severite:    p.statut === 'rupture' ? 'critique' : 'alerte',
        ts:          p.updated_at,
      })),
  ]

  const isLoading = aiLoading || stockLoading

  return (
    <div
      className="absolute right-0 top-full mt-2 w-96 bg-white rounded-xl shadow-xl border border-gray-100 z-50 overflow-hidden"
      onClick={(e) => e.stopPropagation()}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
        <div className="flex items-center gap-2">
          <Bell className="h-4 w-4 text-[#C62828]" />
          <span className="font-semibold text-sm text-[#212121]">Notifications</span>
          {items.length > 0 && (
            <span className="flex items-center justify-center w-5 h-5 rounded-full bg-[#C62828] text-white text-xs font-bold">
              {items.length > 9 ? '9+' : items.length}
            </span>
          )}
        </div>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors">
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Body */}
      <div className="max-h-80 overflow-y-auto">
        {isLoading && (
          <div className="flex items-center justify-center py-8 text-sm text-gray-400 gap-2">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-[#C62828] border-t-transparent" />
            Chargement…
          </div>
        )}
        {!isLoading && items.length === 0 && (
          <div className="flex flex-col items-center justify-center py-10 text-gray-400">
            <Bell className="h-8 w-8 mb-2 text-gray-200" />
            <p className="text-sm">Aucune notification</p>
          </div>
        )}
        {!isLoading && items.map((n) => {
          const { color, bg, Icon } = SEVERITE_STYLES[n.severite] ?? SEVERITE_STYLES.info
          return (
            <div key={n.id} className="flex items-start gap-3 px-4 py-3 border-b border-gray-50 last:border-0 hover:bg-gray-50 transition-colors">
              <div className="flex items-center justify-center w-7 h-7 rounded-full shrink-0 mt-0.5" style={{ backgroundColor: bg }}>
                <Icon className="h-3.5 w-3.5" style={{ color }} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-[#212121] truncate">{n.titre}</p>
                <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{n.description}</p>
                {n.ts && <p className="text-[10px] text-gray-400 mt-1">{n.ts}</p>}
              </div>
            </div>
          )
        })}
      </div>

      {/* Footer */}
      <div className="px-4 py-2.5 border-t border-gray-100">
        <Link
          to="/intelligence"
          onClick={onClose}
          className="text-xs font-medium text-[#C62828] hover:underline"
        >
          Voir toutes les alertes →
        </Link>
      </div>
    </div>
  )
}

// ── User dropdown ──────────────────────────────────────────────────────────────

const ROLE_LABELS: Record<string, string> = {
  admin:     'Directeur / Admin. Principal',
  directeur: 'Directeur',
  operateur: 'Opérateur',
  viewer:    'Lecteur',
}

function UserDropdown({ email, initial, onClose }: { email: string; initial: string; onClose: () => void }) {
  const navigate  = useNavigate()
  const { signOut, role } = useAuth()

  const go = (path: string) => { navigate(path); onClose() }
  const handleSignOut = async () => { onClose(); await signOut(); navigate('/login') }

  const roleLabel = ROLE_LABELS[role ?? ''] ?? (role ?? 'Utilisateur')

  return (
    <div
      className="absolute right-0 top-full mt-2 w-56 bg-white rounded-xl shadow-xl border border-gray-100 z-50 overflow-hidden"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="px-4 py-3 border-b border-gray-100">
        <p className="text-xs font-semibold text-[#212121] truncate">{email}</p>
        <span
          className="inline-block mt-1 px-2 py-0.5 text-[10px] font-bold rounded-full"
          style={{ color: '#C62828', backgroundColor: '#FFEBEE' }}
        >
          {roleLabel}
        </span>
      </div>
      <div className="py-1">
        <button onClick={() => go('/account')}
          className="flex items-center gap-2 w-full px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors">
          <Settings className="h-3.5 w-3.5 text-gray-400" /> Mon compte
        </button>
        <button onClick={handleSignOut}
          className="flex items-center gap-2 w-full px-4 py-2 text-sm text-[#C62828] hover:bg-red-50 transition-colors">
          <LogOut className="h-3.5 w-3.5" /> Déconnexion
        </button>
      </div>
    </div>
  )
}

// ── TopBar ─────────────────────────────────────────────────────────────────────

interface TopBarProps {
  onMobileMenuToggle: () => void
  /** Desktop sidebar collapsed state — passed from AppShell */
  sidebarCollapsed?: boolean
  /** Callback to toggle the desktop sidebar */
  onSidebarToggle?: () => void
}

export function TopBar({ onMobileMenuToggle, sidebarCollapsed, onSidebarToggle }: TopBarProps) {
  const { user, role } = useAuth()
  const location = useLocation()
  const [isOnline, setIsOnline] = useState(navigator.onLine)
  const [showNotifs, setShowNotifs] = useState(false)
  const [showUser, setShowUser]     = useState(false)

  const notifsRef = useRef<HTMLDivElement>(null)
  const userRef   = useRef<HTMLDivElement>(null)

  // Fetch alert counts for badge
  const { data: aiAlertesData }  = useAiAlertes()
  const { data: stockAlertData } = useStockAlertes()

  const aiCount    = aiAlertesData?.alertes?.length ?? 0
  const stockCount = (stockAlertData?.data ?? []).filter(
    (p) => p.statut === 'critique' || p.statut === 'rupture'
  ).length
  const totalNotifications = aiCount + stockCount

  React.useEffect(() => {
    const onOnline  = () => setIsOnline(true)
    const onOffline = () => setIsOnline(false)
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    return () => {
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
    }
  }, [])

  // Close dropdowns on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (notifsRef.current && !notifsRef.current.contains(e.target as Node)) setShowNotifs(false)
      if (userRef.current   && !userRef.current.contains(e.target as Node))   setShowUser(false)
    }
    if (showNotifs || showUser) {
      document.addEventListener('mousedown', handleClick)
      return () => document.removeEventListener('mousedown', handleClick)
    }
  }, [showNotifs, showUser])

  // Close dropdowns on route change
  useEffect(() => {
    setShowNotifs(false)
    setShowUser(false)
  }, [location.pathname])

  const segments = location.pathname.split('/').filter(Boolean)
  const breadcrumbs = [
    { label: 'FORGE', path: '/' },
    ...segments.map((seg, i) => ({
      label: ROUTE_LABELS[seg] ?? seg.charAt(0).toUpperCase() + seg.slice(1),
      path: '/' + segments.slice(0, i + 1).join('/'),
    })),
  ]

  const email   = user?.email ?? ''
  const initial = email.charAt(0).toUpperCase()

  return (
    <>
      <header
        className="shrink-0 z-40 flex items-center gap-3 px-4 md:px-5 border-b border-gray-100 bg-white"
        style={{ height: 64, boxShadow: '0 1px 3px 0 rgba(0,0,0,0.06)' }}
      >
        {/* Mobile: hamburger */}
        <button
          onClick={onMobileMenuToggle}
          className="flex md:hidden items-center justify-center w-8 h-8 rounded-lg text-gray-500 hover:bg-gray-100"
        >
          <Menu className="h-5 w-5" />
        </button>

        {/* Desktop: sidebar collapse toggle */}
        {onSidebarToggle && (
          <button
            onClick={onSidebarToggle}
            title={sidebarCollapsed ? 'Déplier la navigation' : 'Réduire la navigation'}
            className="hidden md:flex items-center justify-center w-8 h-8 rounded-lg text-gray-500 hover:bg-gray-100 transition-colors shrink-0"
          >
            {sidebarCollapsed
              ? <ChevronRight className="h-4 w-4" />
              : <ChevronLeft  className="h-4 w-4" />}
          </button>
        )}

        {/* Breadcrumb */}
        <nav className="hidden md:flex items-center gap-1 text-sm flex-1 min-w-0">
          {breadcrumbs.map((crumb, i) => (
            <React.Fragment key={crumb.path}>
              {i > 0 && <span className="text-gray-300 mx-1">/</span>}
              {i === breadcrumbs.length - 1 ? (
                <span className="font-semibold text-[#212121] truncate">{crumb.label}</span>
              ) : (
                <Link to={crumb.path} className="text-gray-400 hover:text-[#C62828] transition-colors truncate">
                  {crumb.label}
                </Link>
              )}
            </React.Fragment>
          ))}
        </nav>

        {/* Search */}
        <div className="relative flex-1 max-w-xs md:max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input
            type="search"
            placeholder="Rechercher..."
            className="w-full pl-9 pr-3 py-2 text-sm bg-gray-50 border border-gray-200 rounded-lg
              focus:outline-none focus:ring-2 focus:ring-[#C62828] focus:border-transparent
              focus:bg-white transition-colors"
          />
        </div>

        {/* Right actions */}
        <div className="flex items-center gap-1.5 shrink-0">
          {/* WiFi status */}
          <div
            className="flex items-center justify-center w-8 h-8 rounded-lg"
            title={isOnline ? 'Connecté' : 'Hors ligne'}
          >
            {isOnline
              ? <Wifi    className="h-4 w-4 text-green-500" />
              : <WifiOff className="h-4 w-4 text-[#C62828]" />}
          </div>

          {/* Notifications bell */}
          <div ref={notifsRef} className="relative">
            <button
              onClick={() => { setShowNotifs((v) => !v); setShowUser(false) }}
              className="relative flex items-center justify-center w-8 h-8 rounded-lg text-gray-500 hover:bg-gray-100 transition-colors"
              aria-label="Notifications"
            >
              <Bell className="h-4 w-4" />
              {totalNotifications > 0 && (
                <span
                  className="absolute -top-0.5 -right-0.5 flex items-center justify-center
                    w-4 h-4 text-[10px] font-bold text-white rounded-full"
                  style={{ backgroundColor: '#C62828' }}
                >
                  {totalNotifications > 9 ? '9+' : totalNotifications}
                </span>
              )}
            </button>
            {showNotifs && <NotificationsPanel onClose={() => setShowNotifs(false)} />}
          </div>

          {/* User avatar */}
          <div ref={userRef} className="relative">
            <button
              onClick={() => { setShowUser((v) => !v); setShowNotifs(false) }}
              className="flex items-center justify-center w-8 h-8 rounded-full text-white text-sm font-semibold shrink-0"
              style={{ backgroundColor: '#C62828' }}
              title={`${email}${role ? ` — ${ROLE_LABELS[role] ?? role}` : ''}`}
              aria-label="Menu utilisateur"
            >
              {initial}
            </button>
            {showUser && (
              <UserDropdown email={email} initial={initial} onClose={() => setShowUser(false)} />
            )}
          </div>
        </div>
      </header>

      {/* Offline banner flows directly below the sticky header */}
      <OfflineBanner />
    </>
  )
}
