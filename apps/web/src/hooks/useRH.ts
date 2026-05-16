import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { apiClient } from '@/lib/api-client'

// ── Types ──────────────────────────────────────────────────────────────────────

export interface Employe {
  id: string
  nom: string
  poste: string
  departement: string
  type_contrat: 'CDI' | 'CDD' | 'Apprenti'
  date_entree: string
  salaire_brut_xaf: number
  statut: 'actif' | 'inactif' | 'conge'
}

export interface Presence {
  id: string
  employe_id: string
  employe_nom: string
  date: string
  heure_arrivee: string
  heure_depart: string
  heures_travaillees: number
  statut: 'present' | 'absent' | 'retard' | 'conge'
}

export interface BulletinPaie {
  id: string
  employe_id: string
  employe_nom: string
  mois: string
  salaire_brut_xaf: number
  cnps_salarie_xaf: number
  irpp_xaf: number
  salaire_net_xaf: number
  cout_employeur_xaf: number
  statut: 'brouillon' | 'valide' | 'paye'
}

export interface Apprenant {
  id: string
  nom: string
  specialite: string
  niveau: number
  duree_mois: number
  statut: 'en_formation' | 'certifie' | 'recrute'
}

interface EmployesResponse  { data: Employe[];     total: number }
interface PresencesResponse { data: Presence[];    total: number }
interface BulletinsResponse { data: BulletinPaie[]; total: number }
interface ApprenantsResponse { data: Apprenant[];  total: number }

// ── Employes ──────────────────────────────────────────────────────────────────

export function useEmployes(params?: { search?: string; statut?: string }) {
  const qs = new URLSearchParams()
  if (params?.search) qs.set('search', params.search)
  if (params?.statut) qs.set('statut', params.statut)
  const q = qs.toString()

  return useQuery({
    queryKey: ['employes', params],
    queryFn:  () => apiClient.get<EmployesResponse>(`/api/rh/employes${q ? `?${q}` : ''}`),
    staleTime: 60_000,
  })
}

// ── Présences ─────────────────────────────────────────────────────────────────

export function usePresences(params?: { date?: string }) {
  const q = params?.date ? `?date=${params.date}` : ''
  return useQuery({
    queryKey: ['presences', params],
    queryFn:  () => apiClient.get<PresencesResponse>(`/api/rh/presences${q}`),
    staleTime: 30_000,
  })
}

// ── Bulletins de paie ─────────────────────────────────────────────────────────

export function useBulletinsPaie(params?: { mois?: string }) {
  const q = params?.mois ? `?mois=${params.mois}` : ''
  return useQuery({
    queryKey: ['bulletins', params],
    queryFn:  () => apiClient.get<BulletinsResponse>(`/api/rh/paie${q}`),
    staleTime: 60_000,
  })
}

export function useGenererPaie() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (mois: string) =>
      apiClient.post<{ bulletins: BulletinPaie[] }>('/api/rh/paie', { mois }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['bulletins'] })
      toast.success('Bulletins de paie générés')
    },
    onError: (err: Error) => toast.error(err.message),
  })
}

// ── Apprenants ────────────────────────────────────────────────────────────────

export function useApprenants(params?: { statut?: string }) {
  const q = params?.statut ? `?statut=${params.statut}` : ''
  return useQuery({
    queryKey: ['apprenants', params],
    queryFn:  () => apiClient.get<ApprenantsResponse>(`/api/rh/apprenants${q}`),
    staleTime: 60_000,
  })
}

export function useProgressionApprenant() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, observations }: { id: string; observations: string }) =>
      apiClient.post<Apprenant>(`/api/rh/apprenants/${id}/progression`, { observations }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['apprenants'] })
      toast.success('Niveau validé')
    },
    onError: (err: Error) => toast.error(err.message),
  })
}

export function useRecruterApprenant() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, poste, salaire_brut_xaf }: { id: string; poste: string; salaire_brut_xaf: number }) =>
      apiClient.post<Employe>(`/api/rh/apprenants/${id}/recruter`, { poste, salaire_brut_xaf }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['apprenants'] })
      void qc.invalidateQueries({ queryKey: ['employes'] })
      toast.success('Apprenant recruté comme employé')
    },
    onError: (err: Error) => toast.error(err.message),
  })
}
