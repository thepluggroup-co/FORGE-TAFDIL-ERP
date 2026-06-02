import React from 'react'
import { TopBar } from '../components/TopBar'
import { mockOrders, mockProducts, formatXAF } from '../data/mock'
import { COMPANY_NAME } from '@forge/shared'

const statusLabels: Record<string, string> = {
  draft: 'Brouillon',
  confirmed: 'Confirmé',
  in_production: 'En production',
  shipped: 'Expédié',
  delivered: 'Livré',
  cancelled: 'Annulé',
}

const statusColor: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-600',
  confirmed: 'bg-blue-100 text-blue-700',
  in_production: 'bg-yellow-100 text-yellow-700',
  shipped: 'bg-orange-100 text-orange-700',
  delivered: 'bg-green-100 text-green-700',
  cancelled: 'bg-red-100 text-red-700',
}

export function DashboardPage() {
  const totalRevenue = mockOrders
    .filter(o => o.status === 'delivered')
    .reduce((sum, o) => sum + o.totalXAF, 0)

  const activeOrders = mockOrders.filter(
    o => !['delivered', 'cancelled'].includes(o.status),
  ).length

  const lowStock = mockProducts.filter(p => p.stock < 10).length
  const recentOrders = [...mockOrders].reverse().slice(0, 3)

  return (
    <div>
      <TopBar title="Tableau de bord" subtitle={COMPANY_NAME} />

      <div className="px-4 py-4 space-y-5">
        {/* KPI row */}
        <div className="grid grid-cols-2 gap-3">
          <KpiTile
            label="Revenus livrés"
            value={formatXAF(totalRevenue)}
            icon="💰"
            color="bg-green-50 text-green-700"
          />
          <KpiTile
            label="Commandes actives"
            value={String(activeOrders)}
            icon="📦"
            color="bg-blue-50 text-blue-700"
          />
          <KpiTile
            label="Produits"
            value={String(mockProducts.length)}
            icon="🧵"
            color="bg-purple-50 text-purple-700"
          />
          <KpiTile
            label="Stock faible"
            value={String(lowStock)}
            icon="⚠️"
            color={lowStock > 0 ? 'bg-red-50 text-red-700' : 'bg-gray-50 text-gray-500'}
          />
        </div>

        {/* Recent orders */}
        <section>
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-2">
            Commandes récentes
          </h2>
          <div className="space-y-2">
            {recentOrders.map(order => (
              <div
                key={order.id}
                className="bg-white rounded-xl border border-gray-100 shadow-sm px-4 py-3 flex items-center justify-between"
              >
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-gray-900 truncate">{order.clientName}</p>
                  <p className="text-xs text-gray-400 mt-0.5">{formatXAF(order.totalXAF)}</p>
                </div>
                <span className={`text-xs font-medium px-2 py-1 rounded-full shrink-0 ml-2 ${statusColor[order.status]}`}>
                  {statusLabels[order.status]}
                </span>
              </div>
            ))}
          </div>
        </section>

        {/* Low stock alert */}
        {lowStock > 0 && (
          <section>
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-2">
              Stock faible
            </h2>
            <div className="space-y-2">
              {mockProducts
                .filter(p => p.stock < 10)
                .map(product => (
                  <div
                    key={product.id}
                    className="bg-white rounded-xl border border-red-100 px-4 py-3 flex items-center justify-between"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-gray-900 truncate">{product.name}</p>
                      <p className="text-xs text-gray-400">{product.sku}</p>
                    </div>
                    <span className={`text-sm font-bold shrink-0 ml-2 ${product.stock === 0 ? 'text-red-600' : 'text-orange-500'}`}>
                      {product.stock === 0 ? 'Épuisé' : `${product.stock} restants`}
                    </span>
                  </div>
                ))}
            </div>
          </section>
        )}
      </div>
    </div>
  )
}

function KpiTile({
  label,
  value,
  icon,
  color,
}: {
  label: string
  value: string
  icon: string
  color: string
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm px-4 py-4">
      <div className={`inline-flex items-center justify-center w-9 h-9 rounded-lg text-lg mb-2 ${color}`}>
        {icon}
      </div>
      <p className="text-xl font-bold text-gray-900 leading-tight truncate">{value}</p>
      <p className="text-xs text-gray-500 mt-0.5">{label}</p>
    </div>
  )
}
