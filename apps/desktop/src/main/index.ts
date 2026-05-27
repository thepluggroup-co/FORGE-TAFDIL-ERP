import { app, BrowserWindow, Menu, shell, Notification, ipcMain } from 'electron'
import { join } from 'path'
import log from 'electron-log'
import { registerDbHandlers } from './ipc/db-handler'
import { SyncManager } from './ipc/sync-handler'

// Set app name before anything else so userData path uses "FORGE by TAFDIL"
app.setName('FORGE by TAFDIL')

// ── Logging ────────────────────────────────────────────────────────────────────
log.initialize()
log.transports.file.level = 'info'

// ── Globals ────────────────────────────────────────────────────────────────────
const isDev  = !app.isPackaged
const APP_V  = app.getVersion()
let win: BrowserWindow | null = null
let syncMgr: SyncManager | null = null

// Set to true only when the developer deliberately clicks the menu item.
// Devtools opened by ANY other means (F12, Ctrl+Shift+I, extensions, auto-open)
// will be closed immediately.
let devToolsIntentional = false

// ── Menu ───────────────────────────────────────────────────────────────────────
function buildMenu(window: BrowserWindow) {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: 'Fichier',
      submenu: [
        { label: 'Nouvelle fenêtre', accelerator: 'CmdOrCtrl+N', click: () => createWindow() },
        { type: 'separator' },
        { label: 'Quitter', accelerator: 'CmdOrCtrl+Q', role: 'quit' },
      ],
    },
    {
      label: 'Affichage',
      submenu: [
        { label: 'Recharger', accelerator: 'CmdOrCtrl+R', role: 'reload' },
        { type: 'separator' },
        { label: 'Zoom avant',  accelerator: 'CmdOrCtrl+=', role: 'zoomIn' },
        { label: 'Zoom arrière', accelerator: 'CmdOrCtrl+-', role: 'zoomOut' },
        { label: 'Taille réelle', accelerator: 'CmdOrCtrl+0', role: 'resetZoom' },
        { type: 'separator' },
        { label: 'Plein écran', accelerator: 'F11', role: 'togglefullscreen' },
        ...( isDev ? [
          { type: 'separator' as const },
          {
            // No 'role: toggleDevTools' — that would register F12 globally.
            // No accelerator — forces intentional click only.
            label: 'Outils de développement',
            click: () => {
              devToolsIntentional = true
              win?.webContents.toggleDevTools()
            },
          },
        ] : []),
      ],
    },
    {
      label: 'Aide',
      submenu: [
        {
          label: `À propos de FORGE v${APP_V}`,
          click: () => {
            const { dialog } = require('electron')
            dialog.showMessageBox(window, {
              type: 'info',
              title: 'FORGE by TAFDIL',
              message: `FORGE ERP v${APP_V}`,
              detail: 'Microusine Métallurgique & BTP\nTAFDIL SARL — Douala, Cameroun\ninfo@tafdil.cm',
              buttons: ['OK'],
            })
          },
        },
        { type: 'separator' },
        { label: 'Rapport de bugs', click: () => shell.openExternal('mailto:info@tafdil.cm?subject=Bug+FORGE') },
      ],
    },
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

// ── Notification IPC ───────────────────────────────────────────────────────────
ipcMain.handle('notify:show', (_e, title: string, body: string) => {
  if (Notification.isSupported()) {
    new Notification({ title, body }).show()
  }
})

// ── Print PDF IPC ──────────────────────────────────────────────────────────────
ipcMain.handle('print:pdf', async (_e, url: string) => {
  const pdfWin = new BrowserWindow({ show: false })
  await pdfWin.loadURL(url)
  const data = await pdfWin.webContents.printToPDF({})
  pdfWin.close()
  return data
})

// ── Fenêtre principale ─────────────────────────────────────────────────────────
function createWindow() {
  win = new BrowserWindow({
    width:  1280,
    height: 800,
    minWidth:  960,
    minHeight: 600,
    title: `FORGE by TAFDIL v${APP_V}`,
    titleBarStyle: 'default',
    icon: join(__dirname, '../../assets/forge.ico'),
    webPreferences: {
      preload:          join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration:  false,
      sandbox:          false,
    },
    show: false,
  })

  // Chargement : localhost en dev, fichier local en prod
  if (isDev) {
    win.loadURL('http://localhost:5175')
    // DevTools can be opened manually via the Affichage menu or F12
    // win.webContents.openDevTools({ mode: 'detach' })
  } else {
    const rendererPath = join(process.resourcesPath, 'renderer', 'index.html')
    win.loadFile(rendererPath)
  }

  win.once('ready-to-show', () => win?.show())
  win.on('closed', () => { win = null })

  // ── DevTools guard — applies in BOTH dev and production ──────────────────────
  //
  // Why: Electron registers Ctrl+Shift+I as a built-in devtools shortcut in dev
  // mode regardless of the app menu. The menu item above uses a plain click handler
  // (no 'role', no accelerator) so it doesn't register any keyboard shortcut.
  //
  // Rule: devtools are ONLY allowed when devToolsIntentional === true,
  //       i.e. the developer explicitly clicked the menu item.

  // 1. If devtools open from any unexpected source, close them immediately.
  win.webContents.on('devtools-opened', () => {
    if (!devToolsIntentional) {
      win?.webContents.closeDevTools()
      log.warn('[security] DevTools auto-closed — use Affichage → Outils de développement')
    }
    devToolsIntentional = false   // reset after each intentional open
  })

  // 2. Swallow every keyboard shortcut that would open devtools before it fires.
  win.webContents.on('before-input-event', (_e, input) => {
    const isDevToolsShortcut = (
      input.key === 'F12' ||
      (input.control && input.shift && ['I', 'J', 'C'].includes(input.key.toUpperCase()))
    )
    if (isDevToolsShortcut) _e.preventDefault()
  })

  buildMenu(win)
  return win
}

// ── Cycle de vie app ───────────────────────────────────────────────────────────
app.whenReady().then(async () => {
  // Handlers IPC SQLite
  await registerDbHandlers()

  // Gestionnaire de synchronisation
  syncMgr = new SyncManager(() => win)
  syncMgr.start()

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })

})

app.on('window-all-closed', () => {
  syncMgr?.stop()
  if (process.platform !== 'darwin') app.quit()
})
