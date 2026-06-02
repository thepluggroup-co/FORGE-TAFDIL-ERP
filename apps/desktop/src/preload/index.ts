import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('forge', {
  // ── Base de données SQLite locale ──────────────────────────────────────────
  db: {
    /** SELECT multi-lignes → retourne un tableau (ou [] si aucun résultat) */
    query:   (sql: string, params?: unknown[]) =>
      ipcRenderer.invoke('db:query',   sql, params ?? []),

    /** SELECT multi-lignes — alias explicite */
    all:     (sql: string, params?: unknown[]) =>
      ipcRenderer.invoke('db:all',     sql, params ?? []),

    /** SELECT ligne unique → objet | null */
    get:     (sql: string, params?: unknown[]) =>
      ipcRenderer.invoke('db:get',     sql, params ?? []),

    /** INSERT / UPDATE / DELETE → { changes, lastInsertRowid } */
    execute: (sql: string, params?: unknown[]) =>
      ipcRenderer.invoke('db:execute', sql, params ?? []),
  },

  // ── Impression PDF native ─────────────────────────────────────────────────
  print: {
    pdf: (url: string) => ipcRenderer.invoke('print:pdf', url),
  },

  // ── Notifications OS ──────────────────────────────────────────────────────
  notify: {
    show: (title: string, body: string) =>
      ipcRenderer.invoke('notify:show', title, body),
  },

  // ── Statut synchronisation ────────────────────────────────────────────────
  sync: {
    status:   ()      => ipcRenderer.invoke('sync:status'),
    trigger:  ()      => ipcRenderer.invoke('sync:trigger'),
    onUpdate: (cb: (status: string) => void) => {
      const handler = (_e: Electron.IpcRendererEvent, status: string) => cb(status)
      ipcRenderer.on('sync:update', handler)
      return () => ipcRenderer.removeListener('sync:update', handler)
    },
  },

  // ── Infos application ─────────────────────────────────────────────────────
  app: {
    version: () => ipcRenderer.invoke('app:version'),
    isDev:   () => ipcRenderer.invoke('app:isDev'),
  },
})
