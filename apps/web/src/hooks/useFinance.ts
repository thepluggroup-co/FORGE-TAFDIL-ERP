import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { apiClient } from '@/lib/api-client'

// ── Types ──────────────────────────────────────────────────────────────────────

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
  client: { id: string; nom: string }
  lignes: FactureLigne[]
  pdf_url?: string
}

export interface Credit {
  id: string
  reference: string
  statut: 'en_cours' | 'echu' | 'rembourse'
  montant_initial_xaf: number
  solde_restant_xaf: number
  date_debut: string
  date_echeance: string
  client: { id: string; nom: string }
}

export interface EcritureLigne {
  id: string
  date: string
  libelle: string
  compte: string
  compte_label: string
  debit_xaf: number
  credit_xaf: number
  solde_xaf: number
}

interface FacturesResponse  { data: Facture[];       total: number }
interface CreditsResponse   { data: Credit[];        total: number }
interface EcrituresResponse { data: EcritureLigne[]; total: number }

// ── Factures ──────────────────────────────────────────────────────────────────

export function useFactures(params?: { statut?: string }) {
  const q = params?.statut ? `?statut=${params.statut}` : ''
  return useQuery({
    queryKey: ['factures', params],
    queryFn:  () => apiClient.get<FacturesResponse>(`/api/factures${q}`),
    staleTime: 30_000,
  })
}

export function useEnvoyerFacture() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiClient.post<Facture>(`/api/factures/${id}/envoyer-whatsapp`, {}),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['factures'] })
      toast.success('Facture envoyée via WhatsApp')
    },
    onError: (err: Error) => toast.error(err.message),
  })
}

// ── Créer facture ────────────────────────────────────────────────────────────

interface CreerFacturePayload {
  client_id: string
  date_emission: string
  date_echeance: string
  lignes: FactureLigne[]
}

export function useCreerFacture() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: CreerFacturePayload) =>
      apiClient.post<Facture>('/api/factures', payload),
    onSuccess: (facture) => {
      void qc.invalidateQueries({ queryKey: ['factures'] })
      toast.success(`Facture ${facture.numero} créée`)
    },
    onError: (err: Error) => toast.error(err.message),
  })
}

// ── Crédits ───────────────────────────────────────────────────────────────────

export function useCredits(params?: { statut?: string }) {
  const q = params?.statut ? `?statut=${params.statut}` : ''
  return useQuery({
    queryKey: ['credits', params],
    queryFn:  () => apiClient.get<CreditsResponse>(`/api/credits${q}`),
    staleTime: 30_000,
  })
}

export function useRemboursement() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, montant }: { id: string; montant: number }) =>
      apiClient.post<Credit>(`/api/credits/${id}/rembourser`, { montant }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['credits'] })
      toast.success('Remboursement enregistré')
    },
    onError: (err: Error) => toast.error(err.message),
  })
}

// ── Dashboard KPIs ────────────────────────────────────────────────────────────

export interface DashboardKpis {
  ca_mensuel: { mois: string; ca: number }[]
  kpis: {
    commandes_actives: number
    stocks_en_alerte:  number
    apprenants_actifs: number
    bons_en_attente:   number
    credits_echus:     number
  }
  recent_commandes: {
    id:             string
    numero:         string
    client_nom:     string
    total_ttc_xaf:  number
    statut:         string
    date_commande:  string
  }[]
  recent_mouvements: {
    id:         string
    type:       'entree' | 'sortie'
    quantite:   number
    created_at: string
    produits:   { designation: string; unite: string } | null
  }[]
}

export function useDashboardKpis() {
  return useQuery({
    queryKey:       ['dashboard', 'kpis'],
    queryFn:        () => apiClient.get<DashboardKpis>('/api/rapports/dashboard'),
    staleTime:      30_000,
    refetchInterval: 60_000,
  })
}

// ── Écritures ─────────────────────────────────────────────────────────────────

export function useEcritures(params?: { compte?: string; mois?: string }) {
  const qs = new URLSearchParams()
  if (params?.compte) qs.set('compte', params.compte)
  if (params?.mois)   qs.set('mois',   params.mois)
  const q = qs.toString()

  return useQuery({
    queryKey: ['ecritures', params],
    queryFn:  () => apiClient.get<EcrituresResponse>(`/api/ecritures${q ? `?${q}` : ''}`),
    staleTime: 60_000,
  })
}
