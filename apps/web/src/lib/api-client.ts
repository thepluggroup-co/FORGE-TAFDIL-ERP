import { supabase } from './supabase'
import { toast } from 'sonner'

const _raw = import.meta.env.VITE_API_URL as string | undefined
const API_BASE = _raw?.startsWith('http') ? _raw : 'http://localhost:3001'

// Log API configuration
if (typeof window !== 'undefined') {
  console.log('[v0] API Client initialized with base URL:', API_BASE)
}

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
  const url = `${API_BASE}${path}`
  
  console.log('[v0] API Request:', { method, url, hasAuth: !!headers['Authorization'] })

  try {
    const res = await fetch(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })

    console.log('[v0] API Response:', { status: res.status, statusText: res.statusText, url })

    if (res.status === 401) {
      window.location.href = '/login'
      throw new Error('Session expirée')
    }

    if (res.status === 403) {
      toast.error('Accès refusé — droits insuffisants')
      throw new Error('Accès refusé')
    }

    if (res.status === 404) {
      console.error('[v0] Route not found:', url)
      toast.error(`Endpoint not found: ${path}`)
      throw new Error(`Route ${path} introuvable (404)`)
    }

    if (res.status >= 500) {
      toast.error('Erreur serveur — réessayez dans quelques instants')
      throw new Error(`Erreur ${res.status}`)
    }

    if (!res.ok) {
      const payload = await res.json().catch(() => ({})) as { error?: string }
      throw new Error(payload.error ?? `Erreur ${res.status}`)
    }

    return res.json() as Promise<T>
  } catch (error) {
    console.error('[v0] API Request failed:', error)
    throw error
  }
}

export const apiClient = {
  get:    <T>(path: string)                => request<T>('GET',    path),
  post:   <T>(path: string, body: unknown) => request<T>('POST',   path, body),
  put:    <T>(path: string, body: unknown) => request<T>('PUT',    path, body),
  patch:  <T>(path: string, body: unknown) => request<T>('PATCH',  path, body),
  delete: <T>(path: string)               => request<T>('DELETE', path),
}
