import React, { useEffect, useState } from 'react'
import { useOnlineStatus } from '../lib/offline/network'
import { subscribeQueue, retryFailed, discardFailed, type QueuedMutation } from '../lib/offline/queue'

export function OfflineBanner() {
  const online = useOnlineStatus()
  const [items, setItems] = useState<QueuedMutation[]>([])

  useEffect(() => subscribeQueue(setItems), [])

  const pending = items.filter(i => i.status === 'pending')
  const failed = items.filter(i => i.status === 'failed')

  // Rien ne disparaît en silence : l'utilisateur voit ce que le serveur a
  // refusé (et pourquoi) avant de décider d'abandonner.
  const abandonner = () => {
    const detail = failed.map(i => `• ${i.label}${i.error ? ` — ${i.error}` : ''}`).join('\n')
    if (window.confirm(`Abandonner définitivement ces actions ?\n\n${detail}\n\nElles ne seront jamais envoyées au serveur.`)) {
      void discardFailed()
    }
  }

  if (online && items.length === 0) return null

  return (
    <div
      className={`px-4 py-2 text-xs font-medium flex items-center justify-between gap-2 ${
        !online ? 'bg-gray-800 text-white' : failed.length > 0 ? 'bg-orange-100 text-orange-800' : 'bg-blue-50 text-blue-700'
      }`}
    >
      <span>
        {!online && '📡 Hors ligne'}
        {online && items.length > failed.length && '🔄 Synchronisation…'}
        {pending.length > 0 && ` — ${pending.length} action${pending.length > 1 ? 's' : ''} en attente`}
        {failed.length > 0 && ` ${failed.length} action${failed.length > 1 ? 's' : ''} refusée${failed.length > 1 ? 's' : ''} : ${failed[0].error ?? 'à vérifier'}`}
      </span>
      {failed.length > 0 && (
        <span className="flex gap-3 shrink-0">
          {online && (
            <button type="button" onClick={() => void retryFailed()} className="underline font-semibold">
              Réessayer
            </button>
          )}
          <button type="button" onClick={abandonner} className="underline font-semibold">
            Abandonner
          </button>
        </span>
      )}
    </div>
  )
}
