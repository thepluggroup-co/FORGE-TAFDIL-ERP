import React, { useState } from 'react'
import { TopBar } from '../components/TopBar'
import { Card, ChipRow, EmptyState, Icon, Spinner, timeAgo, type IconName } from '../components/ui'
import { useNotifications, type NotificationKind } from '../context/NotificationsContext'

type Filter = 'all' | NotificationKind

const KIND_ICON: Record<NotificationKind, { icon: IconName; tone: string }> = {
  commandes: { icon: 'cart',    tone: 'bg-red-50 text-[#C62828]' },
  stocks:    { icon: 'alert',   tone: 'bg-orange-50 text-orange-600' },
  factures:  { icon: 'receipt', tone: 'bg-green-50 text-green-700' },
}

export function NotificationsPage() {
  const { items, unreadCount, loading, markAllRead, markRead } = useNotifications()
  const [filter, setFilter] = useState<Filter>('all')
  const visible = items.filter((n) => filter === 'all' || n.kind === filter)

  return (
    <div>
      <TopBar title="Notifications" subtitle={unreadCount > 0 ? `${unreadCount} non lue${unreadCount > 1 ? 's' : ''}` : 'Tout est à jour'} />
      <div className="px-4 py-4 space-y-3">
        <ChipRow<Filter>
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: 'Toutes' },
            { value: 'commandes', label: 'Commandes' },
            { value: 'stocks', label: 'Stocks' },
            { value: 'factures', label: 'Factures' },
          ]}
        />

        {loading && items.length === 0 ? <Spinner /> : visible.length === 0 ? (
          <EmptyState title="Aucune notification" hint="Les événements de vos commandes, stocks et factures apparaîtront ici." />
        ) : (
          visible.map((n) => {
            const k = KIND_ICON[n.kind]
            return (
              <Card key={n.id} onClick={() => markRead(n.id)} className={`p-3.5 ${n.read ? 'opacity-70' : ''}`}>
                <div className="flex gap-3">
                  <span className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${k.tone}`}>
                    <Icon name={k.icon} size={18} />
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
