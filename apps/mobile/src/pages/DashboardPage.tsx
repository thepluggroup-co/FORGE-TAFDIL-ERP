import React, { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  ROLE_LABELS, analyticsFromFactures, dashboardSectionsFor, dashboardSourcesFor,
  type MobileDashboardSection, type MobileDashboardSource,
} from '@forge/shared'
import { useAuth } from '../context/AuthContext'
import { usePermissions } from '../context/PermissionsContext'
import { useNotifications } from '../context/NotificationsContext'
import { Avatar, Card, Icon, Sparkline, Trend, formatNumber, formatXAF, timeAgo, trendPct, type IconName } from '../components/ui'
import {
  fetchCommandes, fetchStocks, fetchBonsSoumis, fetchMesLivraisons, fetchSessionCourante, fetchRapportZ,
  fetchFactures, fetchDevisTotal,
  type ApiCommandeClient, type ApiStock, type ApiFacture, type Livraison, type CaisseSession, type RapportZ,
} from '../lib/api'

type Source = MobileDashboardSource | 'factures' | 'devis'
type Section = MobileDashboardSection

// Les sections et les données chargées viennent des permissions de la base
// (dashboardSectionsFor / dashboardSourcesFor) : un rôle ne charge que ce qu'il peut lire.

interface DashboardData {
  orders: ApiCommandeClient[]
  stocks: ApiStock[]
  bonsSoumis: number
  livraisons: Livraison[]
  session: CaisseSession | null
  rapport: RapportZ | null
  factures: ApiFacture[]
  devisTotal: number | null
}

const EMPTY: DashboardData = {
  orders: [], stocks: [], bonsSoumis: 0, livraisons: [], session: null, rapport: null, factures: [], devisTotal: null,
}

async function loadSource(source: Source): Promise<Partial<DashboardData>> {
  switch (source) {
    case 'commandes':  return { orders: (await fetchCommandes({ per_page: 100 })).data }
    case 'stocks':     return { stocks: (await fetchStocks({ per_page: 100 })).data }
    case 'bons':       return { bonsSoumis: (await fetchBonsSoumis()).length }
    case 'livraisons': return { livraisons: await fetchMesLivraisons() }
    case 'factures':   return { factures: (await fetchFactures({ per_page: 500 })).data }
    case 'devis':      return { devisTotal: await fetchDevisTotal() }
    case 'caisse': {
      const session = await fetchSessionCourante()
      return { session, rapport: session ? await fetchRapportZ(session.id) : null }
    }
  }
}

const livraisonLabels: Record<string, string> = {
  planifiee: 'Planifiée', en_transit: 'En route', livree: 'Livrée', annulee: 'Annulée',
}

export function DashboardPage() {
  const { user } = useAuth()
  const { permissions, can } = usePermissions()
  const { items: notifications, unreadCount } = useNotifications()
  const navigate = useNavigate()

  const canFinance = can('FINANCE')
  const canCommercial = can('COMMERCIAL')

  const view = useMemo(() => {
    const sections = dashboardSectionsFor(permissions)
    const sources: Source[] = dashboardSourcesFor(sections)
    if (canFinance) sources.push('factures')
    if (canCommercial) sources.push('devis')
    return { sections, sources }
  }, [permissions, canFinance, canCommercial])

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

  const { orders, stocks, bonsSoumis, livraisons, session, rapport, factures, devisTotal } = data
  const has = (section: Section) => view.sections.includes(section)

  const ca = useMemo(() => analyticsFromFactures(factures, 'mois'), [factures])

  const ordersTrend = useMemo(() => {
    const now = new Date()
    const key = (d: Date) => d.toISOString().slice(0, 7)
    const cur = key(now)
    const prev = key(new Date(now.getFullYear(), now.getMonth() - 1, 15))
    const count = (k: string) => orders.filter((o) => o.statut !== 'cancelled' && o.date_commande.slice(0, 7) === k).length
    return { current: count(cur), pct: trendPct(count(cur), count(prev)) }
  }, [orders])

  const unpaid = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10)
    const open = factures.filter((f) => f.statut === 'valide' || f.statut === 'envoye')
    return { count: open.length, late: open.filter((f) => f.date_echeance < today).length }
  }, [factures])

  const lowStockItems = useMemo(() => stocks.filter((s) => s.stock_actuel <= s.stock_min), [stocks])
  const livraisonsOuvertes = useMemo(
    () => livraisons.filter((l) => l.statut === 'planifiee' || l.statut === 'en_transit'), [livraisons])
  const livreesAujourdhui = useMemo(() => {
    const today = new Date().toDateString()
    return livraisons.filter((l) =>
      l.statut === 'livree' && !!l.date_livraison_reelle && new Date(l.date_livraison_reelle).toDateString() === today).length
  }, [livraisons])

  const firstName = (user?.name ?? '').split(/\s+/)[0] || 'vous'
  const showHero = has('ventes') && factures.length > 0

  return (
    <div>
      {/* En-tête : salutation, cloche, avatar */}
      <div className="bg-white safe-top px-4 pt-4 pb-4 flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-lg font-bold text-gray-900 truncate">Bonjour, {firstName}</p>
          <p className="text-xs text-gray-500">{user ? (ROLE_LABELS[user.role] ?? user.role) : ''}</p>
        </div>
        <button type="button" onClick={() => navigate('/notifications')} aria-label="Notifications" className="relative p-2 text-gray-700 active:opacity-60">
          <Icon name="bell" size={22} />
          {unreadCount > 0 && (
            <span className="absolute top-0.5 right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-[#C62828] text-white text-[9px] font-bold flex items-center justify-center">
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
        </button>
        <button type="button" onClick={() => navigate('/profile')} aria-label="Profil">
          <Avatar name={user?.name ?? '?'} size={38} />
        </button>
      </div>

      <div className="px-4 pb-6 space-y-5">
        {loading ? (
          <div className="flex justify-center py-16">
            <div className="w-7 h-7 border-2 border-[#C62828] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : error ? (
          <Card className="p-6 text-center">
            <p className="text-sm text-red-600 mb-2">{error}</p>
            <p className="text-sm text-gray-500">Vérifiez la connexion puis rouvrez l'application.</p>
          </Card>
        ) : (
          <>
            {/* Vue d'ensemble : chiffre d'affaires du mois (commandes + finance) */}
            {showHero && (
              <div className="rounded-2xl bg-gradient-to-br from-[#1b1f24] to-[#2d333b] p-4 text-white shadow-md">
                <div className="flex items-center justify-between">
                  <p className="flex items-center gap-1.5 text-xs font-semibold text-red-300">
                    <Icon name="chart" size={14} /> Vue d'ensemble
                  </p>
                  <button type="button" onClick={() => navigate('/performance')} aria-label="Voir l'analytique" className="text-gray-300">
                    <Icon name="arrowRight" size={16} />
                  </button>
                </div>
                <p className="mt-2 text-[11px] text-gray-400">Chiffre d'affaires du mois</p>
                <p className="text-2xl font-extrabold">{formatXAF(ca.current)}</p>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <Trend pct={ca.trend} />
                  {ca.trend !== null && <span className="text-[11px] text-gray-400">vs mois dernier</span>}
                </div>
                <div className="mt-2"><Sparkline values={ca.values} height={56} /></div>
              </div>
            )}

            {/* Tuiles : seulement ce que le rôle peut lire */}
            <div className="grid grid-cols-2 gap-3">
              {has('commandes') && (
                <Tile icon="cart" label="Commandes" value={formatNumber(ordersTrend.current)} trend={ordersTrend.pct} caption="ce mois" to="/orders" />
              )}
              {canCommercial && devisTotal !== null && (
                <Tile icon="doc" label="Devis" value={formatNumber(devisTotal)} caption="au total" />
              )}
              {has('stock') && (
                <Tile icon="box" label="Stocks" value={formatNumber(stocks.length)} caption={lowStockItems.length > 0 ? `${lowStockItems.length} en alerte` : 'références'} alert={lowStockItems.length > 0} to="/stocks" />
              )}
              {canFinance && factures.length > 0 && (
                <Tile icon="receipt" label="Factures" value={formatNumber(unpaid.count)} caption={unpaid.late > 0 ? `${unpaid.late} en retard` : 'à encaisser'} alert={unpaid.late > 0} to="/factures" />
              )}
              {has('approbation') && (
                <Tile icon="check" label="Bons à approuver" value={String(bonsSoumis)} caption={bonsSoumis > 0 ? 'en attente' : 'rien en attente'} alert={bonsSoumis > 0} to="/approbation" />
              )}
              {has('livraisons') && (
                <>
                  <Tile icon="truck" label="À livrer" value={String(livraisons.filter((l) => l.statut === 'planifiee').length)} caption="planifiées" to="/livraisons" />
                  <Tile icon="truck" label="En route" value={String(livraisons.filter((l) => l.statut === 'en_transit').length)} caption="en cours" to="/livraisons" />
                  <Tile icon="check" label="Livrées" value={String(livreesAujourdhui)} caption="aujourd'hui" to="/livraisons" />
                </>
              )}
              {has('caisse') && (
                <>
                  <Tile icon="wallet" label={session ? 'Session ouverte' : 'Session fermée'} value={session ? formatXAF(session.fond_ouverture_xaf) : '—'} caption="fond de caisse" to="/caisse" />
                  <Tile icon="receipt" label="Ventes session" value={formatXAF(rapport?.total_ttc_xaf ?? 0)} caption={`${rapport?.tickets_count ?? 0} tickets`} to="/caisse" />
                </>
              )}
            </div>

            {has('caisse') && (
              <Link to="/caisse" className="block text-center bg-[#C62828] text-white text-sm font-semibold rounded-xl py-3 shadow-md active:bg-[#B71C1C]">
                {session ? 'Reprendre la vente' : 'Ouvrir la caisse'}
              </Link>
            )}

            {/* Activités récentes : déduites des commandes, stocks et factures réels */}
            {notifications.length > 0 && (
              <section>
                <div className="flex items-center justify-between mb-2">
                  <h2 className="text-sm font-bold text-gray-900">Activités récentes</h2>
                  <Link to="/notifications" className="text-xs font-semibold text-[#C62828]">Voir tout →</Link>
                </div>
                <div className="space-y-2">
                  {notifications.slice(0, 3).map((n) => (
                    <Card key={n.id} className="px-3.5 py-3 flex items-center gap-3">
                      <span className="w-9 h-9 rounded-full bg-red-50 text-[#C62828] flex items-center justify-center shrink-0">
                        <Icon name={n.kind === 'commandes' ? 'cart' : n.kind === 'stocks' ? 'alert' : 'receipt'} size={17} />
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-gray-900 truncate">{n.title}</p>
                        <p className="text-[11px] text-gray-500 truncate">{n.message}</p>
                      </div>
                      <span className="text-[10px] text-gray-400 shrink-0">{n.at ? timeAgo(n.at) : ''}</span>
                    </Card>
                  ))}
                </div>
              </section>
            )}

            {has('livraisons') && (
              <section>
                <div className="flex items-center justify-between mb-2">
                  <h2 className="text-sm font-bold text-gray-900">Mes livraisons</h2>
                  <Link to="/livraisons" className="text-xs font-semibold text-[#C62828]">Voir tout →</Link>
                </div>
                <div className="space-y-2">
                  {livraisonsOuvertes.length === 0 && (
                    <Card className="px-4 py-6 text-center text-sm text-gray-400">Aucune livraison en attente</Card>
                  )}
                  {livraisonsOuvertes.slice(0, 5).map((l) => (
                    <Card key={l.id} className="px-4 py-3 flex items-center justify-between">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-gray-900 truncate">{l.client_nom}</p>
                        <p className="text-xs text-gray-400 mt-0.5">
                          {l.numero}{l.date_livraison_prevue && ` · ${new Date(l.date_livraison_prevue).toLocaleDateString('fr-FR')}`}
                        </p>
                      </div>
                      <span className="text-[11px] font-semibold px-2.5 py-1 rounded-full shrink-0 ml-2 bg-blue-50 text-blue-700">
                        {livraisonLabels[l.statut] ?? l.statut}
                      </span>
                    </Card>
                  ))}
                </div>
              </section>
            )}

            {has('stock') && lowStockItems.length > 0 && (
              <section>
                <div className="flex items-center justify-between mb-2">
                  <h2 className="text-sm font-bold text-gray-900">Stocks en alerte</h2>
                  <Link to="/stocks" className="text-xs font-semibold text-[#C62828]">Voir tout →</Link>
                </div>
                <div className="space-y-2">
                  {lowStockItems.slice(0, 5).map((s) => (
                    <Card key={s.id} className="px-4 py-3 flex items-center justify-between">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-gray-900 truncate">{s.designation}</p>
                        <p className="text-xs text-gray-400">{s.ref}</p>
                      </div>
                      <span className={`text-sm font-bold shrink-0 ml-2 ${s.stock_actuel === 0 ? 'text-red-600' : 'text-orange-500'}`}>
                        {s.stock_actuel === 0 ? 'Épuisé' : `${s.stock_actuel} restants`}
                      </span>
                    </Card>
                  ))}
                </div>
              </section>
            )}

            {view.sections.length === 0 && !showHero && (
              <p className="text-center text-sm text-gray-500 py-10">
                Aucun indicateur n'est activé pour votre rôle. Contactez l'administrateur.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function Tile({ icon, label, value, caption, trend, alert, to }: {
  icon: IconName; label: string; value: string; caption?: string; trend?: number | null; alert?: boolean; to?: string
}) {
  const navigate = useNavigate()
  return (
    <Card onClick={to ? () => navigate(to) : undefined} className="p-3.5">
      <div className="flex items-center justify-between">
        <p className="text-xs text-gray-500 truncate">{label}</p>
        <span className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${alert ? 'bg-orange-50 text-orange-600' : 'bg-red-50 text-[#C62828]'}`}>
          <Icon name={icon} size={15} />
        </span>
      </div>
      <p className="mt-1.5 text-xl font-extrabold text-gray-900 truncate">{value}</p>
      <div className="flex items-center gap-1.5 mt-0.5 min-h-[16px]">
        {trend !== undefined && <Trend pct={trend} />}
        {caption && <span className={`text-[11px] ${alert ? 'text-orange-600 font-medium' : 'text-gray-400'}`}>{caption}</span>}
      </div>
    </Card>
  )
}
