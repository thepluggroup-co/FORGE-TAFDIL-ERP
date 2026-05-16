import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { apiClient } from '@/lib/api-client'

export interface BonLigne {
  produit_id: string
  designation: string
  quantite: number
  unite: string
}

export interface BonSortie {
  id: string
  numero: string
  statut: 'soumis' | 'valide' | 'execute'
  technicien_nom: string
  lignes: BonLigne[]
  cout_total_xaf: number
  created_at: string
  code_unique?: string
}

interface BonsResponse { data: BonSortie[]; total: number }

export function useBons(params?: { statut?: string }) {
  const q = params?.statut ? `?statut=${params.statut}` : ''
  return useQuery({
    queryKey: ['bons', params],
    queryFn:  () => apiClient.get<BonsResponse>(`/api/bons${q}`),
    staleTime: 15_000,
  })
}

export function useCreateBon() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: { technicien_nom: string; lignes: Omit<BonLigne, 'designation'>[] }) =>
      apiClient.post<BonSortie>('/api/bons', payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['bons'] })
      toast.success('Bon de sortie créé')
    },
    onError: (err: Error) => toast.error(err.message),
  })
}

export function useValidateBon() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiClient.put<BonSortie>(`/api/bons/${id}/valider`, {}),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['bons'] })
      toast.success('Bon validé')
    },
    onError: (err: Error) => toast.error(err.message),
  })
}

export function useExecuteBon() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, code_unique }: { id: string; code_unique: string }) =>
      apiClient.put<BonSortie>(`/api/bons/${id}/executer`, { code_unique }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['bons'] })
      void qc.invalidateQueries({ queryKey: ['stocks'] })
      toast.success('Bon exécuté — stocks mis à jour')
    },
    onError: (err: Error) => toast.error(err.message),
  })
}
