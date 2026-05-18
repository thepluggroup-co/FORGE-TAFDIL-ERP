import React from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { TafdilIcon } from '@/components/ui/Logo'
import {
  LayoutDashboard, Wrench, Package, ShoppingCart, FileText, DollarSign, Users,
  GraduationCap, Kanban, Truck, Megaphone, Shield, Brain, Wifi,
  Store, LogOut, ChevronLeft, ChevronRight,
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

const NAV_ITEMS_BASE: NavItem[] = [
  { path: '/dashboard',    label: 'Dashboard',      icon: LayoutDashboard },
  { path: '/production',   label: 'Production',    icon: Wrench,         badge: 2 },
  { path: '/stocks',       label: 'Stocks',         icon: Package,        badge: 5 },
  { path: '/commandes',    label: 'Commandes',      icon: ShoppingCart,   dynamicBadge: true },
  { path: '/devis',        label: 'Devis',          icon: FileText },
  { path: '/finance',      label: 'Finance',        icon: DollarSign,     badge: 1 },
  { path: '/rh',           label: 'RH',             icon: Users },
  { path: '/formation',    label: 'Formation',      icon: GraduationCap },
  { path: '/projets',      label: 'Projets',        icon: Kanban },
  { path: '/logistique',   label: 'Logistique',     icon: Truck },
  { path: '/marketing',    label: 'Marketing',      icon: Megaphone },
  { path: '/securite',     label: 'Sécurité',       icon: Shield,         badge: 1 },
  { path: '/intelligence', label: 'Intelligence',   icon: Brain },
  { path: '/iot',          label: 'IoT',            icon: Wifi },
  { path: '/boutique',     label: 'Boutique',       icon: Store },
]

interface SidebarProps {
  collapsed: boolean
  onToggle: () => void
}

export function Sidebar({ collapsed, onToggle }: SidebarProps) {
  const { user, signOut } = useAuth()
  const navigate = useNavigate()

  const { data: shopData } = useCommandesShop()
  const webBadge = shopData?.stats?.nouvelles_ce_jour ?? 0

  const NAV_ITEMS = NAV_ITEMS_BASE.map((item) =>
    item.dynamicBadge
      ? { ...item, badge: webBadge > 0 ? webBadge : undefined }
      : item
  )

  const handleSignOut = async () => {
    await signOut()
    navigate('/login')
  }

  const email = user?.email ?? ''
  const initial = email.charAt(0).toUpperCase()
  const role = (user?.user_metadata?.role as string) ?? 'Opérateur'

  return (
    <motion.aside
      animate={{ width: collapsed ? 64 : 240 }}
      transition={{ duration: 0.25, ease: [0.32, 0.72, 0, 1] }}
      className="relative flex flex-col h-full shrink-0 overflow-hidden"
      style={{ backgroundColor: '#212121' }}
    >
      {/* Toggle button */}
      <button
        onClick={onToggle}
        className="absolute -right-3 top-20 z-10 flex items-center justify-center
          w-6 h-6 rounded-full bg-[#C62828] text-white shadow-md
          hover:bg-[#B71C1C] transition-colors"
        aria-label={collapsed ? 'Déplier la sidebar' : 'Réduire la sidebar'}
      >
        {collapsed ? <ChevronRight className="h-3 w-3" /> : <ChevronLeft className="h-3 w-3" />}
      </button>

      {/* Header */}
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

      {/* User info */}
      {!collapsed && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.12 }}
          className="flex items-center gap-2.5 px-4 py-3 border-b border-white/10 shrink-0"
        >
          <div
            className="flex items-center justify-center rounded-full shrink-0 text-white text-sm font-semibold"
            style={{ width: 32, height: 32, backgroundColor: '#C62828' }}
          >
            {initial}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-white text-xs font-medium truncate">{email}</div>
            <span className="inline-block mt-0.5 px-1.5 py-px text-xs rounded-full bg-[#C62828]/30 text-[#EF9A9A]">
              {role}
            </span>
          </div>
        </motion.div>
      )}

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto overflow-x-hidden py-2 scrollbar-thin">
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
                onMouseEnter={(e) => {
                  if (!isActive) e.currentTarget.style.backgroundColor = 'rgba(198,40,40,0.2)'
                }}
                onMouseLeave={(e) => {
                  if (!isActive) e.currentTarget.style.backgroundColor = 'transparent'
                }}
              >
                <item.icon className="h-4.5 w-4.5 shrink-0" style={{ width: 18, height: 18 }} />
                {!collapsed && (
                  <span className="text-sm font-medium truncate flex-1">{item.label}</span>
                )}
                {item.badge && (
                  <span
                    className={`flex items-center justify-center rounded-full text-white text-xs font-bold shrink-0 ${
                      collapsed ? 'absolute -top-1 -right-1 w-4 h-4 text-[10px]' : 'w-5 h-5'
                    }`}
                    style={{ backgroundColor: isActive ? 'rgba(255,255,255,0.3)' : '#C62828', minWidth: collapsed ? 16 : 20 }}
                  >
                    {item.badge}
                  </span>
                )}
              </motion.div>
            )}
          </NavLink>
        ))}
      </nav>

      {/* Footer */}
      <div className="border-t border-white/10 shrink-0 py-3 px-3">
        {!collapsed && (
          <div className="text-white/30 text-xs px-2 mb-2">FORGE v1.0.0</div>
        )}
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
