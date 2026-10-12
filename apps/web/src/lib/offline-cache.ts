// ── Cache de lecture hors ligne (app desktop uniquement) ──────────────────────
//
// Chaque réponse GET réussie de l'API est copiée dans IndexedDB. Quand le
// serveur est injoignable, api-client.ts ressert la dernière copie : les écrans
// affichent les dernières données connues au lieu d'une erreur.
//
// Limité à Electron : dans un navigateur (poste partagé, cybercafé) on ne
// laisse pas les données de l'ERP sur le disque. Les entrées sont rangées par
// utilisateur — un compte ne voit jamais ce qu'un autre a chargé.

const DB_NAME = 'forge-http-cache'
const STORE   = 'responses'

/** Au-delà, une entrée jamais revisitée est supprimée. */
const MAX_UNUSED_MS = 30 * 24 * 60 * 60 * 1000

// Ces lectures ont déjà leur propre source hors ligne (SQLite local, plus
// fiable qu'une copie figée) — voir hooks/useCaisse.ts.
const EXCLUDED_PREFIXES = ['/api/caisse/sessions/courante']

export interface CachedResponse<T = unknown> {
  key:    string
  userId: string
  path:   string
  data:   T
  /** Date de la réponse serveur. */
  ts:     number
  /** Dernière fois qu'un écran a demandé cette donnée en ligne. */
  used:   number
}

const enabled = typeof window !== 'undefined' && 'forge' in window && typeof indexedDB !== 'undefined'

let userId: string | null = null
let dbPromise: Promise<IDBDatabase> | null = null

export function setOfflineCacheUser(id: string | null): void {
  userId = id
}

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

function cacheable(path: string): boolean {
  return enabled && userId !== null && !EXCLUDED_PREFIXES.some((p) => path.startsWith(p))
}

/** `visited` = un écran vient de demander cette donnée (≠ rafraîchissement d'arrière-plan). */
export function saveCachedResponse(path: string, data: unknown, visited = true): void {
  if (!cacheable(path) || data === undefined) return
  const owner = userId as string
  const key = `${owner}|${path}`
  const now = Date.now()
  const write = (used: number) =>
    run('readwrite', (s) => s.put({ key, userId: owner, path, data, ts: now, used } satisfies CachedResponse))
  const done = visited
    ? write(now)
    : run<CachedResponse | undefined>('readonly', (s) => s.get(key)).then((prev) => write(prev?.used ?? now))
  done.catch(() => {})
}

export async function readCachedResponse<T>(path: string): Promise<CachedResponse<T> | undefined> {
  if (!cacheable(path)) return undefined
  try {
    return await run<CachedResponse<T> | undefined>('readonly', (s) => s.get(`${userId}|${path}`))
  } catch {
    return undefined
  }
}

/**
 * Chemins à rafraîchir en arrière-plan pour l'utilisateur courant : les plus
 * récemment consultés d'abord, en sautant ceux déjà à jour. Supprime au
 * passage les entrées qui n'ont plus été consultées depuis longtemps.
 */
export async function listStaleCachedPaths(olderThanMs: number, limit: number): Promise<string[]> {
  if (!enabled || userId === null) return []
  try {
    const owner = userId
    const all = await run<CachedResponse[]>('readonly', (s) => s.index('userId').getAll(owner))
    const now = Date.now()
    for (const entry of all) {
      if (now - entry.used > MAX_UNUSED_MS) run('readwrite', (s) => s.delete(entry.key)).catch(() => {})
    }
    return all
      .filter((e) => now - e.used <= MAX_UNUSED_MS && now - e.ts > olderThanMs)
      .sort((a, b) => b.used - a.used)
      .slice(0, limit)
      .map((e) => e.path)
  } catch {
    return []
  }
}
