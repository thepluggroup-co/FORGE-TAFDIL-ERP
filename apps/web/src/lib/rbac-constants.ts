/**
 * FORGE ERP — Constantes RBAC côté web.
 *
 * Copie de packages/db/src/schema-rbac.ts, dupliquée ici plutôt qu'importée
 * directement : @forge/db exporte aussi des clients Node (Supabase admin avec
 * la clé service_role, client SQLite, moteur de sync offline) qui ne doivent
 * jamais être bundlés côté navigateur, et le package n'expose pas de sous-chemin
 * pour importer schema-rbac.ts isolément.
 *
 * Source unique pour TOUT le web (apps/web/src/hooks/useRbac.ts ré-exporte ces
 * constantes — les composants les consomment via ce hook). Si la liste change
 * côté serveur (packages/db/src/schema-rbac.ts), la reporter ici à la main.
 */

export const RBAC_MODULES = [
  'STOCK', 'COMMERCIAL', 'FINANCE', 'HR', 'PRODUCTION',
  'LOGISTICS', 'ADMIN', 'REPORTS', 'RECEIVABLES', 'CAISSE',
] as const

export const RBAC_ACTIONS = [
  'READ', 'CREATE', 'UPDATE', 'DELETE', 'VALIDATE', 'CONFIGURE', 'EXPORT',
] as const

export const RBAC_ROLE_NAMES = [
  'SUPER_ADMIN', 'MANAGER', 'COMMERCIAL', 'CAISSIER',
  'MAGASINIER', 'FORMATEUR', 'READONLY', 'LIVREUR',
] as const

export const RBAC_MODULE_LABELS: Record<typeof RBAC_MODULES[number], string> = {
  STOCK:       'Stock',
  COMMERCIAL:  'Commercial',
  FINANCE:     'Finance',
  HR:          'RH',
  PRODUCTION:  'Production',
  LOGISTICS:   'Logistique',
  ADMIN:       'Admin',
  REPORTS:     'Rapports',
  RECEIVABLES: 'Créances',
  CAISSE:      'Caisse',
}

export const RBAC_ACTION_LABELS: Record<typeof RBAC_ACTIONS[number], string> = {
  READ:      'Lire',
  CREATE:    'Créer',
  UPDATE:    'Modifier',
  DELETE:    'Supprimer',
  VALIDATE:  'Valider',
  CONFIGURE: 'Configurer',
  EXPORT:    'Exporter',
}

export const RBAC_ROLE_LABELS: Record<typeof RBAC_ROLE_NAMES[number], string> = {
  SUPER_ADMIN: 'Super Admin',
  MANAGER:     'Manager',
  COMMERCIAL:  'Commercial',
  CAISSIER:    'Caissier',
  MAGASINIER:  'Magasinier',
  FORMATEUR:   'Formateur',
  READONLY:    'Lecture seule',
  LIVREUR:     'Livreur',
}
