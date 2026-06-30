import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { dbGetCommandes, dbCreateCommande, dbUpdateStatutCommande } from '@/lib/db'
import { useAuth } from '@/context/AuthContext'
import { apiClient } from '@/lib/api-client'

export interface ConditionPaiement {
  id: string; code: string; libelle: string
  acompte_pct: number; delai_solde_jours: number
}
export interface ConditionPaiementEligible extends ConditionPaiement {
  eligible: boolean
  raison: string | null
}
export interface CommandeLigne {
  designation: string; quantite: number; prix_unitaire_ht_xaf: number; unite?: string
}
export interface CommandeHistorique {
  statut: string; created_at: string; commentaire?: string | null
}
export interface Commande {
  id: string; reference: string
  statut: 'confirmed' | 'in_production' | 'pret' | 'delivered' | 'cancelled'
  date_commande: string | null; date_livraison_prevue: string | null
  montant_ttc_xaf: number; acompte_recu_xaf: number; solde_restant_xaf: number
  condition_paiement_id: string | null
  condition_paiement: ConditionPaiement | null
  montant_acompte: number
  date_echeance_solde: string | null
  statut_paiement: 'non_paye' | 'acompte_recu' | 'solde_recu' | 'solde_en_retard'
  notes: string | null; client: { id: string; nom: string; telephone: string }
  lignes: CommandeLigne[]; historique: CommandeHistorique[]
}
export interface CreateCommandeLigne {
  produit_id?: string; designation: string; unite?: string
  quantite: number; prix_unitaire_ht_xaf: number; ordre?: number
}
export interface CreateCommandePayload {
  client_id?: string; client_nom: string; devis_id?: string; date_commande: string
  client_telephone?: string; client_email?: string; client_adresse?: string; client_ville?: string
  date_livraison_prevue?: string; notes?: string; acompte_recu_xaf?: number
  condition_paiement_id?: string
  lignes: CreateCommandeLigne[]
}
interface CommandesResponse { data: Commande[]; total: number }

export function useCommandes(params?: { statut?: string; search?: string; enabled?: boolean }) {
  return useQuery({
    queryKey:  ['commandes', { statut: params?.statut, search: params?.search }],
    queryFn:   () => dbGetCommandes(params) as Promise<CommandesResponse>,
    staleTime: 20_000,
    enabled:   params?.enabled !== false,
  })
}

export function useCreateCommande() {
  const qc   = useQueryClient()
  const auth = useAuth()
  return useMutation({
    mutationFn: (payload: CreateCommandePayload) =>
      dbCreateCommande(payload, auth.user?.id),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['commandes'] }); toast.success('Commande créée') },
    onError:   (err: Error) => toast.error(err.message),
  })
}

export function useConditionsPaiement() {
  return useQuery({
    queryKey:  ['conditions-paiement'],
    queryFn:   () => apiClient.get<{ data: ConditionPaiement[] }>('/api/conditions-paiement').then(r => r.data ?? []),
    staleTime: 5 * 60_000,
  })
}

export function useConditionsPaiementEligibles(
  clientId: string | undefined,
  montant: number,
  type: 'web' | 'devis' | 'projet' = 'devis',
) {
  return useQuery({
    queryKey: ['conditions-paiement-eligibles', clientId ?? null, Math.round(Math.max(0, montant)), type],
    queryFn: () => {
      const params = new URLSearchParams({ montant: String(Math.round(Math.max(0, montant))), type })
      if (clientId) params.set('client_id', clientId)
      return apiClient
        .get<{ data: ConditionPaiementEligible[] }>(`/api/conditions-paiement/eligibles?${params}`)
        .then((r) => r.data ?? [])
    },
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  })
}

export function useStatutCommande() {
  const qc   = useQueryClient()
  const auth = useAuth()
  return useMutation({
    mutationFn: ({ id, statut, commentaire }: { id: string; statut: string; commentaire?: string }) =>
      dbUpdateStatutCommande(id, statut, commentaire, auth.user?.id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['commandes'] }),
    onError:   (err: Error) => toast.error(err.message),
  })
}
