import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { apiClient } from '@/lib/api-client'

export interface Client {
  id: string
  nom: string
  type: 'entreprise' | 'particulier' | 'institution'
  telephone: string
  email: string
  adresse: string
  commandes_count: number
  encours_credit_xaf: number
  total_ca_xaf: number
  score_fiabilite: number
  statut: 'actif' | 'inactif' | 'bloque'
}

interface ClientsResponse { data: Client[]; total: number }

export function useClient(id: string) {
  return useQuery({
    queryKey: ['clients', id],
    queryFn:  () => apiClient.get<Client>(`/api/clients/${id}`),
    staleTime: 60_000,
    enabled: !!id,
  })
}

export function useClients(params?: { search?: string; statut?: string }) {
  const qs = new URLSearchParams()
  if (params?.search) qs.set('search', params.search)
  if (params?.statut) qs.set('statut', params.statut)
  const q = qs.toString()

  return useQuery({
    queryKey: ['clients', params],
    queryFn:  () => apiClient.get<ClientsResponse>(`/api/clients${q ? `?${q}` : ''}`),
    staleTime: 60_000,
  })
}

export function useCreateClient() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: Omit<Client, 'id' | 'commandes_count' | 'encours_credit_xaf' | 'total_ca_xaf' | 'score_fiabilite'>) =>
      apiClient.post<Client>('/api/clients', payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['clients'] })
      toast.success('Client créé')
    },
    onError: (err: Error) => toast.error(err.message),
  })
}
