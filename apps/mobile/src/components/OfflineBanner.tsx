import React, { useEffect, useState } from 'react'
import { useOnlineStatus } from '../lib/offline/network'
import { subscribeQueue, processQueue, type QueuedMutation } from '../lib/offline/queue'

export function OfflineBanner() {
  const online = useOnlineStatus()
  const [items, setItems] = useState<QueuedMutation[]>([])

  useEffect(() => subscribeQueue(setItems), [])

  const pending = items.filter(i => i.status !== 'syncing')
  const failed = items.filter(i => i.status === 'failed')

  if (online && items.length === 0) return null

  return (
    <div
      className={`px-4 py-2 text-xs font-medium flex items-center justify-between gap-2 ${
        !online ? 'bg-gray-800 text-white' : failed.length > 0 ? 'bg-orange-100 text-orange-800' : 'bg-blue-50 text-blue-700'
      }`}
    >
      <span>
        {!online && '📡 Hors ligne'}
        {online && items.length > 0 && '🔄 Synchronisation…'}
        {pending.length > 0 && ` — ${pending.length} action${pending.length > 1 ? 's' : ''} en attente`}
        {failed.length > 0 && ` (${failed.length} échouée${failed.length > 1 ? 's' : ''})`}
      </span>
      {online && failed.length > 0 && (
        <button
          type="button"
          onClick={() => void processQueue()}
          className="underline font-semibold shrink-0"
        >
          Réessayer
        </button>
      )}
    </div>
  )
}
