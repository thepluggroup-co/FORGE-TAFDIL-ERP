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

export type LivraisonStatut = 'planifiee' | 'en_transit' | 'livree' | 'annulee'

export interface Livraison {
  id: string
  numero: string
  statut: LivraisonStatut
  client_nom: string
  client_id: string | null
  commande_id: string | null
  date_livraison_prevue: string | null
  date_livraison_reelle: string | null
  notes: string | null
  livreur_id: string | null
  created_at: string
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

export async function fetchMesLivraisons(): Promise<Livraison[]> {
  const res = await apiFetch<{ data: Livraison[] }>('/api/logistique/livraisons/mes-livraisons')
  return res.data
}

export async function updateLivraisonStatut(
  id: string,
  statut: LivraisonStatut,
  notes?: string,
): Promise<Livraison> {
  return apiFetch<Livraison>(`/api/logistique/livraisons/${id}/statut`, {
    method: 'PATCH',
    body: JSON.stringify({ statut, notes }),
  })
}

// ── T03 — Signature bon de livraison ─────────────────────────────────────────

export interface BonLivraisonInfo {
  id:               string
  numero:           string
  signataire_nom:   string
  created_at:       string
  pdf_signed_url:   string | null
}

export interface SignatureResult {
  ok: true
  bon_livraison: {
    id:             string
    numero:         string
    pdf_signed_url: string
    signature_path: string
  }
  livraison: {
    id:     string
    statut: string
  }
}

export async function signLivraison(
  livraisonId:      string,
  signatureDataUrl: string,
  signataireNom:    string,
  opts?: { geoloc?: string | null; notifier?: boolean },
): Promise<SignatureResult> {
  return apiFetch<SignatureResult>(`/api/logistique/livraisons/${livraisonId}/signature`, {
    method: 'POST',
    body: JSON.stringify({
      signature_data_url: signatureDataUrl,
      signataire_nom:     signataireNom,
      geoloc:             opts?.geoloc ?? null,
      notifier:           opts?.notifier ?? true,
    }),
  })
}

export async function fetchBonLivraison(livraisonId: string): Promise<BonLivraisonInfo | null> {
  try {
    return await apiFetch<BonLivraisonInfo>(`/api/logistique/livraisons/${livraisonId}/bl`)
  } catch {
    return null
  }
}
