/**
 * FORGE ERP Desktop — Verrouillage automatique par inactivité
 * Minuterie réinitialisée sur tout événement utilisateur.
 * À la déconnexion : émet 'auth:lock' via IPC (le renderer affiche le re-auth).
 * L'app reste ouverte — pas de fermeture.
 */
import { ipcMain, BrowserWindow, powerMonitor } from 'electron'
import log from 'electron-log'
import { getSession, clearSession } from './session'

// ── État ──────────────────────────────────────────────────────────────────────

let _timer:          ReturnType<typeof setTimeout> | null = null
let _timeoutMs:      number = 60 * 60 * 1000   // 60 min par défaut
let _isLocked:       boolean = false
let _mainWindow:     BrowserWindow | null = null

// ── Verrou ────────────────────────────────────────────────────────────────────

function lock(): void {
  if (_isLocked) return
  _isLocked = true
  stopTimer()

  const session = getSession()
  log.info('[autoLock] session verrouillée', { userId: session?.userId })

  // Effacer la session en mémoire (pas le refresh token — le renderer re-authentifie)
  clearSession()

  // Notifier le renderer pour afficher l'écran de re-auth
  _mainWindow?.webContents.send('auth:lock')
}

export function unlock(): void {
  _isLocked = false
  resetTimer()
  log.info('[autoLock] session déverrouillée')
}

export function isLocked(): boolean {
  return _isLocked
}

// ── Minuterie ──────────────────────────────────────────────────────────────────

function stopTimer(): void {
  if (_timer) { clearTimeout(_timer); _timer = null }
}

function resetTimer(): void {
  stopTimer()
  if (_isLocked) return
  _timer = setTimeout(lock, _timeoutMs)
}

export function setTimeoutMinutes(minutes: number): void {
  _timeoutMs = Math.max(5, minutes) * 60 * 1000
  resetTimer()
  log.info('[autoLock] timeout configuré', { minutes })
}

// ── Initialisation ────────────────────────────────────────────────────────────

export function initAutoLock(win: BrowserWindow, timeoutMinutes: number = 60): void {
  _mainWindow = win
  setTimeoutMinutes(timeoutMinutes)

  // Réinitialiser le timer sur messages IPC du renderer (interactions utilisateur)
  ipcMain.on('autolock:activity', () => {
    if (!_isLocked) resetTimer()
  })

  // Verrou immédiat à la mise en veille / hibernation de l'OS
  powerMonitor.on('suspend', () => {
    log.info('[autoLock] mise en veille OS — verrouillage')
    lock()
  })

  // Réinitialiser à la reprise si une session est encore valide
  powerMonitor.on('resume', () => {
    const s = getSession()
    if (s) {
      log.info('[autoLock] reprise OS — session encore valide')
      resetTimer()
    } else {
      lock()
    }
  })

  resetTimer()
  log.info('[autoLock] initialisé', { timeoutMinutes })
}

// ── Handlers IPC ──────────────────────────────────────────────────────────────

export function registerAutoLockHandlers(win: BrowserWindow, timeoutMinutes?: number): void {
  initAutoLock(win, timeoutMinutes)

  // Le renderer confirme l'unlock après re-authentification
  ipcMain.handle('auth:unlock', () => {
    unlock()
    return { success: true }
  })

  ipcMain.handle('auth:isLocked', () => isLocked())

  ipcMain.handle('auth:setTimeoutMinutes', (_event, minutes: number) => {
    setTimeoutMinutes(minutes)
    return { success: true }
  })

  // Forcer le verrou (utilisé pour test ou déconnexion manuelle)
  ipcMain.handle('auth:forceLock', () => {
    lock()
    return { success: true }
  })

  log.info('[autoLock] IPC handlers enregistrés')
}
