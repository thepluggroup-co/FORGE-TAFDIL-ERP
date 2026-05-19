import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { apiClient } from '@/lib/api-client'

export interface StockProduit {
  id: string
  reference: string
  designation: string
  categorie: string
  stock_actuel: number
  stock_min: number
  stock_critique: number
  stock_max: number
  unite: string
  prix_unitaire_xaf: number
  statut: 'normal' | 'alerte' | 'critique' | 'rupture'
  updated_at: string
}

interface StocksParams { search?: string; categorie?: string; statut?: string }
interface StocksResponse { data: StockProduit[]; total: number }

interface MouvementPayload {
  type: 'entree' | 'sortie'
  quantite: number
  reference?: string
  motif: string
}

export function useStocks(params?: StocksParams) {
  const qs = new URLSearchParams()
  if (params?.search)   qs.set('search', params.search)
  if (params?.categorie) qs.set('categorie', params.categorie)
  if (params?.statut)   qs.set('statut', params.statut)
  const q = qs.toString()

  return useQuery({
    queryKey: ['stocks', params],
    queryFn:  () => apiClient.get<StocksResponse>(`/api/stocks${q ? `?${q}` : ''}`),
    staleTime: 30_000,
  })
}

export function useStockAlertes() {
  return useQuery({
    queryKey: ['stocks', 'alertes'],
    queryFn:  () => apiClient.get<{ data: StockProduit[] }>('/api/stocks/alertes'),
    staleTime: 60_000,
  })
}

export interface CreateProduitPayload {
  ref: string
  designation: string
  description?: string
  categorie: string
  unite: string
  stock_actuel: number
  stock_min: number
  stock_critique: number
  prix_unitaire_xaf: number
  emplacement?: string
  fournisseur?: string
}

export function useCreateProduit() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: CreateProduitPayload) =>
      apiClient.post<StockProduit>('/api/stocks', payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['stocks'] })
      toast.success('Produit créé')
    },
    onError: (err: Error) => toast.error(err.message || 'Erreur création produit'),
  })
}

export function useMouvement() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ produitId, payload }: { produitId: string; payload: MouvementPayload }) =>
      apiClient.post<StockProduit>(`/api/stocks/${produitId}/mouvement`, payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['stocks'] })
      toast.success('Mouvement enregistré')
    },
    onError: (err: Error) => toast.error(err.message || 'Erreur mouvement stock'),
  })
}
