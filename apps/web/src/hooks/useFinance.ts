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
  frais_livraison_xaf: number
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

export interface PlanCompte {
  compte: string
  libelle: string
  classe: number
  categorie: string
  nature: string
  sens_normal: 'debit' | 'credit'
  rubrique: string
}

export interface JournalComptable {
  code: string
  label: string
  source: string
  comptes_usuels: string[]
}

export interface GrandLivreLigne {
  id: string
  date: string
  libelle: string
  reference: string | null
  debit_xaf: number
  credit_xaf: number
  solde_xaf: number
  sens: string
}

export interface GrandLivreResponse {
  compte: string
  compte_label: string
  categorie: string
  nature: string
  sens_normal: 'debit' | 'credit'
  rubrique: string
  periode: { debut: string; fin: string }
  lignes: GrandLivreLigne[]
  total_debit_xaf: number
  total_credit_xaf: number
  solde_final_xaf: number
  solde_sens: string
}

export interface RapportSectionCompte {
  compte: string
  compte_label: string
  montant_xaf: number
}

export interface RapportSection {
  rubrique: string
  total_xaf: number
  comptes: RapportSectionCompte[]
}

export interface BilanComptableResponse {
  exercice: string
  periode: { debut: string; fin: string }
  actif: RapportSection[]
  passif: RapportSection[]
  resultat_exercice_xaf: number
  total_actif_xaf: number
  total_passif_xaf: number
  ecart_xaf: number
  equilibre: boolean
}

export interface ResultatAnalytiqueResponse {
  exercice: string
  periode: { debut: string; fin: string }
  produits: RapportSection[]
  charges: RapportSection[]
  total_produits_xaf: number
  total_charges_xaf: number
  resultat_net_xaf: number
  beneficiaire: boolean
  finance: {
    ca_facture_ht_xaf: number
    tva_facturee_xaf: number
    ca_facture_ttc_xaf: number
    encaisse_xaf: number
    reste_a_encaisser_xaf: number
    ecart_ca_comptable_vs_facture_ht_xaf: number
  }
}

export interface SyntheseComptableResponse {
  exercice: string
  periode: { debut: string; fin: string }
  comptabilite: {
    comptes_mouvementes: number
    total_debit_xaf: number
    total_credit_xaf: number
    balance_equilibree: boolean
    total_actif_xaf: number
    total_passif_xaf: number
    resultat_net_xaf: number
  }
  finance: {
    factures: number
    ca_facture_ht_xaf: number
    tva_facturee_xaf: number
    ca_facture_ttc_xaf: number
    encaisse_xaf: number
    reste_a_encaisser_xaf: number
  }
  rapprochement: {
    ca_comptable_xaf: number
    ca_facture_ht_xaf: number
    ecart_ca_xaf: number
  }
  exports: { label: string; endpoint: string }[]
}

export interface ControleComptable {
  code: string
  label: string
  statut: 'ok' | 'attention' | 'alerte'
  details: string
  ecart_xaf: number
}

export interface ControlesComptablesResponse {
  exercice: string
  periode: { debut: string; fin: string }
  statut_global: 'ok' | 'attention' | 'alerte'
  controles: ControleComptable[]
  comptes_inconnus: {
    compte: string
    compte_label: string
    total_debit_xaf: number
    total_credit_xaf: number
  }[]
  recommandations: string[]
}

export interface ClotureComptableResponse {
  exercice: string
  periode: { debut: string; fin: string }
  statut: 'pret' | 'pret_avec_reserves' | 'bloque'
  cloturable: boolean
  etapes: {
    code: string
    label: string
    statut: 'ok' | 'a_revoir' | 'bloquant'
    details: string
  }[]
  resume: {
    comptes_mouvementes: number
    total_debit_xaf: number
    total_credit_xaf: number
    resultat_net_xaf: number
    ca_facture_ht_xaf: number
    encaisse_xaf: number
    reste_a_encaisser_xaf: number
    charges_ht_validees_xaf?: number
    tva_deductible_xaf?: number
  }
  actions_recommandees: string[]
}

interface FacturesResponse { data: Facture[]; total: number }
interface CreditsResponse { data: Credit[]; total: number }
interface EcrituresResponse { data: EcritureLigne[]; total: number }
interface PlanComptableResponse { total: number; comptes: PlanCompte[]; classes: { classe: number; label: string }[] }
interface JournauxComptablesResponse { data: JournalComptable[]; regles: string[] }

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
    factures_en_retard: number
    montant_retard_xaf: number
    credits_ouverts: number
    credits_solde_xaf: number
  }
  repartition_factures: { statut: string; count: number }[]
  factures_en_retard: {
    id: string
    numero: string
    client_nom: string
    date_echeance: string
    solde_restant_xaf: number
  }[]
  top_clients_debiteurs: {
    client_id: string | null
    client_nom: string
    solde_xaf: number
    factures: number
  }[]
  dernieres_ecritures: EcritureLigne[]
}

export interface DeclarationFiscale {
  id: string
  type: string
  periode: string
  statut: 'a_declarer' | 'soumis' | 'valide'
  montant_xaf: number
  echeance: string
  soumis_le?: string | null
  notes?: string | null
}

interface DeclarationsResponse { data: DeclarationFiscale[]; total: number }

export type ChargeStatut = 'brouillon' | 'a_valider' | 'validee' | 'payee' | 'annulee'
export type JustificatifStatut = 'manquant' | 'recu' | 'non_requis'
export type ModePaiementCharge = 'caisse' | 'banque' | 'mobile_money' | 'credit_fournisseur'
export type ModePaiementSortie = 'caisse' | 'banque' | 'mobile_money'

export interface Charge {
  id: string
  numero: string
  fournisseur_nom: string
  categorie: string
  compte_charge: string
  compte_charge_label: string
  date_charge: string
  date_echeance?: string | null
  statut: ChargeStatut
  montant_ht_xaf: number
  tva_xaf: number
  montant_ttc_xaf: number
  montant_paye_xaf: number
  solde_restant_xaf: number
  mode_paiement?: ModePaiementCharge | null
  compte_tresorerie?: string | null
  reference_paiement?: string | null
  justificatif_statut: JustificatifStatut
  description?: string | null
  notes?: string | null
}

export interface SortieTresorerie {
  id: string
  numero: string
  charge_id?: string | null
  date_sortie: string
  beneficiaire: string
  motif: string
  montant_xaf: number
  mode_paiement: ModePaiementSortie
  compte_tresorerie: string
  reference_paiement?: string | null
  statut: 'brouillon' | 'validee' | 'annulee'
  justificatif_statut: JustificatifStatut
  notes?: string | null
  charges?: { numero: string; fournisseur_nom: string } | null
}

export interface ChargesDashboard {
  periode: { from: string; to: string }
  kpis: {
    total_charges_xaf: number
    charges_payees_xaf: number
    charges_a_payer_xaf: number
    sorties_xaf: number
    tva_deductible_xaf: number
    charges_a_valider: number
    justificatifs_manquants: number
  }
  repartition_categories: { categorie: string; total_xaf: number; count: number }[]
  top_fournisseurs: { fournisseur_nom: string; total_xaf: number; count: number }[]
  dernieres_charges: Charge[]
  dernieres_sorties: SortieTresorerie[]
}

interface ChargesResponse { data: Charge[]; total: number }
interface SortiesTresorerieResponse { data: SortieTresorerie[]; total: number }

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
    frais_livraison_xaf: Number(row.frais_livraison_xaf ?? 0),
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

export function usePlanComptable(params?: { classe?: string }) {
  return useQuery({
    queryKey: ['plan-comptable', params],
    queryFn: () => apiClient.get<PlanComptableResponse>(`/api/rapports/plan-comptable${queryString(params)}`),
    staleTime: 60_000,
  })
}

export function useJournauxComptables() {
  return useQuery({
    queryKey: ['journaux-comptables'],
    queryFn: () => apiClient.get<JournauxComptablesResponse>('/api/rapports/journaux-comptables'),
    staleTime: 60_000,
  })
}

export function useGrandLivre(params?: { compte?: string; debut?: string; fin?: string; exercice?: string }) {
  return useQuery({
    queryKey: ['grand-livre', params],
    queryFn: () => apiClient.get<GrandLivreResponse>(`/api/rapports/grand-livre${queryString(params)}`),
    enabled: Boolean(params?.compte),
    staleTime: 60_000,
  })
}

export function useBilanComptable(params?: { exercice?: string }) {
  return useQuery({
    queryKey: ['bilan-comptable', params],
    queryFn: () => apiClient.get<BilanComptableResponse>(`/api/rapports/bilan${queryString(params)}`),
    staleTime: 60_000,
  })
}

export function useResultatAnalytique(params?: { exercice?: string }) {
  return useQuery({
    queryKey: ['resultat-analytique', params],
    queryFn: () => apiClient.get<ResultatAnalytiqueResponse>(`/api/rapports/resultat${queryString(params)}`),
    staleTime: 60_000,
  })
}

export function useSyntheseComptable(params?: { exercice?: string }) {
  return useQuery({
    queryKey: ['synthese-comptable', params],
    queryFn: () => apiClient.get<SyntheseComptableResponse>(`/api/rapports/synthese${queryString(params)}`),
    staleTime: 60_000,
  })
}

export function useControlesComptables(params?: { exercice?: string }) {
  return useQuery({
    queryKey: ['controles-comptables', params],
    queryFn: () => apiClient.get<ControlesComptablesResponse>(`/api/rapports/controles${queryString(params)}`),
    staleTime: 60_000,
  })
}

export function useClotureComptable(params?: { exercice?: string }) {
  return useQuery({
    queryKey: ['cloture-comptable', params],
    queryFn: () => apiClient.get<ClotureComptableResponse>(`/api/rapports/cloture${queryString(params)}`),
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

export function useCharges(params?: { statut?: string; categorie?: string; fournisseur?: string; from?: string; to?: string; justificatif?: string }) {
  return useQuery({
    queryKey: ['charges', params],
    queryFn: () => apiClient.get<ChargesResponse>(`/api/charges${queryString(params)}`),
    staleTime: 30_000,
  })
}

export function useSortiesTresorerie(params?: { charge_id?: string; mode_paiement?: string; statut?: string; justificatif?: string; from?: string; to?: string }) {
  return useQuery({
    queryKey: ['sorties-tresorerie', params],
    queryFn: () => apiClient.get<SortiesTresorerieResponse>(`/api/sorties-tresorerie${queryString(params)}`),
    staleTime: 30_000,
  })
}

export function useChargesDashboard(params?: { from?: string; to?: string }) {
  return useQuery({
    queryKey: ['charges-dashboard', params],
    queryFn: () => apiClient.get<ChargesDashboard>(`/api/charges/dashboard${queryString(params)}`),
    staleTime: 30_000,
  })
}

function invalidateCharges(qc: ReturnType<typeof useQueryClient>) {
  void qc.invalidateQueries({ queryKey: ['charges'] })
  void qc.invalidateQueries({ queryKey: ['sorties-tresorerie'] })
  void qc.invalidateQueries({ queryKey: ['charges-dashboard'] })
  void qc.invalidateQueries({ queryKey: ['ecritures'] })
  void qc.invalidateQueries({ queryKey: ['resultat-analytique'] })
  void qc.invalidateQueries({ queryKey: ['synthese-comptable'] })
  void qc.invalidateQueries({ queryKey: ['controles-comptables'] })
}

export function useCreerCharge() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: {
      fournisseur_nom: string
      categorie: string
      compte_charge: string
      date_charge: string
      date_echeance?: string
      montant_ht_xaf: number
      tva_xaf: number
      mode_paiement?: ModePaiementCharge
      compte_tresorerie?: string
      reference_paiement?: string
      justificatif_statut?: JustificatifStatut
      description?: string
      notes?: string
    }) => apiClient.post<Charge>('/api/charges', payload),
    onSuccess: (charge) => {
      invalidateCharges(qc)
      toast.success(`Charge ${charge.numero ?? ''} creee`)
    },
    onError: (err: Error) => toast.error(err.message),
  })
}

export function useUpdateStatutCharge() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, statut, notes }: { id: string; statut: 'a_valider' | 'validee' | 'annulee'; notes?: string }) =>
      apiClient.patch<Charge>(`/api/charges/${id}/statut`, { statut, notes }),
    onSuccess: () => {
      invalidateCharges(qc)
      toast.success('Statut de charge mis a jour')
    },
    onError: (err: Error) => toast.error(err.message),
  })
}

export function useCreerSortieTresorerie() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: {
      charge_id?: string
      date_sortie: string
      beneficiaire: string
      motif: string
      montant_xaf: number
      mode_paiement: ModePaiementSortie
      compte_tresorerie: string
      reference_paiement?: string
      justificatif_statut?: JustificatifStatut
      notes?: string
    }) => apiClient.post<SortieTresorerie>('/api/sorties-tresorerie', payload),
    onSuccess: (sortie) => {
      invalidateCharges(qc)
      toast.success(`Sortie ${sortie.numero ?? ''} enregistree`)
    },
    onError: (err: Error) => toast.error(err.message),
  })
}

export function useAnnulerSortieTresorerie() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiClient.patch<SortieTresorerie>(`/api/sorties-tresorerie/${id}/annuler`, {}),
    onSuccess: () => {
      invalidateCharges(qc)
      toast.success('Sortie annulee')
    },
    onError: (err: Error) => toast.error(err.message),
  })
}

export function useUploadJustificatifCharge() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ chargeId, file, description }: { chargeId: string; file: File; description?: string }) => {
      const form = new FormData()
      form.append('file', file)
      if (description) form.append('description', description)
      return apiClient.postForm(`/api/charges/${chargeId}/justificatifs`, form)
    },
    onSuccess: () => {
      invalidateCharges(qc)
      toast.success('Justificatif ajoute')
    },
    onError: (err: Error) => toast.error(err.message),
  })
}

export function useUploadJustificatifSortie() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ sortieId, file, description }: { sortieId: string; file: File; description?: string }) => {
      const form = new FormData()
      form.append('file', file)
      if (description) form.append('description', description)
      return apiClient.postForm(`/api/sorties-tresorerie/${sortieId}/justificatifs`, form)
    },
    onSuccess: () => {
      invalidateCharges(qc)
      toast.success('Justificatif ajoute')
    },
    onError: (err: Error) => toast.error(err.message),
  })
}

export function useDeclarationsFiscales(params?: { type?: string; statut?: string }) {
  return useQuery({
    queryKey: ['declarations-fiscales', params],
    queryFn: () => apiClient.get<DeclarationsResponse>(`/api/declarations-fiscales${queryString(params)}`),
    staleTime: 30_000,
  })
}

export function usePreparerDeclarationTva() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: { periode: string; notes?: string }) =>
      apiClient.post('/api/declarations-fiscales/tva/preparer', payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['declarations-fiscales'] })
      toast.success('Déclaration TVA préparée')
    },
    onError: (err: Error) => toast.error(err.message),
  })
}

export function useUpdateStatutDeclaration() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, statut }: { id: string; statut: DeclarationFiscale['statut'] }) =>
      apiClient.patch(`/api/declarations-fiscales/${id}/statut`, { statut }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['declarations-fiscales'] })
      toast.success('Statut fiscal mis à jour')
    },
    onError: (err: Error) => toast.error(err.message),
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

export function useRelanceFacture() {
  return useMutation({
    mutationFn: (payload: { id: string; message?: string }) =>
      apiClient.post<{ url: string; telephone: string | null; message: string; solde_restant_xaf: number }>(
        `/api/factures/${payload.id}/relance`,
        { message: payload.message },
      ),
    onError: (err: Error) => toast.error(err.message),
  })
}
