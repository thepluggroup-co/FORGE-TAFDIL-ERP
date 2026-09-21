import React, { useEffect, useMemo, useState } from 'react'
import { TopBar } from '../components/TopBar'
import { COMPANY_NAME } from '@forge/shared'
import { fetchCommandes, fetchStocks, type ApiCommandeClient, type ApiStock } from '../lib/api'

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

function formatXAF(amount: number): string {
  return new Intl.NumberFormat('fr-CM', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount) + ' FCFA'
}

export function DashboardPage() {
  const [stocks, setStocks] = useState<ApiStock[]>([])
  const [orders, setOrders] = useState<ApiCommandeClient[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    setLoading(true)
    setError('')

    Promise.all([fetchStocks({ per_page: 100 }), fetchCommandes({ per_page: 100 })])
      .then(([stocksRes, commandesRes]) => {
        setStocks(stocksRes.data)
        setOrders(commandesRes.data)
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'Erreur de chargement')
      })
      .finally(() => setLoading(false))
  }, [])

  const totalRevenue = useMemo(
    () => orders
      .filter(order => order.statut === 'delivered')
      .reduce((sum, order) => sum + order.total_ttc_xaf, 0),
    [orders],
  )

  const totalBoutiqueSales = useMemo(
    () => orders.reduce((sum, order) => sum + order.total_ttc_xaf, 0),
    [orders],
  )

  const boutiqueOrdersCount = useMemo(
    () => orders.length,
    [orders],
  )

  const activeOrders = useMemo(
    () => orders.filter(order => !['delivered', 'cancelled'].includes(order.statut)).length,
    [orders],
  )

  const lowStock = useMemo(
    () => stocks.filter(stock => stock.stock_actuel < 10).length,
    [stocks],
  )

  const recentOrders = useMemo(
    () => [...orders].sort((a, b) => new Date(b.date_commande).getTime() - new Date(a.date_commande).getTime()).slice(0, 3),
    [orders],
  )

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-gray-600">Chargement des données…</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 px-6">
        <div className="bg-white p-6 rounded-3xl border border-red-100 shadow-sm text-center">
          <p className="text-sm text-red-600 mb-2">{error}</p>
          <p className="text-sm text-gray-500">Vérifiez que l'API backend est bien démarrée et accessible.</p>
        </div>
      </div>
    )
  }

  return (
    <div>
      <TopBar title="Tableau de bord" subtitle={COMPANY_NAME} />

      <div className="px-4 py-4 space-y-5">
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
            label="Ventes boutique"
            value={formatXAF(totalBoutiqueSales)}
            icon="🛍️"
            color="bg-indigo-50 text-indigo-700"
          />
          <KpiTile
            label="Commandes boutique"
            value={String(boutiqueOrdersCount)}
            icon="🧾"
            color="bg-teal-50 text-teal-700"
          />
          <KpiTile
            label="Stock faible"
            value={String(lowStock)}
            icon="⚠️"
            color={lowStock > 0 ? 'bg-red-50 text-red-700' : 'bg-gray-50 text-gray-500'}
          />
        </div>

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
                  <p className="text-sm font-semibold text-gray-900 truncate">{order.client.nom}</p>
                  <p className="text-xs text-gray-400 mt-0.5">{formatXAF(order.total_ttc_xaf)}</p>
                </div>
                <span className={`text-xs font-medium px-2 py-1 rounded-full shrink-0 ml-2 ${statusColor[order.statut]}`}>
                  {statusLabels[order.statut] ?? order.statut}
                </span>
              </div>
            ))}
          </div>
        </section>

        {lowStock > 0 && (
          <section>
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-2">
              Stocks en alerte
            </h2>
            <div className="space-y-2">
              {stocks
                .filter(stock => stock.stock_actuel < 10)
                .map(stock => (
                  <div
                    key={stock.id}
                    className="bg-white rounded-xl border border-red-100 px-4 py-3 flex items-center justify-between"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-gray-900 truncate">{stock.designation}</p>
                      <p className="text-xs text-gray-400">{stock.ref}</p>
                    </div>
                    <span className={`text-sm font-bold shrink-0 ml-2 ${stock.stock_actuel === 0 ? 'text-red-600' : 'text-orange-500'}`}>
                      {stock.stock_actuel === 0 ? 'Épuisé' : `${stock.stock_actuel} restants`}
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
