import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase'
import {
  dbUpdateStatut,
  dbGetProjets, dbGetLivraisons, dbGetCampagnes,
  genererNumero,
} from '@/lib/db'
import { apiClient } from '@/lib/api-client'
import { useAuth } from '@/context/AuthContext'

// ══════════════════════════════════════════════════════════════════════════════
// PRODUCTION — JOBS
// ══════════════════════════════════════════════════════════════════════════════

export interface Job {
  id: string; numero: string; produit_designation: string
  type_job?: 'commande' | 'stock'
  produit_id?: string | null; produit_ref?: string | null
  categorie?: string | null; unite?: string | null
  quantite_prevue?: number | null; quantite_produite?: number | null
  prix_unitaire_xaf?: number | null; prix_public_xaf?: number | null
  publier_shop?: boolean | null; description_produit?: string | null
  machine_nom?: string | null; technicien_nom?: string | null
  avancement_pct: number
  statut: 'confirmed' | 'in_production' | 'pret' | 'delivered' | 'cancelled'
  date_debut?: string | null; date_fin_prevue?: string | null; date_fin_reelle?: string | null
  notes?: string | null; created_at: string; en_retard?: boolean
}
export interface CreateJobPayload {
  type_job?: 'commande' | 'stock'
  commande_id?: string
  produit_id?: string
  produit_ref?: string
  produit_designation: string; machine_nom?: string; technicien_nom?: string
  categorie?: string; unite?: string
  quantite_prevue?: number
  prix_unitaire_xaf?: number
  prix_public_xaf?: number
  publier_shop?: boolean
  description_produit?: string
  date_debut?: string; date_fin_prevue?: string; notes?: string
}
interface JobsResponse { data: Job[]; total: number }

export function useJobs(params?: { statut?: string; search?: string }) {
  return useQuery({
    queryKey:  ['jobs', params],
    queryFn:   () => {
      const query = new URLSearchParams()
      if (params?.statut) query.set('statut', params.statut)
      if (params?.search) query.set('search', params.search)
      const qs = query.toString()
      return apiClient.get<JobsResponse>(`/api/production/jobs${qs ? `?${qs}` : ''}`)
    },
    staleTime: 20_000,
  })
}

export function useCreateJob() {
  const qc   = useQueryClient()
  return useMutation({
    mutationFn: (payload: CreateJobPayload) => apiClient.post<Job>('/api/production/jobs', payload),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['jobs'] }); toast.success('Job créé') },
    onError:   (err: Error) => toast.error(err.message),
  })
}

export function useUpdateJobStatut() {
  const qc   = useQueryClient()
  return useMutation({
    mutationFn: ({ id, statut, avancement_pct, quantite_produite, date_fin_reelle, notes }: {
      id: string; statut: Job['statut']; avancement_pct?: number; quantite_produite?: number; date_fin_reelle?: string; notes?: string
    }) => apiClient.patch<Job>(`/api/production/jobs/${id}/statut`, {
      statut, avancement_pct, quantite_produite, date_fin_reelle, notes,
    }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['jobs'] })
      void qc.invalidateQueries({ queryKey: ['stocks'] })
      void qc.invalidateQueries({ queryKey: ['produits-shop'] })
      void qc.invalidateQueries({ queryKey: ['commandes'] })
      void qc.invalidateQueries({ queryKey: ['factures'] })
    },
    onError:   (err: Error) => toast.error(err.message),
  })
}

export function useUpdateJobAvancement() {
  const qc   = useQueryClient()
  return useMutation({
    mutationFn: ({ id, avancement_pct }: { id: string; avancement_pct: number }) =>
      apiClient.patch<Job>(`/api/production/jobs/${id}/avancement`, { avancement_pct }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['jobs'] })
      void qc.invalidateQueries({ queryKey: ['commandes'] })
    },
    onError: (err: Error) => toast.error(err.message),
  })
}

// ══════════════════════════════════════════════════════════════════════════════
// PROJETS
// ══════════════════════════════════════════════════════════════════════════════

export interface Projet {
  id: string; nom: string; description?: string
  client_id?: string | null; client_nom?: string
  chef_projet_id?: string | null; chef_projet_nom?: string
  assistant_id?: string | null
  budget_xaf: number; depense_xaf: number; avancement_pct: number; alerte_budget?: boolean
  statut: 'planifie' | 'en_cours' | 'suspendu' | 'livre' | 'annule'
  date_debut?: string; deadline?: string; created_at: string
  taches_projet?: Array<{ id: string; titre: string; statut: string; priorite: string; responsable_id?: string | null; date_echeance?: string | null }>
}

export interface ProjetMembre {
  id: string; projet_id: string; employe_id: string; role_projet: string
  heures_planifiees: number; heures_reelles: number
  employes?: { id: string; nom: string; poste: string; departement?: string; telephone?: string } | null
}

export interface ProjetRessource {
  id: string; projet_id: string; type: string; designation: string
  employe_id?: string | null; produit_id?: string | null; equipement_id?: string | null
  quantite: number; unite: string; cout_unitaire_xaf: number
  statut: 'planifie' | 'disponible' | 'en_cours' | 'utilise' | 'manquant'
  notes?: string | null; created_at: string
  employes?: { nom: string; poste: string } | null
  produits?: { designation: string } | null
  equipements?: { code: string; designation: string } | null
}

export interface CreateProjetPayload {
  nom: string; description?: string; client_nom?: string; chef_projet_nom?: string
  client_id?: string; chef_projet_id?: string; budget_xaf?: number; date_debut?: string; deadline?: string
}

export interface AddRessourcePayload {
  type: 'main_oeuvre' | 'intrant' | 'consommable' | 'equipement' | 'sous_traitant'
  designation: string
  employe_id?: string; produit_id?: string; equipement_id?: string
  quantite: number; unite: string; cout_unitaire_xaf: number
  statut?: string; notes?: string
}
interface ProjetsResponse { data: Projet[]; total: number }

export function useProjets(params?: { statut?: string; search?: string }) {
  return useQuery({
    queryKey:  ['projets', params],
    queryFn:   () => dbGetProjets(params) as Promise<ProjetsResponse>,
    staleTime: 30_000,
  })
}

export function useCreateProjet() {
  const qc   = useQueryClient()
  const auth = useAuth()
  return useMutation({
    mutationFn: async (payload: CreateProjetPayload) => {
      let client_nom = payload.client_nom
      if (payload.client_id && !client_nom) {
        const { data: c } = await supabase.from('clients').select('nom').eq('id', payload.client_id).single()
        client_nom = (c as { nom?: string } | null)?.nom
      }

      // Colonnes garanties présentes dans le schéma Supabase actuel.
      // chef_projet_id / assistant_id sont dans une migration séparée non encore appliquée —
      // on ne les passe pas pour éviter "column not found" tant que la migration n'est pas jouée.
      const insertRow: Record<string, unknown> = {
        nom:             payload.nom,
        description:     payload.description     ?? null,
        client_id:       payload.client_id       ?? null,
        client_nom:      client_nom              ?? null,
        chef_projet_nom: payload.chef_projet_nom ?? null,
        budget_xaf:      payload.budget_xaf      ?? 0,
        date_debut:      payload.date_debut      ?? null,
        deadline:        payload.deadline        ?? null,
        created_by:      auth.user?.id,
        sync_status:     'synced',
      }

      const { data, error } = await supabase.from('projets')
        .insert(insertRow)
        .select().single()
      if (error) throw new Error(error.message)
      return data!
    },
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['projets'] }); toast.success('Projet créé') },
    onError:   (err: Error) => toast.error(err.message),
  })
}

export function useUpdateProjetStatut() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, statut, avancement_pct, depense_xaf }: {
      id: string; statut: Projet['statut']; avancement_pct?: number; depense_xaf?: number
    }) => dbUpdateStatut('projets', id, statut, { avancement_pct, depense_xaf }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['projets'] }),
    onError:   (err: Error) => toast.error(err.message),
  })
}

export function useProjetById(id: string | null) {
  return useQuery({
    queryKey:  ['projets', id],
    queryFn:   () => apiClient.get<Projet>(`/api/projets/${id}`),
    staleTime: 30_000,
    enabled:   !!id,
  })
}

// ── Tâches projet ─────────────────────────────────────────────────────────────

export interface ProjetTache {
  id: string; projet_id: string; titre: string; description?: string
  responsable_id?: string | null; statut: 'todo' | 'en_cours' | 'done' | 'bloque'
  priorite: 'basse' | 'normale' | 'haute' | 'critique'
  date_echeance?: string | null; created_at: string; updated_at: string
}

export function useAddTacheProjet() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ projetId, payload }: {
      projetId: string
      payload: { titre: string; description?: string; responsable_id?: string; priorite?: string; date_echeance?: string }
    }) => apiClient.post<ProjetTache>(`/api/projets/${projetId}/taches`, payload),
    onSuccess: (_, vars) => {
      void qc.invalidateQueries({ queryKey: ['projets', vars.projetId] })
      void qc.invalidateQueries({ queryKey: ['projets'] })
      toast.success('Tâche ajoutée')
    },
    onError: (err: Error) => toast.error(err.message),
  })
}

export function useUpdateTacheStatut() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ projetId, tacheId, statut }: { projetId: string; tacheId: string; statut: string }) =>
      apiClient.patch<ProjetTache>(`/api/projets/${projetId}/taches/${tacheId}/statut`, { statut }),
    onSuccess: (_, vars) => {
      void qc.invalidateQueries({ queryKey: ['projets', vars.projetId] })
      void qc.invalidateQueries({ queryKey: ['projets'] })
    },
    onError: (err: Error) => toast.error(err.message),
  })
}

// ── Membres projet ─────────────────────────────────────────────────────────────

export function useProjetMembres(projetId: string | null) {
  return useQuery({
    queryKey:  ['projets', projetId, 'membres'],
    queryFn:   () => apiClient.get<{ data: ProjetMembre[]; total: number }>(`/api/projets/${projetId}/membres`),
    staleTime: 30_000,
    enabled:   !!projetId,
  })
}

export function useAddMembreProjet() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ projetId, employe_id, role_projet, heures_planifiees }: {
      projetId: string; employe_id: string; role_projet: string; heures_planifiees?: number
    }) => apiClient.post<ProjetMembre>(`/api/projets/${projetId}/membres`, { employe_id, role_projet, heures_planifiees }),
    onSuccess: (_, vars) => {
      void qc.invalidateQueries({ queryKey: ['projets', vars.projetId, 'membres'] })
      void qc.invalidateQueries({ queryKey: ['projets'] })
      toast.success('Membre ajouté')
    },
    onError: (err: Error) => toast.error(err.message),
  })
}

export function useRemoveMembreProjet() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ projetId, employeId }: { projetId: string; employeId: string }) =>
      apiClient.delete<void>(`/api/projets/${projetId}/membres/${employeId}`),
    onSuccess: (_, vars) => {
      void qc.invalidateQueries({ queryKey: ['projets', vars.projetId, 'membres'] })
      toast.success('Membre retiré')
    },
    onError: (err: Error) => toast.error(err.message),
  })
}

// ── Ressources projet ──────────────────────────────────────────────────────────

export function useProjetRessources(projetId: string | null) {
  return useQuery({
    queryKey:  ['projets', projetId, 'ressources'],
    queryFn:   () => apiClient.get<{ data: ProjetRessource[]; total: number; total_cout_xaf: number }>(
      `/api/projets/${projetId}/ressources`
    ),
    staleTime: 30_000,
    enabled:   !!projetId,
  })
}

export function useAddRessourceProjet() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ projetId, payload }: { projetId: string; payload: AddRessourcePayload }) =>
      apiClient.post<ProjetRessource>(`/api/projets/${projetId}/ressources`, payload),
    onSuccess: (_, vars) => {
      void qc.invalidateQueries({ queryKey: ['projets', vars.projetId, 'ressources'] })
      void qc.invalidateQueries({ queryKey: ['projets'] })
      toast.success('Ressource ajoutée')
    },
    onError: (err: Error) => toast.error(err.message),
  })
}

export function useUpdateRessourceStatut() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ projetId, ressourceId, statut }: { projetId: string; ressourceId: string; statut: string }) =>
      apiClient.patch<ProjetRessource>(`/api/projets/${projetId}/ressources/${ressourceId}/statut`, { statut }),
    onSuccess: (_, vars) => {
      void qc.invalidateQueries({ queryKey: ['projets', vars.projetId, 'ressources'] })
      void qc.invalidateQueries({ queryKey: ['projets'] })
    },
    onError: (err: Error) => toast.error(err.message),
  })
}

export function useDeleteRessourceProjet() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ projetId, ressourceId }: { projetId: string; ressourceId: string }) =>
      apiClient.delete<void>(`/api/projets/${projetId}/ressources/${ressourceId}`),
    onSuccess: (_, vars) => {
      void qc.invalidateQueries({ queryKey: ['projets', vars.projetId, 'ressources'] })
      toast.success('Ressource supprimée')
    },
    onError: (err: Error) => toast.error(err.message),
  })
}

// ══════════════════════════════════════════════════════════════════════════════
// LIVRAISONS
// ══════════════════════════════════════════════════════════════════════════════

export interface Livraison {
  id: string; numero: string; client_nom: string; destination: string
  transporteur?: string; client_id?: string
  statut: 'confirmed' | 'in_production' | 'pret' | 'delivered' | 'cancelled'
  date_depart?: string; date_livraison_prevue?: string; date_livraison_reelle?: string
  notes?: string; created_at: string
}
export interface CreateLivraisonPayload {
  client_nom: string; destination: string; transporteur?: string
  client_id?: string; commande_id?: string
  date_depart?: string; date_livraison_prevue?: string; notes?: string
}
interface LivraisonsResponse { data: Livraison[]; total: number }

export function useLivraisons(params?: { statut?: string; search?: string }) {
  return useQuery({
    queryKey:  ['livraisons', params],
    queryFn:   () => dbGetLivraisons(params) as Promise<LivraisonsResponse>,
    staleTime: 20_000,
  })
}

export function useCreateLivraison() {
  const qc   = useQueryClient()
  const auth = useAuth()
  return useMutation({
    mutationFn: async (payload: CreateLivraisonPayload) => {
      const numero = await genererNumero('livraisons', 'LIV')
      let { client_nom, client_id } = payload
      if (payload.commande_id) {
        const { data: cmd } = await supabase.from('commandes')
          .select('client_id,client_nom').eq('id', payload.commande_id).single()
        if (cmd) {
          const c = cmd as { client_id: string | null; client_nom: string }
          client_id  = client_id  ?? c.client_id ?? undefined
          client_nom = client_nom ?? c.client_nom
        }
      }
      const { data, error } = await supabase.from('livraisons')
        .insert({ ...payload, numero, client_id: client_id ?? null, client_nom, created_by: auth.user?.id, sync_status: 'synced' })
        .select().single()
      if (error) throw new Error(error.message)
      return data!
    },
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['livraisons'] }); toast.success('Livraison créée') },
    onError:   (err: Error) => toast.error(err.message),
  })
}

export function useUpdateLivraisonStatut() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, statut, date_livraison_reelle }: {
      id: string; statut: Livraison['statut']; date_livraison_reelle?: string; notes?: string
    }) => {
      const extra: Record<string, unknown> = {}
      if (statut === 'delivered')
        extra.date_livraison_reelle = date_livraison_reelle ?? new Date().toISOString().slice(0, 10)
      const data = await dbUpdateStatut('livraisons', id, statut, Object.keys(extra).length ? extra : undefined)
      // Auto-transition commande si livraison complétée
      if (statut === 'delivered') {
        const liv = data as { commande_id?: string } | null
        if (liv?.commande_id) {
          const { data: cmd } = await supabase.from('commandes').select('statut').eq('id', liv.commande_id).single()
          if (cmd && (cmd as { statut: string }).statut === 'pret') {
            await supabase.from('commandes').update({ statut: 'delivered', updated_at: new Date().toISOString() }).eq('id', liv.commande_id)
          }
        }
      }
      return data
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['livraisons'] }),
    onError:   (err: Error) => toast.error(err.message),
  })
}

// ══════════════════════════════════════════════════════════════════════════════
// MARKETING — CAMPAGNES
// ══════════════════════════════════════════════════════════════════════════════

export interface Campagne {
  id: string; nom: string; description?: string; canal: string
  budget_xaf: number; reach: number; leads_count: number; conversions_count: number
  statut: 'planifie' | 'active' | 'pause' | 'termine' | 'annule'
  date_debut: string; date_fin: string; created_at: string
}
export interface CreateCampagnePayload {
  nom: string; description?: string; canal: string; budget_xaf?: number
  date_debut: string; date_fin: string
}
interface CampagnesResponse { data: Campagne[]; total: number }

export function useCampagnes(params?: { statut?: string; search?: string }) {
  return useQuery({
    queryKey:  ['campagnes', params],
    queryFn:   () => dbGetCampagnes(params) as Promise<CampagnesResponse>,
    staleTime: 30_000,
  })
}

export function useCreateCampagne() {
  const qc   = useQueryClient()
  const auth = useAuth()
  return useMutation({
    mutationFn: async (payload: CreateCampagnePayload) => {
      const { data, error } = await supabase.from('campagnes_marketing')
        .insert({ ...payload, created_by: auth.user?.id, sync_status: 'synced' }).select().single()
      if (error) throw new Error(error.message)
      return data!
    },
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['campagnes'] }); toast.success('Campagne créée') },
    onError:   (err: Error) => toast.error(err.message),
  })
}

export function useUpdateCampagneStatut() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, statut, reach, leads_count, conversions_count }: {
      id: string; statut: Campagne['statut']; reach?: number; leads_count?: number; conversions_count?: number
    }) => dbUpdateStatut('campagnes_marketing', id, statut, { reach, leads_count, conversions_count }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['campagnes'] }),
    onError:   (err: Error) => toast.error(err.message),
  })
}

// ══════════════════════════════════════════════════════════════════════════════
// SÉCURITÉ — INCIDENTS
// ══════════════════════════════════════════════════════════════════════════════

export interface Incident {
  id: string; type: string; description: string; zone: string; signale_par: string
  statut: 'ouvert' | 'traite' | 'corrige' | 'resolu'
  date_incident: string; date_resolution?: string; actions_correctives?: string; created_at: string
}
export interface CreateIncidentPayload {
  type: string; description: string; zone: string; signale_par: string; date_incident: string
}
interface IncidentsResponse { data: Incident[]; total: number }

export function useIncidents(params?: { statut?: string; search?: string }) {
  return useQuery({
    queryKey: ['incidents', params],
    queryFn: async () => {
      let q = supabase.from('incidents_securite').select('*', { count: 'exact' })
      if (params?.statut) q = q.eq('statut', params.statut)
      if (params?.search) q = q.ilike('description', `%${params.search}%`)
      const { data, count, error } = await q.order('created_at', { ascending: false })
      if (error) throw new Error(error.message)
      return { data: data ?? [], total: count ?? 0 } as IncidentsResponse
    },
    staleTime: 30_000,
  })
}

export function useCreateIncident() {
  const qc   = useQueryClient()
  const auth = useAuth()
  return useMutation({
    mutationFn: async (payload: CreateIncidentPayload) => {
      const { data, error } = await supabase.from('incidents_securite')
        .insert({ ...payload, statut: 'ouvert', created_by: auth.user?.id, sync_status: 'synced' })
        .select().single()
      if (error) throw new Error(error.message)
      return data!
    },
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['incidents'] }); toast.success('Incident signalé') },
    onError:   (err: Error) => toast.error(err.message),
  })
}

export function useUpdateIncidentStatut() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, statut, date_resolution, actions_correctrices }: {
      id: string; statut: Incident['statut']; date_resolution?: string; actions_correctrices?: string
    }) => dbUpdateStatut('incidents_securite', id, statut, {
      date_resolution: date_resolution ?? (statut === 'resolu' ? new Date().toISOString().slice(0, 10) : undefined),
      actions_correctrices,
    }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['incidents'] }),
    onError:   (err: Error) => toast.error(err.message),
  })
}
