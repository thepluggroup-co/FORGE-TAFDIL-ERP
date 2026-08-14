import React, { useCallback, useEffect, useState } from 'react'
import type { OrderStatus } from '@forge/shared'
import { TopBar } from '../components/TopBar'
import { fetchCommandes, type ApiCommandeClient } from '../lib/api'

const ALL_STATUSES: OrderStatus[] = ['draft', 'confirmed', 'in_production', 'shipped', 'delivered', 'cancelled']

const statusLabel: Record<OrderStatus, string> = {
  draft: 'Brouillon',
  confirmed: 'Confirmé',
  in_production: 'En production',
  shipped: 'Expédié',
  delivered: 'Livré',
  cancelled: 'Annulé',
}

const statusColor: Record<OrderStatus, string> = {
  draft: 'bg-gray-100 text-gray-600',
  confirmed: 'bg-blue-100 text-blue-700',
  in_production: 'bg-yellow-100 text-yellow-700',
  shipped: 'bg-orange-100 text-orange-700',
  delivered: 'bg-green-100 text-green-700',
  cancelled: 'bg-red-100 text-red-700',
}

function formatXAF(amount: number): string {
  return new Intl.NumberFormat('fr-CM', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount) + ' FCFA'
}

export function OrdersPage() {
  const [filter, setFilter] = useState<OrderStatus | 'all'>('all')
  const [orders, setOrders] = useState<ApiCommandeClient[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const loadOrders = useCallback(async () => {
    setLoading(true)
    setError('')

    try {
      const result = await fetchCommandes({
        statut: filter === 'all' ? undefined : filter,
        per_page: 100,
      })
      setOrders(result.data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur de chargement des commandes')
    } finally {
      setLoading(false)
    }
  }, [filter])

  useEffect(() => {
    loadOrders()
  }, [loadOrders])

  const activeCount = orders.filter(
    order => !['delivered', 'cancelled'].includes(order.statut),
  ).length

  return (
    <div>
      <TopBar title="Commandes" subtitle={`${activeCount} active${activeCount > 1 ? 's' : ''}`} />

      <div className="px-4 py-3 flex gap-2 overflow-x-auto no-scrollbar">
        <FilterChip
          label="Toutes"
          active={filter === 'all'}
          onClick={() => setFilter('all')}
        />
        {ALL_STATUSES.map(s => (
          <FilterChip
            key={s}
            label={statusLabel[s]}
            active={filter === s}
            onClick={() => setFilter(s)}
          />
        ))}
      </div>

      {loading ? (
        <div className="px-4 py-10 text-center text-gray-500">Chargement des commandes…</div>
      ) : error ? (
        <div className="px-4 py-10 text-center text-red-600">{error}</div>
      ) : orders.length === 0 ? (
        <div className="px-4 py-16 text-center text-gray-400">
          <p className="text-3xl mb-2">📋</p>
          <p className="text-sm">Aucune commande</p>
        </div>
      ) : (
        <div className="px-4 pb-4 space-y-2">
          {orders.map(order => {
            const date = new Date(order.date_commande).toLocaleDateString('fr-FR', {
              day: '2-digit',
              month: 'short',
            })
            return (
              <div
                key={order.id}
                className="bg-white rounded-xl border border-gray-100 shadow-sm px-4 py-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-gray-900 truncate">{order.client.nom}</p>
                    {order.client.telephone && (
                      <p className="text-xs text-gray-400 mt-0.5">{order.client.telephone}</p>
                    )}
                  </div>
                  <span className={`text-xs font-medium px-2 py-1 rounded-full shrink-0 ${statusColor[order.statut as OrderStatus] ?? 'bg-gray-100 text-gray-600'}`}>
                    {statusLabel[order.statut as OrderStatus] ?? order.statut}
                  </span>
                </div>
                <div className="flex items-center justify-between mt-2">
                  <span className="text-sm font-bold text-[#C62828]">{formatXAF(order.total_ttc_xaf)}</span>
                  <span className="text-xs text-gray-400">{date}</span>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function FilterChip({
  label,
  active,
  onClick,
}: {
  label: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
        active
          ? 'bg-[#C62828] text-white'
          : 'bg-white border border-gray-200 text-gray-600'
      }`}
    >
      {label}
    </button>
  )
}
