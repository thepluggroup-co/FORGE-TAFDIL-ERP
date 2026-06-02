import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase'
import {
  dbGetEmployes, dbCreateEmploye,
  dbGetApprenants, dbCreateApprenant,
  dbGetPresences, dbGetBulletins,
  dbGetFormationSessions, dbUpdateStatut,
} from '@/lib/db'
import { useAuth } from '@/context/AuthContext'

// ── Types ──────────────────────────────────────────────────────────────────────

export interface Employe {
  id: string; nom: string; poste: string; departement: string
  type_contrat: 'CDI' | 'CDD' | 'stage' | 'freelance'
  date_entree: string; salaire_base_xaf: number
  statut: 'actif' | 'inactif' | 'conge' | 'essai'
  telephone?: string | null; email?: string | null; cin?: string | null; cnps?: string | null
}
export interface Presence {
  id: string; employe_id: string; employe_nom: string; poste: string; date: string
  heure_arrivee: string | null; heure_depart: string | null; heures_travaillees: number
  statut: 'present' | 'absent' | 'retard' | 'conge' | 'maladie'; notes?: string | null
}
export interface BulletinPaie {
  id: string; employe_id: string; employe_nom: string; poste: string; departement: string; mois: string
  salaire_brut_xaf: number; cnps_salarie_xaf: number; irpp_xaf: number
  salaire_net_xaf: number; cout_employeur_xaf: number
  statut: 'en_attente' | 'brouillon' | 'valide' | 'paye'
}
export interface Apprenant {
  id: string; nom: string; specialite: string; niveau: number; duree_mois: number
  statut: 'actif' | 'suspendu' | 'diplome' | 'recrute'; notes?: string | null
}
export interface FormationSession {
  id: string; module: string; niveau: number
  statut: 'planifiee' | 'en_cours' | 'terminee' | 'annulee'
  date_debut: string | null; date_fin: string | null; formateur: string | null
  lieu: string | null; capacite_max: number; horaires: string[]
  description: string | null; nb_inscrits: number
}
export interface FormationInscription {
  id: string; apprenant_id: string; session_id: string; date_inscription: string
  disponibilites: string[]; nb_seances: number; evaluation: number | null
  statut: 'inscrit' | 'en_cours' | 'termine' | 'abandonne'; notes: string | null
  formation_sessions?: Pick<FormationSession, 'module' | 'niveau' | 'date_debut' | 'date_fin' | 'formateur' | 'lieu'> | null
}
export interface ValidationNiveau {
  id: string; apprenant_id: string; niveau: number
  date_validation: string | null; commentaire: string | null
}
export interface ApprenantHistorique {
  apprenant: Apprenant; validations: ValidationNiveau[]; inscriptions: FormationInscription[]
}
export interface CreateEmployePayload {
  nom: string; poste: string; departement: string; type_contrat: 'CDI' | 'CDD' | 'stage' | 'freelance'
  date_entree: string; salaire_base_xaf: number
  telephone?: string; email?: string; cin?: string; cnps?: string
  statut?: 'actif' | 'inactif' | 'conge' | 'essai'
}
export interface CreateApprenantPayload {
  nom: string; specialite: string; niveau?: number; duree_mois?: number
  statut?: 'actif' | 'suspendu' | 'diplome' | 'recrute'; notes?: string
}
export interface CreateFormationSessionPayload {
  module: string; niveau: number; statut?: FormationSession['statut']
  date_debut?: string; date_fin?: string; formateur?: string; lieu?: string
  capacite_max?: number; horaires?: string[]; description?: string
}
export interface InscrirePayload {
  id: string; session_id: string; disponibilites?: string[]; notes?: string
}
export interface RecruterPayload {
  id: string; poste: string; departement: string
  type_contrat: 'CDI' | 'CDD' | 'stage' | 'freelance'
  date_entree: string; salaire_base_xaf: number; commentaire?: string
}

interface EmployesResponse   { data: Employe[];          total: number }
interface PresencesResponse  { data: Presence[];         total: number }
interface BulletinsResponse  { data: BulletinPaie[];     total: number; mois: string; deja_genere?: boolean }
interface ApprenantsResponse { data: Apprenant[];        total: number }
interface SessionsResponse   { data: FormationSession[]; total: number }

// ── Employés ──────────────────────────────────────────────────────────────────

export function useEmployes(params?: { search?: string; statut?: string }) {
  return useQuery({
    queryKey:  ['employes', params],
    queryFn:   () => dbGetEmployes(params) as Promise<EmployesResponse>,
    staleTime: 60_000,
  })
}

export function useCreateEmploye() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: CreateEmployePayload) => dbCreateEmploye(payload as unknown as Record<string, unknown>),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['employes'] }); toast.success('Employé ajouté') },
    onError:   (err: Error) => toast.error(err.message),
  })
}

// ── Présences ─────────────────────────────────────────────────────────────────

export function usePresences(params?: { date?: string }) {
  return useQuery({
    queryKey:  ['presences', params],
    queryFn:   () => dbGetPresences(params) as Promise<PresencesResponse>,
    staleTime: 30_000,
  })
}

export function useCreatePresence() {
  const qc   = useQueryClient()
  const auth = useAuth()
  return useMutation({
    mutationFn: async (payload: {
      employe_id: string; date: string; arrivee?: string; depart?: string
      statut: Presence['statut']; notes?: string
    }) => {
      let heures = 0
      if (payload.arrivee && payload.depart) {
        const [ah, am] = payload.arrivee.split(':').map(Number)
        const [dh, dm] = payload.depart.split(':').map(Number)
        heures = Math.max(0, (dh * 60 + dm - ah * 60 - am) / 60)
      }
      const { data, error } = await supabase.from('presences')
        .insert({ ...payload, heures: Math.round(heures * 100) / 100, created_by: auth.user?.id })
        .select().single()
      if (error) throw new Error(error.message)
      return data!
    },
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['presences'] }); toast.success('Présence enregistrée') },
    onError:   (err: Error) => toast.error(err.message),
  })
}

// ── Bulletins de paie ─────────────────────────────────────────────────────────

export function useBulletinsPaie(params?: { mois?: string }) {
  return useQuery({
    queryKey:  ['bulletins', params],
    queryFn:   () => dbGetBulletins(params?.mois ?? '') as Promise<BulletinsResponse>,
    staleTime: 60_000,
    enabled:   !!params?.mois,
  })
}

export function useGenererPaie() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ mois }: { mois: string; forcer?: boolean }) => {
      // Déléguer au serveur API pour le calcul CNPS/IRPP
      const { data: session } = await supabase.auth.getSession()
      const token = session.session?.access_token
      const res = await fetch(`${import.meta.env.VITE_API_URL ?? 'http://localhost:3001'}/api/rh/paie`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ mois, generer_pdf: false }),
      })
      if (!res.ok) throw new Error((await res.json()).error ?? 'Erreur génération paie')
      return res.json()
    },
    onSuccess: (_, { mois }) => {
      void qc.invalidateQueries({ queryKey: ['bulletins', { mois }] })
      toast.success('Bulletins de paie générés')
    },
    onError: (err: Error) => toast.error(err.message),
  })
}

export function useUpdateStatutBulletin() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, statut }: { id: string; statut: 'valide' | 'vire' }) =>
      dbUpdateStatut('bulletins_paie', id, statut),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['bulletins'] }); toast.success('Bulletin mis à jour') },
    onError:   (err: Error) => toast.error(err.message),
  })
}

// ── Apprenants ────────────────────────────────────────────────────────────────

export function useApprenants(params?: { statut?: string }) {
  return useQuery({
    queryKey:  ['apprenants', params],
    queryFn:   () => dbGetApprenants(params) as Promise<ApprenantsResponse>,
    staleTime: 60_000,
  })
}

export function useCreateApprenant() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: CreateApprenantPayload) => dbCreateApprenant(payload as unknown as Record<string, unknown>),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['apprenants'] }); toast.success('Apprenant ajouté') },
    onError:   (err: Error) => toast.error(err.message),
  })
}

export function useProgressionApprenant() {
  const qc   = useQueryClient()
  const auth = useAuth()
  return useMutation({
    mutationFn: async ({ id, commentaire }: { id: string; observations?: string; commentaire?: string }) => {
      const { data: a } = await supabase.from('apprenants').select('niveau,statut').eq('id', id).single()
      if (!a) throw new Error('Apprenant introuvable')
      const ap = a as { niveau: number; statut: string }
      if (ap.statut !== 'actif') throw new Error('Apprenant inactif')
      if (ap.niveau >= 5) throw new Error('Niveau maximum atteint (5/5)')
      const nouveauNiveau = ap.niveau + 1
      await supabase.from('validations_niveau').insert({
        apprenant_id: id, niveau: nouveauNiveau,
        valide_by: auth.user?.id, date_validation: new Date().toISOString().slice(0, 10),
        commentaire: commentaire ?? null,
      })
      const { data, error } = await supabase.from('apprenants')
        .update({ niveau: nouveauNiveau, updated_at: new Date().toISOString() }).eq('id', id).select().single()
      if (error) throw new Error(error.message)
      return data!
    },
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['apprenants'] }); toast.success('Niveau validé') },
    onError:   (err: Error) => toast.error(err.message),
  })
}

export function useRecruterApprenant() {
  const qc   = useQueryClient()
  const auth = useAuth()
  return useMutation({
    mutationFn: async ({ id, ...body }: RecruterPayload) => {
      const { data: a } = await supabase.from('apprenants').select('*').eq('id', id).single()
      if (!a) throw new Error('Apprenant introuvable')
      const ap = a as { nom: string; niveau: number; duree_mois: number; statut: string }
      if (ap.statut === 'recrute') throw new Error('Déjà recruté')
      if (ap.niveau < 5) throw new Error(`Niveau insuffisant : ${ap.niveau}/5`)
      if (ap.duree_mois < 6) throw new Error(`Durée insuffisante : ${ap.duree_mois} mois`)
      const { data: emp, error: empErr } = await supabase.from('employes')
        .insert({ nom: ap.nom, ...body, statut: 'actif', created_by: auth.user?.id, sync_status: 'synced' })
        .select().single()
      if (empErr || !emp) throw new Error(empErr?.message ?? 'Erreur création employé')
      await supabase.from('apprenants')
        .update({ statut: 'recrute', employe_id: (emp as { id: string }).id, updated_at: new Date().toISOString() })
        .eq('id', id)
      return emp
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['apprenants'] })
      void qc.invalidateQueries({ queryKey: ['employes'] })
      toast.success('Apprenant recruté comme employé')
    },
    onError: (err: Error) => toast.error(err.message),
  })
}

export function useApprenantHistorique(id: string | null) {
  return useQuery({
    queryKey: ['apprenant-historique', id],
    queryFn: async () => {
      const [{ data: a }, { data: v }, { data: i }] = await Promise.all([
        supabase.from('apprenants').select('*').eq('id', id!).single(),
        supabase.from('validations_niveau').select('*').eq('apprenant_id', id!).order('date_validation'),
        supabase.from('formation_inscriptions').select('*, formation_sessions(module,niveau,date_debut,date_fin,formateur,lieu)').eq('apprenant_id', id!),
      ])
      return { apprenant: a, validations: v ?? [], inscriptions: i ?? [] } as ApprenantHistorique
    },
    enabled: !!id, staleTime: 30_000,
  })
}

// ── Formation sessions ─────────────────────────────────────────────────────────

export function useFormationSessions(params?: { statut?: string; niveau?: number }) {
  return useQuery({
    queryKey:  ['formation-sessions', params],
    queryFn:   () => dbGetFormationSessions(params) as unknown as Promise<SessionsResponse>,
    staleTime: 60_000,
  })
}

export function useCreateFormationSession() {
  const qc   = useQueryClient()
  const auth = useAuth()
  return useMutation({
    mutationFn: async (payload: CreateFormationSessionPayload) => {
      const { data, error } = await supabase.from('formation_sessions')
        .insert({ ...payload, created_by: auth.user?.id }).select().single()
      if (error) throw new Error(error.message)
      return { ...data, nb_inscrits: 0 }
    },
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['formation-sessions'] }); toast.success('Session créée') },
    onError:   (err: Error) => toast.error(err.message),
  })
}

export function useUpdateFormationSession() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, ...body }: Partial<CreateFormationSessionPayload> & { id: string }) => {
      const { data, error } = await supabase.from('formation_sessions')
        .update({ ...body, updated_at: new Date().toISOString() }).eq('id', id).select().single()
      if (error) throw new Error(error.message)
      return data!
    },
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['formation-sessions'] }); toast.success('Session mise à jour') },
    onError:   (err: Error) => toast.error(err.message),
  })
}

export function useDeleteFormationSession() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('formation_sessions').delete().eq('id', id)
      if (error) throw new Error(error.message)
    },
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['formation-sessions'] }); toast.success('Session supprimée') },
    onError:   (err: Error) => toast.error(err.message),
  })
}

export function useInscrireApprenant() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, session_id, disponibilites, notes }: InscrirePayload) => {
      const { data: sess } = await supabase.from('formation_sessions')
        .select('statut,capacite_max').eq('id', session_id).single()
      if (!sess) throw new Error('Session introuvable')
      const s = sess as { statut: string; capacite_max: number }
      if (['terminee','annulee'].includes(s.statut)) throw new Error('Session terminée ou annulée')
      const { count } = await supabase.from('formation_inscriptions')
        .select('*', { count: 'exact', head: true }).eq('session_id', session_id)
      if ((count ?? 0) >= s.capacite_max) throw new Error('Session complète')
      const { data, error } = await supabase.from('formation_inscriptions')
        .insert({ apprenant_id: id, session_id, disponibilites: disponibilites ?? [], notes: notes ?? null })
        .select().single()
      if (error) throw new Error(error.message)
      return data!
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['formation-sessions'] })
      void qc.invalidateQueries({ queryKey: ['apprenants'] })
      toast.success('Inscrit à la session')
    },
    onError: (err: Error) => toast.error(err.message),
  })
}

export interface UpdateInscriptionPayload {
  id: string; statut?: FormationInscription['statut']
  nb_seances?: number; evaluation?: number; notes?: string; disponibilites?: string[]
}

export function useUpdateInscription() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, ...body }: UpdateInscriptionPayload) => {
      const { data, error } = await supabase.from('formation_inscriptions')
        .update({ ...body, updated_at: new Date().toISOString() }).eq('id', id).select().single()
      if (error) throw new Error(error.message)
      return data!
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['formation-sessions'] })
      void qc.invalidateQueries({ queryKey: ['apprenant-historique'] })
      toast.success('Inscription mise à jour')
    },
    onError: (err: Error) => toast.error(err.message),
  })
}
