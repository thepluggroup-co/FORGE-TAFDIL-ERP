import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { apiClient } from '@/lib/api-client'

export interface DevisLigne {
  id: string
  designation: string
  categorie: 'materiaux' | 'main-oeuvre' | 'equipement'
  quantite: number
  prix_unitaire_ht_xaf: number
}

export interface Devis {
  id: string
  reference: string
  statut: 'brouillon' | 'envoye' | 'accepte' | 'refuse' | 'expire'
  date_creation: string
  validite_jours: 15 | 30 | 45
  acompte_pct: number
  conditions_paiement: string
  montant_ttc_xaf: number
  client: { id: string; nom: string }
  lignes: DevisLigne[]
}

interface DevisResponse { data: Devis[]; total: number }

export function useDevis(params?: { statut?: string; search?: string }) {
  const qs = new URLSearchParams()
  if (params?.statut) qs.set('statut', params.statut)
  if (params?.search) qs.set('search', params.search)
  const q = qs.toString()

  return useQuery({
    queryKey: ['devis', params],
    queryFn:  () => apiClient.get<DevisResponse>(`/api/devis${q ? `?${q}` : ''}`),
    staleTime: 30_000,
  })
}

export function useUpdateStatutDevis() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, statut }: { id: string; statut: Devis['statut'] }) =>
      apiClient.patch<Devis>(`/api/devis/${id}/statut`, { statut }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['devis'] })
      toast.success('Statut devis mis à jour')
    },
    onError: (err: Error) => toast.error(err.message),
  })
}

export function useTransformerDevis() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      apiClient.post<{ commande_id: string }>(`/api/devis/${id}/transformer-commande`, {}),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['devis'] })
      void qc.invalidateQueries({ queryKey: ['commandes'] })
      toast.success('Devis transformé en commande')
    },
    onError: (err: Error) => toast.error(err.message),
  })
}
