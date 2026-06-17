import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase'
import { dbGetBons, dbUpdateStatut, genererNumero } from '@/lib/db'
import { useAuth } from '@/context/AuthContext'
import { apiClient } from '@/lib/api-client'

export interface BonLigne {
  id?: string; produit_id?: string | null; designation: string; quantite?: number
  quantite_demandee?: number; quantite_servie?: number; unite: string
}
export interface BonSortie {
  id: string; numero: string
  statut: 'en_attente' | 'soumis' | 'valide' | 'execute' | 'refuse'
  type?: 'commande' | 'devis' | 'manuel'
  commande_id?: string | null
  devis_id?: string | null
  montant_total_xaf?: number | null
  demandeur: string; motif: string; notes?: string | null
  lignes: BonLigne[]; bons_sortie_lignes?: BonLigne[]; created_at: string; updated_at?: string; code_unique?: string
}
interface BonsResponse { data: BonSortie[]; total: number }

export function useBons(params?: { statut?: string }) {
  return useQuery({
    queryKey:  ['bons', params],
    queryFn:   () => dbGetBons(params) as Promise<BonsResponse>,
    staleTime: 15_000,
  })
}

/** Retourne le nombre de bons en statut 'en_attente' — utilisé pour le badge magasinier */
export function useBonsEnAttente() {
  return useQuery({
    queryKey:   ['bons', 'en_attente', 'count'],
    queryFn:    async () => {
      const { data, error } = await supabase
        .from('bons_sortie')
        .select('id', { count: 'exact', head: false })
        .in('statut', ['en_attente', 'soumis'])
      if (error) throw new Error(error.message)
      return (data ?? []).length
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
  const qc   = useQueryClient()
  const auth = useAuth()
  return useMutation({
    mutationFn: async (payload: {
      technicien_nom?: string; demandeur?: string; motif?: string; notes?: string
      type?: 'manuel' | 'commande' | 'devis'
      commande_id?: string | null; devis_id?: string | null
      lignes: Array<{ produit_id?: string; designation?: string; unite?: string; quantite?: number; quantite_demandee?: number }>
    }) => {
      const numero = await genererNumero('bons_sortie', 'TAF')
      const { data: bon, error: bonErr } = await supabase.from('bons_sortie').insert({
        numero,
        demandeur:  payload.demandeur ?? payload.technicien_nom ?? 'Technicien',
        motif:      payload.motif ?? 'Sortie de stock',
        notes:      payload.notes ?? null,
        statut:     'soumis',
        type:       payload.type ?? 'manuel',
        ...(payload.commande_id ? { commande_id: payload.commande_id } : {}),
        ...(payload.devis_id ? { devis_id: payload.devis_id } : {}),
        created_by: auth.user?.id,
        sync_status: 'synced',
      }).select().single()
      if (bonErr || !bon) throw new Error(bonErr?.message ?? 'Erreur création bon')
      const bonId = (bon as { id: string }).id
      const lignes = payload.lignes.map(l => ({
        bon_id:            bonId,
        produit_id:        l.produit_id ?? null,
        designation:       l.designation ?? 'Article',
        unite:             l.unite ?? 'unité',
        quantite_demandee: l.quantite_demandee ?? l.quantite ?? 1,
        quantite_servie:   0,
      }))
      const { error: ligErr } = await supabase.from('bons_sortie_lignes').insert(lignes)
      if (ligErr) { await supabase.from('bons_sortie').delete().eq('id', bonId); throw new Error(ligErr.message) }
      return { ...bon, lignes }
    },
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['bons'] }); toast.success('Bon de sortie créé') },
    onError:   (err: Error) => toast.error(err.message),
  })
}

export function useValidateBon() {
  const qc   = useQueryClient()
  return useMutation({
    mutationFn: async (arg: string | { id: string; decision: 'valide' | 'refuse'; commentaire?: string }) => {
      const id       = typeof arg === 'string' ? arg : arg.id
      const decision = typeof arg === 'string' ? 'valide' : arg.decision
      return apiClient.put<BonSortie>(`/api/bons/${id}/valider`, {
        decision,
        commentaire: typeof arg === 'string' ? undefined : arg.commentaire,
      })
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['bons'] })
      void qc.invalidateQueries({ queryKey: ['factures'] })
      toast.success('Décision enregistrée')
    },
    onError:   (err: Error) => toast.error(err.message),
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
