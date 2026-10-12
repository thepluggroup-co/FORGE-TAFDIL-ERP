import type { MiddlewareHandler } from 'hono'
import { supabaseAdmin } from '@forge/db'
import type { HonoVariables } from '../types'

// ── Anti-doublon des écritures ────────────────────────────────────────────────
//
// Les apps desktop / mobile rejouent à la reconnexion les actions faites hors
// ligne, et renvoient une requête dont la réponse s'est perdue (coupure juste
// après le traitement). Chaque écriture porte un en-tête Idempotency-Key ; une
// clé déjà traitée renvoie la réponse enregistrée sans rien réexécuter.
//
// Seules les réponses 2xx sont mémorisées : un refus (stock insuffisant, droit
// manquant…) doit pouvoir être retenté plus tard avec la même clé.
// Table : supabase/migrations/20261018_idempotency_keys.sql.

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

/** Une requête « en cours » depuis plus longtemps est considérée abandonnée (process tué). */
const IN_PROGRESS_TIMEOUT_MS = 2 * 60 * 1000
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000

export const IDEMPOTENCY_HEADER = 'Idempotency-Key'

export type IdempotencyClaim =
  | { state: 'new' }
  | { state: 'done'; status: number; body: unknown }
  | { state: 'in_progress' }
  | { state: 'mismatch' }
  /** Stockage indisponible (migration non appliquée, base injoignable) : on laisse passer. */
  | { state: 'unavailable' }

export interface IdempotencyStore {
  claim(key: string, owner: { userId: string; method: string; path: string }): Promise<IdempotencyClaim>
  complete(key: string, status: number, body: unknown): Promise<void>
  release(key: string): Promise<void>
}

interface Row {
  user_id: string
  method: string
  path: string
  status: number | null
  response: unknown
  created_at: string
}

let warnedUnavailable = false
function warnUnavailable(reason: string) {
  if (warnedUnavailable) return
  warnedUnavailable = true
  console.warn(`[idempotency] protection anti-doublon inactive — ${reason} (migration 20261018_idempotency_keys.sql appliquée ?)`)
}

export const supabaseIdempotencyStore: IdempotencyStore = {
  async claim(key, owner) {
    if (!supabaseAdmin) return { state: 'unavailable' }
    const db = supabaseAdmin

    const { error } = await db.from('idempotency_keys')
      .insert({ key, user_id: owner.userId, method: owner.method, path: owner.path })

    if (!error) {
      // Ménage opportuniste : pas de cron dédié pour une table aussi simple.
      if (Math.random() < 0.01) {
        void db.from('idempotency_keys').delete()
          .lt('created_at', new Date(Date.now() - RETENTION_MS).toISOString())
          .then(() => {}, () => {})
      }
      return { state: 'new' }
    }

    // 23505 = clé déjà présente ; toute autre erreur = stockage inutilisable.
    if (error.code !== '23505') {
      warnUnavailable(error.message)
      return { state: 'unavailable' }
    }

    const { data } = await db.from('idempotency_keys')
      .select('user_id, method, path, status, response, created_at')
      .eq('key', key)
      .maybeSingle()
    const row = data as Row | null

    // Supprimée entre l'insert et la lecture (refus libéré par l'autre requête) : réessayable.
    if (!row) return { state: 'in_progress' }
    if (row.user_id !== owner.userId || row.method !== owner.method || row.path !== owner.path) {
      return { state: 'mismatch' }
    }
    if (row.status !== null) return { state: 'done', status: row.status, body: row.response }

    if (Date.now() - new Date(row.created_at).getTime() < IN_PROGRESS_TIMEOUT_MS) {
      return { state: 'in_progress' }
    }
    // Requête abandonnée : on la reprend, à condition d'être seul à le faire.
    const { data: taken } = await db.from('idempotency_keys')
      .update({ created_at: new Date().toISOString() })
      .eq('key', key)
      .eq('created_at', row.created_at)
      .is('status', null)
      .select('key')
    return taken && taken.length > 0 ? { state: 'new' } : { state: 'in_progress' }
  },

  async complete(key, status, body) {
    if (!supabaseAdmin) return
    const { error } = await supabaseAdmin.from('idempotency_keys')
      .update({ status, response: body ?? null })
      .eq('key', key)
    if (error) console.warn('[idempotency] réponse non mémorisée:', error.message)
  },

  async release(key) {
    if (!supabaseAdmin) return
    await supabaseAdmin.from('idempotency_keys').delete().eq('key', key).is('status', null)
  },
}

export function createIdempotencyMiddleware(
  store: IdempotencyStore = supabaseIdempotencyStore,
): MiddlewareHandler<{ Variables: HonoVariables }> {
  return async (c, next) => {
    const key = c.req.header(IDEMPOTENCY_HEADER)?.trim()
    if (!key || !MUTATING_METHODS.has(c.req.method)) return next()

    if (key.length < 8 || key.length > 100) {
      return c.json({ error: 'En-tête Idempotency-Key invalide', code: 'IDEMPOTENCY_KEY_INVALID' }, 400)
    }

    const claim = await store.claim(key, {
      userId: c.get('user').id,
      method: c.req.method,
      path:   new URL(c.req.url).pathname,
    })

    if (claim.state === 'unavailable') return next()

    if (claim.state === 'mismatch') {
      return c.json({ error: 'Cette clé a déjà servi pour une autre action', code: 'IDEMPOTENCY_KEY_REUSED' }, 422)
    }

    if (claim.state === 'in_progress') {
      c.header('Retry-After', '5')
      return c.json({ error: 'Action déjà en cours de traitement — réessayez dans un instant', code: 'IDEMPOTENCY_IN_PROGRESS' }, 409)
    }

    if (claim.state === 'done') {
      c.header('Idempotent-Replayed', 'true')
      if (claim.status === 204 || claim.body === null || claim.body === undefined) {
        return c.body(null, claim.status as 204)
      }
      return c.json(claim.body as object, claim.status as 200)
    }

    // state === 'new' : on exécute, puis on mémorise ou on libère la clé.
    let completed = false
    try {
      await next()
      const status = c.res.status
      if (status >= 200 && status < 300) {
        let body: unknown = null
        if (status !== 204 && c.res.headers.get('content-type')?.includes('application/json')) {
          body = await c.res.clone().json().catch(() => null)
        }
        await store.complete(key, status, body)
        completed = true
      }
    } finally {
      if (!completed) await store.release(key).catch(() => {})
    }
  }
}

export const idempotencyMiddleware = createIdempotencyMiddleware()
