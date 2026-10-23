import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { useAuth } from './AuthContext'
import { usePermissions } from './PermissionsContext'
import { fetchCommandes, fetchFactures, fetchStocks } from '../lib/api'
import { supabase } from '../lib/supabase'
import { canSeeWorkflowModule } from '@forge/shared'
import type { IconName } from '../components/ui'

// Les catégories suivent les modules du projet (ceux de notifyWorkflow côté API).
export type NotificationKind = 'commandes' | 'stocks' | 'finance' | 'logistique' | 'production'
export type NotificationSeverity = 'info' | 'success' | 'warning' | 'error'

export const KIND_META: Record<NotificationKind, { label: string; icon: IconName }> = {
  commandes:  { label: 'Commandes',  icon: 'cart' },
  stocks:     { label: 'Stocks',     icon: 'alert' },
  finance:    { label: 'Finance',    icon: 'receipt' },
  logistique: { label: 'Logistique', icon: 'truck' },
  production: { label: 'Production', icon: 'box' },
}

const WORKFLOW_KIND: Record<string, NotificationKind> = {
  boutique: 'commandes', commandes: 'commandes', stock: 'stocks',
  finance: 'finance', logistique: 'logistique', production: 'production',
}

interface WorkflowPayload {
  id?: string; event?: string; titre?: string; message?: string; module?: string
  severite?: NotificationSeverity; ref?: string | null; ts?: string
}

export interface AppNotification {
  id: string
  kind: NotificationKind
  title: string
  message: string
  /** Date de l'événement ; absente pour un état courant (ex. stock faible). */
  at: string | null
  severity?: NotificationSeverity
  read: boolean
}

// Le projet n'a pas de journal de notifications persisté : les événements métier sont diffusés en
// temps réel (canal « forge-workflow », le même que celui du web) et envoyés en push. Ce flux réunit :
//   1. les événements reçus en direct pendant la session, filtrés par permission du rôle ;
//   2. un état courant DÉDUIT des données réelles lisibles (commandes récentes, stocks sous le seuil,
//      factures payées ou en retard), jamais inventé.
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
  const [live, setLive] = useState<Omit<AppNotification, 'read'>[]>([])
  const { permissions } = usePermissions()
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
            id: `fac:${f.id}:${f.statut}`, kind: 'finance' as const,
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

  // Événements métier en direct (même canal que le web), limités aux modules que le rôle peut lire.
  useEffect(() => {
    if (!userId || source === 'loading') return
    setLive([])
    const channel = supabase
      .channel('forge-workflow')
      .on('broadcast', { event: 'workflow_notification' }, ({ payload }) => {
        const n = payload as WorkflowPayload
        if (!canSeeWorkflowModule(permissions, n.module)) return
        const kind = WORKFLOW_KIND[n.module ?? '']
        if (!kind) return
        const item: Omit<AppNotification, 'read'> = {
          id: `wf:${n.id ?? `${n.event ?? 'evt'}-${Date.now()}`}`,
          kind,
          title: n.titre ?? 'Notification',
          message: n.message ?? '',
          at: n.ts ?? new Date().toISOString(),
          severity: n.severite,
        }
        setLive((prev) => (prev.some((p) => p.id === item.id) ? prev : [item, ...prev].slice(0, 50)))
        setTick((t) => t + 1) // l'état courant (stocks, commandes) a pu changer
      })
      .subscribe()
    return () => { void supabase.removeChannel(channel) }
  }, [userId, source, permissions])

  // Rafraîchissement périodique tant que l'application est ouverte.
  useEffect(() => {
    if (!userId) return
    const id = setInterval(() => setTick((t) => t + 1), 90_000)
    return () => clearInterval(id)
  }, [userId])

  const items = useMemo(() => {
    const all = [...live, ...raw].sort(
      (a, b) => (b.at ? new Date(b.at).getTime() : Date.now()) - (a.at ? new Date(a.at).getTime() : Date.now()))
    return all.map((n) => ({ ...n, read: read.has(n.id) }))
  }, [live, raw, read])
  const unreadCount = useMemo(() => items.filter((n) => !n.read).length, [items])

  const markAllRead = useCallback(() => {
    if (!userId) return
    const next = new Set(read)
    for (const n of items) next.add(n.id)
    setRead(next)
    saveRead(userId, next)
  }, [userId, read, items])

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
