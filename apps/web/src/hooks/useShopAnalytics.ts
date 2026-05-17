import { useQuery } from '@tanstack/react-query'
import { apiClient } from '@/lib/api-client'

// ── Types ──────────────────────────────────────────────────────────────────────

export interface ShopKpis {
  commandes_aujourd_hui: number
  ca_aujourd_hui:        number
  commandes_mois:        number
  ca_mois:               number
  panier_moyen:          number
}

export interface CaMoisEntry {
  mois:     string   // "2026-05"
  ca_shop:  number
  ca_erp:   number
  ca_total: number
}

export interface ShopAnalytics {
  kpis:       ShopKpis
  ca_mensuel: CaMoisEntry[]
}

// ── Hook ───────────────────────────────────────────────────────────────────────

export function useShopAnalytics() {
  return useQuery({
    queryKey: ['shop-analytics'],
    queryFn:  () => apiClient.get<{ data: ShopAnalytics }>('/api/shop-erp/analytics').then((r) => r.data),
    staleTime: 60_000,
    refetchInterval: 120_000,
  })
}
