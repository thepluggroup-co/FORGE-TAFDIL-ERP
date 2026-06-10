import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { apiClient } from '@/lib/api-client'

export type StatutAppro = 'brouillon' | 'valide' | 'envoye' | 'commande' | 'recu_partiel' | 'recu_total' | 'recu' | 'annule'

export interface CreerApproManuelPayload {
  produit_id:               string
  quantite:                 number
  fournisseur_nom?:         string
  fournisseur_id?:          string
  date_livraison_souhaitee?: string
  notes?:                   string
}

export interface BonApproLigne {
  id: string
  produit_id: string | null
  designation: string
  unite: string
  quantite_a_commander: number
  stock_actuel_snap: number
  stock_min_snap: number
  statut_alerte: 'alerte' | 'critique' | 'rupture'
  fournisseur: string | null
}

export interface BonAppro {
  id: string
  numero: string
  statut: StatutAppro
  bon_sortie_id: string | null
  notes: string | null
  created_at: string
  updated_at: string
  bons_approvisionnement_lignes: BonApproLigne[]
}

interface BonsApproResponse {
  data: BonAppro[]
  total: number
  page: number
  per_page: number
  total_pages: number
}

export function useBonsAppro(params?: { statut?: string; search?: string }) {
  return useQuery({
    queryKey: ['bons-appro', params],
    queryFn: () => {
      const qs = new URLSearchParams()
      if (params?.statut) qs.set('statut', params.statut)
      if (params?.search) qs.set('search', params.search)
      const query = qs.toString()
      return apiClient.get<BonsApproResponse>(`/api/bons/appro${query ? `?${query}` : ''}`)
    },
    staleTime: 15_000,
  })
}

export function useBonsApproBrouillonCount() {
  return useQuery({
    queryKey: ['bons-appro', 'count'],
    queryFn: () => apiClient.get<{ count: number }>('/api/bons/appro/count'),
    staleTime: 30_000,
    refetchInterval: 60_000,
    select: (data) => data.count,
  })
}

export function useCreerApproManuel() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: CreerApproManuelPayload) =>
      apiClient.post<BonAppro>('/api/bons/appro', payload),
    onSuccess: (bon) => {
      void qc.invalidateQueries({ queryKey: ['bons-appro'] })
      toast.success(`Bon ${(bon as { numero?: string }).numero ?? ''} créé`)
    },
    onError: (err: Error) => toast.error(err.message),
  })
}

export function useUpdateStatutAppro() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, statut }: { id: string; statut: StatutAppro }) =>
      apiClient.patch<BonAppro>(`/api/bons/appro/${id}/statut`, { statut }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['bons-appro'] })
      toast.success('Statut mis à jour')
    },
    onError: (err: Error) => toast.error(err.message),
  })
}
