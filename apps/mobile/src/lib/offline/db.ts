// Enveloppe IndexedDB minimale — deux object stores :
//   cache : réponses GET en lecture seule (clé = endpoint, valeur = { data, ts })
//   queue : mutations en attente de synchronisation (clé = id auto-incrémenté)
// Pas de dépendance externe : l'API IndexedDB native suffit pour ce besoin.

const DB_NAME = 'forge-offline'
const DB_VERSION = 1
export const STORE_CACHE = 'cache'
export const STORE_QUEUE = 'queue'

let dbPromise: Promise<IDBDatabase> | null = null

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise

  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB indisponible'))
      return
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE_CACHE)) {
        db.createObjectStore(STORE_CACHE, { keyPath: 'key' })
      }
      if (!db.objectStoreNames.contains(STORE_QUEUE)) {
        db.createObjectStore(STORE_QUEUE, { keyPath: 'id', autoIncrement: true })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('Échec ouverture IndexedDB'))
  })

  return dbPromise
}

async function withStore<T>(
  storeName: string,
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode)
    const store = tx.objectStore(storeName)
    const req = fn(store)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error(`Échec opération ${storeName}`))
  })
}

export async function dbGet<T>(store: string, key: IDBValidKey): Promise<T | undefined> {
  try {
    return await withStore<T>(store, 'readonly', s => s.get(key))
  } catch {
    return undefined
  }
}

export async function dbGetAll<T>(store: string): Promise<T[]> {
  try {
    return await withStore<T[]>(store, 'readonly', s => s.getAll())
  } catch {
    return []
  }
}

export async function dbPut(store: string, value: unknown): Promise<IDBValidKey> {
  return withStore(store, 'readwrite', s => s.put(value))
}

export async function dbDelete(store: string, key: IDBValidKey): Promise<void> {
  await withStore(store, 'readwrite', s => s.delete(key))
}
