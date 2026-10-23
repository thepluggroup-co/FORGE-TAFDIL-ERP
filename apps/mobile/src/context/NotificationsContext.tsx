import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { useAuth } from './AuthContext'
import { usePermissions } from './PermissionsContext'
import { fetchCommandes, fetchFactures, fetchStocks } from '../lib/api'

export type NotificationKind = 'commandes' | 'stocks' | 'factures'

export interface AppNotification {
  id: string
  kind: NotificationKind
  title: string
  message: string
  /** Date de l'événement ; absente pour un état courant (ex. stock faible). */
  at: string | null
  read: boolean
}

// Il n'existe pas (encore) de journal de notifications côté serveur : ce flux est DÉDUIT des
// données réelles que l'utilisateur a le droit de lire (commandes, stocks, factures), jamais inventé.
// L'état « lu » est local à l'appareil.

const COMMANDE_TITLE: Record<string, string> = {
  confirmed: 'Nouvelle commande',
  in_production: 'Commande en production',
  pret: 'Commande prête',
  delivered: 'Commande livrée',
  cancelled: 'Commande annulée',
}

interface Ctx {
  items: AppNotification[]
  unreadCount: number
  loading: boolean
  markAllRead: () => void
  markRead: (id: string) => void
  refresh: () => void
}

const NotificationsContext = createContext<Ctx | null>(null)

function readKey(userId: string) { return `forge.notif.read.${userId}` }

function loadRead(userId: string): Set<string> {
  try {
    const raw = localStorage.getItem(readKey(userId))
    return new Set(raw ? (JSON.parse(raw) as string[]) : [])
  } catch { return new Set() }
}

function saveRead(userId: string, ids: Set<string>) {
  try { localStorage.setItem(readKey(userId), JSON.stringify([...ids].slice(-500))) } catch { /* stockage indisponible */ }
}

export function NotificationsProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth()
  const { can, source } = usePermissions()
  const userId = user?.id ?? null
  const [raw, setRaw] = useState<Omit<AppNotification, 'read'>[]>([])
  const [read, setRead] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(false)
  const [tick, setTick] = useState(0)

  const canCommandes = can('COMMERCIAL')
  const canStocks = can('STOCK')
  const canFactures = can('FINANCE')

  useEffect(() => { setRead(userId ? loadRead(userId) : new Set()) }, [userId])

  useEffect(() => {
    if (!userId || source === 'loading') { setRaw([]); return }
    let cancelled = false
    setLoading(true)
    const jobs: Array<Promise<Omit<AppNotification, 'read'>[]>> = []

    if (canCommandes) {
      jobs.push(fetchCommandes({ per_page: 8 }).then((r) => r.data.slice(0, 8).map((o) => ({
        id: `cmd:${o.id}:${o.statut}`, kind: 'commandes' as const,
        title: COMMANDE_TITLE[o.statut] ?? 'Commande',
        message: `${o.reference} · ${o.client?.nom ?? 'Client'}`,
        at: o.date_commande,
      }))))
    }
    if (canStocks) {
      jobs.push(fetchStocks({ per_page: 100 }).then((r) => r.data
        .filter((s) => s.stock_actuel <= s.stock_min)
        .slice(0, 8)
        .map((s) => ({
          id: `stock:${s.id}:${s.stock_actuel}`, kind: 'stocks' as const,
          title: 'Stock faible',
          message: `${s.designation} : ${s.stock_actuel} ${s.unite} restants (seuil ${s.stock_min})`,
          at: null,
        }))))
    }
    if (canFactures) {
      jobs.push(fetchFactures({ per_page: 50 }).then((r) => {
        const today = new Date().toISOString().slice(0, 10)
        return r.data
          .filter((f) => f.statut === 'paye' || (f.statut !== 'annule' && f.statut !== 'brouillon' && f.date_echeance < today))
          .slice(0, 8)
          .map((f) => ({
            id: `fac:${f.id}:${f.statut}`, kind: 'factures' as const,
            title: f.statut === 'paye' ? 'Facture payée' : 'Facture en retard',
            message: `${f.numero} · ${f.client_nom}`,
            at: f.date_emission,
          }))
      }))
    }

    Promise.allSettled(jobs).then((results) => {
      if (cancelled) return
      const all = results.flatMap((r) => (r.status === 'fulfilled' ? r.value : []))
      all.sort((a, b) => (b.at ? new Date(b.at).getTime() : Date.now()) - (a.at ? new Date(a.at).getTime() : Date.now()))
      setRaw(all)
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [userId, source, canCommandes, canStocks, canFactures, tick])

  // Rafraîchissement périodique tant que l'application est ouverte.
  useEffect(() => {
    if (!userId) return
    const id = setInterval(() => setTick((t) => t + 1), 90_000)
    return () => clearInterval(id)
  }, [userId])

  const items = useMemo(() => raw.map((n) => ({ ...n, read: read.has(n.id) })), [raw, read])
  const unreadCount = useMemo(() => items.filter((n) => !n.read).length, [items])

  const markAllRead = useCallback(() => {
    if (!userId) return
    const next = new Set(read)
    for (const n of raw) next.add(n.id)
    setRead(next)
    saveRead(userId, next)
  }, [userId, read, raw])

  const markRead = useCallback((id: string) => {
    if (!userId || read.has(id)) return
    const next = new Set(read)
    next.add(id)
    setRead(next)
    saveRead(userId, next)
  }, [userId, read])

  const refresh = useCallback(() => setTick((t) => t + 1), [])

  const value = useMemo(() => ({ items, unreadCount, loading, markAllRead, markRead, refresh }),
    [items, unreadCount, loading, markAllRead, markRead, refresh])

  return <NotificationsContext.Provider value={value}>{children}</NotificationsContext.Provider>
}

export function useNotifications(): Ctx {
  const ctx = useContext(NotificationsContext)
  if (!ctx) throw new Error('useNotifications doit être utilisé dans <NotificationsProvider>')
  return ctx
}
