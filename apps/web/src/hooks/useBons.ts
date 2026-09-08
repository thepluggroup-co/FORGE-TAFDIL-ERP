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

export interface BonLigne {
  id?: string; produit_id?: string | null; designation: string; quantite?: number
  quantite_demandee?: number; quantite_servie?: number; unite: string
}
export type StatutPreparationBon = 'a_preparer' | 'en_cours' | 'pret'
export interface BonPreparateur {
  id: string
  nom?: string | null
  telephone?: string | null
  poste?: string | null
  departement?: string | null
  statut?: string | null
}
export interface BonSortie {
  id: string; numero: string
  statut: 'en_attente' | 'soumis' | 'valide' | 'execute' | 'refuse'
  preparateur_id?: string | null
  statut_preparation?: StatutPreparationBon | null
  preparateur?: BonPreparateur | null
  type?: 'commande' | 'devis' | 'manuel'
  nature_transaction?: 'comptant' | 'credit' | 'deduction_acompte' | null
  imputation_payeur?:  'entreprise_tafdil' | 'atelier' | 'administration' | null
  commande_id?: string | null
  devis_id?: string | null
  montant_total_xaf?: number | null
  demandeur: string; motif: string; notes?: string | null
  lignes: BonLigne[]; bons_sortie_lignes?: BonLigne[]; created_at: string; updated_at?: string; code_unique?: string
}
interface BonsResponse { data: BonSortie[]; total: number }
interface PreparateursResponse { data: BonPreparateur[]; total: number }

export function useBons(params?: { statut?: string }) {
  return useQuery({
    queryKey:  ['bons', params],
    queryFn:   () => apiClient.get<BonsResponse>(`/api/bons${queryString(params)}`),
    staleTime: 15_000,
  })
}

export function usePreparateursBons() {
  return useQuery({
    queryKey: ['bons', 'preparateurs'],
    queryFn:  () => apiClient
      .get<{ data: BonPreparateur[]; total: number }>('/api/rh/employes?statut=actif&per_page=100')
      .then((r): PreparateursResponse => ({ data: r.data, total: r.total })),
    staleTime: 60_000,
  })
}

/** Retourne le nombre de bons en statut 'en_attente'/'soumis' — utilisé pour le badge magasinier */
export function useBonsEnAttente() {
  return useQuery({
    queryKey:   ['bons', 'en_attente', 'count'],
    queryFn:    async () => {
      const [enAttente, soumis] = await Promise.all([
        apiClient.get<BonsResponse>('/api/bons?statut=en_attente&per_page=1'),
        apiClient.get<BonsResponse>('/api/bons?statut=soumis&per_page=1'),
      ])
      return enAttente.total + soumis.total
    },
    staleTime:  10_000,
    refetchInterval: 30_000,
  })
}

/** Crée les bons de sortie manquants pour les commandes web existantes — via Supabase direct */
export function useBackfillBons() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () =>
      apiClient.post<{ created: number; errors: string[] }>('/api/commandes/backfill-bons', {}),
    onSuccess: (res) => {
      void qc.refetchQueries({ queryKey: ['bons'] })
      if (res.errors.length) res.errors.forEach((e) => console.error('[backfill]', e))
      toast.success(res.created > 0 ? String(res.created) + ' bon(s) cree(s)' : 'Tous les bons sont deja a jour')
    },
    onError: (err: Error) => toast.error(err.message),
  })
}

export function useCreateBon() {
  const qc = useQueryClient()
  return useMutation({
    // NOTE : l'API (POST /api/bons) ne persiste pas encore `type`/`devis_id`
    // (createBonSchema ne les accepte pas) — écart pré-existant côté API, pas
    // introduit par ce rebranchement. Un bon lié à un devis (plutôt qu'une
    // commande) perdra ce lien tant que l'API n'est pas étendue.
    mutationFn: (payload: {
      technicien_nom?: string; demandeur?: string; motif?: string; notes?: string
      type?: 'manuel' | 'commande' | 'devis'
      commande_id?: string | null; devis_id?: string | null
      nature_transaction: 'comptant' | 'credit' | 'deduction_acompte'
      imputation_payeur:  'entreprise_tafdil' | 'atelier' | 'administration'
      lignes: Array<{ produit_id?: string; designation?: string; unite?: string; quantite?: number; quantite_demandee?: number }>
    }) => apiClient.post<BonSortie>('/api/bons', {
      demandeur:          payload.demandeur ?? payload.technicien_nom ?? 'Technicien',
      motif:              payload.motif ?? 'Sortie de stock',
      notes:              payload.notes ?? undefined,
      commande_id:        payload.commande_id ?? undefined,
      nature_transaction: payload.nature_transaction,
      imputation_payeur:  payload.imputation_payeur,
      lignes: payload.lignes.map((l) => ({
        produit_id:        l.produit_id ?? undefined,
        designation:       l.designation ?? 'Article',
        unite:             l.unite ?? 'unité',
        quantite_demandee: l.quantite_demandee ?? l.quantite ?? 1,
      })),
    }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['bons'] }); toast.success('Bon de sortie créé') },
    onError:   (err: Error) => toast.error(err.message),
  })
}

export function useValidateBon() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (arg: string | {
      id: string
      decision?: 'valide' | 'refuse'
      commentaire?: string
      nature_transaction?: 'comptant' | 'credit' | 'deduction_acompte'
      imputation_payeur?: 'entreprise_tafdil' | 'atelier' | 'administration'
    }) => {
      const id       = typeof arg === 'string' ? arg : arg.id
      const decision = typeof arg === 'string' ? 'valide' : (arg.decision ?? 'valide')
      const nature   = typeof arg !== 'string' ? arg.nature_transaction : undefined
      const payeur   = typeof arg !== 'string' ? arg.imputation_payeur  : undefined

      // PUT /:id/valider exige déjà nature_transaction/imputation_payeur en
      // base et ne les accepte pas en override — pour les bons legacy qui en
      // sont dépourvus, on les renseigne d'abord via ce PATCH dédié.
      if (nature || payeur) {
        await apiClient.patch(`/api/bons/${id}/nature-payeur`, {
          nature_transaction: nature,
          imputation_payeur:  payeur,
        })
      }

      return apiClient.put<BonSortie>(`/api/bons/${id}/valider`, { decision })
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['bons'] })
      void qc.invalidateQueries({ queryKey: ['factures'] })
      toast.success('Décision enregistrée')
    },
    onError: (err: Error) => toast.error(err.message),
  })
}

// ── Types pour la vérification de stock ──────────────────────────────────────

export interface LigneStockCheck {
  designation:       string
  quantite_demandee: number
  stock_disponible:  number | null
  suffisant:         boolean
  sans_produit:      boolean
}

export interface StockCheckResult {
  bon_statut:    string
  lignes:        LigneStockCheck[]
  toutSuffisant: boolean
}

export function useVerifierStockBon(id: string | null) {
  return useQuery({
    queryKey:  ['bons', id, 'verifier-stock'],
    queryFn:   () => apiClient.get<StockCheckResult>(`/api/bons/${id}/verifier-stock`),
    enabled:   !!id,
    staleTime: 0,
  })
}

export function useAssignPreparateurBon() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, preparateur_id }: { id: string; preparateur_id: string }) =>
      apiClient.patch<BonSortie>(`/api/bons/${id}/preparateur`, { preparateur_id }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['bons'] })
      toast.success('Preparateur assigne')
    },
    onError: (err: Error) => toast.error(err.message),
  })
}

export function useMarquerBonPret() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id }: { id: string }) =>
      apiClient.patch<BonSortie>(`/api/bons/${id}/preparation`, { statut: 'pret' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['bons'] })
      void qc.invalidateQueries({ queryKey: ['livraisons'] })
      toast.success('Bon marque pret')
    },
    onError: (err: Error) => toast.error(err.message),
  })
}

export function useExecuteBon() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, code_unique }: { id: string; code_unique: string; nb_articles?: number }) =>
      apiClient.put<unknown>(`/api/bons/${id}/executer`, { code_unique }),
    onSuccess: (_data, variables) => {
      void qc.invalidateQueries({ queryKey: ['bons'] })
      void qc.invalidateQueries({ queryKey: ['stocks'] })
      const nb = variables.nb_articles ?? 0
      toast.success(
        nb > 0
          ? `Bon exécuté — stock mis à jour pour ${nb} article${nb > 1 ? 's' : ''}`
          : 'Bon exécuté — stocks mis à jour',
      )
    },
    onError: (err: Error) => toast.error(err.message),
  })
}
