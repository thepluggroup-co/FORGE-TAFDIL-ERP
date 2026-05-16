import React, { useState } from 'react'
import { useLocation, Link } from 'react-router-dom'
import { Bell, Search, Wifi, WifiOff, Menu } from 'lucide-react'
import { useAuth } from '@/context/AuthContext'
import { OfflineBanner } from '@forge/ui'

const ROUTE_LABELS: Record<string, string> = {
  production: 'Production',
  stocks: 'Stocks',
  commandes: 'Commandes',
  devis: 'Devis',
  finance: 'Finance',
  rh: 'RH',
  formation: 'Formation',
  projets: 'Projets',
  logistique: 'Logistique',
  marketing: 'Marketing',
  securite: 'Sécurité',
  intelligence: 'Intelligence',
  iot: 'IoT',
  boutique: 'Boutique',
  dashboard: 'Dashboard',
}

interface TopBarProps {
  onMobileMenuToggle: () => void
}

export function TopBar({ onMobileMenuToggle }: TopBarProps) {
  const { user } = useAuth()
  const location = useLocation()
  const [isOnline, setIsOnline] = useState(navigator.onLine)
  const [notifications] = useState(4)

  React.useEffect(() => {
    const onOnline = () => setIsOnline(true)
    const onOffline = () => setIsOnline(false)
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    return () => {
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
    }
  }, [])

  const segments = location.pathname.split('/').filter(Boolean)
  const breadcrumbs = [
    { label: 'FORGE', path: '/' },
    ...segments.map((seg, i) => ({
      label: ROUTE_LABELS[seg] ?? seg,
      path: '/' + segments.slice(0, i + 1).join('/'),
    })),
  ]

  const email = user?.email ?? ''
  const initial = email.charAt(0).toUpperCase()

  return (
    <>
      <header
        className="fixed top-0 right-0 left-0 z-40 flex items-center gap-4 px-4 md:px-6 border-b border-gray-100 bg-white"
        style={{ height: 64, boxShadow: '0 1px 3px 0 rgba(0,0,0,0.06)' }}
      >
        {/* Mobile menu button */}
        <button
          onClick={onMobileMenuToggle}
          className="flex md:hidden items-center justify-center w-8 h-8 rounded-lg text-gray-500 hover:bg-gray-100"
        >
          <Menu className="h-5 w-5" />
        </button>

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
        <div className="flex items-center gap-2 shrink-0">
          {/* WiFi status */}
          <div
            className="flex items-center justify-center w-8 h-8 rounded-lg"
            title={isOnline ? 'Connecté' : 'Hors ligne'}
          >
            {isOnline
              ? <Wifi className="h-4 w-4 text-green-500" />
              : <WifiOff className="h-4 w-4 text-[#C62828]" />
            }
          </div>

          {/* Notifications */}
          <button className="relative flex items-center justify-center w-8 h-8 rounded-lg text-gray-500 hover:bg-gray-100 transition-colors">
            <Bell className="h-4 w-4" />
            {notifications > 0 && (
              <span
                className="absolute -top-0.5 -right-0.5 flex items-center justify-center
                  w-4 h-4 text-[10px] font-bold text-white rounded-full"
                style={{ backgroundColor: '#C62828' }}
              >
                {notifications}
              </span>
            )}
          </button>

          {/* Avatar */}
          <button
            className="flex items-center justify-center w-8 h-8 rounded-full text-white text-sm font-semibold shrink-0"
            style={{ backgroundColor: '#C62828' }}
            title={email}
          >
            {initial}
          </button>
        </div>
      </header>

      {/* Offline banner sits just below the topbar */}
      <div className="fixed top-16 inset-x-0 z-30">
        <OfflineBanner />
      </div>
    </>
  )
}
