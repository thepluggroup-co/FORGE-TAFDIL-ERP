import React, { useMemo, useState } from 'react'
import { TopBar } from '../components/TopBar'
import { Card, ChipRow, EmptyState, Icon, Spinner, timeAgo } from '../components/ui'
import { KIND_META, useNotifications, type NotificationKind, type NotificationSeverity } from '../context/NotificationsContext'

type Filter = 'all' | NotificationKind

const TONE: Record<NotificationSeverity | 'default', string> = {
  default: 'bg-red-50 text-[#C62828]', info: 'bg-red-50 text-[#C62828]',
  success: 'bg-green-50 text-green-700', warning: 'bg-orange-50 text-orange-600', error: 'bg-red-100 text-red-700',
}

export function NotificationsPage() {
  const { items, unreadCount, loading, markAllRead, markRead } = useNotifications()
  const [filter, setFilter] = useState<Filter>('all')
  // Les puces suivent les catégories réellement présentes (modules du projet autorisés pour ce rôle).
  const kinds = useMemo(() => [...new Set(items.map((n) => n.kind))], [items])
  const options = [{ value: 'all' as Filter, label: 'Toutes' }, ...kinds.map((k) => ({ value: k as Filter, label: KIND_META[k].label }))]
  const visible = items.filter((n) => filter === 'all' || n.kind === filter)

  return (
    <div>
      <TopBar title="Notifications" subtitle={unreadCount > 0 ? `${unreadCount} non lue${unreadCount > 1 ? 's' : ''}` : 'Tout est à jour'} />
      <div className="px-4 py-4 space-y-3">
        {kinds.length > 1 && <ChipRow<Filter> value={filter} onChange={setFilter} options={options} />}

        {loading && items.length === 0 ? <Spinner /> : visible.length === 0 ? (
          <EmptyState title="Aucune notification" hint="Les événements de vos modules (commandes, stocks, finance, logistique…) apparaîtront ici en direct." />
        ) : (
          visible.map((n) => {
            const meta = KIND_META[n.kind]
            return (
              <Card key={n.id} onClick={() => markRead(n.id)} className={`p-3.5 ${n.read ? 'opacity-70' : ''}`}>
                <div className="flex gap-3">
                  <span className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${TONE[n.severity ?? 'default']}`}>
                    <Icon name={meta.icon} size={18} />
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-semibold text-gray-900">{n.title}</p>
                      <span className="text-[10px] text-gray-400 shrink-0">{n.at ? timeAgo(n.at) : ''}</span>
                    </div>
                    <p className="text-xs text-gray-500 mt-0.5">{n.message}</p>
                  </div>
                  {!n.read && <span className="w-2 h-2 rounded-full bg-[#C62828] mt-1.5 shrink-0" />}
                </div>
              </Card>
            )
          })
        )}

        {unreadCount > 0 && (
          <button
            type="button"
            onClick={markAllRead}
            className="w-full rounded-2xl bg-gray-100 text-[#C62828] text-sm font-semibold py-3 active:bg-gray-200"
          >
            Tout marquer comme lu
          </button>
        )}
      </div>
    </div>
  )
}
