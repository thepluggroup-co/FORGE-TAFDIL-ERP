import React, { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { TopBar } from '../components/TopBar'
import { COMPANY_NAME } from '@forge/shared'
import { useAuth, type MobileRole } from '../context/AuthContext'
import {
  fetchCommandes, fetchStocks, fetchBonsSoumis, fetchMesLivraisons, fetchSessionCourante, fetchRapportZ,
  type ApiCommandeClient, type ApiStock, type Livraison, type CaisseSession, type RapportZ,
} from '../lib/api'

// Valeurs réelles de commandes.statut (commandeStatutEnum, packages/db/src/schema.pg.ts) —
// cf. même correction dans OrdersPage.tsx.
const statusLabels: Record<string, string> = {
  confirmed: 'Confirmé',
  in_production: 'En production',
  pret: 'Prêt',
  delivered: 'Livré',
  cancelled: 'Annulé',
}

const statusColor: Record<string, string> = {
  confirmed: 'bg-blue-100 text-blue-700',
  in_production: 'bg-yellow-100 text-yellow-700',
  pret: 'bg-purple-100 text-purple-700',
  delivered: 'bg-green-100 text-green-700',
  cancelled: 'bg-red-100 text-red-700',
}

const livraisonLabels: Record<string, string> = {
  planifiee: 'Planifiée',
  en_transit: 'En route',
  livree: 'Livrée',
  annulee: 'Annulée',
}

const livraisonColor: Record<string, string> = {
  planifiee: 'bg-blue-100 text-blue-700',
  en_transit: 'bg-yellow-100 text-yellow-700',
  livree: 'bg-green-100 text-green-700',
  annulee: 'bg-red-100 text-red-700',
}

function formatXAF(amount: number): string {
  return new Intl.NumberFormat('fr-CM', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount) + ' FCFA'
}

// ── Contenu par rôle ──────────────────────────────────────────────────────────
// Chaque rôle ne charge que les données de son activité : un livreur ou un
// caissier n'a pas accès aux commandes, et l'ancien chargement commun
// (stocks + commandes pour tous) leur affichait un écran d'erreur.

type Source = 'commandes' | 'stocks' | 'bons' | 'livraisons' | 'caisse'
type Section = 'ventes' | 'commandes' | 'approbation' | 'stock' | 'livraisons' | 'caisse'

const ROLE_VIEW: Record<MobileRole, { subtitle: string; sources: Source[]; sections: Section[] }> = {
  admin:       { subtitle: 'Direction',   sources: ['commandes', 'stocks', 'bons'], sections: ['ventes', 'approbation', 'commandes', 'stock'] },
  manager: { subtitle: 'Supervision', sources: ['commandes', 'stocks', 'bons'], sections: ['approbation', 'commandes', 'stock'] },
  operateur:   { subtitle: 'Commercial',  sources: ['commandes', 'stocks'],         sections: ['commandes', 'stock'] },
  apprenant:   { subtitle: 'Atelier',     sources: ['commandes', 'stocks'],         sections: ['commandes', 'stock'] },
  caissier:    { subtitle: 'Caisse',      sources: ['caisse', 'stocks'],            sections: ['caisse', 'stock'] },
  livreur:     { subtitle: 'Livraison',   sources: ['livraisons'],                  sections: ['livraisons'] },
}

interface DashboardData {
  orders: ApiCommandeClient[]
  stocks: ApiStock[]
  bonsSoumis: number
  livraisons: Livraison[]
  session: CaisseSession | null
  rapport: RapportZ | null
}

const EMPTY: DashboardData = { orders: [], stocks: [], bonsSoumis: 0, livraisons: [], session: null, rapport: null }

async function loadSource(source: Source): Promise<Partial<DashboardData>> {
  switch (source) {
    case 'commandes':  return { orders: (await fetchCommandes({ per_page: 100 })).data }
    case 'stocks':     return { stocks: (await fetchStocks({ per_page: 100 })).data }
    case 'bons':       return { bonsSoumis: (await fetchBonsSoumis()).length }
    case 'livraisons': return { livraisons: await fetchMesLivraisons() }
    case 'caisse': {
      const session = await fetchSessionCourante()
      return { session, rapport: session ? await fetchRapportZ(session.id) : null }
    }
  }
}

export function DashboardPage() {
  const { user } = useAuth()
  const view = ROLE_VIEW[user?.role ?? 'operateur']

  const [data, setData] = useState<DashboardData>(EMPTY)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')

    // allSettled : une source refusée ou indisponible ne vide pas tout l'écran.
    Promise.allSettled(view.sources.map(loadSource)).then((results) => {
      if (cancelled) return
      const next = { ...EMPTY }
      let failures = 0
      for (const r of results) {
        if (r.status === 'fulfilled') Object.assign(next, r.value)
        else failures++
      }
      setData(next)
      if (failures === results.length && results.length > 0) {
        const first = results[0] as PromiseRejectedResult
        setError(first.reason instanceof Error ? first.reason.message : 'Erreur de chargement')
      }
      setLoading(false)
    })

    return () => { cancelled = true }
  }, [view])

  const { orders, stocks, bonsSoumis, livraisons, session, rapport } = data

  const totalRevenue = useMemo(
    () => orders
      .filter(order => order.statut === 'delivered')
      .reduce((sum, order) => sum + order.montant_ttc_xaf, 0),
    [orders],
  )

  const totalSales = useMemo(
    () => orders
      .filter(order => order.statut !== 'cancelled')
      .reduce((sum, order) => sum + order.montant_ttc_xaf, 0),
    [orders],
  )

  const activeOrders = useMemo(
    () => orders.filter(order => !['delivered', 'cancelled'].includes(order.statut)),
    [orders],
  )

  const readyOrders = useMemo(() => orders.filter(order => order.statut === 'pret').length, [orders])

  const lowStockItems = useMemo(() => stocks.filter(stock => stock.stock_actuel < 10), [stocks])
  const lowStock = lowStockItems.length

  const recentOrders = useMemo(
    () => [...orders].sort((a, b) => new Date(b.date_commande).getTime() - new Date(a.date_commande).getTime()).slice(0, 3),
    [orders],
  )

  const livraisonsOuvertes = useMemo(
    () => livraisons.filter(l => l.statut === 'planifiee' || l.statut === 'en_transit'),
    [livraisons],
  )
  const livreesAujourdhui = useMemo(() => {
    const today = new Date().toDateString()
    return livraisons.filter(l =>
      l.statut === 'livree' && !!l.date_livraison_reelle && new Date(l.date_livraison_reelle).toDateString() === today,
    ).length
  }, [livraisons])

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

  const has = (section: Section) => view.sections.includes(section)
  const lowStockTile = (
    <KpiTile
      label="Stock faible"
      value={String(lowStock)}
      icon="⚠️"
      color={lowStock > 0 ? 'bg-red-50 text-red-700' : 'bg-gray-50 text-gray-500'}
    />
  )

  return (
    <div>
      <TopBar title="Tableau de bord" subtitle={`${COMPANY_NAME} · ${view.subtitle}`} />

      <div className="px-4 py-4 space-y-5">
        <div className="grid grid-cols-2 gap-3">
          {has('caisse') && (
            <>
              <KpiTile
                label={session ? 'Session ouverte' : 'Session fermée'}
                value={session ? formatXAF(session.fond_ouverture_xaf) : '—'}
                icon="🏦"
                color={session ? 'bg-green-50 text-green-700' : 'bg-gray-50 text-gray-500'}
              />
              <KpiTile
                label="Ventes de la session"
                value={formatXAF(rapport?.total_ttc_xaf ?? 0)}
                icon="💰"
                color="bg-indigo-50 text-indigo-700"
              />
              <KpiTile
                label="Tickets"
                value={String(rapport?.tickets_count ?? 0)}
                icon="🧾"
                color="bg-teal-50 text-teal-700"
              />
            </>
          )}

          {has('livraisons') && (
            <>
              <KpiTile
                label="À livrer"
                value={String(livraisons.filter(l => l.statut === 'planifiee').length)}
                icon="📦"
                color="bg-blue-50 text-blue-700"
              />
              <KpiTile
                label="En route"
                value={String(livraisons.filter(l => l.statut === 'en_transit').length)}
                icon="🚚"
                color="bg-yellow-50 text-yellow-700"
              />
              <KpiTile
                label="Livrées aujourd'hui"
                value={String(livreesAujourdhui)}
                icon="✅"
                color="bg-green-50 text-green-700"
              />
            </>
          )}

          {has('ventes') && (
            <>
              <KpiTile
                label="Revenus livrés"
                value={formatXAF(totalRevenue)}
                icon="💰"
                color="bg-green-50 text-green-700"
              />
              <KpiTile
                label="Total commandes"
                value={formatXAF(totalSales)}
                icon="🛍️"
                color="bg-indigo-50 text-indigo-700"
              />
            </>
          )}

          {has('approbation') && (
            <KpiTile
              label="Bons à approuver"
              value={String(bonsSoumis)}
              icon="📝"
              color={bonsSoumis > 0 ? 'bg-orange-50 text-orange-700' : 'bg-gray-50 text-gray-500'}
              to="/approbation"
            />
          )}

          {has('commandes') && (
            <>
              <KpiTile
                label="Commandes actives"
                value={String(activeOrders.length)}
                icon="📦"
                color="bg-blue-50 text-blue-700"
              />
              <KpiTile
                label="Commandes prêtes"
                value={String(readyOrders)}
                icon="🧾"
                color="bg-purple-50 text-purple-700"
              />
            </>
          )}

          {has('stock') && lowStockTile}
        </div>

        {has('caisse') && (
          <Link
            to="/caisse"
            className="block text-center bg-[#C62828] text-white text-sm font-semibold rounded-xl py-3"
          >
            {session ? 'Reprendre la vente' : 'Ouvrir la caisse'}
          </Link>
        )}

        {has('livraisons') && (
          <section>
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">
                Mes livraisons
              </h2>
              <Link to="/livraisons" className="text-xs font-medium text-[#C62828]">
                Voir tout →
              </Link>
            </div>
            <div className="space-y-2">
              {livraisonsOuvertes.length === 0 && (
                <p className="text-sm text-gray-400 bg-white rounded-xl border border-gray-100 px-4 py-6 text-center">
                  Aucune livraison en attente
                </p>
              )}
              {livraisonsOuvertes.slice(0, 5).map(l => (
                <div
                  key={l.id}
                  className="bg-white rounded-xl border border-gray-100 shadow-sm px-4 py-3 flex items-center justify-between"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-gray-900 truncate">{l.client_nom}</p>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {l.numero}
                      {l.date_livraison_prevue && ` · ${new Date(l.date_livraison_prevue).toLocaleDateString('fr-CM')}`}
                    </p>
                  </div>
                  <span className={`text-xs font-medium px-2 py-1 rounded-full shrink-0 ml-2 ${livraisonColor[l.statut]}`}>
                    {livraisonLabels[l.statut] ?? l.statut}
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}

        {has('commandes') && (
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
                    <p className="text-xs text-gray-400 mt-0.5">{formatXAF(order.montant_ttc_xaf)}</p>
                  </div>
                  <span className={`text-xs font-medium px-2 py-1 rounded-full shrink-0 ml-2 ${statusColor[order.statut]}`}>
                    {statusLabels[order.statut] ?? order.statut}
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}

        {has('stock') && lowStock > 0 && (
          <section>
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">
                Stocks en alerte
              </h2>
              <Link to="/stocks" className="text-xs font-medium text-[#C62828]">
                Voir tout →
              </Link>
            </div>
            <div className="space-y-2">
              {lowStockItems.slice(0, 5).map(stock => (
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
  to,
}: {
  label: string
  value: string
  icon: string
  color: string
  to?: string
}) {
  const tile = (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm px-4 py-4">
      <div className={`inline-flex items-center justify-center w-9 h-9 rounded-lg text-lg mb-2 ${color}`}>
        {icon}
      </div>
      <p className="text-xl font-bold text-gray-900 leading-tight truncate">{value}</p>
      <p className="text-xs text-gray-500 mt-0.5">{label}</p>
    </div>
  )
  return to ? <Link to={to}>{tile}</Link> : tile
}
