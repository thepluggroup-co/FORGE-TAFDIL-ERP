import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { apiClient } from '@/lib/api-client'
import { useAuth } from '@/context/AuthContext'

// ── Types ──────────────────────────────────────────────────────────────────────

export interface DevisLigne {
  id: string
  designation: string
  categorie: 'materiaux' | 'main-oeuvre' | 'equipement' | string
  quantite: number
  prix_unitaire_ht_xaf: number
  unite?: string
}

export interface Devis {
  id: string
  reference: string
  statut: 'brouillon' | 'envoye' | 'accepte' | 'refuse' | 'expire' | 'transforme' | string
  date_creation: string | null
  date_validite: string | null
  validite_jours: number
  acompte_pct: number
  condition_paiement_id: string | null
  condition_paiement: { code: string; libelle: string; acompte_pct: number; delai_solde_jours: number } | null
  total_ht_xaf: number
  tva_xaf: number
  montant_ttc_xaf: number
  pdf_url: string | null
  notes: string | null
  source_web: boolean
  expire: boolean
  jours_restants: number | null
  approuve_par_client: boolean
  approuve_at: string | null
  commentaire_client: string | null
  client: { id: string; nom: string; telephone?: string | null; email?: string | null }
  lignes: DevisLigne[]
}

export interface CreateDevisPayload {
  client_id?: string
  client_nom: string
  date_emission: string
  date_validite: string
  validite_jours: 15 | 30 | 45
  acompte_pct: number
  condition_paiement_id?: string
  notes?: string
  lignes: Array<{
    designation: string; categorie: string; unite: string
    quantite: number; prix_unitaire_ht_xaf: number; ordre: number; description?: string
  }>
}

interface DevisResponse { data: Devis[]; total: number }

// ── Queries ────────────────────────────────────────────────────────────────────

export function useDevis(params?: { statut?: string; search?: string }) {
  const qs = new URLSearchParams()
  if (params?.statut) qs.set('statut', params.statut)
  if (params?.search) qs.set('search', params.search)
  const q = qs.toString()
  return useQuery({
    queryKey:  ['devis', params],
    queryFn:   () => apiClient.get<DevisResponse>(`/api/devis${q ? `?${q}` : ''}`),
    staleTime: 30_000,
  })
}

export function useDevisById(id: string | null) {
  return useQuery({
    queryKey:  ['devis', id],
    queryFn:   () => apiClient.get<Devis>(`/api/devis/${id}`),
    staleTime: 30_000,
    enabled:   !!id,
  })
}

// ── Mutations ──────────────────────────────────────────────────────────────────

export function useCreateDevis() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: CreateDevisPayload) =>
      apiClient.post<Devis>('/api/devis', payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['devis'] })
      toast.success('Devis créé avec succès !')
    },
    onError: (err: Error) => toast.error(err.message),
  })
}

export function useUpdateDevis() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: Partial<CreateDevisPayload> }) =>
      apiClient.put<Devis>(`/api/devis/${id}`, payload),
    onSuccess: (_, { id }) => {
      void qc.invalidateQueries({ queryKey: ['devis'] })
      void qc.invalidateQueries({ queryKey: ['devis', id] })
      toast.success('Devis mis à jour')
    },
    onError: (err: Error) => toast.error(err.message),
  })
}

export function useDeleteDevis() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiClient.delete<void>(`/api/devis/${id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['devis'] })
      toast.success('Devis supprimé')
    },
    onError: (err: Error) => toast.error(err.message),
  })
}

export function useUpdateStatutDevis() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, statut }: { id: string; statut: string }) =>
      apiClient.patch<Devis>(`/api/devis/${id}/statut`, { statut }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['devis'] })
      toast.success('Statut devis mis à jour')
    },
    onError: (err: Error) => toast.error(err.message),
  })
}

export function useEnvoyerApprobation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      apiClient.post<{ token: string; expires_at: string; approval_url: string }>(
        `/api/devis/${id}/envoyer-approbation`, {}
      ),
    onSuccess: (data) => {
      void qc.invalidateQueries({ queryKey: ['devis'] })
      toast.success('Lien d\'approbation envoyé au client')
      // Copier le lien dans le presse-papier
      navigator.clipboard?.writeText(data.approval_url).catch(() => {})
    },
    onError: (err: Error) => toast.error(err.message),
  })
}

export function useTransformerDevis() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      apiClient.post<{ commande: { id: string; numero: string }; commande_numero: string }>(
        `/api/devis/${id}/transformer-commande`, {}
      ),
    onSuccess: (data) => {
      void qc.invalidateQueries({ queryKey: ['devis'] })
      void qc.invalidateQueries({ queryKey: ['commandes'] })
      toast.success(`Commande ${data.commande_numero} créée`)
    },
    onError: (err: Error) => toast.error(err.message),
  })
}

export interface ConditionPaiement {
  id: string
  code: string
  libelle: string
  acompte_pct: number
  delai_solde_jours: number
}

export function useConditionsPaiement() {
  return useQuery({
    queryKey: ['conditions-paiement'],
    queryFn:  () => apiClient.get<{ data: ConditionPaiement[] }>('/api/commerce/conditions-paiement'),
    staleTime: 5 * 60_000,
  })
}
