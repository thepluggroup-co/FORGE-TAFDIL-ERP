import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase'
import {
  dbGetFactures, dbGetCredits, dbGetDashboardKpis, dbUpdateStatut,
} from '@/lib/db'

export interface FactureLigne { designation: string; quantite: number; prix_unitaire_ht_xaf: number }
export interface Facture {
  id: string; numero: string; statut: 'brouillon' | 'valide' | 'envoye' | 'paye' | 'annule'
  date_emission: string; date_echeance: string
  montant_ht_xaf: number; montant_tva_xaf: number; montant_ttc_xaf: number
  montant_paye_xaf: number; solde_restant_xaf: number
  client: { id: string; nom: string }; lignes: FactureLigne[]; pdf_url?: string
}
export interface Credit {
  id: string; numero?: string; statut: 'en_cours' | 'echu' | 'rembourse'
  montant_xaf: number; solde_restant_xaf: number; date_debut: string; echeance: string
  client_nom: string; client_id: string | null
}
export interface EcritureLigne {
  id: string; date: string; libelle: string
  compte_syscohada: string; compte_label: string; debit_xaf: number; credit_xaf: number
  // Aliases pour compatibilité avec les pages existantes
  compte: string; solde_xaf: number
}
interface FacturesResponse  { data: Facture[];      total: number }
interface CreditsResponse   { data: Credit[];       total: number }

// ── Factures ──────────────────────────────────────────────────────────────────

export function useFactures(params?: { statut?: string }) {
  return useQuery({
    queryKey:  ['factures', params],
    queryFn:   () => dbGetFactures(params) as Promise<FacturesResponse>,
    staleTime: 30_000,
  })
}

export function useEnvoyerFacture() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { data: f } = await supabase.from('factures').select('numero,client_nom,total_ttc_xaf').eq('id', id).single()
      if (!f) throw new Error('Facture introuvable')
      return f
    },
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['factures'] }); toast.success('Facture partagée') },
    onError:   (err: Error) => toast.error(err.message),
  })
}

interface CreerFacturePayload {
  client_id?: string; client_nom: string; commande_id?: string
  date_emission: string; date_echeance: string; lignes: FactureLigne[]
}

export function useCreerFacture() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (payload: CreerFacturePayload) => {
      if (payload.commande_id) {
        const { count } = await supabase.from('factures').select('*', { count: 'exact', head: true })
          .eq('commande_id', payload.commande_id).neq('statut', 'annule')
        if ((count ?? 0) > 0) throw new Error('Une facture existe déjà pour cette commande')
      }
      const year = new Date().getFullYear()
      const { count } = await supabase.from('factures').select('*', { count: 'exact', head: true })
        .gte('created_at', `${year}-01-01T00:00:00.000Z`)
      const numero = `FAC-${year}-${String((count ?? 0) + 1).padStart(4, '0')}`
      const TVA = 0.1925
      const ht  = Math.round(payload.lignes.reduce((s, l) => s + l.quantite * l.prix_unitaire_ht_xaf, 0))
      const tva = Math.round(ht * TVA)
      const { data: facture, error } = await supabase.from('factures')
        .insert({
          numero, client_id: payload.client_id ?? null, client_nom: payload.client_nom,
          commande_id: payload.commande_id ?? null, statut: 'brouillon',
          date_emission: payload.date_emission, date_echeance: payload.date_echeance,
          total_ht_xaf: ht, tva_xaf: tva, total_ttc_xaf: ht + tva, montant_paye_xaf: 0,
          sync_status: 'synced',
        }).select().single()
      if (error) throw new Error(error.message)
      await supabase.from('factures_lignes').insert(
        payload.lignes.map((l, i) => ({
          facture_id: (facture as { id: string }).id, designation: l.designation,
          unite: 'unité', quantite: l.quantite, prix_unitaire_ht_xaf: l.prix_unitaire_ht_xaf,
          total_ht_xaf: Math.round(l.quantite * l.prix_unitaire_ht_xaf), ordre: i,
        })),
      )
      return facture!
    },
    onSuccess: (f) => {
      void qc.invalidateQueries({ queryKey: ['factures'] })
      toast.success(`Facture ${(f as { numero?: string }).numero ?? ''} créée`)
    },
    onError: (err: Error) => toast.error(err.message),
  })
}

// ── Crédits ───────────────────────────────────────────────────────────────────

export function useCredits(params?: { statut?: string }) {
  return useQuery({
    queryKey:  ['credits', params],
    queryFn:   () => dbGetCredits(params) as Promise<CreditsResponse>,
    staleTime: 30_000,
  })
}

export function useRemboursement() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (arg: {
      id: string
      montant_xaf?: number
      montant?: number  // alias ancien format
      date_paiement?: string
      type?: 'total' | 'partiel'
      notes?: string
    }) => {
      const { id } = arg
      const montant_xaf  = arg.montant_xaf ?? arg.montant ?? 0
      const date_paiement = arg.date_paiement ?? new Date().toISOString().slice(0, 10)
      const type          = arg.type ?? (montant_xaf > 0 ? 'partiel' : 'partiel')
      const { data: cr } = await supabase.from('credits')
        .select('solde_restant_xaf,statut,client_id').eq('id', id).single()
      if (!cr) throw new Error('Crédit introuvable')
      const c = cr as { solde_restant_xaf: number; statut: string; client_id: string | null }
      if (c.statut === 'rembourse') throw new Error('Crédit déjà remboursé')
      if (montant_xaf > c.solde_restant_xaf) throw new Error(`Montant dépasse le solde restant`)
      const nouveauSolde  = Math.max(0, c.solde_restant_xaf - montant_xaf)
      const nouveauStatut = nouveauSolde <= 0 ? 'rembourse' : 'en_cours'
      await supabase.from('credits')
        .update({ solde_restant_xaf: nouveauSolde, statut: nouveauStatut, updated_at: new Date().toISOString() })
        .eq('id', id)
      if (c.client_id) {
        const { data: credits } = await supabase.from('credits')
          .select('solde_restant_xaf').eq('client_id', c.client_id).in('statut', ['en_cours','echu'])
        const encours = ((credits ?? []) as { solde_restant_xaf: number }[]).reduce((s, x) => s + x.solde_restant_xaf, 0)
        await supabase.from('clients').update({ encours_credit_xaf: Math.round(encours) }).eq('id', c.client_id)
      }
      return { nouveau_solde_xaf: nouveauSolde, statut: nouveauStatut }
    },
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['credits'] }); toast.success('Remboursement enregistré') },
    onError:   (err: Error) => toast.error(err.message),
  })
}

// ── Dashboard KPIs ────────────────────────────────────────────────────────────

export interface DashboardKpis {
  ca_mensuel: { mois: string; ca: number }[]
  kpis: { commandes_actives: number; stocks_en_alerte: number; apprenants_actifs: number; bons_en_attente: number; credits_echus: number }
  recent_commandes: { id: string; numero: string; client_nom: string; total_ttc_xaf: number; statut: string; date_commande: string }[]
  recent_mouvements: { id: string; type: string; quantite: number; created_at: string; produits: { designation: string; unite: string } | null }[]
}

export function useDashboardKpis() {
  return useQuery({
    queryKey:        ['dashboard', 'kpis'],
    queryFn:         () => dbGetDashboardKpis() as Promise<DashboardKpis>,
    staleTime:       30_000,
    refetchInterval: 60_000,
  })
}

// ── Écritures ─────────────────────────────────────────────────────────────────

interface EcrituresResponse { data: EcritureLigne[]; total: number }

export function useEcritures(params?: { compte?: string; mois?: string }) {
  return useQuery({
    queryKey: ['ecritures', params],
    queryFn: async () => {
      let q = supabase.from('ecritures_comptables').select('*', { count: 'exact' })
      if (params?.compte) q = q.eq('compte_syscohada', params.compte)
      const { data, count, error } = await q.order('date', { ascending: false })
      if (error) throw new Error(error.message)
      // Ajouter les alias pour la compatibilité avec les pages
      const enriched = (data ?? []).map((e: Record<string, unknown>) => ({
        ...e,
        compte:    e.compte_syscohada,
        solde_xaf: Number(e.debit_xaf ?? 0) - Number(e.credit_xaf ?? 0),
      }))
      return { data: enriched, total: count ?? 0 } as EcrituresResponse
    },
    staleTime: 60_000,
  })
}

// ── Statut facture ────────────────────────────────────────────────────────────

export function useUpdateStatutFacture() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, statut }: { id: string; statut: Facture['statut'] }) =>
      dbUpdateStatut('factures', id, statut),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['factures'] }); toast.success('Statut facture mis à jour') },
    onError:   (err: Error) => toast.error(err.message),
  })
}
