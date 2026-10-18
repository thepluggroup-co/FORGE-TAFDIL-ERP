import { dbGet, dbPut, STORE_CACHE } from './db'

interface CacheEntry<T> {
  key: string
  data: T
  ts: number
}

// Les réponses sont rangées par utilisateur : sur un téléphone partagé, un
// compte ne voit jamais ce qu'un autre a chargé (les réponses de l'API
// dépendent des droits de chacun).
let userId: string | null = null

export function setCacheUser(id: string | null): void {
  userId = id
}

/** Copie une réponse GET réussie — api.ts l'appelle pour TOUTES les lectures. */
export function saveCached(path: string, data: unknown): void {
  if (!userId || data === undefined) return
  dbPut(STORE_CACHE, { key: `${userId}|${path}`, data, ts: Date.now() } satisfies CacheEntry<unknown>).catch(() => {})
}

/** Dernière réponse connue pour ce chemin, quand le serveur est injoignable. */
export async function readCached<T>(path: string): Promise<{ data: T; ts: number } | undefined> {
  if (!userId) return undefined
  try {
    const entry = await dbGet<CacheEntry<T>>(STORE_CACHE, `${userId}|${path}`)
    if (!entry) return undefined
    console.info(`[offline] "${path}" servi depuis le cache (${Math.round((Date.now() - entry.ts) / 60000)} min)`)
    return entry
  } catch {
    return undefined
  }
}
