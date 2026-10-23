// ── Accès de l'application mobile, piloté par les permissions de la base ─────
//
// Source de vérité : GET /api/profile/permissions (rôles et permissions RBAC
// définis en base, modifiables dans le module Sécurité). Le web les utilise déjà
// pour sa sidebar ; le mobile s'appuie sur les mêmes données.
//
// Les droits réels restent appliqués par l'API (requirePermission) : ce module ne
// décide que de ce que l'interface PROPOSE, pour ne pas montrer des écrans ou des
// boutons que le serveur refuserait.
//
// Repli (`legacyPermissionsForRole`) : uniquement quand les permissions n'ont pu
// être chargées NI en ligne NI depuis la copie de l'appareil (ex. première
// connexion hors ligne). Il reprend les règles qui étaient codées en dur avant ce
// module — jamais plus large qu'avant.

export type MobileModule =
  | 'STOCK' | 'COMMERCIAL' | 'FINANCE' | 'HR' | 'PRODUCTION'
  | 'LOGISTICS' | 'ADMIN' | 'REPORTS' | 'RECEIVABLES' | 'CAISSE'

export type MobileAction =
  | 'READ' | 'CREATE' | 'UPDATE' | 'DELETE' | 'VALIDATE' | 'CONFIGURE' | 'EXPORT'

export interface MobilePermission {
  module: MobileModule
  action: MobileAction
}

export type MobileScreen =
  | 'dashboard' | 'modules' | 'notifications' | 'orders' | 'stocks' | 'approbation'
  | 'livraisons' | 'caisse' | 'factures' | 'performance' | 'profile'

/** Permission minimale pour voir chaque écran. `null` = toujours accessible. */
export const MOBILE_SCREEN_PERMISSION: Record<MobileScreen, MobilePermission | null> = {
  dashboard:   null,
  modules:     null,
  notifications: null,
  profile:     null,
  orders:      { module: 'COMMERCIAL', action: 'READ' },
  stocks:      { module: 'STOCK',      action: 'READ' },
  // Valider un bon de sortie exige STOCK:VALIDATE côté API (PUT /bons/:id/valider).
  approbation: { module: 'STOCK',      action: 'VALIDATE' },
  livraisons:  { module: 'LOGISTICS',  action: 'READ' },
  caisse:      { module: 'CAISSE',     action: 'READ' },
  factures:    { module: 'FINANCE',    action: 'READ' },
  performance: { module: 'FINANCE',    action: 'READ' },
}

export function hasMobilePermission(
  permissions: readonly MobilePermission[],
  module: MobileModule,
  action: MobileAction = 'READ',
): boolean {
  return permissions.some((p) => p.module === module && p.action === action)
}

export function canAccessMobileScreen(
  permissions: readonly MobilePermission[],
  screen: MobileScreen,
): boolean {
  const required = MOBILE_SCREEN_PERMISSION[screen]
  if (!required) return true
  return hasMobilePermission(permissions, required.module, required.action)
}

/**
 * Repli quand aucune permission n'est disponible : traduit les anciennes règles
 * par rôle (admin/manager → approbation + caisse, caissier → caisse, livreur →
 * livraisons, tous → commandes + stocks sauf livreur) en permissions.
 */
export function legacyPermissionsForRole(role: string | null | undefined): MobilePermission[] {
  const perms: MobilePermission[] = []
  const add = (module: MobileModule, ...actions: MobileAction[]) => {
    for (const action of actions) perms.push({ module, action })
  }
  switch (role) {
    case 'admin':
      add('COMMERCIAL', 'READ'); add('FINANCE', 'READ'); add('STOCK', 'READ', 'VALIDATE'); add('CAISSE', 'READ')
      break
    case 'manager':
      add('COMMERCIAL', 'READ'); add('STOCK', 'READ', 'VALIDATE'); add('CAISSE', 'READ')
      break
    case 'caissier':
      add('COMMERCIAL', 'READ'); add('STOCK', 'READ'); add('CAISSE', 'READ')
      break
    case 'livreur':
      add('LOGISTICS', 'READ')
      break
    case 'operateur':
    case 'apprenant':
      add('COMMERCIAL', 'READ'); add('STOCK', 'READ')
      break
    default:
      break
  }
  return perms
}

export type MobileDashboardSection =
  | 'ventes' | 'approbation' | 'commandes' | 'stock' | 'caisse' | 'livraisons'

export type MobileDashboardSource = 'commandes' | 'stocks' | 'bons' | 'livraisons' | 'caisse'

/** Sections du tableau de bord visibles, dans l'ordre d'affichage, selon les permissions. */
export function dashboardSectionsFor(permissions: readonly MobilePermission[]): MobileDashboardSection[] {
  const can = (m: MobileModule, a: MobileAction = 'READ') => hasMobilePermission(permissions, m, a)
  const sections: MobileDashboardSection[] = []
  // « Ventes » = totaux de chiffre d'affaires : réservé à qui voit à la fois les commandes et la finance.
  if (can('COMMERCIAL') && can('FINANCE')) sections.push('ventes')
  if (can('STOCK', 'VALIDATE')) sections.push('approbation')
  if (can('COMMERCIAL')) sections.push('commandes')
  if (can('CAISSE')) sections.push('caisse')
  if (can('LOGISTICS')) sections.push('livraisons')
  if (can('STOCK')) sections.push('stock')
  return sections
}

/** Sources de données à charger pour alimenter ces sections (aucune requête inutile). */
export function dashboardSourcesFor(sections: readonly MobileDashboardSection[]): MobileDashboardSource[] {
  const sources = new Set<MobileDashboardSource>()
  for (const s of sections) {
    if (s === 'ventes' || s === 'commandes') sources.add('commandes')
    if (s === 'stock') sources.add('stocks')
    if (s === 'approbation') sources.add('bons')
    if (s === 'livraisons') sources.add('livraisons')
    if (s === 'caisse') sources.add('caisse')
  }
  return [...sources]
}
