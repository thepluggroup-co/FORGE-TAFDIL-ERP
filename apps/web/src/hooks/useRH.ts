import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { apiClient } from '@/lib/api-client'

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
  salaire_base_xaf: number; heures_sup_xaf: number; primes_xaf: number; deductions_xaf: number
  avance_deduite_xaf: number; retenue_deduite_xaf: number; salaire_brut_xaf: number; cnps_salarie_xaf: number; cnps_employeur_xaf: number; irpp_xaf: number
  salaire_net_xaf: number; cout_employeur_xaf: number
  pdf_url?: string | null; pdf_generated_at?: string | null
  statut: 'en_attente' | 'valide' | 'vire'
}
export interface AvanceSalaire {
  id: string; employe_id: string; employe_nom: string; poste: string; departement: string
  sortie_id: string | null; date_avance: string; mois_deduction: string
  montant_xaf: number; montant_deduit_xaf: number
  statut: 'payee' | 'deduite' | 'annulee'
  mode_paiement: 'caisse' | 'banque' | 'mobile_money'
  compte_tresorerie: '571' | '521'
  reference_paiement?: string | null; motif?: string | null; notes?: string | null; created_at: string
}
export interface RetenueSalaire {
  id: string; employe_id: string; employe_nom: string; poste: string; departement: string
  mois_deduction: string; type: 'absence' | 'materiel' | 'pret_interne' | 'discipline' | 'autre'
  libelle: string; montant_xaf: number; montant_deduit_xaf: number
  statut: 'active' | 'deduite' | 'annulee'
  notes?: string | null; created_at: string
}
export interface CotisationSociale {
  id?: string; mois: string; nb_bulletins: number
  total_brut_xaf: number; cnps_salarie_xaf: number; cnps_employeur_xaf: number; total_cnps_xaf: number
  irpp_xaf: number; total_avances_deduites_xaf: number; total_retenues_deduites_xaf: number
  net_a_payer_xaf: number; cout_total_employeur_xaf: number
  statut: 'calculee' | 'validee' | 'payee'
}
export interface PaiePeriode {
  id: string; mois: string; sortie_id?: string | null
  statut: 'calculee' | 'validee' | 'viree'
  nb_bulletins: number; total_brut_xaf: number
  cnps_salarie_xaf: number; cnps_employeur_xaf: number; irpp_xaf: number
  total_avances_deduites_xaf: number; total_retenues_deduites_xaf: number; total_autres_deductions_xaf: number
  net_a_payer_xaf: number; cout_total_employeur_xaf: number
  mode_paiement?: 'caisse' | 'banque' | 'mobile_money' | null
  compte_tresorerie?: '571' | '521' | null
  reference_paiement?: string | null
}
export interface ControlePaie {
  mois: string
  statut_global: 'ok' | 'warning' | 'error'
  totaux: {
    nb_bulletins: number
    total_brut_xaf: number
    cnps_salarie_xaf: number
    cnps_employeur_xaf: number
    irpp_xaf: number
    total_avances_deduites_xaf: number
    total_retenues_deduites_xaf: number
    total_autres_deductions_xaf: number
    net_a_payer_xaf: number
    cout_total_employeur_xaf: number
  }
  controles: Array<{
    code: string
    niveau: 'ok' | 'warning' | 'error'
    message: string
    attendu?: number
    observe?: number
  }>
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
export interface CreateAvanceSalairePayload {
  employe_id: string; date_avance: string; mois_deduction: string; montant_xaf: number
  mode_paiement: 'caisse' | 'banque' | 'mobile_money'
  compte_tresorerie?: '571' | '521'
  reference_paiement?: string; motif?: string; notes?: string
}
export interface CreateRetenueSalairePayload {
  employe_id: string; mois_deduction: string
  type: 'absence' | 'materiel' | 'pret_interne' | 'discipline' | 'autre'
  libelle: string; montant_xaf: number; notes?: string
}

export interface Conge {
  id: string; employe_id: string; type: string
  date_debut: string; date_fin: string; jours_ouvres: number
  statut: 'en_attente' | 'approuve' | 'refuse' | 'annule'
  motif?: string | null; commentaire_rh?: string | null
  approuve_par?: string | null; approuve_at?: string | null
  created_at: string
  employes?: { nom: string; poste: string; departement: string } | null
}
export interface SoldeConge {
  employe_id: string; employe_nom: string
  jours_acquis: number; jours_pris: number; jours_restants: number
}
export interface CreateCongePayload {
  employe_id: string; type: string
  date_debut: string; date_fin: string; jours_ouvres: number; motif?: string
}

interface EmployesResponse   { data: Employe[];          total: number }
interface PresencesResponse  { data: Presence[];         total: number }
interface BulletinsResponse  { data: BulletinPaie[];     total: number; mois: string; deja_genere?: boolean }
interface AvancesSalaireResponse { data: AvanceSalaire[]; total: number; total_xaf: number }
interface RetenuesSalaireResponse { data: RetenueSalaire[]; total: number; total_xaf: number }
interface PaiePeriodesResponse { data: PaiePeriode[]; total: number }
interface ApprenantsResponse { data: Apprenant[];        total: number }
interface SessionsResponse   { data: FormationSession[]; total: number }
interface CongesResponse     { data: Conge[];            total: number }

// ── Employés ──────────────────────────────────────────────────────────────────

export function useEmployes(params?: { search?: string; statut?: string }) {
  return useQuery({
    queryKey:  ['employes', params],
    queryFn:   () => {
      const entries = Object.entries(params ?? {}).filter(([, v]) => v) as [string, string][]
      const qs = entries.length ? '?' + new URLSearchParams(entries).toString() : ''
      return apiClient.get<EmployesResponse>(`/api/rh/employes${qs}`)
    },
    staleTime: 60_000,
  })
}

export function useCreateEmploye() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: CreateEmployePayload) =>
      apiClient.post<Employe>('/api/rh/employes', payload),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['employes'] }); toast.success('Employé ajouté') },
    onError:   (err: Error) => toast.error(err.message),
  })
}

// ── Présences ─────────────────────────────────────────────────────────────────

export function usePresences(params?: { date?: string; employe_id?: string }) {
  return useQuery({
    queryKey:  ['presences', params],
    queryFn:   () => {
      const entries = Object.entries(params ?? {}).filter(([, v]) => v) as [string, string][]
      const qs = entries.length ? '?' + new URLSearchParams(entries).toString() : ''
      return apiClient.get<PresencesResponse>(`/api/rh/presences${qs}`)
    },
    staleTime: 30_000,
  })
}

export function useCreatePresence() {
  const qc = useQueryClient()
  return useMutation({
    // heures est recalculé côté API depuis arrivee/depart (apps/api/src/routes/rh.ts) —
    // même formule, plus besoin de la dupliquer ici.
    mutationFn: (payload: {
      employe_id: string; date: string; arrivee?: string; depart?: string
      statut: Presence['statut']; notes?: string
    }) => apiClient.post<Presence>('/api/rh/presences', payload),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['presences'] }); toast.success('Présence enregistrée') },
    onError:   (err: Error) => toast.error(err.message),
  })
}

// ── Bulletins de paie ─────────────────────────────────────────────────────────

export function useBulletinsPaie(params?: { mois?: string }) {
  return useQuery({
    queryKey:  ['bulletins', params],
    queryFn:   () => apiClient.get<BulletinsResponse>(`/api/rh/paie?mois=${params?.mois ?? ''}`),
    staleTime: 60_000,
    enabled:   !!params?.mois,
  })
}

export function useGenererPaie() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ mois, forcer }: { mois: string; forcer?: boolean }) =>
      apiClient.post<{ data: BulletinPaie[]; total: number; mois: string }>(
        '/api/rh/paie',
        { mois, generer_pdf: false, forcer: forcer ?? false },
        60_000,  // 60s — la génération fait N requêtes Supabase (une par employé)
      ),
    onSuccess: (_, { mois }) => {
      void qc.invalidateQueries({ queryKey: ['bulletins', { mois }] })
      void qc.invalidateQueries({ queryKey: ['bulletins'] })
      void qc.invalidateQueries({ queryKey: ['avances-salaire'] })
      void qc.invalidateQueries({ queryKey: ['retenues-salaire'] })
      void qc.invalidateQueries({ queryKey: ['controle-paie', mois] })
      void qc.invalidateQueries({ queryKey: ['paie-periodes', mois] })
      void qc.invalidateQueries({ queryKey: ['cotisations-sociales', mois] })
      toast.success('Paie mensuelle recalculée')
    },
    onError: (err: Error) => toast.error(err.message),
  })
}

export function useUpdateStatutBulletin() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, statut }: { id: string; statut: 'valide' | 'vire' }) =>
      apiClient.patch<BulletinPaie>(`/api/rh/paie/${id}/statut`, { statut }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['bulletins'] }); toast.success('Bulletin mis à jour') },
    onError:   (err: Error) => toast.error(err.message),
  })
}

export function useAvancesSalaire(params?: { mois?: string; employe_id?: string; statut?: string }) {
  return useQuery({
    queryKey: ['avances-salaire', params],
    queryFn:  () => {
      const entries = Object.entries(params ?? {}).filter(([, v]) => v) as [string, string][]
      const qs = entries.length ? '?' + new URLSearchParams(entries).toString() : ''
      return apiClient.get<AvancesSalaireResponse>(`/api/rh/avances-salaire${qs}`)
    },
    staleTime: 60_000,
  })
}

export function useCreateAvanceSalaire() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: CreateAvanceSalairePayload) =>
      apiClient.post<AvanceSalaire>('/api/rh/avances-salaire', payload),
    onSuccess: (_, payload) => {
      void qc.invalidateQueries({ queryKey: ['avances-salaire'] })
      void qc.invalidateQueries({ queryKey: ['bulletins', { mois: payload.mois_deduction }] })
      void qc.invalidateQueries({ queryKey: ['bulletins'] })
      void qc.invalidateQueries({ queryKey: ['controle-paie', payload.mois_deduction] })
      void qc.invalidateQueries({ queryKey: ['paie-periodes', payload.mois_deduction] })
      void qc.invalidateQueries({ queryKey: ['cotisations-sociales', payload.mois_deduction] })
      toast.success('Avance enregistrée. Recalculez la paie du mois pour la déduire.')
    },
    onError: (err: Error) => toast.error(err.message),
  })
}

export function useAnnulerAvanceSalaire() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      apiClient.patch<AvanceSalaire>(`/api/rh/avances-salaire/${id}/annuler`, {}),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['avances-salaire'] })
      void qc.invalidateQueries({ queryKey: ['bulletins'] })
      void qc.invalidateQueries({ queryKey: ['controle-paie'] })
      toast.success('Avance annulée')
    },
    onError: (err: Error) => toast.error(err.message),
  })
}

export function useRetenuesSalaire(params?: { mois?: string; employe_id?: string; statut?: string }) {
  return useQuery({
    queryKey: ['retenues-salaire', params],
    queryFn:  () => {
      const entries = Object.entries(params ?? {}).filter(([, v]) => v) as [string, string][]
      const qs = entries.length ? '?' + new URLSearchParams(entries).toString() : ''
      return apiClient.get<RetenuesSalaireResponse>(`/api/rh/retenues-salaire${qs}`)
    },
    staleTime: 60_000,
  })
}

export function useCreateRetenueSalaire() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: CreateRetenueSalairePayload) =>
      apiClient.post<RetenueSalaire>('/api/rh/retenues-salaire', payload),
    onSuccess: (_, payload) => {
      void qc.invalidateQueries({ queryKey: ['retenues-salaire'] })
      void qc.invalidateQueries({ queryKey: ['bulletins', { mois: payload.mois_deduction }] })
      void qc.invalidateQueries({ queryKey: ['bulletins'] })
      void qc.invalidateQueries({ queryKey: ['controle-paie', payload.mois_deduction] })
      void qc.invalidateQueries({ queryKey: ['paie-periodes', payload.mois_deduction] })
      void qc.invalidateQueries({ queryKey: ['cotisations-sociales', payload.mois_deduction] })
      toast.success('Retenue enregistrée. Recalculez la paie du mois pour la déduire.')
    },
    onError: (err: Error) => toast.error(err.message),
  })
}

export function useAnnulerRetenueSalaire() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      apiClient.patch<RetenueSalaire>(`/api/rh/retenues-salaire/${id}/annuler`, {}),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['retenues-salaire'] })
      void qc.invalidateQueries({ queryKey: ['bulletins'] })
      void qc.invalidateQueries({ queryKey: ['controle-paie'] })
      toast.success('Retenue annulée')
    },
    onError: (err: Error) => toast.error(err.message),
  })
}

export function useCotisationsSociales(mois?: string) {
  return useQuery({
    queryKey: ['cotisations-sociales', mois],
    queryFn:  () => apiClient.get<CotisationSociale>(`/api/rh/cotisations-sociales?mois=${mois ?? ''}`),
    enabled:  !!mois,
    staleTime: 60_000,
  })
}

export function useGenererCotisationsSociales() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (mois: string) =>
      apiClient.post<CotisationSociale>('/api/rh/cotisations-sociales', { mois }),
    onSuccess: (_, mois) => {
      void qc.invalidateQueries({ queryKey: ['cotisations-sociales', mois] })
      toast.success('Cotisations sociales calculées')
    },
    onError: (err: Error) => toast.error(err.message),
  })
}

export function useUpdateStatutCotisationsSociales() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, statut }: { id: string; statut: 'validee' | 'payee' }) =>
      apiClient.patch<CotisationSociale>(`/api/rh/cotisations-sociales/${id}/statut`, { statut }),
    onSuccess: (data) => {
      void qc.invalidateQueries({ queryKey: ['cotisations-sociales', data.mois] })
      toast.success('Cotisations mises à jour')
    },
    onError: (err: Error) => toast.error(err.message),
  })
}

export function usePaiePeriode(mois?: string) {
  return useQuery({
    queryKey: ['paie-periodes', mois],
    queryFn:  async () => {
      const res = await apiClient.get<PaiePeriodesResponse>(`/api/rh/paie-periodes?mois=${mois ?? ''}`)
      return res.data[0] ?? null
    },
    enabled: !!mois,
    staleTime: 60_000,
  })
}

export function useValiderPaieMois() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (mois: string) =>
      apiClient.post<PaiePeriode>(`/api/rh/paie/${mois}/valider`, {}),
    onSuccess: (_, mois) => {
      void qc.invalidateQueries({ queryKey: ['paie-periodes', mois] })
      void qc.invalidateQueries({ queryKey: ['bulletins', { mois }] })
      void qc.invalidateQueries({ queryKey: ['bulletins'] })
      void qc.invalidateQueries({ queryKey: ['cotisations-sociales', mois] })
      void qc.invalidateQueries({ queryKey: ['controle-paie', mois] })
      toast.success('Paie mensuelle validée')
    },
    onError: (err: Error) => toast.error(err.message),
  })
}

export function useVirerPaieMois() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ mois, mode_paiement, reference_paiement }: {
      mois: string
      mode_paiement: 'caisse' | 'banque' | 'mobile_money'
      reference_paiement?: string
    }) =>
      apiClient.post<PaiePeriode>(`/api/rh/paie/${mois}/virer`, { mode_paiement, reference_paiement }),
    onSuccess: (_, payload) => {
      void qc.invalidateQueries({ queryKey: ['paie-periodes', payload.mois] })
      void qc.invalidateQueries({ queryKey: ['bulletins', { mois: payload.mois }] })
      void qc.invalidateQueries({ queryKey: ['bulletins'] })
      void qc.invalidateQueries({ queryKey: ['controle-paie', payload.mois] })
      toast.success('Paiement de paie enregistré')
    },
    onError: (err: Error) => toast.error(err.message),
  })
}

export function useControlePaie(mois?: string) {
  return useQuery({
    queryKey: ['controle-paie', mois],
    queryFn:  () => apiClient.get<ControlePaie>(`/api/rh/paie/${mois ?? ''}/controle`),
    enabled:  !!mois,
    staleTime: 30_000,
  })
}

export function useExportPaie() {
  return useMutation({
    mutationFn: async (mois: string) => {
      const blob = await apiClient.getBlob(`/api/rh/paie/${mois}/export`)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `paie-${mois}.csv`
      a.click()
      URL.revokeObjectURL(url)
      return mois
    },
    onSuccess: () => toast.success('Export paie téléchargé'),
    onError: (err: Error) => toast.error(err.message),
  })
}

// ── Apprenants ────────────────────────────────────────────────────────────────

export function useApprenants(params?: { statut?: string }) {
  return useQuery({
    queryKey:  ['apprenants', params],
    queryFn:   () => {
      const qs = params?.statut ? `?statut=${encodeURIComponent(params.statut)}` : ''
      return apiClient.get<ApprenantsResponse>(`/api/rh/apprenants${qs}`)
    },
    staleTime: 60_000,
  })
}

export function useCreateApprenant() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: CreateApprenantPayload) => apiClient.post<Apprenant>('/api/rh/apprenants', payload),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['apprenants'] }); toast.success('Apprenant ajouté') },
    onError:   (err: Error) => toast.error(err.message),
  })
}

export function useProgressionApprenant() {
  const qc = useQueryClient()
  return useMutation({
    // Règles (niveau actif, max 5/5) revalidées côté API — apps/api/src/routes/rh.ts.
    mutationFn: ({ id, commentaire }: { id: string; observations?: string; commentaire?: string }) =>
      apiClient.post<Apprenant>(`/api/rh/apprenants/${id}/progression`, { commentaire }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['apprenants'] }); toast.success('Niveau validé') },
    onError:   (err: Error) => toast.error(err.message),
  })
}

export function useRecruterApprenant() {
  const qc = useQueryClient()
  return useMutation({
    // Règles (niveau 5/5, 6 mois min, création employé + statut='recrute')
    // revalidées et exécutées côté API.
    mutationFn: ({ id, ...body }: RecruterPayload) => apiClient.post<Employe>(`/api/rh/apprenants/${id}/recruter`, body),
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
    queryFn:  () => apiClient.get<ApprenantHistorique>(`/api/rh/apprenants/${id}/historique`),
    enabled: !!id, staleTime: 30_000,
  })
}

// ── Formation sessions ─────────────────────────────────────────────────────────

export function useFormationSessions(params?: { statut?: string; niveau?: number }) {
  return useQuery({
    queryKey:  ['formation-sessions', params],
    queryFn:   () => {
      const qs = new URLSearchParams()
      if (params?.statut)  qs.set('statut', params.statut)
      if (params?.niveau)  qs.set('niveau', String(params.niveau))
      const q = qs.toString()
      return apiClient.get<SessionsResponse>(`/api/rh/formation/sessions${q ? `?${q}` : ''}`)
    },
    staleTime: 60_000,
  })
}

export function useCreateFormationSession() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: CreateFormationSessionPayload) =>
      apiClient.post<FormationSession>('/api/rh/formation/sessions', payload),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['formation-sessions'] }); toast.success('Session créée') },
    onError:   (err: Error) => toast.error(err.message),
  })
}

export function useUpdateFormationSession() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...body }: Partial<CreateFormationSessionPayload> & { id: string }) =>
      apiClient.put<FormationSession>(`/api/rh/formation/sessions/${id}`, body),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['formation-sessions'] }); toast.success('Session mise à jour') },
    onError:   (err: Error) => toast.error(err.message),
  })
}

export function useDeleteFormationSession() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiClient.delete(`/api/rh/formation/sessions/${id}`),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['formation-sessions'] }); toast.success('Session supprimée') },
    onError:   (err: Error) => toast.error(err.message),
  })
}

export function useInscrireApprenant() {
  const qc = useQueryClient()
  return useMutation({
    // Capacité/statut de session revalidés côté API (apps/api/src/routes/rh.ts).
    mutationFn: ({ id, session_id, disponibilites, notes }: InscrirePayload) =>
      apiClient.post<FormationInscription>(`/api/rh/apprenants/${id}/inscrire`, { session_id, disponibilites, notes }),
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

// ── Congés ────────────────────────────────────────────────────────────────────

export function useConges(params?: { employe_id?: string; statut?: string; mois?: string }) {
  return useQuery({
    queryKey:  ['conges', params],
    queryFn:   () => {
      const entries = Object.entries(params ?? {}).filter(([, v]) => v) as [string, string][]
      const qs = entries.length ? '?' + new URLSearchParams(entries).toString() : ''
      return apiClient.get<CongesResponse>(`/api/rh/conges${qs}`)
    },
    staleTime: 30_000,
  })
}

export function useSoldesConges() {
  return useQuery({
    queryKey: ['conges-soldes'],
    queryFn:  () => apiClient.get<{ data: SoldeConge[] }>('/api/rh/conges/soldes'),
    staleTime: 5 * 60_000,
  })
}

export function useCreateConge() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: CreateCongePayload) =>
      apiClient.post<Conge>('/api/rh/conges', payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['conges'] })
      void qc.invalidateQueries({ queryKey: ['conges-soldes'] })
      toast.success('Demande de congé enregistrée')
    },
    onError: (err: Error) => toast.error(err.message),
  })
}

export function useApprouverConge() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, statut, commentaire_rh }: { id: string; statut: 'approuve' | 'refuse' | 'annule'; commentaire_rh?: string }) =>
      apiClient.patch<Conge>(`/api/rh/conges/${id}/statut`, { statut, commentaire_rh }),
    onSuccess: (_, { statut }) => {
      void qc.invalidateQueries({ queryKey: ['conges'] })
      void qc.invalidateQueries({ queryKey: ['conges-soldes'] })
      void qc.invalidateQueries({ queryKey: ['employes'] })
      toast.success(statut === 'approuve' ? 'Congé approuvé' : statut === 'refuse' ? 'Congé refusé' : 'Congé annulé')
    },
    onError: (err: Error) => toast.error(err.message),
  })
}

// ── Pointage batch ────────────────────────────────────────────────────────────

export function usePresenceBatch() {
  const qc = useQueryClient()
  return useMutation({
    // Pas d'endpoint batch dédié côté API : on réutilise GET /rh/presences
    // (lookup des lignes déjà enregistrées ce jour-là) puis un POST ou PUT
    // unitaire par employé, en parallèle. heures est recalculé côté API.
    mutationFn: async (lignes: Array<{
      employe_id: string; date: string; arrivee?: string; depart?: string
      statut: Presence['statut']; notes?: string; heures?: number
    }>) => {
      if (lignes.length === 0) return 0
      const date = lignes[0].date

      const existing = await apiClient.get<PresencesResponse>(`/api/rh/presences?date=${date}`)
      const existingMap = new Map(existing.data.map((p) => [p.employe_id, p.id]))

      await Promise.all(lignes.map((l) => {
        const body = {
          employe_id: l.employe_id, date: l.date,
          arrivee: l.arrivee, depart: l.depart, statut: l.statut, notes: l.notes,
        }
        const id = existingMap.get(l.employe_id)
        return id
          ? apiClient.put(`/api/rh/presences/${id}`, body)
          : apiClient.post('/api/rh/presences', body)
      }))

      return lignes.length
    },
    onSuccess: (count) => {
      void qc.invalidateQueries({ queryKey: ['presences'] })
      toast.success(`${count} pointage(s) enregistré(s)`)
    },
    onError: (err: Error) => toast.error(err.message),
  })
}

// ── Bulletin PDF ──────────────────────────────────────────────────────────────

export function useBulletinPdf() {
  return useMutation({
    mutationFn: async ({ id }: { id: string; nom: string; mois: string }): Promise<string> => {
      const blob = await apiClient.getBlob(`/api/rh/paie/${id}/pdf`)
      return URL.createObjectURL(blob)
    },
    onError: (err: Error) => toast.error(err.message),
  })
}
