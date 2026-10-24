import React from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { Icon, type IconName } from './ui'
import { useNotifications } from '../context/NotificationsContext'
import { usePermissions } from '../context/PermissionsContext'
import { accessibleMobileModules } from '@forge/shared'
import { MODULES } from '../lib/modules'

// Barre du bas : Accueil · Modules · Notifications · Profil.
// Les écrans métier s'ouvrent depuis « Modules », où seuls ceux autorisés par les permissions
// du rôle apparaissent. Adaptation au projet : un rôle qui n'a qu'UN module (ex. livreur →
// Livraisons, caissier → Caisse) y accède directement depuis l'onglet, sans passer par le hub.
const MODULE_ROUTES = ['/modules', '/orders', '/stocks', '/approbation', '/livraisons', '/caisse', '/factures', '/performance']

export function BottomNav() {
  const { unreadCount } = useNotifications()
  const { permissions } = usePermissions()
  const { pathname } = useLocation()
  const inModules = MODULE_ROUTES.some((r) => pathname === r || pathname.startsWith(r + '/'))

  const accessible = accessibleMobileModules(permissions)
  const single = accessible.length === 1 ? MODULES.find((m) => m.screen === accessible[0]) : undefined

  const tabs: Array<{ to: string; label: string; icon: IconName; badge?: number; active?: boolean }> = [
    { to: '/dashboard', label: 'Accueil', icon: 'home' },
    single
      ? { to: single.to, label: single.label, icon: single.icon, active: inModules }
      : { to: '/modules', label: 'Modules', icon: 'grid', active: inModules },
    { to: '/notifications', label: 'Notifications', icon: 'bell', badge: unreadCount },
    { to: '/profile', label: 'Profil', icon: 'user' },
  ]

  return (
    <nav className="fixed bottom-0 inset-x-0 z-40 bg-white border-t border-gray-100 safe-bottom">
      <div className="grid grid-cols-4">
        {tabs.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            className={({ isActive }) => {
              const on = tab.active ?? isActive
              return `relative flex flex-col items-center gap-0.5 py-2.5 text-[10px] font-medium ${on ? 'text-[#C62828]' : 'text-gray-400'}`
            }}
          >
            <span className="relative">
              <Icon name={tab.icon} size={22} />
              {!!tab.badge && (
                <span className="absolute -top-1.5 -right-2.5 min-w-[16px] h-4 px-1 rounded-full bg-[#C62828] text-white text-[9px] font-bold flex items-center justify-center">
                  {tab.badge > 9 ? '9+' : tab.badge}
                </span>
              )}
            </span>
            {tab.label}
          </NavLink>
        ))}
      </div>
    </nav>
  )
}
