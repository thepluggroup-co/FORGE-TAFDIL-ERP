import React, { useState } from 'react'
import type { OrderStatus } from '@forge/shared'
import { TopBar } from '../components/TopBar'
import { mockOrders, formatXAF } from '../data/mock'

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

export function OrdersPage() {
  const [filter, setFilter] = useState<OrderStatus | 'all'>('all')

  const filtered = filter === 'all'
    ? mockOrders
    : mockOrders.filter(o => o.status === filter)

  const activeCount = mockOrders.filter(
    o => !['delivered', 'cancelled'].includes(o.status),
  ).length

  return (
    <div>
      <TopBar title="Commandes" subtitle={`${activeCount} active${activeCount > 1 ? 's' : ''}`} />

      {/* Filter chips */}
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

      <div className="px-4 pb-4 space-y-2">
        {filtered.length === 0 && (
          <div className="text-center py-16 text-gray-400">
            <p className="text-3xl mb-2">📋</p>
            <p className="text-sm">Aucune commande</p>
          </div>
        )}
        {filtered.map(order => {
          const date = new Date(order.createdAt).toLocaleDateString('fr-FR', {
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
                  <p className="text-sm font-semibold text-gray-900 truncate">{order.clientName}</p>
                  {order.clientPhone && (
                    <p className="text-xs text-gray-400 mt-0.5">{order.clientPhone}</p>
                  )}
                </div>
                <span className={`text-xs font-medium px-2 py-1 rounded-full shrink-0 ${statusColor[order.status]}`}>
                  {statusLabel[order.status]}
                </span>
              </div>
              <div className="flex items-center justify-between mt-2">
                <span className="text-sm font-bold text-[#C62828]">{formatXAF(order.totalXAF)}</span>
                <span className="text-xs text-gray-400">{date}</span>
              </div>
            </div>
          )
        })}
      </div>
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
