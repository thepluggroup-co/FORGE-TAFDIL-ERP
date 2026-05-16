import { app, BrowserWindow } from 'electron';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// The built directory structure
//
// ├─┬ resources
// │ ├─┬ app.asar
// │ │ ├─ main.js
// │ │ ├─ preload.js
// │ │ └─ renderer.js
// │ ├─ logo.ico
// │ └─ tray_icon.png
//
// We want the final directory structure to be:
// ├─┬ dist
// │ ├─ main.js
// │ ├─ preload.js
// │ ├─ renderer.js
// │ └─ index.html

process.env.APP_ROOT = path.join(__dirname, '..');

// 🚀 Use ['ENV_NAME'] avoid vite dependency in the keyword expansion there
const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL'];
const MAIN_DIST = path.join(process.env.APP_ROOT, 'dist-main');
const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist-renderer');

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL ? path.join(process.env.APP_ROOT, 'public') : RENDERER_DIST;

let win: BrowserWindow | null;
// Here you can use `preload.js` to use IPC and ContextIsolation
// in the renderers!
const preload = path.join(__dirname, '../preload/index.js');
const indexHtml = path.join(RENDERER_DIST, 'index.html');

function createWindow() {
  win = new BrowserWindow({
    icon: path.join(process.env.PUBLIC, 'electron-vite.svg'),
    webPreferences: {
      preload,
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  // Test active push message to Renderer-process.
  if (VITE_DEV_SERVER_URL) {
    win.webContents.openDevTools();
    win.loadURL(VITE_DEV_SERVER_URL);
  } else {
    win.loadFile(indexHtml);
  }
}

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  // On macOS it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (win === null) {
    createWindow();
  }
});

app.whenReady().then(createWindow);
