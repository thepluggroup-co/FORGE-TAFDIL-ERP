import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { apiClient } from '@/lib/api-client'

// ══════════════════════════════════════════════════════════════════════════════
// PRODUCTION — JOBS
// ══════════════════════════════════════════════════════════════════════════════

export interface Job {
  id: string
  numero: string
  produit_designation: string
  machine_nom?: string
  technicien_nom?: string
  avancement_pct: number
  statut: 'confirmed' | 'in_production' | 'pret' | 'delivered' | 'cancelled'
  date_debut?: string
  date_fin_prevue?: string
  date_fin_reelle?: string
  notes?: string
  created_at: string
}

export interface CreateJobPayload {
  produit_designation: string
  machine_nom?: string
  technicien_nom?: string
  date_debut?: string
  date_fin_prevue?: string
  notes?: string
}

interface JobsResponse { data: Job[]; total: number }

export function useJobs(params?: { statut?: string; search?: string }) {
  const qs = new URLSearchParams()
  if (params?.statut) qs.set('statut', params.statut)
  if (params?.search) qs.set('search', params.search)
  const q = qs.toString()
  return useQuery({
    queryKey: ['jobs', params],
    queryFn:  () => apiClient.get<JobsResponse>(`/api/production/jobs${q ? `?${q}` : ''}`),
    staleTime: 20_000,
  })
}

export function useCreateJob() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: CreateJobPayload) =>
      apiClient.post<Job>('/api/production/jobs', payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['jobs'] })
      toast.success('Job de production créé')
    },
    onError: (err: Error) => toast.error(err.message),
  })
}

export function useUpdateJobStatut() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, statut, avancement_pct, date_fin_reelle, notes }: {
      id: string
      statut: Job['statut']
      avancement_pct?: number
      date_fin_reelle?: string
      notes?: string
    }) => apiClient.patch<Job>(`/api/production/jobs/${id}/statut`, { statut, avancement_pct, date_fin_reelle, notes }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['jobs'] })
    },
    onError: (err: Error) => toast.error(err.message),
  })
}

// ══════════════════════════════════════════════════════════════════════════════
// PROJETS
// ══════════════════════════════════════════════════════════════════════════════

export interface Projet {
  id: string
  nom: string
  description?: string
  client_nom?: string
  chef_projet_nom?: string
  budget_xaf: number
  depense_xaf: number
  avancement_pct: number
  statut: 'planifie' | 'en_cours' | 'suspendu' | 'livre' | 'annule'
  date_debut?: string
  deadline?: string
  created_at: string
}

export interface CreateProjetPayload {
  nom: string
  description?: string
  client_nom?: string
  chef_projet_nom?: string
  budget_xaf?: number
  date_debut?: string
  deadline?: string
}

interface ProjetsResponse { data: Projet[]; total: number }

export function useProjets(params?: { statut?: string; search?: string }) {
  const qs = new URLSearchParams()
  if (params?.statut) qs.set('statut', params.statut)
  if (params?.search) qs.set('search', params.search)
  const q = qs.toString()
  return useQuery({
    queryKey: ['projets', params],
    queryFn:  () => apiClient.get<ProjetsResponse>(`/api/projets${q ? `?${q}` : ''}`),
    staleTime: 30_000,
  })
}

export function useCreateProjet() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: CreateProjetPayload) =>
      apiClient.post<Projet>('/api/projets', payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['projets'] })
      toast.success('Projet créé')
    },
    onError: (err: Error) => toast.error(err.message),
  })
}

export function useUpdateProjetStatut() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, statut, avancement_pct, depense_xaf }: {
      id: string
      statut: Projet['statut']
      avancement_pct?: number
      depense_xaf?: number
    }) => apiClient.patch<Projet>(`/api/projets/${id}/statut`, { statut, avancement_pct, depense_xaf }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['projets'] })
    },
    onError: (err: Error) => toast.error(err.message),
  })
}

// ══════════════════════════════════════════════════════════════════════════════
// LOGISTIQUE — LIVRAISONS
// ══════════════════════════════════════════════════════════════════════════════

export interface Livraison {
  id: string
  numero: string
  client_nom: string
  destination: string
  transporteur?: string
  statut: 'confirmed' | 'in_production' | 'pret' | 'delivered' | 'cancelled'
  date_depart?: string
  date_livraison_prevue?: string
  date_livraison_reelle?: string
  notes?: string
  created_at: string
}

export interface CreateLivraisonPayload {
  client_nom: string
  destination: string
  transporteur?: string
  date_depart?: string
  date_livraison_prevue?: string
  notes?: string
}

interface LivraisonsResponse { data: Livraison[]; total: number }

export function useLivraisons(params?: { statut?: string; search?: string }) {
  const qs = new URLSearchParams()
  if (params?.statut) qs.set('statut', params.statut)
  if (params?.search) qs.set('search', params.search)
  const q = qs.toString()
  return useQuery({
    queryKey: ['livraisons', params],
    queryFn:  () => apiClient.get<LivraisonsResponse>(`/api/logistique/livraisons${q ? `?${q}` : ''}`),
    staleTime: 20_000,
  })
}

export function useCreateLivraison() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: CreateLivraisonPayload) =>
      apiClient.post<Livraison>('/api/logistique/livraisons', payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['livraisons'] })
      toast.success('Livraison créée')
    },
    onError: (err: Error) => toast.error(err.message),
  })
}

export function useUpdateLivraisonStatut() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, statut, date_livraison_reelle, notes }: {
      id: string
      statut: Livraison['statut']
      date_livraison_reelle?: string
      notes?: string
    }) => apiClient.patch<Livraison>(`/api/logistique/livraisons/${id}/statut`, { statut, date_livraison_reelle, notes }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['livraisons'] })
    },
    onError: (err: Error) => toast.error(err.message),
  })
}

// ══════════════════════════════════════════════════════════════════════════════
// MARKETING — CAMPAGNES
// ══════════════════════════════════════════════════════════════════════════════

export interface Campagne {
  id: string
  nom: string
  description?: string
  canal: string
  budget_xaf: number
  reach: number
  leads_count: number
  conversions_count: number
  statut: 'planifie' | 'active' | 'pause' | 'termine' | 'annule'
  date_debut: string
  date_fin: string
  created_at: string
}

export interface CreateCampagnePayload {
  nom: string
  description?: string
  canal: string
  budget_xaf?: number
  date_debut: string
  date_fin: string
}

interface CampagnesResponse { data: Campagne[]; total: number }

export function useCampagnes(params?: { statut?: string; search?: string }) {
  const qs = new URLSearchParams()
  if (params?.statut) qs.set('statut', params.statut)
  if (params?.search) qs.set('search', params.search)
  const q = qs.toString()
  return useQuery({
    queryKey: ['campagnes', params],
    queryFn:  () => apiClient.get<CampagnesResponse>(`/api/marketing/campagnes${q ? `?${q}` : ''}`),
    staleTime: 30_000,
  })
}

export function useCreateCampagne() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: CreateCampagnePayload) =>
      apiClient.post<Campagne>('/api/marketing/campagnes', payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['campagnes'] })
      toast.success('Campagne créée')
    },
    onError: (err: Error) => toast.error(err.message),
  })
}

export function useUpdateCampagneStatut() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, statut, reach, leads_count, conversions_count }: {
      id: string
      statut: Campagne['statut']
      reach?: number
      leads_count?: number
      conversions_count?: number
    }) => apiClient.patch<Campagne>(`/api/marketing/campagnes/${id}/statut`, { statut, reach, leads_count, conversions_count }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['campagnes'] })
    },
    onError: (err: Error) => toast.error(err.message),
  })
}

// ══════════════════════════════════════════════════════════════════════════════
// SÉCURITÉ — INCIDENTS
// ══════════════════════════════════════════════════════════════════════════════

export interface Incident {
  id: string
  type: string
  description: string
  zone: string
  signale_par: string
  statut: 'ouvert' | 'traite' | 'corrige' | 'resolu'
  date_incident: string
  date_resolution?: string
  actions_correctrices?: string
  created_at: string
}

export interface CreateIncidentPayload {
  type: string
  description: string
  zone: string
  signale_par: string
  date_incident: string
}

interface IncidentsResponse { data: Incident[]; total: number }

export function useIncidents(params?: { statut?: string; search?: string }) {
  const qs = new URLSearchParams()
  if (params?.statut) qs.set('statut', params.statut)
  if (params?.search) qs.set('search', params.search)
  const q = qs.toString()
  return useQuery({
    queryKey: ['incidents', params],
    queryFn:  () => apiClient.get<IncidentsResponse>(`/api/securite/incidents${q ? `?${q}` : ''}`),
    staleTime: 30_000,
  })
}

export function useCreateIncident() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: CreateIncidentPayload) =>
      apiClient.post<Incident>('/api/securite/incidents', payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['incidents'] })
      toast.success('Incident signalé')
    },
    onError: (err: Error) => toast.error(err.message),
  })
}

export function useUpdateIncidentStatut() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, statut, date_resolution, actions_correctrices }: {
      id: string
      statut: Incident['statut']
      date_resolution?: string
      actions_correctrices?: string
    }) => apiClient.patch<Incident>(`/api/securite/incidents/${id}/statut`, { statut, date_resolution, actions_correctrices }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['incidents'] })
    },
    onError: (err: Error) => toast.error(err.message),
  })
}
