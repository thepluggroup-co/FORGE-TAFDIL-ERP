import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { apiClient } from '@/lib/api-client'

// ── Types ──────────────────────────────────────────────────────────────────────

export interface Employe {
  id: string
  nom: string
  poste: string
  departement: string
  type_contrat: 'CDI' | 'CDD' | 'stage' | 'freelance'
  date_entree: string
  /** Salaire mensuel brut de base (XAF) — champ réel en base */
  salaire_base_xaf: number
  statut: 'actif' | 'inactif' | 'conge' | 'essai'
  telephone?: string | null
  email?: string | null
  cin?: string | null
  cnps?: string | null
}

export interface Presence {
  id: string
  employe_id: string
  employe_nom: string
  poste: string
  date: string
  heure_arrivee: string | null
  heure_depart: string | null
  heures_travaillees: number
  statut: 'present' | 'absent' | 'retard' | 'conge' | 'maladie'
  notes?: string | null
}

export interface BulletinPaie {
  id: string
  employe_id: string
  employe_nom: string
  poste: string
  departement: string
  mois: string
  salaire_brut_xaf: number
  cnps_salarie_xaf: number
  irpp_xaf: number
  salaire_net_xaf: number
  cout_employeur_xaf: number
  statut: 'en_attente' | 'brouillon' | 'valide' | 'paye'
}

export interface Apprenant {
  id: string
  nom: string
  specialite: string
  niveau: number
  duree_mois: number
  statut: 'actif' | 'suspendu' | 'diplome' | 'recrute'
  notes?: string | null
}

interface EmployesResponse   { data: Employe[];      total: number }
interface PresencesResponse  { data: Presence[];     total: number }
interface BulletinsResponse  {
  data: BulletinPaie[]
  total: number
  mois: string
  masse_salariale_nette_xaf?: number
  deja_genere?: boolean
}
interface ApprenantsResponse { data: Apprenant[];    total: number }

export interface CreateEmployePayload {
  nom: string
  poste: string
  departement: string
  type_contrat: 'CDI' | 'CDD' | 'stage' | 'freelance'
  date_entree: string
  salaire_base_xaf: number
  telephone?: string
  email?: string
  cin?: string
  cnps?: string
  statut?: 'actif' | 'inactif' | 'conge' | 'essai'
}

export interface CreateApprenantPayload {
  nom: string
  specialite: string
  niveau?: number
  duree_mois?: number
  statut?: 'actif' | 'suspendu' | 'diplome' | 'recrute'
  notes?: string
}

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

export function useCreateEmploye() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: CreateEmployePayload) =>
      apiClient.post<Employe>('/api/rh/employes', payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['employes'] })
      toast.success('Employé ajouté')
    },
    onError: (err: Error) => toast.error(err.message),
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
    enabled:  !!params?.mois,  // ne charge pas sans mois
  })
}

export function useGenererPaie() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ mois, forcer = false }: { mois: string; forcer?: boolean }) =>
      apiClient.post<BulletinsResponse>('/api/rh/paie', { mois, forcer }),
    onSuccess: (_, { mois }) => {
      void qc.invalidateQueries({ queryKey: ['bulletins', { mois }] })
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

export function useCreateApprenant() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: CreateApprenantPayload) =>
      apiClient.post<Apprenant>('/api/rh/apprenants', payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['apprenants'] })
      toast.success('Apprenant ajouté')
    },
    onError: (err: Error) => toast.error(err.message),
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

export interface RecruterPayload {
  id: string
  poste: string
  departement: string
  type_contrat: 'CDI' | 'CDD' | 'stage' | 'freelance'
  date_entree: string
  salaire_base_xaf: number
  commentaire?: string
}

// ── Formation sessions ─────────────────────────────────────────────────────────

export interface FormationSession {
  id:           string
  module:       string
  niveau:       number
  statut:       'planifiee' | 'en_cours' | 'terminee' | 'annulee'
  date_debut:   string | null
  date_fin:     string | null
  formateur:    string | null
  lieu:         string | null
  capacite_max: number
  horaires:     string[]
  description:  string | null
  nb_inscrits:  number
}

export interface FormationInscription {
  id:               string
  apprenant_id:     string
  session_id:       string
  date_inscription: string
  disponibilites:   string[]
  nb_seances:       number
  evaluation:       number | null
  statut:           'inscrit' | 'en_cours' | 'termine' | 'abandonne'
  notes:            string | null
  formation_sessions?: Pick<FormationSession, 'module' | 'niveau' | 'date_debut' | 'date_fin' | 'formateur' | 'lieu'>
}

export interface ValidationNiveau {
  id:               string
  apprenant_id:     string
  niveau:           number
  date_validation:  string | null
  commentaire:      string | null
}

export interface ApprenantHistorique {
  apprenant:    Apprenant
  validations:  ValidationNiveau[]
  inscriptions: FormationInscription[]
}

export interface CreateFormationSessionPayload {
  module:       string
  niveau:       number
  statut?:      'planifiee' | 'en_cours' | 'terminee' | 'annulee'
  date_debut?:  string
  date_fin?:    string
  formateur?:   string
  lieu?:        string
  capacite_max?: number
  horaires?:    string[]
  description?: string
}

export interface InscrirePayload {
  id:             string
  session_id:     string
  disponibilites?: string[]
  notes?:         string
}

export interface UpdateInscriptionPayload {
  id:             string
  statut?:        'inscrit' | 'en_cours' | 'termine' | 'abandonne'
  nb_seances?:    number
  evaluation?:    number
  notes?:         string
  disponibilites?: string[]
}

interface FormationSessionsResponse { data: FormationSession[]; total: number }

export function useFormationSessions(params?: { statut?: string; niveau?: number }) {
  const qs = new URLSearchParams()
  if (params?.statut) qs.set('statut', params.statut)
  if (params?.niveau) qs.set('niveau', String(params.niveau))
  const q = qs.toString()
  return useQuery({
    queryKey: ['formation-sessions', params],
    queryFn:  () => apiClient.get<FormationSessionsResponse>(`/api/rh/formation/sessions${q ? `?${q}` : ''}`),
    staleTime: 60_000,
  })
}

export function useCreateFormationSession() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: CreateFormationSessionPayload) =>
      apiClient.post<FormationSession>('/api/rh/formation/sessions', payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['formation-sessions'] })
      toast.success('Session de formation créée')
    },
    onError: (err: Error) => toast.error(err.message),
  })
}

export function useUpdateFormationSession() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...body }: Partial<CreateFormationSessionPayload> & { id: string }) =>
      apiClient.put<FormationSession>(`/api/rh/formation/sessions/${id}`, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['formation-sessions'] })
      toast.success('Session mise à jour')
    },
    onError: (err: Error) => toast.error(err.message),
  })
}

export function useDeleteFormationSession() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiClient.delete(`/api/rh/formation/sessions/${id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['formation-sessions'] })
      toast.success('Session supprimée')
    },
    onError: (err: Error) => toast.error(err.message),
  })
}

export function useInscrireApprenant() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...body }: InscrirePayload) =>
      apiClient.post<FormationInscription>(`/api/rh/apprenants/${id}/inscrire`, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['formation-sessions'] })
      void qc.invalidateQueries({ queryKey: ['apprenants'] })
      toast.success('Inscrit à la session de formation')
    },
    onError: (err: Error) => toast.error(err.message),
  })
}

export function useUpdateInscription() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...body }: UpdateInscriptionPayload) =>
      apiClient.put<FormationInscription>(`/api/rh/formation/inscriptions/${id}`, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['formation-sessions'] })
      void qc.invalidateQueries({ queryKey: ['apprenant-historique'] })
      toast.success('Inscription mise à jour')
    },
    onError: (err: Error) => toast.error(err.message),
  })
}

export function useApprenantHistorique(id: string | null) {
  return useQuery({
    queryKey: ['apprenant-historique', id],
    queryFn:  () => apiClient.get<ApprenantHistorique>(`/api/rh/apprenants/${id}/historique`),
    enabled:  !!id,
    staleTime: 30_000,
  })
}

export function useRecruterApprenant() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...body }: RecruterPayload) =>
      apiClient.post<Employe>(`/api/rh/apprenants/${id}/recruter`, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['apprenants'] })
      void qc.invalidateQueries({ queryKey: ['employes'] })
      toast.success('Apprenant recruté comme employé')
    },
    onError: (err: Error) => toast.error(err.message),
  })
}
