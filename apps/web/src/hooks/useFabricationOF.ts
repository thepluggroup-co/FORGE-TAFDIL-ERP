// Fabrication d'un OF : étapes (gamme copiée), temps réels, consommations (Phase 7)

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import type { StatutOperationOF, ResumeFabrication } from '@forge/shared'
import { apiClient } from '@/lib/api-client'

export interface OperationOF {
  id:                     string
  numero:                 number
  libelle:                string
  poste_libelle:          string | null
  equipement_designation: string | null
  temps_prevu_h:          number
  temps_reel_h:           number | null
  statut:                 StatutOperationOF
  technicien_id:          string | null
  technicien_nom:         string | null
  debut_le:               string | null
  fin_le:                 string | null
  notes:                  string | null
  transitions_possibles:  StatutOperationOF[]
}

export interface ConsommationOF {
  id:                    string
  type:                  'materiau' | 'consommable'
  designation:           string
  unite:                 string
  produit_id:            string | null
  quantite_prevue:       number
  quantite_reelle:       number | null
  quantite_sortie_stock: number
  notes:                 string | null
}

export interface FabricationOF {
  job: {
    id: string; numero: string; statut: string
    fiche_technique_id: string | null; quantite_facturable: number | null; gamme_chargee_le: string | null
  }
  operations:    OperationOF[]
  consommations: ConsommationOF[]
  resume:        ResumeFabrication
}

const cle = (jobId: string | null) => ['jobs', jobId, 'fabrication']

export function useFabricationOF(jobId: string | null) {
  return useQuery({
    queryKey: cle(jobId),
    queryFn:  () => apiClient.get<{ data: FabricationOF }>(`/api/production/jobs/${jobId}/fabrication`).then((r) => r.data),
    enabled:  !!jobId,
  })
}

function useInvalider(jobId: string) {
  const qc = useQueryClient()
  return () => {
    void qc.invalidateQueries({ queryKey: cle(jobId) })
    void qc.invalidateQueries({ queryKey: ['jobs'] })
  }
}

export function useChargerGammeOF(jobId: string) {
  const invalider = useInvalider(jobId)
  return useMutation({
    mutationFn: (payload: { modele_id?: string; quantite_facturable?: number }) =>
      apiClient.post<{ data: { operations: number; consommations: number } }>(`/api/production/jobs/${jobId}/gamme`, payload),
    onSuccess: (res) => {
      invalider()
      toast.success(`Gamme chargée : ${res.data.operations} étape(s), ${res.data.consommations} matière(s)`)
    },
    onError: (err: Error) => toast.error(err.message),
  })
}

export function useMajOperationOF(jobId: string) {
  const invalider = useInvalider(jobId)
  return useMutation({
    mutationFn: ({ opId, ...payload }: { opId: string; statut?: StatutOperationOF; temps_reel_h?: number; technicien_id?: string | null; notes?: string }) =>
      apiClient.patch(`/api/production/jobs/${jobId}/operations/${opId}`, payload),
    onSuccess: invalider,
    onError: (err: Error) => toast.error(err.message),
  })
}

export function useSaisirConsommationOF(jobId: string) {
  const invalider = useInvalider(jobId)
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ cId, ...payload }: { cId: string; quantite_reelle: number; sortir_stock?: boolean; notes?: string }) =>
      apiClient.patch(`/api/production/jobs/${jobId}/consommations/${cId}`, payload),
    onSuccess: () => {
      invalider()
      void qc.invalidateQueries({ queryKey: ['stocks'] })
      toast.success('Consommation enregistrée')
    },
    onError: (err: Error) => toast.error(err.message),
  })
}

export function useAjouterConsommationOF(jobId: string) {
  const invalider = useInvalider(jobId)
  return useMutation({
    mutationFn: (payload: { type: 'materiau' | 'consommable'; designation: string; unite: string; produit_id?: string; quantite_reelle: number; notes?: string }) =>
      apiClient.post(`/api/production/jobs/${jobId}/consommations`, payload),
    onSuccess: () => { invalider(); toast.success('Consommation imprévue ajoutée') },
    onError: (err: Error) => toast.error(err.message),
  })
}
