const rawApiUrl = import.meta.env.VITE_API_URL as string | undefined
const browserOrigin = typeof window !== 'undefined' && window.location?.origin?.startsWith('http')
  ? window.location.origin
  : undefined
const BASE = rawApiUrl?.startsWith('http')
  ? rawApiUrl
  : browserOrigin ?? 'http://localhost:3003'

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

export interface ApiStock {
  id: string
  ref: string
  designation: string
  categorie: string
  unite: string
  description?: string | null
  image_url?: string | null
  prix_unitaire_xaf: number
  stock_actuel: number
  stock_min: number
  stock_critique: number
  statut: string
}

export interface ApiCommandeClient {
  id: string
  numero: string
  statut: string
  date_commande: string
  total_ttc_xaf: number
  client: {
    nom: string
    telephone: string | null
  }
}

export interface ApiShopCommandeClient {
  id: string
  ref: string
  client: {
    nom: string
    telephone: string | null
  }
  client_adresse?: string | null
  client_ville?: string | null
  montant_ht: number
  tva: number
  montant_ttc: number
  frais_livraison: number
  mode_paiement: 'mtn_momo' | 'orange_money' | 'livraison' | 'especes'
  mode_livraison: 'livraison' | 'retrait_boutique'
  avance_livraison_pct: number | null
  avance_montant: number
  reste_montant: number
  statut_commande: string
  statut_paiement: string
  payment_reference?: string | null
  erp_commande_id?: string | null
  created_at: string
  updated_at: string
}

export interface FetchStocksResult {
  data: ApiStock[]
  total: number
  page: number
  per_page: number
  total_pages: number
}

export interface FetchCommandesResult {
  data: ApiCommandeClient[]
  total: number
  page: number
  per_page: number
  total_pages: number
}

export interface FetchShopCommandesResult {
  data: ApiShopCommandeClient[]
  total: number
  page: number
  per_page: number
  total_pages: number
}

let _token: string | null = null

export function setApiToken(token: string | null) {
  _token = token
}

function buildQuery(params: Record<string, string | number | boolean | undefined>) {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue
    query.set(key, String(value))
  }
  const qs = query.toString()
  return qs ? `?${qs}` : ''
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

export async function fetchStocks(opts?: { search?: string; page?: number; per_page?: number; categorie?: string; statut?: string }) {
  const query = buildQuery({
    search: opts?.search,
    page: opts?.page ?? 1,
    per_page: opts?.per_page ?? 100,
    categorie: opts?.categorie,
    statut: opts?.statut,
  })
  return apiFetch<FetchStocksResult>(`/api/stocks${query}`)
}

export async function fetchCommandes(opts?: { statut?: string; client_id?: string; search?: string; page?: number; per_page?: number }) {
  const query = buildQuery({
    statut: opts?.statut,
    client_id: opts?.client_id,
    search: opts?.search,
    page: opts?.page ?? 1,
    per_page: opts?.per_page ?? 100,
  })
  return apiFetch<FetchCommandesResult>(`/api/commandes${query}`)
}

export async function fetchShopCommandes(opts?: { statut_commande?: string; statut_paiement?: string; search?: string; page?: number; per_page?: number }) {
  const query = buildQuery({
    statut_commande: opts?.statut_commande,
    statut_paiement: opts?.statut_paiement,
    search: opts?.search,
    page: opts?.page ?? 1,
    per_page: opts?.per_page ?? 100,
  })
  return apiFetch<FetchShopCommandesResult>(`/api/shop/commandes${query}`)
}

export interface StockMouvement {
  id: string
  produit_id: string
  type: 'entree' | 'sortie' | 'ajustement' | 'transfert'
  quantite: number
  reference: string | null
  notes: string | null
  created_by: string | null
  created_at: string
}

export interface StockDetail extends ApiStock {
  historique_30j: StockMouvement[]
  stats_30j: {
    entrees: number
    sorties: number
    mouvements: number
  }
}

export interface CreateStockPayload {
  ref: string
  designation: string
  description?: string | null
  categorie: string
  unite: string
  stock_actuel: number
  stock_min: number
  stock_critique: number
  prix_unitaire_xaf: number
  emplacement?: string | null
  fournisseur?: string | null
}

export async function createStock(payload: CreateStockPayload): Promise<ApiStock> {
  return apiFetch<ApiStock>('/api/stocks', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export async function uploadStockImages(id: string, files: File[]): Promise<{ urls: string[] }> {
  const form = new FormData()
  for (const f of files.slice(0, 12)) form.append('images', f)

  const headers: Record<string, string> = {}
  if (_token) headers['Authorization'] = `Bearer ${_token}`

  const res = await fetch(`${BASE}/api/shop-erp/produits/${id}/images`, {
    method: 'POST',
    body: form,
    headers,
  })

  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`)
  }

  return res.json()
}

export async function fetchStockDetail(id: string): Promise<StockDetail> {
  return apiFetch<StockDetail>(`/api/stocks/${id}`)
}

export interface CreateShopCommandeLigne {
  product_id: string
  designation: string
  quantite: number
  prix_unitaire: number
}

export async function createShopCommande(payload: {
  client_nom: string
  client_telephone: string | null
  client_email: string | null
  client_adresse: string | null
  client_ville: string | null
  lignes: CreateShopCommandeLigne[]
  mode_paiement: 'mtn_momo' | 'orange_money' | 'especes' | 'livraison'
  mode_livraison: 'livraison' | 'retrait_boutique'
  frais_livraison: number
  avance_livraison_pct?: number
  condition_paiement_code?: string
  notes_client?: string
}): Promise<{ ref?: string; montant_ttc?: number }> {
  return apiFetch<{ ref?: string; montant_ttc?: number }>('/api/shop/commandes', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export async function createStockMouvement(
  id: string,
  body: { type: 'entree' | 'sortie' | 'ajustement' | 'transfert'; quantite: number; reference?: string; motif?: string },
): Promise<{ mouvement: StockMouvement; produit: ApiStock }> {
  return apiFetch<{ mouvement: StockMouvement; produit: ApiStock }>(`/api/stocks/${id}/mouvement`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
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
