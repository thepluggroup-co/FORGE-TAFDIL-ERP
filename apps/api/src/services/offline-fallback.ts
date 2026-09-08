/**
 * Détecte les erreurs réseau Supabase et bascule vers SQLite local.
 *
 * Erreurs considérées comme "offline" :
 *  - ECONNREFUSED / ENOTFOUND / ETIMEDOUT / ENETUNREACH : réseau coupé
 *  - fetch failed / network error                        : DNS ou socket
 *  - PostgreSQL code 08xxx                               : connexion PG perdue
 *  - Supabase "Failed to fetch"                          : cloud injoignable
 *  - AbortError / this operation was aborted             : timeout fetchWithTimeout
 *    (packages/db/src/supabase-client.ts) — supabase-js/postgrest-js stringifie
 *    l'exception d'abort dans error.message via `${fetchError}`, ce qui donne
 *    littéralement "AbortError: This operation was aborted".
 */

// ── Détecteur ──────────────────────────────────────────────────────────────────

const OFFLINE_CODES = new Set(['ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT', 'ENETUNREACH', 'ECONNRESET'])
const OFFLINE_PG_CODES = /^08/    // PostgreSQL connection codes
const OFFLINE_MSGS = [
  'fetch failed',
  'network error',
  'failed to fetch',
  'socket hang up',
  'connection refused',
  'connection timed out',
  'getaddrinfo',
  'econnrefused',
  'enotfound',
  'aborterror',
  'operation was aborted',
]

export function isNetworkError(err: unknown): boolean {
  if (!err) return false

  const e = err as {
    code?:    string
    name?:    string
    message?: string
    cause?:   { code?: string; message?: string }
  }

  // Code syscall direct
  if (e.code && OFFLINE_CODES.has(e.code)) return true

  // Code PostgreSQL connexion (08xxx)
  if (e.code && OFFLINE_PG_CODES.test(e.code)) return true

  // Cause wrappée (fetch → TypeError → cause)
  if (e.cause?.code && OFFLINE_CODES.has(e.cause.code)) return true

  // AbortController.abort() — timeout fetchWithTimeout, pas une vraie erreur applicative
  if (e.name === 'AbortError') return true

  // Message texte
  const msg = (e.message ?? '').toLowerCase()
  if (OFFLINE_MSGS.some((m) => msg.includes(m))) return true

  return false
}

// ── Wrapper principal ──────────────────────────────────────────────────────────

/**
 * Tente d'abord l'opération Supabase.
 * Si une erreur réseau est détectée, exécute le fallback SQLite local.
 * Les autres erreurs (validation, 4xx…) sont relancées normalement.
 *
 * @param label   Label court pour les logs (ex: "POST /factures")
 * @param online  Fonction qui appelle Supabase — doit throw si erreur
 * @param offline Fonction qui écrit en SQLite et retourne le résultat local
 */
export async function withOfflineFallback<T>(
  label:   string,
  online:  () => Promise<T>,
  offline: () => T,
): Promise<T> {
  try {
    return await online()
  } catch (err) {
    if (isNetworkError(err)) {
      console.warn(`[offline] ${label} — Supabase injoignable, basculement SQLite local`)
      try {
        return offline()
      } catch (localErr) {
        console.error(`[offline] ${label} — SQLite fallback échoué:`, localErr)
        throw new Error('Mode hors-ligne : impossible d\'enregistrer localement. Vérifiez l\'application.')
      }
    }
    throw err   // erreur Supabase normale (contrainte, auth, 4xx…) — pas de fallback
  }
}
