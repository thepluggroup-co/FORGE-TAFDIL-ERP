import { useCallback, useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useAuth } from '@/context/AuthContext'
import { syncOfflineWrites } from '@/lib/api-client'
import {
  discardOutboxAction, listOutbox, outboxEnabled, requeueOutboxAction, subscribeOutbox,
} from '@/lib/outbox'
import type { OutboxAction } from '@/lib/outbox'

// ── Actions en attente (desktop) ──────────────────────────────────────────────
// Ce que l'utilisateur a fait hors ligne et qui n'est pas encore arrivé au
// serveur, plus ce que le serveur a refusé à la synchronisation : rien ne doit
// disparaître en silence. Invisible tant que la file est vide.

const RETRY_INTERVAL_MS = 30_000

const STATUS_LABEL: Record<OutboxAction['status'], string> = {
  pending: 'En attente d\'envoi',
  failed:  'Refusée par le serveur',
  expired: 'Trop ancienne',
}

function formatWhen(ts: number): string {
  return new Date(ts).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

export function OutboxPanel() {
  const { user } = useAuth()
  const qc = useQueryClient()
  const userId = user?.id ?? null
  const [actions, setActions] = useState<OutboxAction[]>([])
  const [open, setOpen] = useState(false)

  const reload = useCallback(() => { void listOutbox(userId).then(setActions) }, [userId])

  useEffect(() => {
    if (!outboxEnabled()) return
    reload()
    return subscribeOutbox((event) => {
      reload()
      // Des actions viennent d'arriver au serveur : les listes affichées
      // (encore celles du cache) doivent se recharger pour les montrer.
      if (event === 'synced') {
        void qc.invalidateQueries()
        toast.success('Actions hors ligne synchronisées')
      }
    })
  }, [reload, qc])

  // Tant qu'il reste des envois en attente, on retente régulièrement : le
  // retour du réseau n'est pas toujours signalé par le système.
  const hasPending = actions.some((a) => a.status === 'pending')
  useEffect(() => {
    if (!hasPending) return
    const timer = setInterval(() => { void syncOfflineWrites() }, RETRY_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [hasPending])

  if (!outboxEnabled() || actions.length === 0) return null

  const blocked = actions.filter((a) => a.status !== 'pending').length

  async function retry(action: OutboxAction) {
    await requeueOutboxAction(action.key)
    void syncOfflineWrites()
  }

  async function discard(action: OutboxAction) {
    if (!window.confirm(`Abandonner définitivement « ${action.label} » ?\nCette action ne sera jamais envoyée au serveur.`)) return
    await discardOutboxAction(action.key)
  }

  return (
    <div className="fixed bottom-4 right-4 z-[9998] flex flex-col items-end gap-2">
      {open && (
        <div className="w-[26rem] max-w-[calc(100vw-2rem)] max-h-[60vh] overflow-y-auto rounded-xl border border-gray-200 bg-white shadow-2xl">
          <div className="sticky top-0 flex items-center justify-between border-b border-gray-100 bg-white px-4 py-3">
            <div>
              <p className="text-sm font-bold text-gray-900">Actions en attente</p>
              <p className="text-xs text-gray-500">Faites hors ligne, pas encore enregistrées sur le serveur.</p>
            </div>
            <button type="button" onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-700 text-lg leading-none px-1" aria-label="Fermer">×</button>
          </div>

          <ul className="divide-y divide-gray-100">
            {actions.map((action) => (
              <li key={action.key} className="px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-gray-900 truncate">{action.label}</p>
                    <p className="text-xs text-gray-500">{formatWhen(action.createdAt)}</p>
                  </div>
                  <span
                    className="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold"
                    style={action.status === 'pending'
                      ? { backgroundColor: '#FEF3C7', color: '#92400E' }
                      : { backgroundColor: '#FEE2E2', color: '#991B1B' }}
                  >
                    {STATUS_LABEL[action.status]}
                  </span>
                </div>
                {action.error && <p className="mt-1 text-xs text-red-700">{action.error}</p>}
                <div className="mt-2 flex gap-3 text-xs font-semibold">
                  {action.status !== 'pending' && (
                    <button type="button" onClick={() => void retry(action)} className="text-[#C62828] hover:underline">
                      {action.status === 'expired' ? 'Confirmer l\'envoi' : 'Réessayer'}
                    </button>
                  )}
                  <button type="button" onClick={() => void discard(action)} className="text-gray-500 hover:underline">
                    Abandonner
                  </button>
                </div>
              </li>
            ))}
          </ul>

          {hasPending && (
            <div className="border-t border-gray-100 px-4 py-2 text-right">
              <button type="button" onClick={() => void syncOfflineWrites()} className="text-xs font-semibold text-[#C62828] hover:underline">
                Envoyer maintenant
              </button>
            </div>
          )}
        </div>
      )}

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="rounded-full px-4 py-2 text-xs font-bold text-white shadow-lg"
        style={{ backgroundColor: blocked > 0 ? '#B91C1C' : '#B45309' }}
      >
        {actions.length} action{actions.length > 1 ? 's' : ''} en attente
        {blocked > 0 && ` · ${blocked} à traiter`}
      </button>
    </div>
  )
}
