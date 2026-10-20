/**
 * Récupération après un nouveau déploiement.
 *
 * Chaque page est un fichier JS chargé à la demande (React.lazy), dont le nom
 * change à chaque build (ex: BonsSortie-CFpjWAVV.js). Un onglet ouvert AVANT un
 * redéploiement Vercel réclame encore l'ancien nom, qui n'existe plus : « Failed
 * to fetch dynamically imported module ». Recharger la page récupère la nouvelle
 * version — on le fait automatiquement, une seule fois, pour ne jamais boucler
 * si le fichier manque vraiment.
 */

const STALE_CHUNK = /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|Unable to preload CSS|ChunkLoadError/i

const STORAGE_KEY = 'forge:chunk-reload-at'
/** Un second échec dans ce délai après un rechargement = vraie erreur, pas une version périmée. */
const RETRY_WINDOW_MS = 10_000

export function isStaleChunkError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err ?? '')
  return STALE_CHUNK.test(message)
}

interface Deps {
  storage: Pick<Storage, 'getItem' | 'setItem'> | null
  reload: () => void
  now: () => number
}

export function createChunkRecovery({ storage, reload, now }: Deps) {
  let reloading = false

  /** Vrai si un rechargement est lancé (ou déjà en cours) pour cette erreur. */
  return function recover(err: unknown): boolean {
    if (!isStaleChunkError(err)) return false
    if (reloading) return true
    try {
      const last = Number(storage?.getItem(STORAGE_KEY) ?? 0)
      if (now() - last < RETRY_WINDOW_MS) return false
      storage?.setItem(STORAGE_KEY, String(now()))
    } catch {
      // Stockage indisponible (navigation privée…) : on recharge quand même,
      // le risque de boucle se limite à ce cas déjà marginal.
    }
    reloading = true
    reload()
    return true
  }
}

function sessionStorageOrNull(): Storage | null {
  try { return window.sessionStorage } catch { return null }
}

export const recoverFromStaleChunk = createChunkRecovery({
  storage: typeof window === 'undefined' ? null : sessionStorageOrNull(),
  reload:  () => window.location.reload(),
  now:     () => Date.now(),
})

/** À appeler une fois au démarrage : Vite signale ici l'échec d'un import dynamique. */
export function installChunkReloadHandler(): void {
  window.addEventListener('vite:preloadError', (event) => {
    recoverFromStaleChunk((event as Event & { payload?: unknown }).payload)
  })
}
