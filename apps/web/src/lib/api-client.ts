import { toast } from 'sonner'
import { supabase } from './supabase'

const _raw = import.meta.env.VITE_API_URL as string | undefined
export const API_BASE = _raw?.startsWith('http') ? _raw : 'http://localhost:3001'

const REQUEST_TIMEOUT_MS = 15_000

// ── Token cache ────────────────────────────────────────────────────────────────
// AuthContext calls setApiToken() whenever the session changes.
// This avoids calling supabase.auth.getSession() on every request
// (which can race against session initialization and return null).
let _cachedToken: string | null = null

export function setApiToken(token: string | null) {
  _cachedToken = token
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
async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const url = `${API_BASE}${path}`

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  try {
    const headers = await getAuthHeaders()

    const res = await fetch(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    })

    // ── Auth errors ────────────────────────────────────────────────────────
    if (res.status === 401) {
      handleSessionExpired()
      throw new Error('Session expirée')
    }

    if (res.status === 403) {
      const data = await res.json().catch(() => ({})) as { details?: string; error?: string }
      const detail = data.details ?? data.error ?? 'Droits insuffisants'
      toast.error(`Accès refusé — ${detail}`)
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
      const data = await res.json().catch(() => ({})) as { error?: unknown; message?: string }
      // data.error can be a Zod error object (from @hono/zod-validator) — serialize safely
      const errMsg =
        typeof data.error === 'string'
          ? data.error
          : typeof data.message === 'string'
            ? data.message
            : `Erreur ${res.status}`
      throw new Error(errMsg)
    }

    // 204 No Content — pas de corps JSON
    if (res.status === 204) return undefined as unknown as T

    return res.json() as Promise<T>

  } catch (err) {
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

export const apiClient = {
  get:    <T>(path: string)                => request<T>('GET',    path),
  post:   <T>(path: string, body: unknown) => request<T>('POST',   path, body),
  put:    <T>(path: string, body: unknown) => request<T>('PUT',    path, body),
  patch:  <T>(path: string, body: unknown) => request<T>('PATCH',  path, body),
  delete: <T>(path: string)               => request<T>('DELETE', path),
}
