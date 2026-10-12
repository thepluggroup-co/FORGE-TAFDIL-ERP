import { toast } from 'sonner'
import { supabase } from './supabase'
import { canQueueOffline, describeOfflineAction, OFFLINE_QUEUED } from '@forge/shared'
import { getOfflineCacheUser, listStaleCachedPaths, readCachedResponse, saveCachedResponse } from './offline-cache'
import { enqueueOutbox, flushOutbox, outboxEnabled } from './outbox'
import type { OutboxAction, SendOutcome } from './outbox'

const _raw = import.meta.env.VITE_API_URL as string | undefined
export const API_BASE = _raw?.startsWith('http')
  ? _raw.replace(/\/$/, '')
  : 'https://forge-tafdil-erp-tafdil.up.railway.app'

const REQUEST_TIMEOUT_MS = 15_000

// ── Token cache ────────────────────────────────────────────────────────────────
// AuthContext calls setApiToken() whenever the session changes.
// This avoids calling supabase.auth.getSession() on every request
// (which can race against session initialization and return null).
let _cachedToken: string | null = null

export function setApiToken(token: string | null) {
  _cachedToken = token
}

// ── Rafraîchissement du cache hors ligne (desktop) ─────────────────────────────
// À la connexion et au retour du réseau, on recharge en arrière-plan les
// données que l'utilisateur consulte habituellement : si la connexion tombe
// ensuite, il retrouve des listes fraîches même sur les écrans qu'il n'a pas
// rouverts aujourd'hui. Volontairement lent et silencieux (aucun toast, aucune
// redirection) pour ne gêner ni l'utilisateur ni le rate-limit de l'API.
const REFRESH_OLDER_THAN_MS = 30 * 60 * 1000
const REFRESH_MAX_PATHS     = 60
const REFRESH_PAUSE_MS      = 400
let _refreshingCache = false

export async function refreshOfflineCache(): Promise<void> {
  if (_refreshingCache || !_cachedToken) return
  _refreshingCache = true
  try {
    const paths = await listStaleCachedPaths(REFRESH_OLDER_THAN_MS, REFRESH_MAX_PATHS)
    for (const path of paths) {
      const token = _cachedToken
      if (!token) break
      try {
        const res = await fetch(`${API_BASE}${path}`, {
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          signal:  AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        })
        if (res.status === 401 || res.status === 429) break
        if (res.ok && res.status !== 204) saveCachedResponse(path, await res.json(), false)
      } catch {
        break   // réseau retombé — on réessaiera à la prochaine reconnexion
      }
      await new Promise((r) => setTimeout(r, REFRESH_PAUSE_MS))
    }
  } finally {
    _refreshingCache = false
  }
}

// ── Deduplicated 401 handler ───────────────────────────────────────────────
let _redirecting = false
function handleSessionExpired() {
  if (_redirecting) return
  _redirecting = true
  _cachedToken = null
  toast.error('Session expirée — reconnexion…')
  setTimeout(() => {
    // scope:'local' clears localStorage only — does NOT revoke the session
    // server-side, which would cause "Auth session missing" on the next login.
    supabase.auth.signOut({ scope: 'local' }).finally(() => {
      _redirecting = false
      window.location.href = '/login'
    })
  }, 800)
}

// ── Silent token refresh (deduplicated) ────────────────────────────────────
// Shared promise so concurrent requests don't each trigger their own refresh.
let _refreshPromise: Promise<boolean> | null = null

async function tryRefreshToken(): Promise<boolean> {
  if (_refreshPromise) return _refreshPromise
  _refreshPromise = supabase.auth.refreshSession().then(({ data, error }) => {
    _refreshPromise = null
    if (error || !data.session?.access_token) return false
    _cachedToken = data.session.access_token
    return true
  }).catch(() => {
    _refreshPromise = null
    return false
  })
  return _refreshPromise
}

// ── Auth headers ───────────────────────────────────────────────────────────
async function getAuthHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }

  // 1. Use cached token if available (set by AuthContext via setApiToken).
  //    This token comes from supabase.auth.getSession() which auto-refreshes
  //    expired tokens — so _cachedToken is always fresh.
  if (_cachedToken) {
    headers['Authorization'] = `Bearer ${_cachedToken}`
    return headers
  }

  // 2. Fallback: call getSession() directly. Supabase auto-refreshes the token
  //    if expired (using the refresh token). Never read localStorage directly
  //    because it may hold an expired access_token.
  try {
    const result = await Promise.race([
      supabase.auth.getSession(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('getSession timeout')), 4_000),
      ),
    ]) as Awaited<ReturnType<typeof supabase.auth.getSession>>

    const token = result?.data?.session?.access_token
    if (token) {
      _cachedToken = token
      headers['Authorization'] = `Bearer ${token}`
    }
  } catch {
    // No token — API will return 401 and handleSessionExpired will fire
  }
  return headers
}

// ── Core request ───────────────────────────────────────────────────────────
async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  _retried = false,
  timeoutMs = REQUEST_TIMEOUT_MS,
  idempotencyKey?: string,
): Promise<T> {
  const url = `${API_BASE}${path}`

  // Desktop : chaque écriture porte une clé unique, conservée d'un renvoi à
  // l'autre (rafraîchissement de jeton, file hors ligne) — le serveur ne
  // l'exécute qu'une fois (apps/api/src/middleware/idempotency.ts).
  // Pas dans un navigateur : sans file hors ligne la clé n'y sert pas, et un
  // en-tête que l'API déployée n'autorise pas encore en CORS bloquerait
  // toutes les écritures du site web.
  const key = method === 'GET' || !outboxEnabled() ? undefined : (idempotencyKey ?? crypto.randomUUID())

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const headers = await getAuthHeaders()
    if (key) headers['Idempotency-Key'] = key

    const res = await fetch(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    })

    // ── Auth errors ────────────────────────────────────────────────────────
    if (res.status === 401) {
      if (!_retried) {
        // Token may have just expired — try a silent refresh once before giving up
        clearTimeout(timer)
        const refreshed = await tryRefreshToken()
        if (refreshed) return request<T>(method, path, body, true, timeoutMs, key)
      }
      handleSessionExpired()
      throw new Error('Session expirée')
    }

    if (res.status === 403) {
      const data = await res.json().catch(() => ({})) as { details?: string; error?: string; code?: string }

      // Refus de permission RBAC (requirePermission / requireRole) : plus de
      // toast « Accès refusé — Permission requise : MODULE:ACTION. Rôle actuel… ».
      // Ces messages techniques s'affichaient à chaque écran qui charge en
      // arrière-plan une donnée hors du périmètre du profil (tableau de bord,
      // listes liées…) — du bruit pour l'utilisateur, pas une information.
      //  - lecture (GET) : silencieux, l'écran affiche simplement ce qu'il peut ;
      //  - action (POST/PUT/PATCH/DELETE) : l'erreur porte un message simple,
      //    affiché une seule fois par le onError de l'appelant.
      const refusRbac = data.code === 'FORBIDDEN'
        && /^(Permission requise|Rôle requis)/.test(data.details ?? '')
      if (refusRbac) {
        throw new Error('Action non autorisée pour votre profil')
      }

      // Autres 403 = règles métier (remise plafonnée, session d'un autre
      // caissier, livraison d'un autre livreur…) : le message reste affiché.
      // toast.warning (ambre) plutôt que toast.error (rouge) — une règle
      // métier n'est pas une panne ; le rouge reste réservé aux 5xx / réseau.
      const detail = data.details ?? data.error ?? 'Droits insuffisants'
      toast.warning(detail)
      throw new Error(detail)
    }

    // ── Server errors ──────────────────────────────────────────────────────
    if (res.status >= 500) {
      const data = await res.json().catch(() => ({})) as { error?: string; details?: string }
      const detail = data.details ?? data.error ?? `Erreur ${res.status}`
      toast.error(`Erreur serveur — ${detail}`)
      throw new Error(detail)
    }

    // ── Other non-OK ───────────────────────────────────────────────────────
    if (!res.ok) {
      const data = await res.json().catch(() => ({})) as { error?: unknown; message?: string; code?: string }
      // data.error can be a Zod error object (from @hono/zod-validator) — serialize safely
      const errMsg =
        typeof data.error === 'string'
          ? data.error
          : typeof data.message === 'string'
            ? data.message
            : `Erreur ${res.status}`
      // .code est attaché en plus du message (ex: ACTIVE_ORDERS sur DELETE /clients/:id)
      // pour permettre à l'appelant de distinguer une erreur métier précise sans
      // parser le texte — les appelants existants qui ne lisent que .message
      // ne sont pas affectés.
      const error = new Error(errMsg) as Error & { code?: string }
      if (typeof data.code === 'string') error.code = data.code
      throw error
    }

    // 204 No Content — pas de corps JSON
    if (res.status === 204) return undefined as unknown as T

    const data = await res.json() as T
    if (method === 'GET') saveCachedResponse(path, data)
    return data

  } catch (err) {
    // Serveur injoignable (pas de réseau, ou délai dépassé) — jamais une vraie
    // réponse 4xx/5xx, qui est levée plus haut sous forme d'Error classique.
    const unreachable = err instanceof TypeError
      || (err instanceof DOMException && err.name === 'AbortError')

    if (unreachable && method === 'GET') {
      const cached = await readCachedResponse<T>(path)
      if (cached) return cached.data
    }

    // Écriture autorisée hors ligne (desktop) : mise en file, rejouée à la
    // reconnexion avec la même clé. L'appelant reçoit le marqueur
    // OFFLINE_QUEUED à la place de la réponse serveur (isQueuedOffline()).
    // Un délai dépassé est traité pareil : la requête a peut-être abouti,
    // et la clé garantit qu'un renvoi ne créera pas de doublon.
    const owner = getOfflineCacheUser()
    if (unreachable && key && owner && outboxEnabled() && canQueueOffline(method, path)) {
      try {
        await enqueueOutbox({ key, userId: owner, method, path, body, label: describeOfflineAction(method, path) })
        _queuedAt = Date.now()
        toast.info('Hors ligne — action mise en attente', {
          description: 'Elle sera envoyée automatiquement au retour de la connexion.',
        })
        return OFFLINE_QUEUED as unknown as T
      } catch (queueErr) {
        // Disque plein / IndexedDB indisponible : ne surtout pas annoncer
        // « enregistré » — on retombe sur l'erreur réseau normale.
        console.warn('[api-client] mise en file impossible:', queueErr)
      }
    }

    // TypeError conservé : useCaisse.ts s'en sert pour basculer sur SQLite.
    if (err instanceof TypeError && method !== 'GET') {
      throw new TypeError('Serveur injoignable — cette action nécessite une connexion Internet')
    }

    if (err instanceof DOMException && err.name === 'AbortError') {
      const msg = `Délai dépassé — ${method} ${path} (serveur API non disponible ?)`
      toast.error(msg)
      throw new Error(msg)
    }
    throw err
  } finally {
    clearTimeout(timer)
  }
}

// ── Pas de « Client créé » pour une action seulement mise en attente ─────────
// Les ~150 hooks de mutation affichent leur toast de succès dès que la
// requête « réussit » — y compris quand elle vient d'être mise en file. Plutôt
// que de modifier chaque hook, on retient ici le toast de succès qui suit
// immédiatement une mise en file : seul reste « action mise en attente ».
let _queuedAt = 0
const QUEUED_SUCCESS_MUTE_MS = 1_500
if (outboxEnabled()) {
  const success = toast.success
  toast.success = ((...args: Parameters<typeof success>) =>
    Date.now() - _queuedAt < QUEUED_SUCCESS_MUTE_MS ? '' : success(...args)) as typeof success
}

// ── Envoi des écritures en attente (desktop) ───────────────────────────────
async function sendQueuedAction(action: OutboxAction): Promise<SendOutcome> {
  const token = _cachedToken
  if (!token) return { kind: 'retry-later' }   // connexion hors ligne : pas encore de session

  let res: Response
  try {
    res = await fetch(`${API_BASE}${action.path}`, {
      method:  action.method,
      headers: {
        'Content-Type':    'application/json',
        Authorization:     `Bearer ${token}`,
        'Idempotency-Key': action.key,
      },
      body:   action.body !== undefined ? JSON.stringify(action.body) : undefined,
      signal: AbortSignal.timeout(30_000),
    })
  } catch {
    return { kind: 'retry-later' }
  }

  if (res.ok) return { kind: 'done' }

  if (res.status === 401) {
    await tryRefreshToken()
    return { kind: 'retry-later' }
  }

  const data = await res.json().catch(() => ({})) as { error?: unknown; details?: string; code?: string }
  // Indisponibilité passagère : limite de débit, passerelle, ou la même action
  // encore en cours de traitement côté serveur.
  if (res.status === 429 || res.status === 502 || res.status === 503 || res.status === 504
    || data.code === 'IDEMPOTENCY_IN_PROGRESS') {
    return { kind: 'retry-later' }
  }

  // Même simplification que pour une action en ligne (cf. le 403 de request()).
  if (data.code === 'FORBIDDEN' && /^(Permission requise|Rôle requis)/.test(data.details ?? '')) {
    return { kind: 'rejected', message: 'Action non autorisée pour votre profil' }
  }
  const message = data.details ?? (typeof data.error === 'string' ? data.error : null) ?? `Refusé par le serveur (erreur ${res.status})`
  return { kind: 'rejected', message }
}

/** Rejoue les écritures faites hors ligne. Sans effet hors desktop ou sans session. */
export function syncOfflineWrites(): Promise<void> {
  return flushOutbox(getOfflineCacheUser(), sendQueuedAction)
}

// ── Upload multipart/form-data ─────────────────────────────────────────────
async function requestForm<T>(path: string, form: FormData): Promise<T> {
  const url        = `${API_BASE}${path}`
  const controller = new AbortController()
  const timer      = setTimeout(() => controller.abort(), 30_000)
  try {
    const token = _cachedToken ?? (await supabase.auth.getSession()).data.session?.access_token
    const res   = await fetch(url, {
      method:  'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body:    form,
      signal:  controller.signal,
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({})) as { error?: string }
      throw new Error(data.error ?? `Erreur ${res.status}`)
    }
    return res.json() as Promise<T>
  } finally {
    clearTimeout(timer)
  }
}

async function requestBlob(path: string): Promise<Blob> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const token = _cachedToken ?? (await supabase.auth.getSession()).data.session?.access_token
    const res = await fetch(`${API_BASE}${path}`, {
      method:  'GET',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      signal:  controller.signal,
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({})) as { error?: string }
      throw new Error(data.error ?? `Erreur ${res.status}`)
    }
    return res.blob()
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Télécharge un fichier servi par l'API (PDF, CSV, XLS) avec le jeton de
 * session. Ne jamais faire window.open('/api/…') : l'URL relative pointe vers
 * l'hébergement du web (Vercel → 404) et n'envoie pas l'en-tête Authorization.
 */
async function downloadFile(path: string, filename: string): Promise<void> {
  const blob = await requestBlob(path)
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href     = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

/** Ouvre un fichier de l'API dans un nouvel onglet (aperçu PDF), jeton compris. */
async function openFile(path: string): Promise<void> {
  const blob = await requestBlob(path)
  const url  = URL.createObjectURL(blob)
  window.open(url, '_blank')
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

export const apiClient = {
  get:      <T>(path: string)                                          => request<T>('GET',    path),
  post:     <T>(path: string, body: unknown, timeoutMs?: number)       => request<T>('POST',   path, body, false, timeoutMs),
  put:      <T>(path: string, body: unknown)                           => request<T>('PUT',    path, body),
  patch:    <T>(path: string, body: unknown)                           => request<T>('PATCH',  path, body),
  delete:   <T>(path: string)                                          => request<T>('DELETE', path),
  postForm: <T>(path: string, form: FormData)                          => requestForm<T>(path, form),
  getBlob:  (path: string)                                             => requestBlob(path),
  downloadFile,
  openFile,
}
