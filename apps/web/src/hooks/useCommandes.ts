import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { apiClient } from '@/lib/api-client'

export interface CommandeLigne {
  designation: string
  quantite: number
  prix_unitaire_ht_xaf: number
  unite?: string
}

export interface CommandeHistorique {
  statut: string
  created_at: string
  commentaire?: string | null
}

export interface Commande {
  id: string
  reference: string
  statut: 'confirmed' | 'in_production' | 'pret' | 'delivered' | 'cancelled'
  date_commande: string
  date_livraison_prevue: string | null
  montant_ttc_xaf: number
  acompte_recu_xaf: number
  notes: string | null
  client: { id: string; nom: string; telephone: string }
  lignes: CommandeLigne[]
  historique: CommandeHistorique[]
}

export interface CreateCommandeLigne {
  produit_id?: string
  designation: string
  unite?: string
  quantite: number
  prix_unitaire_ht_xaf: number
  ordre?: number
}

export interface CreateCommandePayload {
  client_id?: string
  client_nom: string
  devis_id?: string
  date_commande: string
  date_livraison_prevue?: string
  notes?: string
  acompte_recu_xaf?: number
  lignes: CreateCommandeLigne[]
}

interface CommandesResponse { data: Commande[]; total: number }

export function useCommandes(params?: { statut?: string; search?: string; enabled?: boolean }) {
  const qs = new URLSearchParams()
  if (params?.statut) qs.set('statut', params.statut)
  if (params?.search) qs.set('search', params.search)
  const q = qs.toString()

  return useQuery({
    queryKey: ['commandes', { statut: params?.statut, search: params?.search }],
    queryFn:  () => apiClient.get<CommandesResponse>(`/api/commandes${q ? `?${q}` : ''}`),
    staleTime: 20_000,
    enabled:   params?.enabled !== false,
  })
}

export function useCreateCommande() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: CreateCommandePayload) =>
      apiClient.post<Commande>('/api/commandes', payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['commandes'] })
      toast.success('Commande créée')
    },
    onError: (err: Error) => toast.error(err.message),
  })
}

export function useStatutCommande() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, statut, commentaire }: { id: string; statut: string; commentaire?: string }) =>
      apiClient.patch<Commande>(`/api/commandes/${id}/statut`, { statut, commentaire }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['commandes'] })
    },
    onError: (err: Error) => toast.error(err.message),
  })
}
