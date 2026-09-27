import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { apiClient } from '@/lib/api-client'

function queryString(params?: Record<string, string | number | boolean | undefined>) {
  const qs = new URLSearchParams()
  Object.entries(params ?? {}).forEach(([key, value]) => {
    if (value !== undefined && value !== '') qs.set(key, String(value))
  })
  const value = qs.toString()
  return value ? `?${value}` : ''
}

export type TypeGamme = 'catalogue' | 'sur_mesure' | 'configuration'

export interface Famille {
  id: string
  nom: string
  parent_id: string | null
  type_gamme: TypeGamme
  ordre: number
  actif: boolean
  created_at?: string
  updated_at?: string
}

export interface CreateFamillePayload {
  nom: string
  parent_id?: string | null
  type_gamme: TypeGamme
  ordre?: number
  actif?: boolean
}

export interface Modele {
  id: string
  famille_id: string
  reference: string
  designation: string
  description: string | null
  unite_facturation: string
  unite_facturation_id: string | null
  type_gamme: TypeGamme | null
  type_gamme_effectif?: TypeGamme
  actif: boolean
}

export interface CreateModelePayload {
  famille_id: string
  reference: string
  designation: string
  description?: string
  unite_facturation?: string
  type_gamme?: TypeGamme
  actif?: boolean
}

export interface ModeleSpecification {
  id: string
  modele_id: string
  cle: string
  valeur: string
  unite: string | null
  ordre: number
}

// §34 — GET /catalogue/modeles/:id/configuration

export interface ChampDimension {
  cle:   'largeur' | 'hauteur' | 'longueur' | 'poids'
  label: string
  unite: string
}

export interface ModeleConfiguration {
  modele: Modele & { type_gamme_effectif: TypeGamme }
  fiche_technique_disponible: boolean
  mode_calcul:       string | null
  champs_dimensions: ChampDimension[]
  specifications:    ModeleSpecification[]
}

interface Paginated<T> { data: T[]; total: number; page: number; per_page: number; total_pages: number }

// ── Familles ─────────────────────────────────────────────────────────────────

export function useFamilles(params?: { actif?: boolean; page?: number; per_page?: number }) {
  return useQuery({
    queryKey:  ['catalogue', 'familles', params],
    queryFn:   () => apiClient.get<Paginated<Famille>>(
      `/api/catalogue/familles${queryString({ actif: params?.actif, page: params?.page, per_page: params?.per_page ?? 100 })}`,
    ),
    staleTime: 30_000,
  })
}

export function useCreateFamille() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: CreateFamillePayload) => apiClient.post<Famille>('/api/catalogue/familles', payload),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['catalogue', 'familles'] }); toast.success('Famille créée') },
    onError:   (err: Error) => toast.error(err.message),
  })
}

export function useUpdateFamille() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: Partial<CreateFamillePayload> }) =>
      apiClient.put<Famille>(`/api/catalogue/familles/${id}`, payload),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['catalogue', 'familles'] }); toast.success('Famille mise à jour') },
    onError:   (err: Error) => toast.error(err.message),
  })
}

// ── Modèles ──────────────────────────────────────────────────────────────────

export function useModeles(params?: { famille_id?: string; actif?: boolean; page?: number; per_page?: number; enabled?: boolean }) {
  return useQuery({
    queryKey:  ['catalogue', 'modeles', params],
    queryFn:   () => apiClient.get<Paginated<Modele>>(
      `/api/catalogue/modeles${queryString({
        famille_id: params?.famille_id, actif: params?.actif,
        page: params?.page, per_page: params?.per_page ?? 100,
      })}`,
    ),
    staleTime: 30_000,
    // famille_id est un filtre optionnel : sans lui, la route retourne tous les
    // modèles (utile pour un sélecteur transverse, ex. Configurateur dans Devis.tsx).
    enabled:   params?.enabled !== false,
  })
}

export function useCreateModele() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: CreateModelePayload) => apiClient.post<Modele>('/api/catalogue/modeles', payload),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['catalogue', 'modeles'] }); toast.success('Modèle créé') },
    onError:   (err: Error) => toast.error(err.message),
  })
}

export function useUpdateModele() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: Partial<CreateModelePayload> }) =>
      apiClient.put<Modele>(`/api/catalogue/modeles/${id}`, payload),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['catalogue', 'modeles'] }); toast.success('Modèle mis à jour') },
    onError:   (err: Error) => toast.error(err.message),
  })
}

export function useModeleConfiguration(modeleId: string | null) {
  return useQuery({
    queryKey:  ['catalogue', 'modeles', modeleId, 'configuration'],
    queryFn:   () => apiClient.get<ModeleConfiguration>(`/api/catalogue/modeles/${modeleId}/configuration`),
    staleTime: 30_000,
    enabled:   !!modeleId,
  })
}

// ── Spécifications ───────────────────────────────────────────────────────────

export function useModeleSpecifications(modeleId: string | null) {
  return useQuery({
    queryKey:  ['catalogue', 'modeles', modeleId, 'specifications'],
    queryFn:   () => apiClient.get<{ data: ModeleSpecification[]; total: number }>(`/api/catalogue/modeles/${modeleId}/specifications`),
    staleTime: 30_000,
    enabled:   !!modeleId,
  })
}

export function useCreateSpecification() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ modeleId, payload }: { modeleId: string; payload: { cle: string; valeur: string; unite?: string; ordre?: number } }) =>
      apiClient.post<ModeleSpecification>(`/api/catalogue/modeles/${modeleId}/specifications`, payload),
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: ['catalogue', 'modeles', vars.modeleId, 'specifications'] })
      toast.success('Spécification ajoutée')
    },
    onError: (err: Error) => toast.error(err.message),
  })
}

export function useDeleteSpecification() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id }: { id: string; modeleId: string }) =>
      apiClient.delete<void>(`/api/catalogue/modele-specifications/${id}`),
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: ['catalogue', 'modeles', vars.modeleId, 'specifications'] })
      toast.success('Spécification supprimée')
    },
    onError: (err: Error) => toast.error(err.message),
  })
}

// ── Fiche technique (§14/§15) ─────────────────────────────────────────────────

export type ModeCalcul = 'quantitatif' | 'surface' | 'lineaire' | 'volume' | 'poids' | 'forfait' | 'qualitatif'
export type StatutFicheTechnique = 'brouillon' | 'active' | 'archivee'
export type TypeRessource = 'materiau' | 'main_oeuvre' | 'equipement'

export interface FicheTechnique {
  id: string
  modele_id: string
  version: number
  statut: StatutFicheTechnique
  mode_calcul: ModeCalcul
  unite_facturation_id: string | null
  notes: string | null
  created_at?: string
  updated_at?: string
}

export interface CreateFicheTechniquePayload {
  mode_calcul: ModeCalcul
  notes?: string
}

export interface FicheTechniqueRessource {
  id: string
  fiche_technique_id: string
  type: TypeRessource
  ressource_produit_id: string | null
  designation: string
  unite: string
  quantite_par_unite: number
  cout_unitaire_reference_xaf: number
  temps_reference_h: number | null
  ordre: number
  actif: boolean
  produits?: { designation: string; unite: string; prix_unitaire_xaf: number } | null
}

export interface CreateRessourcePayload {
  type: TypeRessource
  ressource_produit_id?: string
  designation: string
  unite: string
  quantite_par_unite: number
  cout_unitaire_reference_xaf?: number
  temps_reference_h?: number
  ordre?: number
  actif?: boolean
}

export function useFichesTechniques(modeleId: string | null) {
  return useQuery({
    queryKey:  ['catalogue', 'modeles', modeleId, 'fiche-technique'],
    queryFn:   () => apiClient.get<{ data: FicheTechnique[]; total: number }>(`/api/catalogue/modeles/${modeleId}/fiche-technique`),
    staleTime: 15_000,
    enabled:   !!modeleId,
  })
}

export function useCreateFicheTechnique() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ modeleId, payload }: { modeleId: string; payload: CreateFicheTechniquePayload }) =>
      apiClient.post<FicheTechnique>(`/api/catalogue/modeles/${modeleId}/fiche-technique`, payload),
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: ['catalogue', 'modeles', vars.modeleId, 'fiche-technique'] })
      toast.success('Nouvelle version de fiche technique créée (brouillon)')
    },
    onError: (err: Error) => toast.error(err.message),
  })
}

export function useUpdateFicheTechnique() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, payload }: { id: string; modeleId: string; payload: Partial<CreateFicheTechniquePayload> }) =>
      apiClient.put<FicheTechnique>(`/api/catalogue/fiche-technique/${id}`, payload),
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: ['catalogue', 'modeles', vars.modeleId, 'fiche-technique'] })
      toast.success('Fiche technique mise à jour')
    },
    onError: (err: Error) => toast.error(err.message),
  })
}

export function useActiverFicheTechnique() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id }: { id: string; modeleId: string }) =>
      apiClient.post<FicheTechnique>(`/api/catalogue/fiche-technique/${id}/activer`, {}),
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: ['catalogue', 'modeles', vars.modeleId, 'fiche-technique'] })
      void qc.invalidateQueries({ queryKey: ['catalogue', 'modeles', vars.modeleId, 'configuration'] })
      toast.success('Fiche technique activée — l\'ancienne version a été archivée')
    },
    onError: (err: Error) => toast.error(err.message),
  })
}

export function useDeleteFicheTechnique() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id }: { id: string; modeleId: string }) =>
      apiClient.delete<void>(`/api/catalogue/fiche-technique/${id}`),
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: ['catalogue', 'modeles', vars.modeleId, 'fiche-technique'] })
      toast.success('Fiche technique supprimée')
    },
    onError: (err: Error) => toast.error(err.message),
  })
}

export function useFicheTechniqueRessources(ficheTechniqueId: string | null) {
  return useQuery({
    queryKey:  ['catalogue', 'fiche-technique', ficheTechniqueId, 'ressources'],
    queryFn:   () => apiClient.get<{ data: FicheTechniqueRessource[]; total: number }>(`/api/catalogue/fiche-technique/${ficheTechniqueId}/ressources`),
    staleTime: 15_000,
    enabled:   !!ficheTechniqueId,
  })
}

export function useCreateRessource() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ ficheTechniqueId, payload }: { ficheTechniqueId: string; payload: CreateRessourcePayload }) =>
      apiClient.post<FicheTechniqueRessource>(`/api/catalogue/fiche-technique/${ficheTechniqueId}/ressources`, payload),
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: ['catalogue', 'fiche-technique', vars.ficheTechniqueId, 'ressources'] })
      toast.success('Ressource ajoutée')
    },
    onError: (err: Error) => toast.error(err.message),
  })
}

export function useUpdateRessource() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, payload }: { id: string; ficheTechniqueId: string; payload: Partial<CreateRessourcePayload> }) =>
      apiClient.put<FicheTechniqueRessource>(`/api/catalogue/ressources/${id}`, payload),
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: ['catalogue', 'fiche-technique', vars.ficheTechniqueId, 'ressources'] })
      toast.success('Ressource mise à jour')
    },
    onError: (err: Error) => toast.error(err.message),
  })
}

export function useDeleteRessource() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id }: { id: string; ficheTechniqueId: string }) =>
      apiClient.delete<void>(`/api/catalogue/ressources/${id}`),
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: ['catalogue', 'fiche-technique', vars.ficheTechniqueId, 'ressources'] })
      toast.success('Ressource supprimée')
    },
    onError: (err: Error) => toast.error(err.message),
  })
}
