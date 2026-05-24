import { supabase } from './supabase'
import { toast } from 'sonner'

const _raw = import.meta.env.VITE_API_URL as string | undefined
const API_BASE = _raw?.startsWith('http') ? _raw : 'http://localhost:3001'

async function getAuthHeaders(): Promise<Record<string, string>> {
  const { data: { session } } = await supabase.auth.getSession()
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (session?.access_token) {
    headers['Authorization'] = `Bearer ${session.access_token}`
  }
  return headers
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers = await getAuthHeaders()

  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })

  if (res.status === 401) {
    toast.error('Session expirée — veuillez vous reconnecter')
    throw new Error('Session expirée')
  }

  if (res.status === 403) {
    toast.error('Accès refusé — droits insuffisants')
    throw new Error('Accès refusé')
  }

  if (res.status >= 500) {
    const body = await res.json().catch(() => ({})) as { error?: string; code?: string; details?: string }
    const detail = body.details ?? body.error ?? `Erreur ${res.status}`
    console.error(`[API ${res.status}] ${method} ${path}`, body)
    toast.error(`Erreur serveur — ${detail}`)
    throw new Error(detail)
  }

  if (!res.ok) {
    const payload = await res.json().catch(() => ({})) as { error?: string }
    throw new Error(payload.error ?? `Erreur ${res.status}`)
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
