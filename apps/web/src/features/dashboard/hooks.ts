// Requêtes propres au tableau de bord — endpoints sans hook existant, ou dont le
// hook existant affiche un toast d'erreur (inadapté à un simple indicateur).

import { useQuery } from '@tanstack/react-query'
import { apiClient } from '@/lib/api-client'
import { useHistoriqueTickets } from '@/hooks/useCaisse'
import type { CreditDashboard, OverdueRow } from '@/hooks/useCredit'
import type { Livraison } from '@/hooks/useOperations'

export interface PreparationResume {
  a_preparer: number
  en_cours: number
  pret_a_livrer: number
  planifiee: number
}

export function usePreparationResume() {
  return useQuery({
    queryKey: ['logistique', 'preparation-resume'],
    queryFn:  () => apiClient.get<PreparationResume>('/api/logistique/preparation/resume'),
    staleTime: 30_000,
    refetchInterval: 60_000,
  })
}

/** Livraisons assignées à l'utilisateur connecté (livreur). */
export function useMesLivraisons() {
  return useQuery({
    queryKey: ['livraisons', 'mes-livraisons'],
    queryFn:  () => apiClient.get<{ data: Livraison[]; total: number }>('/api/logistique/livraisons/mes-livraisons?per_page=50'),
    staleTime: 30_000,
    refetchInterval: 60_000,
  })
}

export function useCreancesResume() {
  return useQuery({
    queryKey: ['credit', 'dashboard'],
    queryFn:  () => apiClient.get<CreditDashboard>('/api/credit/dashboard'),
    staleTime: 60_000,
  })
}

export function useEcheancesEnRetard() {
  return useQuery({
    queryKey: ['credit', 'overdue'],
    queryFn:  () => apiClient.get<{ data: OverdueRow[] }>('/api/credit/overdue').then((r) => r.data ?? []),
    staleTime: 60_000,
  })
}

function jourLocal(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * Ventes caisse du jour. L'API ne renvoie à un caissier que ses propres tickets
 * (un responsable voit tous les postes). Le filtre de date est réappliqué ici :
 * en Electron la lecture locale renvoie les derniers tickets sans filtre.
 */
export function useVentesCaisseDuJour() {
  const today = jourLocal()
  const query = useHistoriqueTickets({ date_debut: today, per_page: 100 })
  const tickets = (query.data?.data ?? []).filter(
    (t) => jourLocal(new Date(t.created_at)) === today && t.statut !== 'annule' && t.statut !== 'annulee',
  )
  const total = tickets.reduce((s, t) => s + Number(t.total_ttc_xaf ?? 0), 0)
  return { ...query, tickets, total, count: tickets.length }
}
