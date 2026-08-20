import React, { useState, useEffect } from 'react'
import { NavLink, useNavigate, useLocation } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { TafdilIcon } from '@/components/ui/Logo'
import {
  LayoutDashboard, Wrench, Package, ShoppingCart, FileText, DollarSign, Users,
  GraduationCap, Kanban, Truck, Megaphone, Shield, Brain, Wifi,
  Store, LogOut, ChevronLeft, ChevronRight, ChevronDown, Settings, Crown, Hammer, Building2,
  Receipt,
} from 'lucide-react'
import { useAuth } from '@/context/AuthContext'
import { useCommandesShop } from '@/hooks/useCommandesShop'

type AppRole = 'admin' | 'superviseur' | 'operateur' | 'technicien' | 'caissier'

interface NavItem {
  path: string
  label: string
  icon: React.ElementType
  badge?: number
  dynamicBadge?: boolean
  roles?: AppRole[]   // undefined = tous les rôles
}

interface NavGroup {
  id: string
  label: string
  items: NavItem[]
  roles?: AppRole[]   // filtre le groupe entier si tous ses items sont cachés
}

const ALL: AppRole[] = ['admin', 'superviseur', 'operateur', 'technicien']
const NO_TECHNICIEN: AppRole[] = ['admin', 'superviseur', 'operateur']
const ADMIN_SUPERVISEUR: AppRole[] = ['admin', 'superviseur']
const CAISSIER_RESPONSABLE: AppRole[] = ['caissier', 'admin', 'superviseur']

const DASHBOARD_ITEM: NavItem = { path: '/dashboard', label: 'Dashboard', icon: LayoutDashboard }

const NAV_GROUPS: NavGroup[] = [
  {
    id: 'activite',
    label: 'Activité',
    items: [
      { path: '/caisse',       label: 'Caisse',       icon: Receipt,       roles: CAISSIER_RESPONSABLE },
      { path: '/boutique',     label: 'Boutique',     icon: Store, dynamicBadge: true, roles: ALL },
      { path: '/production',   label: 'Production',   icon: Wrench,        roles: ALL },
      { path: '/commandes',    label: 'Commandes',    icon: ShoppingCart,  roles: ALL },
      { path: '/stocks',       label: 'Stocks',       icon: Package,       roles: ALL },
      { path: '/fournisseurs', label: 'Fournisseurs', icon: Building2,     roles: ALL },
    ],
  },
  {
    id: 'commercial',
    label: 'Commercial',
    items: [
      { path: '/devis',      label: 'Devis',      icon: FileText, roles: ALL },
      { path: '/clients',    label: 'Clients',    icon: Users,    roles: ALL },
      { path: '/logistique', label: 'Logistique', icon: Truck,    roles: ALL },
    ],
  },
  {
    id: 'gestion',
    label: 'Gestion',
    items: [
      { path: '/finance',     label: 'Finance',     icon: DollarSign,   roles: ADMIN_SUPERVISEUR },
      { path: '/rh',          label: 'RH',          icon: Users,        roles: ADMIN_SUPERVISEUR },
      { path: '/formation',   label: 'Formation',   icon: GraduationCap, roles: NO_TECHNICIEN },
      { path: '/equipements', label: 'Équipements', icon: Hammer,       roles: NO_TECHNICIEN },
      { path: '/projets',     label: 'Projets',     icon: Kanban,       roles: ADMIN_SUPERVISEUR },
    ],
  },
  {
    id: 'pilotage',
    label: 'Pilotage',
    items: [
      { path: '/intelligence', label: 'Intelligence', icon: Brain,    roles: ADMIN_SUPERVISEUR },
      { path: '/marketing',    label: 'Marketing',    icon: Megaphone, roles: ADMIN_SUPERVISEUR },
      { path: '/iot',          label: 'IoT',          icon: Wifi,     roles: NO_TECHNICIEN },
      { path: '/securite',     label: 'Sécurité',     icon: Shield,   roles: ADMIN_SUPERVISEUR },
    ],
  },
]

const STORAGE_KEY = 'forge-sidebar-groups'

interface SidebarProps {
  collapsed: boolean
  onToggle: () => void
}

export function Sidebar({ collapsed, onToggle }: SidebarProps) {
  const { user, role: appRole, displayName: authName, signOut } = useAuth()
  const navigate  = useNavigate()
  const location  = useLocation()

  const { data: shopData } = useCommandesShop()
  const webBadge = shopData?.stats?.nouvelles_ce_jour ?? 0

  // ── Group open/close state — persisted in localStorage ──────────────────────
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      return saved
        ? (JSON.parse(saved) as Record<string, boolean>)
        : { activite: true, commercial: true, gestion: false, pilotage: false }
    } catch {
      return { activite: true, commercial: true, gestion: false, pilotage: false }
    }
  })

  // Auto-open the group that contains the active route
  useEffect(() => {
    const activeGroup = NAV_GROUPS.find(g =>
      g.items.some(i => location.pathname === i.path || location.pathname.startsWith(i.path + '/'))
    )
    if (activeGroup && !openGroups[activeGroup.id]) {
      setOpenGroups(prev => {
        const next = { ...prev, [activeGroup.id]: true }
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
        return next
      })
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname])

  const toggleGroup = (id: string) => {
    setOpenGroups(prev => {
      const next = { ...prev, [id]: !prev[id] }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
      return next
    })
  }

  const currentRole = (appRole ?? 'technicien') as AppRole

  // Inject admin item at bottom of Gestion group, then filter by role
  const groups: NavGroup[] = NAV_GROUPS.map(g => {
    const withAdmin = g.id === 'gestion' && appRole === 'admin'
      ? { ...g, items: [...g.items, { path: '/admin', label: 'Administration', icon: Crown, roles: ['admin'] as AppRole[] }] }
      : g
    return {
      ...withAdmin,
      items: withAdmin.items.filter(item => !item.roles || item.roles.includes(currentRole)),
    }
  }).filter(g => g.items.length > 0)

  const resolveItem = (item: NavItem): NavItem =>
    item.dynamicBadge && item.path === '/boutique'
      ? { ...item, badge: webBadge > 0 ? webBadge : undefined }
      : item

  const email       = user?.email ?? ''
  const displayName = authName ?? user?.email?.split('@')[0] ?? 'Utilisateur'
  const initial     = displayName.charAt(0).toUpperCase()

  const roleLabels: Record<string, string> = {
    admin:       'Admin (Patron)',
    superviseur: 'Superviseur',
    operateur:   'Opérateur',
    technicien:  'Technicien',
    caissier:    'Caissier',
  }
  const roleLabel = roleLabels[appRole ?? ''] ?? (appRole ?? 'Utilisateur')

  const handleSignOut = async () => {
    await signOut()
    navigate('/login')
  }

  const renderItem = (item: NavItem) => {
    const resolved = resolveItem(item)
    return (
      <NavLink key={resolved.path} to={resolved.path} title={collapsed ? resolved.label : undefined}>
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
            <resolved.icon className="shrink-0" style={{ width: 18, height: 18 }} />
            {!collapsed && (
              <span className="text-sm font-medium truncate flex-1">{resolved.label}</span>
            )}
            {resolved.badge !== undefined && resolved.badge > 0 && (
              <span
                className={`flex items-center justify-center rounded-full text-white text-xs font-bold shrink-0 ${
                  collapsed ? 'absolute -top-1 -right-1 w-4 h-4 text-[10px]' : 'w-5 h-5'
                }`}
                style={{
                  backgroundColor: isActive ? 'rgba(255,255,255,0.3)' : '#C62828',
                  minWidth: collapsed ? 16 : 20,
                }}
              >
                {resolved.badge > 99 ? '99+' : resolved.badge}
              </span>
            )}
          </motion.div>
        )}
      </NavLink>
    )
  }

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
            <div className="text-white text-sm font-semibold truncate leading-tight">{displayName}</div>
            <div className="text-white/40 text-xs truncate leading-tight mt-0.5">{email}</div>
            <span className="inline-block mt-1 px-1.5 py-px text-xs rounded-full bg-[#C62828]/30 text-[#EF9A9A]">
              {roleLabel}
            </span>
          </motion.div>
        )}
      </button>

      {/* ── Navigation ── */}
      <nav className="sidebar-scroll flex-1 min-h-0 overflow-y-auto overflow-x-hidden py-2">

        {/* Dashboard — standalone, toujours visible */}
        {renderItem(DASHBOARD_ITEM)}

        {collapsed ? (
          // Mode icônes : tous les items à plat, pas de groupes
          groups.flatMap(g => g.items).map(renderItem)
        ) : (
          // Mode étendu : groupes collapsibles
          groups.map(group => {
            const isOpen = openGroups[group.id] ?? false
            return (
              <div key={group.id} className="mt-1">
                <button
                  onClick={() => toggleGroup(group.id)}
                  className="flex items-center justify-between w-full px-3 h-8 rounded-md
                    text-white/40 hover:text-white/60 transition-colors"
                  style={{ margin: '0 8px', width: 'calc(100% - 16px)' }}
                >
                  <span className="text-[11px] font-semibold uppercase tracking-wider">
                    {group.label}
                  </span>
                  <ChevronDown
                    style={{
                      width: 13, height: 13,
                      transform: isOpen ? 'rotate(0deg)' : 'rotate(-90deg)',
                      transition: 'transform 0.2s ease',
                    }}
                  />
                </button>

                <AnimatePresence initial={false}>
                  {isOpen && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2, ease: 'easeInOut' }}
                      className="overflow-hidden"
                    >
                      {group.items.map(renderItem)}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            )
          })
        )}
      </nav>

      {/* ── Footer ── */}
      <div className="border-t border-white/10 shrink-0 py-3 px-3 space-y-1">
        {!collapsed && (
          <div className="text-white/30 text-xs px-2 mb-1">FORGE v1.0.0</div>
        )}
        <button
          onClick={() => navigate('/account')}
          title={collapsed ? 'Paramètres du compte' : undefined}
          className="flex items-center gap-3 w-full px-2 py-2 rounded-lg
            text-white/60 hover:text-white hover:bg-white/10 transition-colors"
        >
          <Settings className="shrink-0" style={{ width: 18, height: 18 }} />
          {!collapsed && <span className="text-sm">Paramètres</span>}
        </button>
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

      {/* ── Collapse toggle ── */}
      <button
        onClick={onToggle}
        className="absolute bottom-24 -right-3 flex items-center justify-center w-6 h-6 rounded-full
          bg-[#333] border border-white/10 text-white/60 hover:text-white hover:bg-[#444] transition-colors z-10"
      >
        {collapsed
          ? <ChevronRight style={{ width: 12, height: 12 }} />
          : <ChevronLeft  style={{ width: 12, height: 12 }} />
        }
      </button>
    </motion.aside>
  )
}
