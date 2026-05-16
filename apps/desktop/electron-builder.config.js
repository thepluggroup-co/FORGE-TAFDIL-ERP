/** @type {import('electron-builder').Configuration} */
module.exports = {
  appId:       'com.tafdil.forge',
  productName: 'FORGE by TAFDIL',
  copyright:   'Copyright © 2026 TAFDIL SARL',

  directories: {
    output: 'release',
    buildResources: 'assets',
  },

  files: [
    'out/**',
    '!out/renderer/**',
  ],

  // Le renderer (apps/web/dist) est copié dans le paquet
  extraResources: [
    {
      from: '../web/dist',
      to:   'renderer',
      filter: ['**/*'],
    },
  ],

  // ── Windows ──────────────────────────────────────────────────────────────────
  win: {
    target: [{ target: 'nsis', arch: ['x64'] }],
    icon: 'assets/forge.ico',
    requestedExecutionLevel: 'requireAdministrator',
  },

  nsis: {
    oneClick:                        false,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut:           true,
    createStartMenuShortcut:         true,
    shortcutName:                    'FORGE by TAFDIL',
    installerIcon:                   'assets/forge.ico',
    uninstallerIcon:                 'assets/forge.ico',
  },

  // ── Linux ────────────────────────────────────────────────────────────────────
  linux: {
    target: [{ target: 'AppImage', arch: ['x64'] }],
    icon:   'assets/forge.png',
    category: 'Office',
  },

  // ── Mac ──────────────────────────────────────────────────────────────────────
  mac: {
    target: [{ target: 'dmg', arch: ['x64', 'arm64'] }],
    icon: 'assets/forge.icns',
    category: 'public.app-category.business',
  },

  // Mise à jour automatique (electron-updater)
  publish: null,
}
