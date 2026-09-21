// URL de base pour les appels client-side (composants browser).
// Vide = URLs relatives — le navigateur résout automatiquement vers l'origine du shop.
export const API_URL = ''

type ApiResult<T> = { data: T; error: null } | { data: null; error: string }

class ApiClient {
  private baseUrl: string

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl
  }

  async get<T>(path: string, init?: RequestInit): Promise<ApiResult<T>> {
    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        headers: {
          'Content-Type': 'application/json',
          ...init?.headers,
        },
      })

      if (!res.ok) {
        const body = await res.json().catch(() => ({ message: res.statusText }))
        return { data: null, error: body?.message ?? `HTTP ${res.status}` }
      }

      const data: T = await res.json()
      return { data, error: null }
    } catch (err) {
      return { data: null, error: err instanceof Error ? err.message : 'Erreur réseau' }
    }
  }

  async post<T>(path: string, body: unknown, init?: RequestInit): Promise<ApiResult<T>> {
    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        method: 'POST',
        ...init,
        headers: {
          'Content-Type': 'application/json',
          ...init?.headers,
        },
        body: JSON.stringify(body),
      })

      if (!res.ok) {
        const resBody = await res.json().catch(() => ({ message: res.statusText }))
        return { data: null, error: resBody?.message ?? `HTTP ${res.status}` }
      }

      const data: T = await res.json()
      return { data, error: null }
    } catch (err) {
      return { data: null, error: err instanceof Error ? err.message : 'Erreur réseau' }
    }
  }

  async patch<T>(path: string, body: unknown, init?: RequestInit): Promise<ApiResult<T>> {
    return this.post<T>(path, body, { ...init, method: 'PATCH' } as RequestInit)
  }
}

export const api = new ApiClient(API_URL)
