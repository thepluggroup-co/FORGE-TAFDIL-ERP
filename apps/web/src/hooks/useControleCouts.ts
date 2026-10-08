// Indicateurs atelier et contrôle des coûts (Catalogue Hybride Phase 8)

import { useQuery } from '@tanstack/react-query'
import type { CoutsOF, MargeCommande } from '@forge/shared'
import { apiClient } from '@/lib/api-client'

export interface IndicateursProduction {
  of_en_cours:  number
  of_a_lancer:  number
  of_en_retard: number
  machines: { operationnelles: number; total: number; en_panne: number; en_maintenance: number }
  rendement_30j_pct:   number | null
  etapes_mesurees_30j: number
  anomalies: { total: number; of_en_retard: number; machines_en_panne: number }
}

export function useIndicateursProduction() {
  return useQuery({
    queryKey: ['jobs', 'indicateurs'],
    queryFn:  () => apiClient.get<{ data: IndicateursProduction }>('/api/production/indicateurs').then((r) => r.data),
    staleTime: 60_000,
    refetchInterval: 120_000,
  })
}

/** Coût prévu / réel d'un OF — `enabled` uniquement avec le droit COMMERCIAL:CONFIGURE. */
export function useCoutsOF(jobId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: ['jobs', jobId, 'couts'],
    queryFn:  () => apiClient.get<{ data: CoutsOF }>(`/api/production/jobs/${jobId}/couts`).then((r) => r.data),
    enabled:  !!jobId && enabled,
    retry:    false,
  })
}

export interface LigneControleCommande {
  commande_id: string
  numero:      string
  client_nom:  string | null
  statut:      string
  nb_of:       number
  marge:       MargeCommande
}

export interface SyntheseControleCouts {
  data: LigneControleCommande[]
  totaux: {
    prix_vente_ht_xaf: number
    cout_revient_reel_xaf: number
    marge_reelle_xaf: number
    taux_marge_reelle_pct: number | null
    commandes_deficitaires: number
  }
  periode_jours: number
}

export interface ConsommationCommande {
  type: 'materiau' | 'consommable'
  designation: string
  unite: string
  produit_id: string | null
  quantite_prevue: number
  quantite_reelle: number | null
  quantite_sortie_stock: number
  ofs: string[]
}

export interface ConsommationsCommande {
  commande: { id: string; numero: string; client_nom: string | null }
  source: 'ordres_fabrication' | 'devis' | 'aucune'
  data: ConsommationCommande[]
}

export function useConsommationsCommande(commandeId: string | null) {
  return useQuery({
    queryKey: ['jobs', commandeId, 'consommations-commande'],
    queryFn: () => apiClient.get<ConsommationsCommande>(`/api/production/commandes/${commandeId}/consommations`),
    enabled: !!commandeId,
    staleTime: 0,
  })
}

export function useSyntheseControleCouts(jours: number, enabled: boolean) {
  return useQuery({
    queryKey: ['jobs', 'controle-couts', jours],
    queryFn:  () => apiClient.get<SyntheseControleCouts>(`/api/production/couts/synthese?jours=${jours}`),
    enabled,
    retry:    false,
    staleTime: 60_000,
  })
}
