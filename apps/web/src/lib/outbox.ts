// ── File d'attente des écritures hors ligne (app desktop uniquement) ──────────
//
// Quand le serveur est injoignable, api-client.ts dépose ici les écritures
// autorisées (packages/shared/src/offline-writes.ts). Elles sont rejouées dans
// l'ordre à la reconnexion, chacune avec sa clé Idempotency-Key d'origine :
// le serveur ne l'exécute qu'une fois, même renvoyée plusieurs fois.
//
// Statuts :
//   pending — en attente d'envoi (rejouée automatiquement)
//   failed  — refusée par le serveur (stock insuffisant, droit manquant, fiche
//             supprimée…) : attend une décision de l'utilisateur
//   expired — en attente depuis plus de 7 jours : n'est plus envoyée sans
//             confirmation explicite
import { OFFLINE_ACTION_MAX_AGE_MS } from '@forge/shared'

const DB_NAME = 'forge-outbox'
const STORE   = 'actions'

export type OutboxStatus = 'pending' | 'failed' | 'expired'

export interface OutboxAction {
  /** Clé d'idempotence — identifie l'action de bout en bout. */
  key:       string
  userId:    string
  method:    string
  path:      string
  body:      unknown
  label:     string
  createdAt: number
  status:    OutboxStatus
  attempts:  number
  error?:    string
}

/** Résultat d'un envoi, tel que vu par la file. */
export type SendOutcome =
  | { kind: 'done' }
  /** Refus définitif du serveur (4xx métier) : à montrer à l'utilisateur. */
  | { kind: 'rejected'; message: string }
  /** Réseau, session ou serveur momentanément indisponible : on réessaiera, sans rien marquer. */
  | { kind: 'retry-later' }

export type OutboxSender = (action: OutboxAction) => Promise<SendOutcome>

const enabled = typeof window !== 'undefined' && 'forge' in window && typeof indexedDB !== 'undefined'

export function outboxEnabled(): boolean {
  return enabled
}

let dbPromise: Promise<IDBDatabase> | null = null

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      const store = req.result.createObjectStore(STORE, { keyPath: 'key' })
      store.createIndex('userId', 'userId')
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror   = () => { dbPromise = null; reject(req.error) }
  })
  return dbPromise
}

function run<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then((db) => new Promise<T>((resolve, reject) => {
    const req = fn(db.transaction(STORE, mode).objectStore(STORE))
    req.onsuccess = () => resolve(req.result)
    req.onerror   = () => reject(req.error)
  }))
}

// ── Abonnés (écran « Actions en attente ») ────────────────────────────────────

type Listener = (event: 'changed' | 'synced') => void
const listeners = new Set<Listener>()

export function subscribeOutbox(fn: Listener): () => void {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

function emit(event: 'changed' | 'synced') {
  listeners.forEach((fn) => fn(event))
}

// ── Opérations ────────────────────────────────────────────────────────────────

export async function listOutbox(userId: string | null): Promise<OutboxAction[]> {
  if (!enabled || !userId) return []
  try {
    const all = await run<OutboxAction[]>('readonly', (s) => s.index('userId').getAll(userId))
    return all.sort((a, b) => a.createdAt - b.createdAt)
  } catch {
    return []
  }
}

/** Lève si l'écriture sur disque échoue : l'appelant NE DOIT PAS annoncer « enregistré ». */
export async function enqueueOutbox(action: Omit<OutboxAction, 'status' | 'attempts' | 'createdAt'>): Promise<void> {
  if (!enabled) throw new Error('File d\'attente hors ligne indisponible')
  await run('readwrite', (s) => s.put({
    ...action, createdAt: Date.now(), status: 'pending', attempts: 0,
  } satisfies OutboxAction))
  emit('changed')
}

export async function discardOutboxAction(key: string): Promise<void> {
  await run('readwrite', (s) => s.delete(key))
  emit('changed')
}

/** « Réessayer » : remet une action refusée ou expirée dans le circuit d'envoi. */
export async function requeueOutboxAction(key: string): Promise<void> {
  const action = await run<OutboxAction | undefined>('readonly', (s) => s.get(key))
  if (!action) return
  // createdAt repart de maintenant : l'utilisateur vient de reconfirmer l'envoi.
  await run('readwrite', (s) => s.put({ ...action, status: 'pending', error: undefined, createdAt: Date.now() }))
  emit('changed')
}

let flushing = false

/**
 * Envoie les actions « pending » de l'utilisateur, dans l'ordre de création.
 * S'arrête au premier « retry-later » : inutile d'insister si le serveur ou la
 * session ne répond pas, et l'ordre des actions suivantes est préservé.
 */
export async function flushOutbox(userId: string | null, send: OutboxSender): Promise<void> {
  if (!enabled || !userId || flushing) return
  flushing = true
  let synced = false
  try {
    for (const action of await listOutbox(userId)) {
      if (action.status !== 'pending') continue

      if (Date.now() - action.createdAt > OFFLINE_ACTION_MAX_AGE_MS) {
        await run('readwrite', (s) => s.put({
          ...action, status: 'expired',
          error: 'En attente depuis plus de 7 jours — confirmez l\'envoi ou abandonnez',
        } satisfies OutboxAction))
        emit('changed')
        continue
      }

      const outcome = await send(action)
      if (outcome.kind === 'retry-later') break

      if (outcome.kind === 'done') {
        await run('readwrite', (s) => s.delete(action.key))
        synced = true
      } else {
        await run('readwrite', (s) => s.put({
          ...action, status: 'failed', attempts: action.attempts + 1, error: outcome.message,
        } satisfies OutboxAction))
      }
      emit('changed')
    }
  } catch (err) {
    console.warn('[outbox] synchronisation interrompue:', err)
  } finally {
    flushing = false
    if (synced) emit('synced')
  }
}
