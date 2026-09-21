import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { apiClient } from '@/lib/api-client'

// ── Types ──────────────────────────────────────────────────────────────────────

export interface Fournisseur {
  id:               string
  nom:              string
  telephone:        string | null
  email:            string | null
  whatsapp:         string | null
  adresse:          string | null
  produits_fournis: string[]
  notes:            string | null
  actif:            boolean
  created_at:       string
}

export interface CreateFournisseurPayload {
  nom:              string
  telephone?:       string
  email?:           string
  whatsapp?:        string
  adresse?:         string
  produits_fournis?: string[]
  notes?:           string
  actif?:           boolean
}

export interface EnvoyerBonPayload {
  bon_appro_id:          string
  canal:                 'email' | 'whatsapp'
  message_personnalise?: string
}

export interface EnvoyerBonResult {
  success:    boolean
  canal:      'email' | 'whatsapp'
  messageId?: string
  wa_link?:   string
}

// ── Hooks ──────────────────────────────────────────────────────────────────────

export function useFournisseurs(search?: string) {
  return useQuery({
    queryKey:  ['fournisseurs', search],
    queryFn:   () => {
      const params = new URLSearchParams()
      if (search) params.set('search', search)
      return apiClient.get<{ data: Fournisseur[] }>(`/api/fournisseurs?${params}`)
    },
    staleTime: 30_000,
    select:    (res) => res.data,
  })
}

export function useCreateFournisseur() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: CreateFournisseurPayload) =>
      apiClient.post<Fournisseur>('/api/fournisseurs', payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['fournisseurs'] })
      toast.success('Fournisseur créé')
    },
    onError: (err: Error) => toast.error(err.message),
  })
}

export function useUpdateFournisseur() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...payload }: { id: string } & Partial<CreateFournisseurPayload>) =>
      apiClient.patch<Fournisseur>(`/api/fournisseurs/${id}`, payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['fournisseurs'] })
      toast.success('Fournisseur mis à jour')
    },
    onError: (err: Error) => toast.error(err.message),
  })
}

export function useDeleteFournisseur() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiClient.delete<{ success: boolean }>(`/api/fournisseurs/${id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['fournisseurs'] })
      toast.success('Fournisseur désactivé')
    },
    onError: (err: Error) => toast.error(err.message),
  })
}

export function useEnvoyerBon() {
  return useMutation({
    mutationFn: ({ fournisseurId, ...payload }: { fournisseurId: string } & EnvoyerBonPayload) =>
      apiClient.post<EnvoyerBonResult>(`/api/fournisseurs/${fournisseurId}/envoyer-bon`, payload),
    onError: (err: Error) => toast.error(err.message),
  })
}
