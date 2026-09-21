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
 *   - Reconnexion : backoff exponentiel automatique (1s → 2s → 4s … → 64s max).
 */
import { supabase } from './supabase-client'
import type { ForgeTable } from './supabase-client'

// Browser globals — absent in Node.js / Edge runtimes, guard before use.
declare const localStorage: { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void } | undefined
declare const navigator:    { onLine: boolean } | undefined
declare const window:       { addEventListener(e: string, cb: () => void): void; removeEventListener(e: string, cb: () => void): void } | undefined

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

const QUEUE_KEY     = 'forge_sync_queue'
const QUEUE_MAX     = 500   // entrées maximum avant purge
const QUEUE_PURGE_N = 50    // nombre d'entrées les plus anciennes supprimées à chaque purge

const pendingQueue: SyncOperation[] = (() => {
  if (typeof localStorage === 'undefined') return []
  try {
    const raw = localStorage.getItem(QUEUE_KEY)
    return raw ? (JSON.parse(raw) as SyncOperation[]) : []
  } catch {
    return []
  }
})()

/**
 * Persiste la file dans localStorage.
 * Si le stockage est plein, purge les QUEUE_PURGE_N entrées les plus anciennes
 * (celles qui ont le timestamp le plus ancien, en tête de tableau) et réessaie
 * une seule fois — sans jamais perdre silencieusement plus que le minimum.
 */
function persistQueue(): void {
  if (typeof localStorage === 'undefined') return

  // Purge préventive si la file dépasse QUEUE_MAX
  if (pendingQueue.length > QUEUE_MAX) {
    const purged = pendingQueue.splice(0, QUEUE_PURGE_N)
    console.warn(
      `[sync] file d'attente dépassait ${QUEUE_MAX} entrées — ${purged.length} opération(s) purgée(s) ` +
      `(tables: ${[...new Set(purged.map(p => p.table))].join(', ')})`,
    )
  }

  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(pendingQueue))
  } catch {
    // localStorage plein — purge supplémentaire des plus anciennes et réessai unique
    const purged = pendingQueue.splice(0, QUEUE_PURGE_N)
    console.warn(
      `[sync] localStorage plein — ${purged.length} opération(s) oldest purgée(s) ` +
      `(tables: ${[...new Set(purged.map(p => p.table))].join(', ')})`,
    )
    try {
      localStorage.setItem(QUEUE_KEY, JSON.stringify(pendingQueue))
    } catch {
      // Si ça échoue encore, on laisse la file en mémoire sans planter.
      console.error('[sync] persistQueue: localStorage inaccessible — file conservée en mémoire uniquement')
    }
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

/**
 * Comparaison champ par champ de deux SyncRecord.
 * Plus fiable que JSON.stringify (pas de sensibilité à l'ordre des clés).
 */
function recordsEqual(a: SyncRecord, b: SyncRecord): boolean {
  const keysA = Object.keys(a)
  const keysB = Object.keys(b)
  if (keysA.length !== keysB.length) return false
  for (const k of keysA) {
    const va = a[k]
    const vb = b[k]
    if (va !== vb) {
      // Comparaison dates normalisées (toISOString peut diverger en ms)
      if (typeof va === 'string' && typeof vb === 'string') {
        const da = Date.parse(va)
        const db = Date.parse(vb)
        if (!isNaN(da) && !isNaN(db) && da === db) continue
      }
      return false
    }
  }
  return true
}

/**
 * Résolution de conflits last-write-wins sur `updated_at`.
 * En cas d'égalité de timestamps, l'enregistrement LOCAL prévaut
 * (pour éviter d'écraser un changement non encore poussé).
 */
function resolveConflict(local: SyncRecord, remote: SyncRecord): SyncRecord {
  const localTs  = local.updated_at  ? new Date(local.updated_at).getTime()  : 0
  const remoteTs = remote.updated_at ? new Date(remote.updated_at).getTime() : 0
  return localTs >= remoteTs ? local : remote
}

// ── Backoff exponentiel ────────────────────────────────────────────────────────

let _retryDelay  = 1000   // ms, reset à chaque succès
const RETRY_MAX  = 64_000 // 64 secondes max

function nextRetryDelay(): number {
  const delay = _retryDelay
  _retryDelay = Math.min(_retryDelay * 2, RETRY_MAX)
  return delay
}

function resetRetryDelay(): void {
  _retryDelay = 1000
}

// ── syncToCloud ────────────────────────────────────────────────────────────────

/**
 * Pousse des enregistrements vers Supabase via upsert.
 * En cas d'erreur réseau, ajoute l'opération à la file d'attente offline.
 */
export async function syncToCloud(
  table: ForgeTable,
  records: SyncRecord[],
): Promise<void> {
  if (!records.length) return

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

  // 2. Résolution de conflits (comparaison champ par champ — pas JSON.stringify)
  const remoteMap = new Map(remoteRecords.map((r) => [r.id, r]))
  const toUpsertLocally: SyncRecord[] = []

  for (const remote of remoteRecords) {
    const local = localRecords.find((l) => l.id === remote.id)
    if (local && local.sync_status === 'pending') {
      const winner = resolveConflict(local, remote)
      // Un conflit réel : le winner diffère de l'enregistrement local
      if (!recordsEqual(winner, local)) {
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
 * En cas d'erreur réseau, s'arrête et planifie une nouvelle tentative avec
 * backoff exponentiel.
 *
 * Appelée automatiquement quand `navigator.onLine` repasse à true.
 */
export async function flushPendingQueue(): Promise<{ flushed: number; remaining: number }> {
  let flushed = 0

  while (pendingQueue.length > 0 && isOnline()) {
    const op = pendingQueue[0]
    try {
      if (op.type === 'upsert') {
        await syncToCloud(op.table, op.records)
      } else {
        // delete — pas de helper pour l'instant, on skip sans bloquer
        console.warn(`[sync] flushPendingQueue: opération delete ignorée pour ${op.table}`)
      }
      dequeue()
      flushed++
    } catch {
      // Réseau toujours indisponible — on arrête et on replanifie
      break
    }
  }

  if (flushed > 0) {
    resetRetryDelay()
    console.info(`[sync] flushPendingQueue: ${flushed} opération(s) envoyée(s) — ${pendingQueue.length} restante(s)`)
  }

  return { flushed, remaining: pendingQueue.length }
}

// ── Listener online/offline avec backoff ──────────────────────────────────────

/**
 * Installe les listeners `online`/`offline` sur window.
 * À appeler une seule fois au démarrage de l'application.
 * Retourne une fonction de nettoyage.
 */
export function initSyncListeners(): () => void {
  if (typeof window === 'undefined') return () => {}

  let retryTimer: ReturnType<typeof setTimeout> | null = null

  const scheduleRetry = () => {
    if (retryTimer) clearTimeout(retryTimer)
    const delay = nextRetryDelay()
    console.info(`[sync] Nouvelle tentative dans ${delay / 1000}s`)
    retryTimer = setTimeout(() => {
      if (isOnline()) {
        flushPendingQueue()
          .then(({ flushed, remaining }) => {
            if (remaining > 0) scheduleRetry()
            else console.info(`[sync] File vidée — ${flushed} opération(s) envoyée(s)`)
          })
          .catch((e) => {
            console.error('[sync] Erreur flush retry:', e)
            scheduleRetry()
          })
      }
    }, delay)
  }

  const handleOnline = () => {
    console.info('[sync] Connexion rétablie — vidage de la file offline')
    resetRetryDelay()
    if (retryTimer) { clearTimeout(retryTimer); retryTimer = null }
    flushPendingQueue()
      .then(({ flushed, remaining }) => {
        console.info(`[sync] ${flushed} opération(s) envoyée(s) — ${remaining} en attente`)
        if (remaining > 0) scheduleRetry()
      })
      .catch((e) => {
        console.error('[sync] Erreur flush:', e)
        scheduleRetry()
      })
  }

  const handleOffline = () => {
    console.warn('[sync] Hors ligne — les modifications seront mises en file')
    if (retryTimer) { clearTimeout(retryTimer); retryTimer = null }
  }

  window.addEventListener('online',  handleOnline)
  window.addEventListener('offline', handleOffline)

  return () => {
    window.removeEventListener('online',  handleOnline)
    window.removeEventListener('offline', handleOffline)
    if (retryTimer) clearTimeout(retryTimer)
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
