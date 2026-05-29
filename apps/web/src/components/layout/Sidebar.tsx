import React from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { TafdilIcon } from '@/components/ui/Logo'
import {
  LayoutDashboard, Wrench, Package, ShoppingCart, FileText, DollarSign, Users,
  GraduationCap, Kanban, Truck, Megaphone, Shield, Brain, Wifi,
  Store, LogOut, ChevronLeft, ChevronRight, Settings, Crown,
} from 'lucide-react'
import { useAuth } from '@/context/AuthContext'
import { useCommandesShop } from '@/hooks/useCommandesShop'

interface NavItem {
  path: string
  label: string
  icon: React.ElementType
  badge?: number
  dynamicBadge?: boolean
}

// ── Static nav items — no arbitrary badge numbers ──────────────────────────────
const NAV_ITEMS_BASE: NavItem[] = [
  { path: '/dashboard',    label: 'Dashboard',    icon: LayoutDashboard },
  { path: '/boutique',     label: 'Boutique',     icon: Store,          dynamicBadge: true },
  { path: '/production',   label: 'Production',   icon: Wrench },
  { path: '/stocks',       label: 'Stocks',       icon: Package },
  { path: '/commandes',    label: 'Commandes',    icon: ShoppingCart },
  { path: '/devis',        label: 'Devis',        icon: FileText },
  { path: '/clients',      label: 'Clients',      icon: Users },
  { path: '/finance',      label: 'Finance',      icon: DollarSign },
  { path: '/rh',           label: 'RH',           icon: Users },
  { path: '/formation',    label: 'Formation',    icon: GraduationCap },
  { path: '/projets',      label: 'Projets',      icon: Kanban },
  { path: '/logistique',   label: 'Logistique',   icon: Truck },
  { path: '/marketing',    label: 'Marketing',    icon: Megaphone },
  { path: '/securite',     label: 'Sécurité',     icon: Shield },
  { path: '/intelligence', label: 'Intelligence', icon: Brain },
  { path: '/iot',          label: 'IoT',          icon: Wifi },
]

interface SidebarProps {
  collapsed: boolean
  onToggle: () => void
}

export function Sidebar({ collapsed, onToggle }: SidebarProps) {
  const { user, role: appRole, signOut } = useAuth()
  const navigate = useNavigate()

  // Dynamic badge: new web orders today
  const { data: shopData } = useCommandesShop()
  const webBadge = shopData?.stats?.nouvelles_ce_jour ?? 0

  // Build nav — inject admin item for admin role
  const baseItems: NavItem[] = appRole === 'admin'
    ? [...NAV_ITEMS_BASE, { path: '/admin', label: 'Administration', icon: Crown }]
    : NAV_ITEMS_BASE

  const NAV_ITEMS = baseItems.map((item) =>
    item.dynamicBadge && item.path === '/boutique'
      ? { ...item, badge: webBadge > 0 ? webBadge : undefined }
      : { ...item, badge: item.dynamicBadge ? undefined : item.badge }
  )

  const handleSignOut = async () => {
    await signOut()
    navigate('/login')
  }

  const email   = user?.email ?? ''
  const initial = email.charAt(0).toUpperCase()

  const roleLabels: Record<string, string> = {
    admin:     'Directeur · Admin. Principal',
    directeur: 'Directeur',
    operateur: 'Opérateur',
    viewer:    'Lecteur',
  }
  const roleLabel = roleLabels[appRole ?? ''] ?? (appRole ?? 'Utilisateur')

  return (
    <motion.aside
      animate={{ width: collapsed ? 64 : 240 }}
      transition={{ duration: 0.25, ease: [0.32, 0.72, 0, 1] }}
      className="relative flex flex-col shrink-0 overflow-hidden"
      style={{ backgroundColor: '#212121', height: '100%' }}
    >
      {/* ── Header ── */}
      <div className="flex items-center gap-3 px-4 py-5 border-b border-white/10 shrink-0">
        <TafdilIcon size={36} variant="white" className="shrink-0" />
        {!collapsed && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.1 }}
            className="min-w-0"
          >
            <div className="text-white font-bold text-base leading-none">
              <span style={{ color: '#C62828' }}>FOR</span>GE
            </div>
            <div className="text-white/40 text-xs mt-0.5 leading-none">ERP · TAFDIL</div>
          </motion.div>
        )}
      </div>

      {/* ── User info — clickable → /account ── */}
      <button
        onClick={() => navigate('/account')}
        title={collapsed ? `${email} — ${roleLabel}` : undefined}
        className="flex items-center gap-2.5 px-4 py-3 border-b border-white/10 shrink-0
          hover:bg-white/5 transition-colors text-left w-full"
      >
        <div
          className="flex items-center justify-center rounded-full shrink-0 text-white text-sm font-semibold"
          style={{ width: 32, height: 32, backgroundColor: '#C62828' }}
        >
          {initial}
        </div>
        {!collapsed && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.12 }}
            className="min-w-0 flex-1"
          >
            <div className="text-white text-xs font-medium truncate">{email}</div>
            <span className="inline-block mt-0.5 px-1.5 py-px text-xs rounded-full bg-[#C62828]/30 text-[#EF9A9A]">
              {roleLabel}
            </span>
          </motion.div>
        )}
      </button>

      {/* ── Navigation — flex-1 + min-h-0 ensures it scrolls instead of overflowing ── */}
      <nav className="sidebar-scroll flex-1 min-h-0 overflow-y-auto overflow-x-hidden py-2">
        {NAV_ITEMS.map((item) => (
          <NavLink key={item.path} to={item.path} title={collapsed ? item.label : undefined}>
            {({ isActive }) => (
              <motion.div
                whileHover={{ scale: 1.02 }}
                transition={{ duration: 0.15 }}
                className="relative flex items-center gap-3 px-3 mx-2 my-0.5 rounded-lg h-10 cursor-pointer transition-colors"
                style={{
                  backgroundColor: isActive ? '#C62828' : 'transparent',
                  color: isActive ? '#fff' : 'rgba(255,255,255,0.7)',
                }}
                onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.backgroundColor = 'rgba(198,40,40,0.2)' }}
                onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.backgroundColor = 'transparent' }}
              >
                <item.icon className="shrink-0" style={{ width: 18, height: 18 }} />
                {!collapsed && (
                  <span className="text-sm font-medium truncate flex-1">{item.label}</span>
                )}
                {item.badge !== undefined && item.badge > 0 && (
                  <span
                    className={`flex items-center justify-center rounded-full text-white text-xs font-bold shrink-0 ${
                      collapsed ? 'absolute -top-1 -right-1 w-4 h-4 text-[10px]' : 'w-5 h-5'
                    }`}
                    style={{
                      backgroundColor: isActive ? 'rgba(255,255,255,0.3)' : '#C62828',
                      minWidth: collapsed ? 16 : 20,
                    }}
                  >
                    {item.badge > 99 ? '99+' : item.badge}
                  </span>
                )}
              </motion.div>
            )}
          </NavLink>
        ))}
      </nav>

      {/* ── Footer ── */}
      <div className="border-t border-white/10 shrink-0 py-3 px-3 space-y-1">
        {!collapsed && (
          <div className="text-white/30 text-xs px-2 mb-1">FORGE v1.0.0</div>
        )}

        {/* Account / settings shortcut */}
        <button
          onClick={() => navigate('/account')}
          title={collapsed ? 'Paramètres du compte' : undefined}
          className="flex items-center gap-3 w-full px-2 py-2 rounded-lg
            text-white/60 hover:text-white hover:bg-white/10 transition-colors"
        >
          <Settings className="shrink-0" style={{ width: 18, height: 18 }} />
          {!collapsed && <span className="text-sm">Paramètres</span>}
        </button>

        {/* Sign-out */}
        <button
          onClick={handleSignOut}
          title={collapsed ? 'Déconnexion' : undefined}
          className="flex items-center gap-3 w-full px-2 py-2 rounded-lg
            text-white/60 hover:text-white hover:bg-white/10 transition-colors"
        >
          <LogOut className="shrink-0" style={{ width: 18, height: 18 }} />
          {!collapsed && <span className="text-sm">Déconnexion</span>}
        </button>
      </div>
    </motion.aside>
  )
}
