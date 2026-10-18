/**
 * FORGE ERP — Tableau de bord par rôle.
 *
 * Chaque rôle RBAC a sa propre sélection d'indicateurs, de listes d'activité et
 * de raccourcis. Le rôle ne fait que CHOISIR et ORDONNER : ce qui s'affiche
 * réellement est toujours filtré par les vraies permissions de l'utilisateur
 * (GET /api/profile/permissions), comme la sidebar — un widget dont le module
 * n'est pas lisible n'est jamais monté, donc jamais d'appel API refusé (403).
 *
 * Fichier sans dépendance React : testable seul (cf. __tests__/dashboard-layouts.test.ts).
 */
import type { RBAC_MODULES, RBAC_ACTIONS, RBAC_ROLE_NAMES } from '@/lib/rbac-constants'

type Module   = typeof RBAC_MODULES[number]
type Action   = typeof RBAC_ACTIONS[number]
type RoleName = typeof RBAC_ROLE_NAMES[number]

interface Requirement {
  /** Modules dont la permission READ est requise (tous). */
  modules: Module[]
  /** Réservé à ces rôles legacy (ex: parcours personnel du technicien). */
  legacyRoles?: string[]
}

// ── Indicateurs ───────────────────────────────────────────────────────────────

export const KPI_REQUIREMENTS = {
  // Synthèse entreprise — GET /api/rapports/dashboard
  'reports.caisse_jour':          { modules: ['REPORTS', 'CAISSE'] },
  'reports.ca_mois':              { modules: ['REPORTS'] },
  'reports.commandes_actives':    { modules: ['REPORTS', 'COMMERCIAL'] },
  'reports.stocks_critiques':     { modules: ['REPORTS', 'STOCK'] },
  'reports.apprenants':           { modules: ['REPORTS', 'HR'] },
  // Finance / créances
  'finance.a_recevoir':           { modules: ['FINANCE'] },
  'finance.retards':              { modules: ['FINANCE'] },
  'creances.encours':             { modules: ['RECEIVABLES'] },
  'creances.retards':             { modules: ['RECEIVABLES'] },
  // Caisse — ventes de l'utilisateur connecté
  'caisse.session':               { modules: ['CAISSE'] },
  'caisse.mes_ventes':            { modules: ['CAISSE'] },
  'caisse.ticket_moyen':          { modules: ['CAISSE'] },
  // Commercial
  'commercial.devis_attente':     { modules: ['COMMERCIAL'] },
  'commercial.commandes_actives': { modules: ['COMMERCIAL'] },
  'commercial.commandes_pretes':  { modules: ['COMMERCIAL'] },
  // Stock / logistique
  'stock.alertes':                { modules: ['STOCK'] },
  'stock.bons_attente':           { modules: ['STOCK'] },
  'logistique.a_preparer':        { modules: ['LOGISTICS'] },
  'logistique.pret_a_livrer':     { modules: ['LOGISTICS'] },
  'logistique.planifiees':        { modules: ['LOGISTICS'] },
  'livreur.a_livrer':             { modules: ['LOGISTICS'] },
  'livreur.en_route':             { modules: ['LOGISTICS'] },
  'livreur.livrees':              { modules: ['LOGISTICS'] },
  // Atelier
  'production.of_en_cours':       { modules: ['PRODUCTION'] },
  'production.of_en_retard':      { modules: ['PRODUCTION'] },
  'production.machines':          { modules: ['PRODUCTION'] },
  // Formation
  'formation.apprenants':         { modules: ['HR'] },
  'formation.sessions_en_cours':  { modules: ['HR'] },
  'formation.sessions_planifiees': { modules: ['HR'] },
  'formation.niveau_final':       { modules: ['HR'] },
  'parcours.niveau':              { modules: [], legacyRoles: ['technicien'] },
} satisfies Record<string, Requirement>

export type KpiId = keyof typeof KPI_REQUIREMENTS

// ── Listes d'activité ─────────────────────────────────────────────────────────

export const PANEL_REQUIREMENTS = {
  alertes:              { modules: ['REPORTS'] },
  ca_chart:             { modules: ['REPORTS'] },
  commandes_recentes:   { modules: ['REPORTS', 'COMMERCIAL'] },
  factures_retard:      { modules: ['FINANCE'] },
  creances_retard:      { modules: ['RECEIVABLES'] },
  caisse_ventes:        { modules: ['CAISSE'] },
  devis_suivi:          { modules: ['COMMERCIAL'] },
  stock_alertes:        { modules: ['STOCK'] },
  mouvements:           { modules: ['STOCK'] },
  livraisons:           { modules: ['LOGISTICS'] },
  mes_livraisons:       { modules: ['LOGISTICS'] },
  of_en_cours:          { modules: ['PRODUCTION'] },
  formation_sessions:   { modules: ['HR'] },
  formation_apprenants: { modules: ['HR'] },
  mon_parcours:         { modules: [], legacyRoles: ['technicien'] },
} satisfies Record<string, Requirement>

export type PanelId = keyof typeof PANEL_REQUIREMENTS

// ── Raccourcis ────────────────────────────────────────────────────────────────

export interface QuickAction {
  label: string
  path: string
  /** Permission requise — absente = toujours proposé. */
  module?: Module
  action?: Action
  legacyRoles?: string[]
}

const A = {
  caisse:       { label: 'Ouvrir la caisse',     path: '/caisse',                   module: 'CAISSE' },
  devis:        { label: 'Nouveau devis',        path: '/devis',                    module: 'COMMERCIAL', action: 'CREATE' },
  commandes:    { label: 'Commandes',            path: '/commandes',                module: 'COMMERCIAL' },
  clients:      { label: 'Clients',              path: '/clients',                  module: 'COMMERCIAL' },
  boutique:     { label: 'Boutique en ligne',    path: '/boutique',                 module: 'COMMERCIAL' },
  stocks:       { label: 'Stocks',               path: '/stocks',                   module: 'STOCK' },
  bons:         { label: 'Bons de sortie',       path: '/stocks/bons-sortie',       module: 'STOCK' },
  bonsValider:  { label: 'Bons à valider',       path: '/stocks/bons-sortie',       module: 'STOCK', action: 'VALIDATE' },
  appro:        { label: 'Approvisionnement',    path: '/stocks/approvisionnement', module: 'STOCK' },
  logistique:   { label: 'Livraisons',           path: '/logistique',               module: 'LOGISTICS' },
  production:   { label: 'Production',           path: '/production',               module: 'PRODUCTION' },
  equipements:  { label: 'Équipements',          path: '/equipements',              module: 'PRODUCTION' },
  finance:      { label: 'Finance',              path: '/finance',                  module: 'FINANCE' },
  intelligence: { label: 'Intelligence',         path: '/intelligence',             module: 'REPORTS' },
  rh:           { label: 'RH',                   path: '/rh',                       module: 'HR' },
  formation:    { label: 'Formation',            path: '/formation',                module: 'HR' },
  securite:     { label: 'Sécurité',             path: '/securite',                 module: 'HR' },
  parcours:     { label: 'Mon parcours',         path: '/formation',                legacyRoles: ['technicien'] },
  admin:        { label: 'Administration',       path: '/admin',                    module: 'ADMIN', action: 'CONFIGURE' },
} satisfies Record<string, QuickAction>

// ── Mise en page par rôle ─────────────────────────────────────────────────────

export interface DashboardLayout {
  /** Intitulé du poste, affiché sous le nom de l'utilisateur. */
  label: string
  subtitle: string
  kpis: KpiId[]
  panels: PanelId[]
  actions: QuickAction[]
}

export const ROLE_LAYOUTS: Record<RoleName, DashboardLayout> = {
  SUPER_ADMIN: {
    label: 'Direction',
    subtitle: "Vue d'ensemble de l'entreprise",
    kpis: [
      'reports.caisse_jour', 'reports.ca_mois', 'finance.a_recevoir',
      'reports.commandes_actives', 'reports.stocks_critiques', 'reports.apprenants',
    ],
    panels: ['alertes', 'ca_chart', 'commandes_recentes', 'factures_retard'],
    actions: [A.finance, A.intelligence, A.commandes, A.admin],
  },
  MANAGER: {
    label: 'Supervision',
    subtitle: 'Suivi des opérations et validations en attente',
    kpis: [
      'reports.commandes_actives', 'production.of_en_retard', 'stock.bons_attente',
      'reports.stocks_critiques', 'reports.caisse_jour',
    ],
    panels: ['alertes', 'of_en_cours', 'commandes_recentes', 'mouvements'],
    actions: [A.bonsValider, A.production, A.commandes, A.logistique],
  },
  COMMERCIAL: {
    label: 'Commercial',
    subtitle: 'Devis, commandes et suivi client',
    kpis: [
      'commercial.devis_attente', 'commercial.commandes_actives', 'commercial.commandes_pretes',
      'reports.ca_mois', 'stock.alertes',
    ],
    panels: ['devis_suivi', 'commandes_recentes', 'ca_chart', 'stock_alertes'],
    actions: [A.devis, A.commandes, A.clients, A.boutique],
  },
  CAISSIER: {
    label: 'Caisse',
    subtitle: 'Votre session et vos ventes du jour',
    kpis: ['caisse.session', 'caisse.mes_ventes', 'caisse.ticket_moyen', 'creances.retards'],
    panels: ['caisse_ventes', 'creances_retard', 'stock_alertes'],
    actions: [A.caisse, A.stocks, A.clients],
  },
  MAGASINIER: {
    label: 'Magasin',
    subtitle: 'Stocks, bons de sortie et préparation des livraisons',
    kpis: [
      'stock.alertes', 'stock.bons_attente', 'logistique.a_preparer',
      'logistique.pret_a_livrer', 'logistique.planifiees',
    ],
    panels: ['stock_alertes', 'mouvements', 'livraisons'],
    actions: [A.bons, A.appro, A.stocks, A.logistique],
  },
  LIVREUR: {
    label: 'Livraison',
    subtitle: 'Vos livraisons assignées',
    kpis: ['livreur.a_livrer', 'livreur.en_route', 'livreur.livrees'],
    panels: ['mes_livraisons'],
    actions: [A.logistique],
  },
  FORMATEUR: {
    label: 'Formation',
    subtitle: 'Apprenants et sessions de formation',
    kpis: [
      'formation.apprenants', 'formation.sessions_en_cours',
      'formation.sessions_planifiees', 'formation.niveau_final',
    ],
    panels: ['formation_sessions', 'formation_apprenants'],
    actions: [A.formation, A.rh, A.securite],
  },
  READONLY: {
    label: 'Atelier',
    subtitle: "Ordres de fabrication et parc machines",
    kpis: ['production.of_en_cours', 'production.of_en_retard', 'production.machines', 'parcours.niveau'],
    panels: ['of_en_cours', 'mon_parcours', 'stock_alertes'],
    actions: [A.production, A.parcours, A.equipements, A.stocks],
  },
}

/** Rôle personnalisé ou inconnu : tout ce que ses permissions autorisent, dans un ordre générique. */
const DEFAULT_LAYOUT: DashboardLayout = {
  label: 'Utilisateur',
  subtitle: 'Votre activité',
  kpis: [
    'reports.ca_mois', 'commercial.commandes_actives', 'stock.alertes', 'stock.bons_attente',
    'production.of_en_cours', 'logistique.a_preparer', 'caisse.mes_ventes', 'creances.retards',
    'formation.apprenants',
  ],
  panels: [
    'alertes', 'commandes_recentes', 'stock_alertes', 'of_en_cours',
    'livraisons', 'caisse_ventes', 'formation_sessions',
  ],
  actions: [A.caisse, A.commandes, A.stocks, A.production, A.logistique, A.formation],
}

// Même correspondance que LEGACY_ROLE_MAP (apps/api/src/services/rbacService.ts) —
// sert uniquement quand le profil n'a pas encore de rôle RBAC explicite.
const LEGACY_TO_RBAC: Record<string, RoleName> = {
  admin: 'SUPER_ADMIN', directeur: 'SUPER_ADMIN', manager: 'MANAGER', operateur: 'COMMERCIAL',
  technicien: 'READONLY', apprenant: 'READONLY', caissier: 'CAISSIER', livreur: 'LIVREUR',
}

const MAX_KPIS = 6
const MAX_PANELS = 4
const MAX_ACTIONS = 4

export type Can = (module: Module, action?: Action) => boolean

export function resolveDashboardLayout(
  rbacRoleName: string | null | undefined,
  legacyRole: string | null | undefined,
  can: Can,
): DashboardLayout {
  const role = (rbacRoleName && rbacRoleName in ROLE_LAYOUTS
    ? rbacRoleName
    : LEGACY_TO_RBAC[legacyRole ?? '']) as RoleName | undefined
  const base = role ? ROLE_LAYOUTS[role] : DEFAULT_LAYOUT

  const allowed = (req: Requirement) =>
    req.modules.every((m) => can(m, 'READ'))
    && (!req.legacyRoles || req.legacyRoles.includes(legacyRole ?? ''))

  return {
    ...base,
    kpis:   base.kpis.filter((id) => allowed(KPI_REQUIREMENTS[id])).slice(0, MAX_KPIS),
    panels: base.panels.filter((id) => allowed(PANEL_REQUIREMENTS[id])).slice(0, MAX_PANELS),
    actions: base.actions
      .filter((a: QuickAction) =>
        (!a.module || can(a.module, a.action ?? 'READ'))
        && (!a.legacyRoles || a.legacyRoles.includes(legacyRole ?? '')))
      .slice(0, MAX_ACTIONS),
  }
}
