import type { OrderStatus, UserRole } from '@forge/shared'

// --- Roles utilisateurs ---
export const USER_ROLE_LABELS: Record<UserRole, string> = {
  admin:       'Admin (Patron)',
  superviseur: 'Superviseur',
  operateur:   'Opérateur',
  apprenant:   'Apprenant',
}

export const USER_ROLE_COLORS: Record<UserRole, string> = {
  admin:       'text-forge-red bg-forge-red-light',
  superviseur: 'text-blue-700 bg-blue-50',
  operateur:   'text-green-700 bg-green-50',
  apprenant:   'text-gray-600 bg-gray-100',
}

// --- Statuts commandes ---
export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  draft: 'Brouillon',
  confirmed: 'Confirmée',
  in_production: 'En production',
  shipped: 'Expédiée',
  delivered: 'Livrée',
  cancelled: 'Annulée',
}

export const ORDER_STATUS_COLORS: Record<OrderStatus, string> = {
  draft: 'text-gray-600 bg-gray-100',
  confirmed: 'text-blue-700 bg-blue-50',
  in_production: 'text-orange-700 bg-orange-50',
  shipped: 'text-purple-700 bg-purple-50',
  delivered: 'text-green-700 bg-green-50',
  cancelled: 'text-red-700 bg-red-50',
}

// --- Statuts production ---
export type ProductionStatus = 'pending' | 'active' | 'paused' | 'done'

export const PRODUCTION_STATUS_LABELS: Record<ProductionStatus, string> = {
  pending: 'En attente',
  active: 'En cours',
  paused: 'Suspendu',
  done: 'Terminé',
}

export const PRODUCTION_STATUS_COLORS: Record<ProductionStatus, string> = {
  pending: 'text-gray-600 bg-gray-100',
  active: 'text-blue-700 bg-blue-50',
  paused: 'text-yellow-700 bg-yellow-50',
  done: 'text-green-700 bg-green-50',
}

// --- Navigation ---
export const NAV_ITEMS = [
  { path: '/dashboard', label: 'Dashboard', icon: 'LayoutDashboard' },
  { path: '/orders', label: 'Commandes', icon: 'ShoppingCart' },
  { path: '/production', label: 'Production', icon: 'Factory' },
  { path: '/inventory', label: 'Inventaire', icon: 'Package' },
  { path: '/clients', label: 'Clients', icon: 'Users' },
  { path: '/ai', label: 'FORGE AI', icon: 'Bot' },
] as const

// --- App ---
export const APP_VERSION = '1.0.0'
export const ITEMS_PER_PAGE = 20
