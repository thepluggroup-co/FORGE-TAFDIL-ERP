const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3001'

export interface BonLigne {
  id: string
  designation: string
  unite: string
  quantite_demandee: number
  quantite_servie: number
}

export interface BonSortie {
  id: string
  numero: string
  statut: 'en_attente' | 'soumis' | 'valide' | 'execute' | 'refuse'
  demandeur: string
  motif: string
  notes: string | null
  created_at: string
  bons_sortie_lignes: BonLigne[]
}

let _token: string | null = null

export function setApiToken(token: string | null) {
  _token = token
}

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options?.headers as Record<string, string> ?? {}),
  }
  if (_token) headers['Authorization'] = `Bearer ${_token}`

  const res = await fetch(`${BASE}${path}`, { ...options, headers })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`)
  }
  return res.json() as Promise<T>
}

export async function loginApi(email: string, password: string) {
  return apiFetch<{ token: string; user: { id: string; name: string; email: string; role: string } }>(
    '/api/auth/login',
    { method: 'POST', body: JSON.stringify({ email, password }) },
  )
}

export async function fetchBonsSoumis(): Promise<BonSortie[]> {
  const res = await apiFetch<{ data: BonSortie[] }>('/api/bons?statut=soumis&per_page=50')
  return res.data
}

export async function validerBon(id: string, decision: 'valide' | 'refuse', commentaire?: string) {
  return apiFetch<BonSortie>(`/api/bons/${id}/valider`, {
    method: 'PUT',
    body: JSON.stringify({ decision, commentaire }),
  })
}
