import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('forge', {
  // ── Base de données SQLite locale ──────────────────────────────────────────
  db: {
    query:   (sql: string, params?: unknown[]) =>
      ipcRenderer.invoke('db:query',   sql, params ?? []),
    execute: (sql: string, params?: unknown[]) =>
      ipcRenderer.invoke('db:execute', sql, params ?? []),
    all:     (sql: string, params?: unknown[]) =>
      ipcRenderer.invoke('db:all',     sql, params ?? []),
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
    status:  ()      => ipcRenderer.invoke('sync:status'),
    trigger: ()      => ipcRenderer.invoke('sync:trigger'),
    onUpdate: (cb: (status: string) => void) => {
      ipcRenderer.on('sync:update', (_e, status) => cb(status))
      return () => ipcRenderer.removeAllListeners('sync:update')
    },
  },

  // ── Infos application ─────────────────────────────────────────────────────
  app: {
    version: () => ipcRenderer.invoke('app:version'),
    isDev:   () => ipcRenderer.invoke('app:isDev'),
  },
})
