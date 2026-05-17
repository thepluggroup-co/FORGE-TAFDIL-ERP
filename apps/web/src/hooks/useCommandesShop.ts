import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase'
import { apiClient } from '@/lib/api-client'

// ── Types ──────────────────────────────────────────────────────────────────────

export type StatutPaiement = 'en_attente' | 'paye' | 'echec' | 'rembourse'
export type StatutCommandeShop = 'recue' | 'confirmee' | 'en_preparation' | 'expediee' | 'livree' | 'annulee'
export type ModePaiement = 'mtn_momo' | 'orange_money' | 'livraison'

export interface LigneCommandeShop {
  designation:   string
  quantite:      number
  prix_unitaire: number
  total_ht:      number
}

export interface CommandeShop {
  id:                string
  ref:               string
  client_nom:        string
  client_telephone:  string
  client_email?:     string
  client_adresse:    string
  client_ville?:     string
  lignes:            LigneCommandeShop[]
  montant_ht:        number
  tva:               number
  montant_ttc:       number
  frais_livraison:   number
  mode_paiement:     ModePaiement
  statut_paiement:   StatutPaiement
  statut_commande:   StatutCommandeShop
  notes_client?:     string
  payment_reference?: string
  erp_commande_id?:  string
  created_at:        string
  updated_at:        string
}

export interface CommandesShopStats {
  nouvelles_ce_jour:      number
  en_attente_paiement:    number
  confirmees:             number
  ca_web_mois:            number
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function buildStats(data: CommandeShop[]): CommandesShopStats {
  const today = new Date().toISOString().split('T')[0]
  const debutMois = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString()

  return {
    nouvelles_ce_jour:   data.filter((c) => c.created_at.startsWith(today)).length,
    en_attente_paiement: data.filter((c) => c.statut_paiement === 'en_attente').length,
    confirmees:          data.filter((c) => c.statut_paiement === 'paye').length,
    ca_web_mois:         data
      .filter((c) => c.created_at >= debutMois && c.statut_commande !== 'annulee')
      .reduce((s, c) => s + (c.montant_ttc ?? 0), 0),
  }
}

// ── Query : liste commandes_shop ───────────────────────────────────────────────

interface CommandesShopParams {
  statut_commande?: StatutCommandeShop | 'tous'
  statut_paiement?: StatutPaiement | 'tous'
  search?: string
}

export function useCommandesShop(params?: CommandesShopParams) {
  return useQuery({
    queryKey: ['commandes-shop', params],
    queryFn: async (): Promise<{ data: CommandeShop[]; stats: CommandesShopStats }> => {
      let query = supabase
        .from('commandes_shop')
        .select('*')
        .order('created_at', { ascending: false })

      if (params?.statut_commande && params.statut_commande !== 'tous') {
        query = query.eq('statut_commande', params.statut_commande)
      }
      if (params?.statut_paiement && params.statut_paiement !== 'tous') {
        query = query.eq('statut_paiement', params.statut_paiement)
      }
      if (params?.search) {
        query = query.or(`ref.ilike.%${params.search}%,client_nom.ilike.%${params.search}%`)
      }

      const { data, error } = await query

      if (error) throw new Error(error.message)

      const rows = (data ?? []) as CommandeShop[]

      // Stats calculées sur la totalité (sans filtre) pour l'en-tête
      const { data: all } = await supabase.from('commandes_shop').select('*')
      const stats = buildStats((all ?? []) as CommandeShop[])

      return { data: rows, stats }
    },
    staleTime: 15_000,
    refetchInterval: 60_000,
  })
}

// ── Mutation : changer statut commande web (appelle l'API ERP) ─────────────────

interface ChangerStatutPayload {
  id:               string
  statut_commande:  StatutCommandeShop
  statut_paiement?: StatutPaiement
}

export function useStatutCommandeShop() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: ChangerStatutPayload) =>
      apiClient.patch<CommandeShop>(`/api/commandes/web/${payload.id}/statut`, {
        statut_commande:  payload.statut_commande,
        statut_paiement:  payload.statut_paiement,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['commandes-shop'] })
    },
    onError: (err: Error) => toast.error(err.message),
  })
}

// ── Export stats helper ────────────────────────────────────────────────────────

export { buildStats }
