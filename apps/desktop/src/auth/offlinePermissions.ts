/**
 * FORGE ERP Desktop — Permissions offline (SQLite cache)
 * Lit/écrit rbac_cached_permissions dans le SQLite local.
 * Synchronise vers le serveur à la reconnexion.
 */
import { ipcMain } from 'electron'
import log from 'electron-log'
import type Database from 'better-sqlite3'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CachedPermission {
  userId:  string
  module:  string
  action:  string
  granted: boolean
}

// ── Référence à la DB SQLite ──────────────────────────────────────────────────
// Initialisé par registerOfflinePermissionsHandlers()

let _db: InstanceType<typeof Database> | null = null

export function initOfflinePermissions(db: InstanceType<typeof Database>): void {
  _db = db

  // Créer la table si nécessaire (migration déjà dans db-handler, sécurité en +)
  db.exec(`
    CREATE TABLE IF NOT EXISTS rbac_cached_permissions (
      user_id   TEXT NOT NULL,
      module    TEXT NOT NULL,
      action    TEXT NOT NULL,
      granted   INTEGER NOT NULL DEFAULT 1,
      cached_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (user_id, module, action)
    )
  `)

  log.info('[offlinePerms] table vérifiée')
}

// ── Lecture ───────────────────────────────────────────────────────────────────

export function getOfflinePermissions(userId: string): CachedPermission[] {
  if (!_db) return []
  const rows = _db
    .prepare('SELECT user_id, module, action, granted FROM rbac_cached_permissions WHERE user_id = ?')
    .all(userId) as Array<{ user_id: string; module: string; action: string; granted: number }>

  return rows.map(r => ({
    userId:  r.user_id,
    module:  r.module,
    action:  r.action,
    granted: r.granted === 1,
  }))
}

export function hasOfflinePermission(userId: string, module: string, action: string): boolean {
  if (!_db) return false
  const row = _db
    .prepare('SELECT granted FROM rbac_cached_permissions WHERE user_id = ? AND module = ? AND action = ?')
    .get(userId, module, action) as { granted: number } | undefined

  return row?.granted === 1
}

// ── Écriture / Sync depuis le serveur ────────────────────────────────────────

export function cachePermissions(userId: string, permissions: CachedPermission[]): void {
  if (!_db) return

  const upsert = _db.prepare(`
    INSERT INTO rbac_cached_permissions (user_id, module, action, granted, cached_at)
    VALUES (?, ?, ?, ?, datetime('now'))
    ON CONFLICT (user_id, module, action) DO UPDATE SET granted = excluded.granted, cached_at = excluded.cached_at
  `)

  const tx = _db.transaction((perms: CachedPermission[]) => {
    // Supprimer les anciennes permissions du user puis réinscrire
    _db!.prepare('DELETE FROM rbac_cached_permissions WHERE user_id = ?').run(userId)
    for (const p of perms) {
      upsert.run(p.userId, p.module, p.action, p.granted ? 1 : 0)
    }
  })

  tx(permissions)
  log.info('[offlinePerms] cache mis à jour', { userId, count: permissions.length })
}

// ── Sync vers serveur à la reconnexion ────────────────────────────────────────

export async function syncPermissionsFromServer(
  userId: string,
  apiBaseUrl: string,
  accessToken: string,
): Promise<void> {
  try {
    const res = await fetch(`${apiBaseUrl}/admin/rbac/users/${userId}/permissions`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })

    if (!res.ok) {
      log.warn('[offlinePerms] sync échouée', { status: res.status })
      return
    }

    const json = await res.json() as { data: Array<{ module: string; action: string }> }
    const perms: CachedPermission[] = (json.data ?? []).map(p => ({
      userId,
      module:  p.module,
      action:  p.action,
      granted: true,
    }))

    cachePermissions(userId, perms)
    log.info('[offlinePerms] synchronisé depuis serveur', { userId, count: perms.length })
  } catch (e) {
    log.error('[offlinePerms] sync error', e)
  }
}

// ── Handlers IPC ──────────────────────────────────────────────────────────────

export function registerOfflinePermissionsHandlers(db: InstanceType<typeof Database>): void {
  initOfflinePermissions(db)

  ipcMain.handle('auth:getOfflinePermissions', (_event, userId: string) => {
    return getOfflinePermissions(userId)
  })

  ipcMain.handle(
    'auth:hasOfflinePermission',
    (_event, userId: string, module: string, action: string) => {
      return hasOfflinePermission(userId, module, action)
    },
  )

  ipcMain.handle(
    'auth:cachePermissions',
    (_event, userId: string, permissions: CachedPermission[]) => {
      cachePermissions(userId, permissions)
      return { success: true }
    },
  )

  ipcMain.handle(
    'auth:syncPermissionsFromServer',
    (_event, userId: string, apiBaseUrl: string, accessToken: string) => {
      return syncPermissionsFromServer(userId, apiBaseUrl, accessToken)
    },
  )

  log.info('[offlinePerms] IPC handlers enregistrés')
}
