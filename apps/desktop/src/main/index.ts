import { app, BrowserWindow, Menu, shell, Notification, ipcMain, session } from 'electron'
import { join } from 'path'
import { fork } from 'child_process'
import type { ChildProcess } from 'child_process'
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
let win:     BrowserWindow | null = null
let syncMgr: SyncManager   | null = null
let apiProc: ChildProcess  | null = null

// ── Démarrage du serveur API embarqué ─────────────────────────────────────────
//
// En dev  : apps/api/dist/standalone/index.mjs (build tsup standalone)
// En prod : {resources}/api/index.mjs (copié via extraResources)
//
// Le renderer (apps/web) appelle http://localhost:3001/api/* — ce processus
// répond exactement à cette adresse.

function resolveApiEntry(): string {
  if (isDev) {
    // En dev : build standalone dans apps/api/dist/standalone/
    return join(__dirname, '../../../../apps/api/dist/standalone/index.cjs')
  }
  // En prod : copié dans resources/api/ par electron-builder extraResources
  return join(process.resourcesPath, 'api', 'index.cjs')
}

/**
 * Démarre le serveur API Hono en tant que processus Node.js enfant via fork().
 * fork() utilise le runtime Node.js interne d'Electron (pas l'exe Electron).
 * Le processus enfant n'a pas accès aux APIs Electron — c'est un Node.js pur.
 *
 * Les variables Supabase sont baked dans le bundle par electron-vite (define)
 * et transmises à l'enfant via env.
 */
function startApiServer(): Promise<void> {
  return new Promise((resolve) => {
    const apiEntry = resolveApiEntry()
    log.info('[api] démarrage depuis', apiEntry)

    const apiEnv: NodeJS.ProcessEnv = {
      ...process.env,
      PORT:                      '3001',
      NODE_ENV:                  isDev ? 'development' : 'production',
      SUPABASE_URL:              process.env.SUPABASE_URL              ?? '',
      SUPABASE_ANON_KEY:         process.env.SUPABASE_ANON_KEY         ?? '',
      SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
      SUPABASE_JWT_SECRET:       process.env.SUPABASE_JWT_SECRET       ?? '',
      VITE_SUPABASE_URL:         process.env.SUPABASE_URL              ?? '',
      VITE_SUPABASE_ANON_KEY:    process.env.SUPABASE_ANON_KEY         ?? '',
      // Chemin SQLite local pour le fallback offline de l'API embarquée
      SQLITE_PATH:               join(app.getPath('userData'), 'forge.db'),
      // Autoriser les requêtes depuis file:// (app packagée) et localhost (dev)
      FRONTEND_URL:              'http://localhost:5173,http://localhost:4173,file://',
    }

    // fork() crée un processus Node.js en utilisant l'exécutable interne
    // d'Electron — fonctionne en dev et en production packagée.
    apiProc = fork(apiEntry, [], {
      env:     apiEnv,
      silent:  true,   // redirige stdout/stderr via events (pas hérité du parent)
    })

    // Timeout de sécurité : si l'API ne se déclare pas en 10s, on continue quand même
    const timeout = setTimeout(() => {
      log.warn('[api] timeout 10s — fenêtre ouverte sans confirmation de l\'API')
      resolve()
    }, 10_000)

    apiProc.stdout?.on('data', (chunk: Buffer) => {
      const line = chunk.toString().trim()
      log.info('[api]', line)
      // L'API Hono écrit "FORGE API  →  http://localhost:3001" au boot
      if (line.includes('3001')) {
        clearTimeout(timeout)
        resolve()
      }
    })

    apiProc.stderr?.on('data', (chunk: Buffer) => {
      log.error('[api]', chunk.toString().trim())
    })

    apiProc.on('error', (err) => {
      log.error('[api] fork error:', err.message)
      clearTimeout(timeout)
      resolve()
    })

    apiProc.on('exit', (code, signal) => {
      log.warn(`[api] processus terminé — code: ${code}, signal: ${signal}`)
      apiProc = null
    })
  })
}

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

  // Chargement : localhost en dev (apps/web Vite server), fichier local en prod
  if (isDev) {
    // Port 5173 = port par défaut de apps/web/vite.config.ts
    // Démarrer: `pnpm --filter @forge/web dev` dans un terminal séparé
    const devUrl = process.env.VITE_DEV_SERVER_URL ?? 'http://localhost:5173'
    win.loadURL(devUrl).catch((err) => {
      log.error('[main] Impossible de charger le serveur de développement:', devUrl, err.message)
      // Afficher une page d'erreur utile plutôt qu'un écran vide
      win?.loadURL(`data:text/html,
        <html><body style="font-family:sans-serif;padding:40px;background:#1a1a2e;color:#e0e0e0">
          <h2 style="color:#ef4444">Serveur de développement non démarré</h2>
          <p>Lancez d'abord : <code style="background:#2a2a3e;padding:4px 8px;border-radius:4px">pnpm --filter @forge/web dev</code></p>
          <p style="color:#9ca3af">URL attendue : <strong>${devUrl}</strong></p>
          <p style="margin-top:24px"><button onclick="location.reload()"
            style="background:#ef4444;color:white;border:none;padding:8px 16px;border-radius:4px;cursor:pointer">
            Réessayer
          </button></p>
        </body></html>
      `)
    })
  } else {
    const rendererPath = join(process.resourcesPath, 'renderer', 'index.html')
    win.loadFile(rendererPath).catch((err) => {
      log.error('[main] Impossible de charger le renderer:', rendererPath, err.message)
      win?.loadURL(`data:text/html,
        <html><body style="font-family:sans-serif;padding:40px;background:#1a1a2e;color:#e0e0e0">
          <h2 style="color:#ef4444">Renderer introuvable</h2>
          <p>Le dossier <code>renderer/</code> est absent dans les resources de l'application.</p>
          <p style="color:#9ca3af">Exécutez d'abord : <strong>pnpm --filter @forge/web build</strong> puis repackagez.</p>
        </body></html>
      `)
    })
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

// ── CORS pour requêtes file:// → localhost:3001 ───────────────────────────────
//
// En mode packagé, le renderer est servi depuis file:// et Chromium envoie
// Origin: null pour toutes les requêtes fetch vers localhost:3001.
// L'API Hono rejette ces requêtes (origin null ≠ liste blanche).
//
// Solution : intercepter les réponses HTTP sortant de l'API locale et injecter
// les headers Access-Control-Allow-* avant que Chromium ne les lise.
// Cela ne bypass pas la sécurité réseau — uniquement le serveur local.

function installCorsProxy() {
  if (!isDev) {
    session.defaultSession.webRequest.onHeadersReceived(
      { urls: ['http://localhost:3001/*'] },
      (details, callback) => {
        const headers = { ...details.responseHeaders }
        headers['Access-Control-Allow-Origin']      = ['*']
        headers['Access-Control-Allow-Methods']     = ['GET, POST, PUT, PATCH, DELETE, OPTIONS']
        headers['Access-Control-Allow-Headers']     = ['Content-Type, Authorization, X-Request-ID']
        headers['Access-Control-Allow-Credentials'] = ['true']
        callback({ responseHeaders: headers })
      },
    )
    // Autoriser les requêtes OPTIONS (preflight) sans bloquer
    session.defaultSession.webRequest.onBeforeRequest(
      { urls: ['http://localhost:3001/*'] },
      (details, callback) => callback({ cancel: false }),
    )
    log.info('[cors] proxy CORS localhost:3001 installé pour file://')
  }
}

// ── Cycle de vie app ───────────────────────────────────────────────────────────
app.whenReady().then(async () => {
  // 0. CORS proxy — doit être installé AVANT la création de la fenêtre
  installCorsProxy()

  // 1. Handlers IPC SQLite
  await registerDbHandlers()

  // 2. Démarrer le serveur API embarqué (Hono → port 3001)
  //    Tous les hooks React appellent http://localhost:3001/api/*
  await startApiServer()

  // 3. Gestionnaire de synchronisation Supabase
  syncMgr = new SyncManager(() => win)
  syncMgr.start()

  // 4. Ouvrir la fenêtre principale (le serveur API est prêt)
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  syncMgr?.stop()

  // Tuer le serveur API embarqué proprement
  if (apiProc && !apiProc.killed) {
    log.info('[api] arrêt du serveur embarqué')
    apiProc.kill('SIGTERM')
    apiProc = null
  }

  if (process.platform !== 'darwin') app.quit()
})
