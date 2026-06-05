import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase'
import { dbGetCredits, dbGetDashboardKpis } from '@/lib/db'
import { apiClient } from '@/lib/api-client'

export interface FactureLigne {
  designation: string
  quantite: number
  prix_unitaire_ht_xaf: number
}

export interface Facture {
  id: string
  numero: string
  statut: 'brouillon' | 'valide' | 'envoye' | 'paye' | 'annule'
  date_emission: string
  date_echeance: string
  montant_ht_xaf: number
  montant_tva_xaf: number
  montant_ttc_xaf: number
  montant_paye_xaf: number
  solde_restant_xaf: number
  client: { id: string; nom: string }
  lignes: FactureLigne[]
  pdf_url?: string
}

export interface Credit {
  id: string
  numero?: string
  statut: 'en_cours' | 'echu' | 'rembourse'
  montant_xaf: number
  solde_restant_xaf: number
  date_debut: string
  echeance: string
  client_nom: string
  client_id: string | null
}

export interface EcritureLigne {
  id: string
  date: string
  libelle: string
  compte_syscohada: string
  compte_label: string
  debit_xaf: number
  credit_xaf: number
  compte: string
  solde_xaf: number
}

interface FacturesResponse { data: Facture[]; total: number }
interface CreditsResponse { data: Credit[]; total: number }
interface EcrituresResponse { data: EcritureLigne[]; total: number }

export interface FinanceDashboard {
  kpis: {
    ca_facture_xaf: number
    encaisse_xaf: number
    a_recevoir_xaf: number
    banque_caisse_xaf: number
    taux_encaissement: number
    factures_total: number
    factures_brouillon: number
    factures_a_relancer: number
    credits_ouverts: number
    credits_solde_xaf: number
  }
  repartition_factures: { statut: string; count: number }[]
  dernieres_ecritures: EcritureLigne[]
}

function queryString(params?: Record<string, string | undefined>) {
  const qs = new URLSearchParams()
  Object.entries(params ?? {}).forEach(([key, value]) => {
    if (value) qs.set(key, value)
  })
  const value = qs.toString()
  return value ? `?${value}` : ''
}

function mapFacture(row: Record<string, unknown>): Facture {
  const ttc = Number(row.total_ttc_xaf ?? row.montant_ttc_xaf ?? 0)
  const paye = Number(row.montant_paye_xaf ?? 0)
  const lignes = (row.factures_lignes ?? row.lignes ?? []) as FactureLigne[]

  return {
    ...(row as unknown as Facture),
    id:                row.id as string,
    numero:            row.numero as string,
    statut:            row.statut as Facture['statut'],
    date_emission:     row.date_emission as string,
    date_echeance:     row.date_echeance as string,
    montant_ht_xaf:    Number(row.total_ht_xaf ?? row.montant_ht_xaf ?? 0),
    montant_tva_xaf:   Number(row.tva_xaf ?? row.montant_tva_xaf ?? 0),
    montant_ttc_xaf:   ttc,
    montant_paye_xaf:  paye,
    solde_restant_xaf: Number(row.solde_restant_xaf ?? Math.max(0, ttc - paye)),
    client: {
      id:  (row.client_id as string | null) ?? '',
      nom: (row.client_nom as string | null) ?? '',
    },
    lignes,
  }
}

export function useFactures(params?: { statut?: string }) {
  return useQuery({
    queryKey: ['factures', params],
    queryFn: async () => {
      const res = await apiClient.get<{ data: Record<string, unknown>[]; total: number }>(`/api/factures${queryString(params)}`)
      return { ...res, data: (res.data ?? []).map(mapFacture) } as FacturesResponse
    },
    staleTime: 30_000,
  })
}

export function useEnvoyerFacture() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      apiClient.patch<Record<string, unknown>>(`/api/factures/${id}/statut`, { statut: 'envoye' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['factures'] })
      toast.success('Facture marquee envoyee')
    },
    onError: (err: Error) => toast.error(err.message),
  })
}

interface CreerFacturePayload {
  client_id?: string
  client_nom: string
  commande_id?: string
  date_emission: string
  date_echeance: string
  lignes: FactureLigne[]
}

export function useCreerFacture() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (payload: CreerFacturePayload) =>
      mapFacture(await apiClient.post<Record<string, unknown>>('/api/factures', payload)),
    onSuccess: (facture) => {
      void qc.invalidateQueries({ queryKey: ['factures'] })
      toast.success(`Facture ${facture.numero ?? ''} creee`)
    },
    onError: (err: Error) => toast.error(err.message),
  })
}

export function useCredits(params?: { statut?: string }) {
  return useQuery({
    queryKey: ['credits', params],
    queryFn: () => dbGetCredits(params) as Promise<CreditsResponse>,
    staleTime: 30_000,
  })
}

export function useRemboursement() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (arg: {
      id: string
      montant_xaf?: number
      montant?: number
      date_paiement?: string
      type?: 'total' | 'partiel'
      notes?: string
    }) => {
      const { id } = arg
      const montant_xaf = arg.montant_xaf ?? arg.montant ?? 0
      const date_paiement = arg.date_paiement ?? new Date().toISOString().slice(0, 10)
      const type = arg.type ?? (montant_xaf > 0 ? 'partiel' : 'partiel')
      const { data: cr } = await supabase.from('credits')
        .select('solde_restant_xaf,statut,client_id')
        .eq('id', id)
        .single()
      if (!cr) throw new Error('Credit introuvable')
      const c = cr as { solde_restant_xaf: number; statut: string; client_id: string | null }
      if (c.statut === 'rembourse') throw new Error('Credit deja rembourse')
      if (montant_xaf > c.solde_restant_xaf) throw new Error('Montant depasse le solde restant')

      const nouveauSolde = Math.max(0, c.solde_restant_xaf - montant_xaf)
      const nouveauStatut = nouveauSolde <= 0 ? 'rembourse' : 'en_cours'
      await supabase.from('credits')
        .update({ solde_restant_xaf: nouveauSolde, statut: nouveauStatut, updated_at: new Date().toISOString() })
        .eq('id', id)

      if (c.client_id) {
        const { data: credits } = await supabase.from('credits')
          .select('solde_restant_xaf')
          .eq('client_id', c.client_id)
          .in('statut', ['en_cours', 'echu'])
        const encours = ((credits ?? []) as { solde_restant_xaf: number }[])
          .reduce((sum, item) => sum + item.solde_restant_xaf, 0)
        await supabase.from('clients').update({ encours_credit_xaf: Math.round(encours) }).eq('id', c.client_id)
      }

      return { nouveau_solde_xaf: nouveauSolde, statut: nouveauStatut, date_paiement, type }
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['credits'] })
      toast.success('Remboursement enregistre')
    },
    onError: (err: Error) => toast.error(err.message),
  })
}

export interface DashboardKpis {
  ca_mensuel: { mois: string; ca: number }[]
  kpis: {
    commandes_actives: number
    stocks_en_alerte: number
    apprenants_actifs: number
    bons_en_attente: number
    credits_echus: number
  }
  recent_commandes: { id: string; numero: string; client_nom: string; total_ttc_xaf: number; statut: string; date_commande: string }[]
  recent_mouvements: { id: string; type: string; quantite: number; created_at: string; produits: { designation: string; unite: string } | null }[]
}

export function useDashboardKpis() {
  return useQuery({
    queryKey: ['dashboard', 'kpis'],
    queryFn: () => dbGetDashboardKpis() as Promise<DashboardKpis>,
    staleTime: 30_000,
    refetchInterval: 60_000,
  })
}

export function useEcritures(params?: { compte?: string; mois?: string }) {
  return useQuery({
    queryKey: ['ecritures', params],
    queryFn: () => apiClient.get<EcrituresResponse>(`/api/ecritures${queryString(params)}`),
    staleTime: 60_000,
  })
}

export function useFinanceDashboard() {
  return useQuery({
    queryKey: ['finance', 'dashboard'],
    queryFn: () => apiClient.get<FinanceDashboard>('/api/finance/dashboard'),
    staleTime: 30_000,
  })
}

export function useUpdateStatutFacture() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, statut }: { id: string; statut: Facture['statut'] }) =>
      apiClient.patch(`/api/factures/${id}/statut`, { statut }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['factures'] })
      toast.success('Statut facture mis a jour')
    },
    onError: (err: Error) => toast.error(err.message),
  })
}

export function usePaiementFacture() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, montant_xaf, date_paiement, mode, notes }: {
      id: string
      montant_xaf: number
      date_paiement: string
      mode: 'banque' | 'caisse'
      notes?: string
    }) => apiClient.post(`/api/factures/${id}/paiement`, { montant_xaf, date_paiement, mode, notes }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['factures'] })
      void qc.invalidateQueries({ queryKey: ['ecritures'] })
      toast.success('Paiement facture enregistre')
    },
    onError: (err: Error) => toast.error(err.message),
  })
}
