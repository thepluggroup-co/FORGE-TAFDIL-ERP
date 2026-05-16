/**
 * FORGE ERP — Synchronisation bidirectionnelle offline-first.
 *
 * Stratégie :
 *   - Les enregistrements locaux ont un champ `sync_status`
 *     ('pending' | 'synced' | 'conflict').
 *   - syncToCloud  : pousse les enregistrements `pending` vers Supabase (upsert).
 *   - syncFromCloud: tire les enregistrements modifiés depuis `since` (upsert local).
 *   - Résolution de conflits : last-write-wins sur `updated_at`.
 *   - File offline : tableau en mémoire + localStorage (survit aux rechargements).
 */
import { supabase } from './supabase-client'
import type { ForgeTable } from './supabase-client'

// ── Types ──────────────────────────────────────────────────────────────────────

export interface SyncRecord {
  id: string
  updated_at?: string
  [key: string]: unknown
}

interface SyncOperation {
  type: 'upsert' | 'delete'
  table: ForgeTable
  records: SyncRecord[]
  timestamp: string
}

interface SyncResult {
  pushed: number
  pulled: number
  conflicts: number
  errors: string[]
}

// ── File d'attente offline ─────────────────────────────────────────────────────

const QUEUE_KEY = 'forge_sync_queue'

const pendingQueue: SyncOperation[] = (() => {
  if (typeof localStorage === 'undefined') return []
  try {
    const raw = localStorage.getItem(QUEUE_KEY)
    return raw ? (JSON.parse(raw) as SyncOperation[]) : []
  } catch {
    return []
  }
})()

function persistQueue(): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(pendingQueue))
  } catch {
    // localStorage plein — on purge les plus anciens
    pendingQueue.splice(0, Math.floor(pendingQueue.length / 2))
    localStorage.setItem(QUEUE_KEY, JSON.stringify(pendingQueue))
  }
}

function enqueue(op: SyncOperation): void {
  pendingQueue.push(op)
  persistQueue()
}

function dequeue(): SyncOperation | undefined {
  const op = pendingQueue.shift()
  persistQueue()
  return op
}

// ── Utilitaires ────────────────────────────────────────────────────────────────

function isOnline(): boolean {
  return typeof navigator !== 'undefined' ? navigator.onLine : true
}

function resolveConflict(local: SyncRecord, remote: SyncRecord): SyncRecord {
  const localTs  = local.updated_at  ? new Date(local.updated_at).getTime()  : 0
  const remoteTs = remote.updated_at ? new Date(remote.updated_at).getTime() : 0
  // Dernier write gagne
  return localTs >= remoteTs ? local : remote
}

// ── syncToCloud ────────────────────────────────────────────────────────────────

/**
 * Pousse des enregistrements vers Supabase via upsert.
 * En cas d'erreur réseau, ajoute l'opération à la file d'attente offline.
 *
 * @param table   Nom de la table Supabase
 * @param records Enregistrements à pousser (doivent avoir un champ `id`)
 */
export async function syncToCloud(
  table: ForgeTable,
  records: SyncRecord[],
): Promise<void> {
  if (!records.length) return

  // Marquer comme pending avant envoi
  const payload = records.map((r) => ({ ...r, sync_status: 'pending' as const }))

  if (!isOnline()) {
    enqueue({ type: 'upsert', table, records: payload, timestamp: new Date().toISOString() })
    throw new Error(`[sync] Hors ligne — ${records.length} enregistrement(s) mis en file pour ${table}`)
  }

  const { error } = await supabase
    .from(table)
    .upsert(payload, { onConflict: 'id' })

  if (error) {
    enqueue({ type: 'upsert', table, records: payload, timestamp: new Date().toISOString() })
    throw new Error(`[sync] Erreur push ${table} : ${error.message}`)
  }
}

// ── syncFromCloud ──────────────────────────────────────────────────────────────

/**
 * Tire les enregistrements depuis Supabase modifiés après `since`.
 * Retourne le tableau de résultats (à upsert localement par l'appelant).
 *
 * @param table Nom de la table Supabase
 * @param since Timestamp ISO — ne tire que les records plus récents
 */
export async function syncFromCloud(
  table: ForgeTable,
  since?: string,
): Promise<SyncRecord[]> {
  if (!isOnline()) {
    console.warn(`[sync] Hors ligne — syncFromCloud(${table}) ignoré`)
    return []
  }

  let query = supabase.from(table).select('*')
  if (since) {
    query = query.gte('updated_at', since)
  }

  const { data, error } = await query

  if (error) {
    throw new Error(`[sync] Erreur pull ${table} : ${error.message}`)
  }

  return (data ?? []) as SyncRecord[]
}

// ── Sync bidirectionnel ────────────────────────────────────────────────────────

/**
 * Synchronisation complète d'une table :
 * 1. Pull les changements distants depuis `since`
 * 2. Résout les conflits avec les enregistrements locaux fournis
 * 3. Retourne les enregistrements à upsert localement
 *
 * @param table       Table cible
 * @param localRecords Enregistrements locaux `pending` à pousser
 * @param since       Timestamp de la dernière sync réussie
 */
export async function syncTable(
  table: ForgeTable,
  localRecords: SyncRecord[],
  since?: string,
): Promise<{ toUpsertLocally: SyncRecord[]; result: SyncResult }> {
  const errors: string[] = []
  let pushed = 0
  let pulled = 0
  let conflicts = 0

  // 1. Pull remote
  let remoteRecords: SyncRecord[] = []
  try {
    remoteRecords = await syncFromCloud(table, since)
    pulled = remoteRecords.length
  } catch (e) {
    errors.push((e as Error).message)
  }

  // 2. Résolution de conflits
  const remoteMap = new Map(remoteRecords.map((r) => [r.id, r]))
  const toUpsertLocally: SyncRecord[] = []

  for (const remote of remoteRecords) {
    const local = localRecords.find((l) => l.id === remote.id)
    if (local && local.sync_status === 'pending') {
      const winner = resolveConflict(local, remote)
      if (winner.id !== local.id || JSON.stringify(winner) !== JSON.stringify(local)) {
        conflicts++
      }
      toUpsertLocally.push({ ...winner, sync_status: 'synced' })
    } else {
      toUpsertLocally.push({ ...remote, sync_status: 'synced' })
    }
  }

  // 3. Push local pending (ceux non présents dans remote)
  const pendingLocal = localRecords.filter(
    (l) => l.sync_status === 'pending' && !remoteMap.has(l.id),
  )
  if (pendingLocal.length) {
    try {
      await syncToCloud(table, pendingLocal)
      pushed = pendingLocal.length
      // Marquer comme synced dans la liste de retour
      for (const r of pendingLocal) {
        toUpsertLocally.push({ ...r, sync_status: 'synced' })
      }
    } catch (e) {
      errors.push((e as Error).message)
    }
  }

  return {
    toUpsertLocally,
    result: { pushed, pulled, conflicts, errors },
  }
}

// ── Vider la file offline ──────────────────────────────────────────────────────

/**
 * Tente de rejouer toutes les opérations en attente dans la file offline.
 * S'arrête à la première erreur (réseau toujours coupé, etc.).
 *
 * Appelée automatiquement quand `navigator.onLine` repasse à true.
 */
export async function flushPendingQueue(): Promise<{ flushed: number; remaining: number }> {
  let flushed = 0

  while (pendingQueue.length > 0 && isOnline()) {
    const op = pendingQueue[0]
    try {
      await syncToCloud(op.table, op.records)
      dequeue()
      flushed++
    } catch {
      // Réseau toujours indisponible — on arrête
      break
    }
  }

  return { flushed, remaining: pendingQueue.length }
}

// ── Listener online/offline ────────────────────────────────────────────────────

/**
 * Installe les listeners `online`/`offline` sur window.
 * À appeler une seule fois au démarrage de l'application.
 */
export function initSyncListeners(): () => void {
  if (typeof window === 'undefined') return () => {}

  const handleOnline = () => {
    console.info('[sync] Connexion rétablie — vidage de la file offline')
    flushPendingQueue()
      .then(({ flushed, remaining }) => {
        console.info(`[sync] ${flushed} opération(s) envoyée(s) — ${remaining} en attente`)
      })
      .catch((e) => console.error('[sync] Erreur flush:', e))
  }

  const handleOffline = () => {
    console.warn('[sync] Hors ligne — les modifications seront mises en file')
  }

  window.addEventListener('online', handleOnline)
  window.addEventListener('offline', handleOffline)

  return () => {
    window.removeEventListener('online', handleOnline)
    window.removeEventListener('offline', handleOffline)
  }
}

// ── Accesseurs de la file (pour debug / UI) ────────────────────────────────────

export function getPendingQueueLength(): number {
  return pendingQueue.length
}

export function getPendingQueue(): Readonly<SyncOperation[]> {
  return pendingQueue
}

export function clearPendingQueue(): void {
  pendingQueue.splice(0, pendingQueue.length)
  persistQueue()
}
