// FORGE ERP — @forge/db
// Schémas Drizzle ORM, clients DB et utilitaires de synchronisation.

// ── Schéma SQLite (local / LibSQL / Turso) ────────────────────────────────────
export * from './schema'

// ── Schéma PostgreSQL (Supabase) ──────────────────────────────────────────────
export * from './schema.pg'

// ── Client LibSQL / SQLite local ──────────────────────────────────────────────
export { dbLocal, pingLocal, getLocalDbPath } from './sqlite-client'
export type { DbLocal } from './sqlite-client'

// ── Client LibSQL historique (Turso / remote) ─────────────────────────────────
export { db } from './client'
export type { DB } from './client'

// ── Clients Supabase ──────────────────────────────────────────────────────────
export { supabase, supabaseAdmin } from './supabase-client'
export type { SupabaseClient, ForgeTable } from './supabase-client'

// ── Synchronisation offline-first ─────────────────────────────────────────────
export {
  syncToCloud,
  syncFromCloud,
  syncTable,
  flushPendingQueue,
  initSyncListeners,
  getPendingQueueLength,
  getPendingQueue,
  clearPendingQueue,
} from './sync'
export type { SyncRecord } from './sync'
