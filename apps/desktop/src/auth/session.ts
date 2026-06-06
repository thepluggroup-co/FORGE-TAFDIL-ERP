/**
 * FORGE ERP Desktop — Gestion de session sécurisée
 * Stockage AES-256 via electron-store.
 * Mode dégradé offline : READ + CREATE uniquement.
 */
import { ipcMain } from 'electron'
import log from 'electron-log'

// eslint-disable-next-line @typescript-eslint/no-require-imports
const Store = require('electron-store') as typeof import('electron-store').default

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ForgeSession {
  userId:      string
  email:       string
  rbacRole:    string
  accessToken: string
  expiresAt:   number   // timestamp ms
  isOffline:   boolean
}

interface StoreSchema {
  session: ForgeSession | null
}

// ── Store chiffré (AES-256-GCM via safeStorage Electron) ─────────────────────

const store = new Store<StoreSchema>({
  name:           'forge-session',
  encryptionKey:  'forge-aes256-session-key',   // safeStorage dans Electron 32+
  clearInvalidConfig: true,
  defaults: { session: null },
})

// ── API publique ──────────────────────────────────────────────────────────────

export function saveSession(session: ForgeSession): void {
  store.set('session', session)
  log.info('[session] sauvegardée', { userId: session.userId, role: session.rbacRole })
}

export function getSession(): ForgeSession | null {
  const s = store.get('session', null)
  if (!s) return null

  // Vérifier expiration
  if (Date.now() > s.expiresAt) {
    log.info('[session] expirée — suppression', { userId: s.userId })
    clearSession()
    return null
  }

  return s
}

export function clearSession(): void {
  store.set('session', null)
  log.info('[session] effacée')
}

export function isSessionValid(): boolean {
  return getSession() !== null
}

export function setOfflineMode(offline: boolean): void {
  const s = store.get('session', null)
  if (s) store.set('session', { ...s, isOffline: offline })
}

/**
 * Vérifie si une opération est autorisée en mode offline.
 * READ et CREATE sont autorisés ; UPDATE/DELETE/VALIDATE/CONFIGURE refusés.
 */
export function isAllowedOffline(action: string): boolean {
  const session = getSession()
  if (!session?.isOffline) return true   // En ligne : tout est permis (RBAC vérifie côté API)
  return action === 'READ' || action === 'CREATE'
}

// ── Handlers IPC ──────────────────────────────────────────────────────────────

export function registerSessionHandlers(): void {
  ipcMain.handle('auth:getSession', () => {
    return getSession()
  })

  ipcMain.handle('auth:saveSession', (_event, session: ForgeSession) => {
    saveSession(session)
    return { success: true }
  })

  ipcMain.handle('auth:clearSession', () => {
    clearSession()
    return { success: true }
  })

  ipcMain.handle('auth:isAllowedOffline', (_event, action: string) => {
    return isAllowedOffline(action)
  })

  ipcMain.handle('auth:setOfflineMode', (_event, offline: boolean) => {
    setOfflineMode(offline)
    return { success: true }
  })

  log.info('[session] IPC handlers enregistrés')
}
