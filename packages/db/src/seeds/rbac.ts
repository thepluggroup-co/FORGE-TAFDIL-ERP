/**
 * FORGE ERP — Seed RBAC
 * Matrice complète de permissions par défaut.
 * Appeler runRbacSeed(supabaseAdmin) après la migration 0013.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

// ── Données des rôles ─────────────────────────────────────────────────────────

export const SEED_ROLES = [
  { name: 'SUPER_ADMIN', label: 'Super Administrateur', description: 'Accès total, non restreint' },
  { name: 'MANAGER',     label: 'Manager',               description: 'Gestion complète hors ADMIN/CONFIGURE' },
  { name: 'COMMERCIAL',  label: 'Commercial',             description: 'Ventes, devis, commandes, stock lecture' },
  { name: 'CAISSIER',    label: 'Caissier',               description: 'Encaissements et créances uniquement' },
  { name: 'MAGASINIER',  label: 'Magasinier',             description: 'Gestion stocks et logistique' },
  { name: 'FORMATEUR',   label: 'Formateur',              description: 'Ressources humaines et rapports lecture' },
  { name: 'READONLY',    label: 'Lecture seule',          description: 'Consultation uniquement, aucune écriture' },
] as const

// ── Modules et actions ────────────────────────────────────────────────────────

const MODULES = ['STOCK','COMMERCIAL','FINANCE','HR','PRODUCTION','LOGISTICS','ADMIN','REPORTS','RECEIVABLES'] as const
const ACTIONS = ['READ','CREATE','UPDATE','DELETE','VALIDATE','CONFIGURE','EXPORT'] as const

type Module = typeof MODULES[number]
type Action = typeof ACTIONS[number]

// Labels lisibles pour les permissions (module:action)
const PERM_LABELS: Partial<Record<`${Module}:${Action}`, string>> = {
  'STOCK:READ':          'Voir les stocks',
  'STOCK:CREATE':        'Créer des mouvements stock',
  'STOCK:UPDATE':        'Modifier les stocks',
  'STOCK:DELETE':        'Supprimer des articles stock',
  'STOCK:VALIDATE':      'Valider des entrées/sorties',
  'STOCK:EXPORT':        "Exporter l'inventaire",
  'COMMERCIAL:READ':     'Voir devis et commandes',
  'COMMERCIAL:CREATE':   'Créer devis/commandes',
  'COMMERCIAL:UPDATE':   'Modifier devis/commandes',
  'COMMERCIAL:DELETE':   'Supprimer devis/commandes',
  'COMMERCIAL:VALIDATE': 'Valider devis/commandes',
  'COMMERCIAL:EXPORT':   'Exporter commandes',
  'FINANCE:READ':        'Voir les finances',
  'FINANCE:CREATE':      'Créer factures/crédits',
  'FINANCE:UPDATE':      'Modifier factures',
  'FINANCE:DELETE':      'Supprimer écritures',
  'FINANCE:VALIDATE':    'Valider paiements',
  'FINANCE:EXPORT':      'Exporter comptabilité',
  'HR:READ':             'Voir les employés',
  'HR:CREATE':           'Créer dossiers RH',
  'HR:UPDATE':           'Modifier RH',
  'HR:DELETE':           'Supprimer RH',
  'HR:VALIDATE':         'Valider bulletins',
  'HR:EXPORT':           'Exporter RH',
  'PRODUCTION:READ':     'Voir production',
  'PRODUCTION:CREATE':   'Créer jobs production',
  'PRODUCTION:UPDATE':   'Modifier production',
  'PRODUCTION:DELETE':   'Supprimer jobs',
  'PRODUCTION:VALIDATE': 'Valider jobs',
  'PRODUCTION:EXPORT':   'Exporter production',
  'LOGISTICS:READ':      'Voir livraisons',
  'LOGISTICS:CREATE':    'Créer livraisons',
  'LOGISTICS:UPDATE':    'Modifier livraisons',
  'LOGISTICS:DELETE':    'Supprimer livraisons',
  'LOGISTICS:VALIDATE':  'Valider livraisons',
  'LOGISTICS:EXPORT':    'Exporter logistique',
  'ADMIN:READ':          'Lire la config admin',
  'ADMIN:CREATE':        'Créer utilisateurs',
  'ADMIN:UPDATE':        'Modifier utilisateurs',
  'ADMIN:DELETE':        'Supprimer utilisateurs',
  'ADMIN:VALIDATE':      'Valider actions admin',
  'ADMIN:CONFIGURE':     'Configurer le système',
  'ADMIN:EXPORT':        'Exporter logs audit',
  'REPORTS:READ':        'Voir les rapports',
  'REPORTS:EXPORT':      'Exporter les rapports',
  'RECEIVABLES:READ':    'Voir les créances',
  'RECEIVABLES:CREATE':  'Créer des encaissements',
  'RECEIVABLES:UPDATE':  'Modifier créances',
  'RECEIVABLES:DELETE':  'Supprimer créances',
  'RECEIVABLES:VALIDATE':'Valider encaissements',
  'RECEIVABLES:EXPORT':  'Exporter créances',
}

// ── Matrice des permissions par rôle ─────────────────────────────────────────

type PermissionMatrix = Record<string, Array<{ module: Module; action: Action }>>

export const ROLE_PERMISSIONS_MATRIX: PermissionMatrix = (() => {
  const all: Array<{ module: Module; action: Action }> = []
  for (const m of MODULES) for (const a of ACTIONS) all.push({ module: m, action: a })

  return {
    // SUPER_ADMIN : tout
    SUPER_ADMIN: all,

    // MANAGER : tout sauf ADMIN module (sauf READ+EXPORT) et CONFIGURE action
    MANAGER: [
      ...MODULES.filter(m => m !== 'ADMIN').flatMap(m =>
        ACTIONS.filter(a => a !== 'CONFIGURE').map(a => ({ module: m as Module, action: a as Action }))
      ),
      { module: 'ADMIN', action: 'READ' },
      { module: 'ADMIN', action: 'EXPORT' },
    ],

    // COMMERCIAL : COMMERCIAL READ+CREATE+UPDATE, STOCK READ, REPORTS READ
    COMMERCIAL: [
      { module: 'COMMERCIAL', action: 'READ' },
      { module: 'COMMERCIAL', action: 'CREATE' },
      { module: 'COMMERCIAL', action: 'UPDATE' },
      { module: 'STOCK',      action: 'READ' },
      { module: 'REPORTS',    action: 'READ' },
    ],

    // CAISSIER : RECEIVABLES READ+CREATE uniquement
    CAISSIER: [
      { module: 'RECEIVABLES', action: 'READ' },
      { module: 'RECEIVABLES', action: 'CREATE' },
    ],

    // MAGASINIER : STOCK READ+CREATE+UPDATE, LOGISTICS READ+CREATE+UPDATE
    MAGASINIER: [
      { module: 'STOCK',      action: 'READ' },
      { module: 'STOCK',      action: 'CREATE' },
      { module: 'STOCK',      action: 'UPDATE' },
      { module: 'LOGISTICS',  action: 'READ' },
      { module: 'LOGISTICS',  action: 'CREATE' },
      { module: 'LOGISTICS',  action: 'UPDATE' },
    ],

    // FORMATEUR : HR READ+CREATE+UPDATE, REPORTS READ
    FORMATEUR: [
      { module: 'HR',      action: 'READ' },
      { module: 'HR',      action: 'CREATE' },
      { module: 'HR',      action: 'UPDATE' },
      { module: 'REPORTS', action: 'READ' },
    ],

    // READONLY : tous les modules, READ uniquement
    READONLY: MODULES.map(m => ({ module: m as Module, action: 'READ' as Action })),
  }
})()

// ── Permissions immutables (gardes-fous) ─────────────────────────────────────
// Ces permissions sont marquées is_immutable=true dans la DB et
// vérifiées AVANT la DB dans rbacService.ts.

export const IMMUTABLE_PERMISSIONS = [
  { module: 'ADMIN', action: 'CONFIGURE' }, // SUPER_ADMIN only
  { module: 'ADMIN', action: 'DELETE' },    // audit_logs jamais supprimés
] as const

// ── runRbacSeed ───────────────────────────────────────────────────────────────

export async function runRbacSeed(db: SupabaseClient): Promise<void> {
  console.info('[seed:rbac] Démarrage du seed RBAC…')

  // 1. Créer les rôles
  const { data: rolesData, error: rolesErr } = await db
    .from('rbac_roles')
    .upsert(SEED_ROLES.map(r => ({ ...r, is_system: true })), { onConflict: 'name' })
    .select('id, name')

  if (rolesErr) throw new Error(`Erreur seed roles: ${rolesErr.message}`)
  const roleMap = new Map<string, string>((rolesData ?? []).map((r: { id: string; name: string }) => [r.name, r.id]))
  console.info(`[seed:rbac] ${roleMap.size} rôles créés/confirmés`)

  // 2. Créer toutes les permissions (module × action)
  const permissionsToInsert = MODULES.flatMap(module =>
    ACTIONS.map(action => {
      const key  = `${module}:${action}` as keyof typeof PERM_LABELS
      const isImmutable = IMMUTABLE_PERMISSIONS.some(p => p.module === module && p.action === action)
      return {
        module,
        action,
        label:       PERM_LABELS[key] ?? `${module} — ${action}`,
        is_immutable: isImmutable,
      }
    })
  )

  const { data: permsData, error: permsErr } = await db
    .from('rbac_permissions')
    .upsert(permissionsToInsert, { onConflict: 'module,action' })
    .select('id, module, action')

  if (permsErr) throw new Error(`Erreur seed permissions: ${permsErr.message}`)
  const permMap = new Map<string, string>(
    (permsData ?? []).map((p: { id: string; module: string; action: string }) => [`${p.module}:${p.action}`, p.id])
  )
  console.info(`[seed:rbac] ${permMap.size} permissions créées/confirmées`)

  // 3. Créer les role_permissions
  const rolePermissionsToInsert: Array<{ role_id: string; permission_id: string }> = []

  for (const [roleName, perms] of Object.entries(ROLE_PERMISSIONS_MATRIX)) {
    const roleId = roleMap.get(roleName)
    if (!roleId) { console.warn(`[seed:rbac] rôle introuvable: ${roleName}`); continue }

    for (const { module, action } of perms) {
      const permId = permMap.get(`${module}:${action}`)
      if (!permId) { console.warn(`[seed:rbac] permission introuvable: ${module}:${action}`); continue }
      rolePermissionsToInsert.push({ role_id: roleId, permission_id: permId })
    }
  }

  // Supprimer les assignations existantes et réinscrire (idempotent)
  await db.from('rbac_role_permissions').delete().in('role_id', [...roleMap.values()])

  const { error: rpErr } = await db
    .from('rbac_role_permissions')
    .insert(rolePermissionsToInsert)

  if (rpErr) throw new Error(`Erreur seed role_permissions: ${rpErr.message}`)
  console.info(`[seed:rbac] ${rolePermissionsToInsert.length} role_permissions créées`)

  // 4. Paramètres de sécurité par défaut
  await db
    .from('rbac_security_settings')
    .upsert({ id: 'singleton' }, { onConflict: 'id' })

  console.info('[seed:rbac] ✅ Seed RBAC terminé')
}
