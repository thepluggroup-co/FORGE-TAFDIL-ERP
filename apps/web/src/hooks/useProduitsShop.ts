import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { apiClient } from '@/lib/api-client'

// ── Types ──────────────────────────────────────────────────────────────────────

export interface ProduitShopErp {
  id:             string
  ref:            string
  nom:            string
  categorie:      string
  description?:   string | null
  unite:          string
  stock_actuel:   number
  stock_min:      number
  stock_critique: number
  statut:         string
  visible_shop:   boolean
  prix_public:    number | null
  description_longue: string | null
  images:         string[]
  tags:           string[]
  delai_fabrication_jours: number
  min_commande:   number
}

export interface ProduitShopVitrinePayload {
  visible_shop?: boolean
  prix_public?: number | null
  description_longue?: string | null
  images?: string[]
  tags?: string[]
  delai_fabrication_jours?: number
  min_commande?: number
}

// ── Hook : liste ───────────────────────────────────────────────────────────────

export function useProduitsShop() {
  return useQuery({
    queryKey: ['produits-shop-erp'],
    queryFn:  () =>
      apiClient.get<{ data: ProduitShopErp[]; total: number }>('/api/shop-erp/produits')
        .then((r) => r.data),
    staleTime: 30_000,
  })
}

// ── Mutation : toggle visibilité ───────────────────────────────────────────────

export function useToggleVisibilite() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, visible }: { id: string; visible: boolean }) =>
      apiClient.put(`/api/shop-erp/produits/${id}/visibilite`, { visible }),
    onSuccess: (_, { visible }) => {
      void qc.invalidateQueries({ queryKey: ['produits-shop-erp'] })
      toast.success(visible ? 'Produit affiché sur le shop' : 'Produit masqué du shop')
    },
    onError: (err: Error) => toast.error(err.message),
  })
}

// ── Mutation : mise à jour prix ────────────────────────────────────────────────

export function useUpdatePrix() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, prix }: { id: string; prix: number }) =>
      apiClient.put(`/api/shop-erp/produits/${id}/prix`, { prix }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['produits-shop-erp'] })
      toast.success('Prix mis à jour')
    },
    onError: (err: Error) => toast.error(err.message),
  })
}

export function useUpdateVitrineProduit() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: ProduitShopVitrinePayload }) =>
      apiClient.put(`/api/shop-erp/produits/${id}/vitrine`, payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['produits-shop-erp'] })
      toast.success('Fiche boutique mise a jour')
    },
    onError: (err: Error) => toast.error(err.message),
  })
}

export function useUploadImagesProduit() {
  return useMutation({
    mutationFn: ({ id, files }: { id: string; files: File[] }) => {
      const form = new FormData()
      files.forEach((file) => form.append('images', file))
      return apiClient.postForm<{ data: { urls: string[] } }>(`/api/shop-erp/produits/${id}/images`, form)
    },
    onError: (err: Error) => toast.error(err.message),
  })
}
