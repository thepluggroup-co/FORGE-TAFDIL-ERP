import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  dbGetProduits, dbGetAlertesProduits, dbCreateProduit, dbMouvementStock,
} from '@/lib/db'
import { apiClient } from '@/lib/api-client'

export interface StockProduit {
  id: string; ref: string; designation: string; categorie: string; unite: string
  stock_actuel: number; stock_min: number; stock_critique: number
  prix_unitaire_xaf: number; statut: 'normal' | 'alerte' | 'critique' | 'rupture'
  updated_at: string | null
}

export interface CreateProduitPayload {
  ref: string; designation: string; description?: string; categorie: string; unite: string
  stock_actuel: number; stock_min: number; stock_critique: number
  prix_unitaire_xaf: number; emplacement?: string; fournisseur?: string
}

interface StocksResponse { data: StockProduit[]; total: number }

export function useStocks(params?: { search?: string; categorie?: string; statut?: string }) {
  return useQuery({
    queryKey:  ['stocks', params],
    queryFn:   () => dbGetProduits(params) as Promise<StocksResponse>,
    staleTime: 30_000,
  })
}

export function useStockAlertes() {
  return useQuery({
    queryKey:  ['stocks', 'alertes'],
    queryFn:   () => dbGetAlertesProduits() as Promise<{ data: StockProduit[] }>,
    staleTime: 60_000,
  })
}

export function useCreateProduit() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: CreateProduitPayload) => dbCreateProduit(payload),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['stocks'] }); toast.success('Produit créé') },
    onError:   (err: Error) => toast.error(err.message),
  })
}

export interface MouvementStock {
  id: string
  created_at: string
  type: 'entree' | 'sortie' | 'ajustement' | 'transfert'
  quantite: number
  reference: string | null
  notes: string | null
  created_by: string | null
  produits: { ref: string; designation: string; unite: string } | null
  profiles: { full_name: string | null } | null
}

export function useMouvementsStock(params?: {
  produit_id?: string
  type?: 'entree' | 'sortie' | 'ajustement' | 'transfert'
  date_debut?: string
  date_fin?: string
  page?: number
}) {
  return useQuery({
    queryKey:  ['mouvements_stock', params],
    queryFn:   () => {
      const qs = new URLSearchParams()
      if (params?.produit_id) qs.set('produit_id', params.produit_id)
      if (params?.type)       qs.set('type', params.type)
      if (params?.date_debut) qs.set('date_debut', params.date_debut)
      if (params?.date_fin)   qs.set('date_fin', params.date_fin)
      if (params?.page)       qs.set('page', String(params.page))
      const query = qs.toString()
      return apiClient.get<{ data: MouvementStock[]; total: number; page: number; per_page: number; total_pages: number }>(
        `/api/stocks/mouvements${query ? `?${query}` : ''}`
      )
    },
    staleTime: 15_000,
  })
}

export function useMouvement() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ produitId, payload }: {
      produitId: string
      payload: { type: 'entree' | 'sortie' | 'ajustement'; quantite: number; motif?: string; reference?: string }
    }) => dbMouvementStock(produitId, payload.type, payload.quantite, payload.motif),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['stocks'] }); toast.success('Mouvement enregistré') },
    onError:   (err: Error) => toast.error(err.message),
  })
}
