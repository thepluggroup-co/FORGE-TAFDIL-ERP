import { supabase } from './supabase'
import { toast } from 'sonner'

const _raw = import.meta.env.VITE_API_URL as string | undefined
export const API_BASE = _raw?.startsWith('http') ? _raw : 'http://localhost:3001'

const REQUEST_TIMEOUT_MS = 15_000

// ── Deduplicated 401 handler ───────────────────────────────────────────────
// Prevents 10 simultaneous requests all firing the same "session expirée" toast.
let _redirecting = false
function handleSessionExpired() {
  if (_redirecting) return
  _redirecting = true
  toast.error('Session expirée — reconnexion…')
  // Give the toast 800 ms to appear before the page changes
  setTimeout(() => {
    supabase.auth.signOut().finally(() => {
      _redirecting = false
      window.location.href = '/login'
    })
  }, 800)
}

// ── Auth headers ───────────────────────────────────────────────────────────
async function getAuthHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  try {
    const result = await Promise.race([
      supabase.auth.getSession(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('getSession timeout')), 4_000),
      ),
    ]) as Awaited<ReturnType<typeof supabase.auth.getSession>>

    const token = result?.data?.session?.access_token
    if (token) headers['Authorization'] = `Bearer ${token}`
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
      const data = await res.json().catch(() => ({})) as { error?: string }
      throw new Error(data.error ?? `Erreur ${res.status}`)
    }

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
