import { dbGet, dbPut, STORE_CACHE } from './db'

interface CacheEntry<T> {
  key: string
  data: T
  ts: number
}

const MAX_AGE_MS = 24 * 60 * 60 * 1000 // 24h — au-delà, la donnée en cache n'est plus montrée comme fraîche

/**
 * Essaie `fetcher()` (réseau). En cas d'échec réseau (pas une erreur métier
 * 4xx/5xx explicite, juste une requête qui n'a pas pu partir), retombe sur la
 * dernière réponse mise en cache pour cette clé, si elle existe — sinon
 * relance l'erreur d'origine. Toute réponse réseau réussie est mise en cache.
 * Les appelants n'ont rien à changer : la forme du retour est identique à
 * `fetcher()`, en ligne ou hors ligne.
 */
export async function cachedGet<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
  try {
    const data = await fetcher()
    dbPut(STORE_CACHE, { key, data, ts: Date.now() } satisfies CacheEntry<T>).catch(() => {})
    return data
  } catch (err) {
    const cached = await dbGet<CacheEntry<T>>(STORE_CACHE, key)
    if (cached) {
      const age = Date.now() - cached.ts
      const label = age > MAX_AGE_MS ? 'ancien' : 'récent'
      console.info(`[offline] "${key}" servi depuis le cache (${label}, ${Math.round(age / 60000)} min)`)
      return cached.data
    }
    throw err
  }
}
