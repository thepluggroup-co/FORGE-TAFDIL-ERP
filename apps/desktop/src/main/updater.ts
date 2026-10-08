import { dialog } from 'electron'
import type { BrowserWindow } from 'electron'
import log from 'electron-log'
import { autoUpdater } from 'electron-updater'

// ── Mises à jour automatiques ─────────────────────────────────────────────────
//
// Source : GitHub Releases (bloc "publish" de package.json). Chaque poste
// vérifie au démarrage puis toutes les heures, télécharge en arrière-plan et
// installe la nouvelle version au redémarrage (ou tout de suite si accepté).

const CHECK_INTERVAL_MS = 60 * 60 * 1000  // 1 heure

let manualCheck = false
let promptShown = false

export function setupAutoUpdate(getWin: () => BrowserWindow | null): void {
  autoUpdater.logger          = log
  autoUpdater.autoDownload    = true
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('update-available', (info) => {
    log.info('[update] nouvelle version disponible :', info.version)
  })

  autoUpdater.on('update-not-available', () => {
    if (!manualCheck) return
    manualCheck = false
    const win = getWin()
    const opts = { type: 'info' as const, title: 'FORGE by TAFDIL', message: 'FORGE est à jour.', buttons: ['OK'] }
    if (win) dialog.showMessageBox(win, opts)
    else dialog.showMessageBox(opts)
  })

  autoUpdater.on('error', (err) => {
    log.warn('[update] échec de la vérification :', err?.message ?? err)
    if (!manualCheck) return
    manualCheck = false
    dialog.showErrorBox('Mise à jour', 'Impossible de vérifier les mises à jour. Vérifiez la connexion Internet.')
  })

  autoUpdater.on('update-downloaded', async (info) => {
    log.info('[update] version téléchargée :', info.version)
    manualCheck = false
    if (promptShown) return
    promptShown = true

    const win = getWin()
    const opts = {
      type:      'info' as const,
      title:     'Mise à jour disponible',
      message:   `FORGE v${info.version} est prête à être installée.`,
      detail:    'Redémarrer maintenant pour l\'installer, ou plus tard : elle sera installée automatiquement à la fermeture de l\'application.',
      buttons:   ['Redémarrer maintenant', 'Plus tard'],
      defaultId: 0,
      cancelId:  1,
    }
    const { response } = win ? await dialog.showMessageBox(win, opts) : await dialog.showMessageBox(opts)
    promptShown = false
    if (response === 0) autoUpdater.quitAndInstall(true, true)
  })

  const check = () => autoUpdater.checkForUpdates().catch((e) => log.warn('[update]', e?.message ?? e))
  check()
  setInterval(check, CHECK_INTERVAL_MS)
}

/** Vérification déclenchée depuis le menu Aide — affiche un retour à l'utilisateur. */
export function checkForUpdatesManually(): void {
  manualCheck = true
  autoUpdater.checkForUpdates().catch((e) => log.warn('[update]', e?.message ?? e))
}
