import { supabase } from './supabase'
import { toast } from 'sonner'

const _raw = import.meta.env.VITE_API_URL as string | undefined
const API_BASE = _raw?.startsWith('http') ? _raw : 'http://localhost:3001'

const REQUEST_TIMEOUT_MS = 15_000

async function getAuthHeaders(): Promise<Record<string, string>> {
  // getSession() reads from localStorage — fast, no network call needed
  const { data: { session } } = await supabase.auth.getSession()
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (session?.access_token) {
    headers['Authorization'] = `Bearer ${session.access_token}`
  }
  return headers
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers = await getAuthHeaders()

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  let res: Response
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    })
  } catch (err) {
    clearTimeout(timer)
    if (err instanceof DOMException && err.name === 'AbortError') {
      toast.error('Délai dépassé — l\'API ne répond pas (vérifiez que le serveur tourne)')
      throw new Error('Délai dépassé — serveur ne répond pas')
    }
    const msg = err instanceof Error ? err.message : 'Erreur réseau'
    toast.error(`Erreur réseau — ${msg}`)
    throw new Error(msg)
  } finally {
    clearTimeout(timer)
  }

  if (res.status === 401) {
    toast.error('Session expirée — veuillez vous reconnecter')
    throw new Error('Session expirée')
  }

  if (res.status === 403) {
    const payload = await res.json().catch(() => ({})) as { details?: string; error?: string }
    const detail = payload.details ?? payload.error ?? 'Droits insuffisants'
    toast.error(`Accès refusé — ${detail}`)
    throw new Error(detail)
  }

  if (res.status >= 500) {
    const payload = await res.json().catch(() => ({})) as { error?: string; code?: string; details?: string }
    const detail = payload.details ?? payload.error ?? `Erreur ${res.status}`
    console.error(`[API ${res.status}] ${method} ${path}`, payload)
    toast.error(`Erreur serveur — ${detail}`)
    throw new Error(detail)
  }

  if (!res.ok) {
    const payload = await res.json().catch(() => ({})) as { error?: string }
    const msg = payload.error ?? `Erreur ${res.status}`
    throw new Error(msg)
  }

  return res.json() as Promise<T>
}

export const apiClient = {
  get:    <T>(path: string)                => request<T>('GET',    path),
  post:   <T>(path: string, body: unknown) => request<T>('POST',   path, body),
  put:    <T>(path: string, body: unknown) => request<T>('PUT',    path, body),
  patch:  <T>(path: string, body: unknown) => request<T>('PATCH',  path, body),
  delete: <T>(path: string)               => request<T>('DELETE', path),
}
