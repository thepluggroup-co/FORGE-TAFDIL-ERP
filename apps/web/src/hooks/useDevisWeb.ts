import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { apiClient } from '@/lib/api-client'

// ── Types ──────────────────────────────────────────────────────────────────────

export type StatutDevisWeb = 'nouvelle' | 'en_cours' | 'traitee' | 'refusee'

export interface DevisWeb {
  id:           string
  nom:          string
  telephone:    string
  email?:       string
  description:  string
  type_projet?: string
  statut:       StatutDevisWeb
  erp_devis_id?: string
  created_at:   string
}

// ── Hook : liste ───────────────────────────────────────────────────────────────

export function useDevisWeb(statut?: StatutDevisWeb) {
  return useQuery({
    queryKey: ['devis-web', statut],
    queryFn:  () => {
      const qs = statut ? `?statut=${statut}` : ''
      return apiClient.get<{ data: DevisWeb[]; total: number }>(`/api/shop-erp/devis-web${qs}`)
        .then((r) => r.data)
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
  })
}

// ── Mutation : créer devis ERP depuis demande web ──────────────────────────────

export function useCreerDevisErp() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      apiClient.post<{ data: { id: string; numero: string } }>(`/api/shop-erp/devis/${id}/creer-erp`, {}),
    onSuccess: (res) => {
      void qc.invalidateQueries({ queryKey: ['devis-web'] })
      toast.success(`Devis ERP ${res.data.numero} créé`)
    },
    onError: (err: Error) => toast.error(err.message),
  })
}

export function useChangerStatutDevisWeb() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, statut }: { id: string; statut: StatutDevisWeb }) =>
      apiClient.patch<{ data: DevisWeb }>(`/api/shop-erp/devis-web/${id}/statut`, { statut }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['devis-web'] })
      toast.success('Demande de devis mise a jour')
    },
    onError: (err: Error) => toast.error(err.message),
  })
}
