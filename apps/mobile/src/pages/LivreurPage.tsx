import React, { useCallback, useEffect, useState } from 'react'
import { TopBar } from '../components/TopBar'
import { fetchMesLivraisons, updateLivraisonStatut, type Livraison, type LivraisonStatut } from '../lib/api'

// Transitions disponibles depuis un statut donné
const NEXT_STATUT: Record<string, LivraisonStatut | null> = {
  planifiee: 'en_transit',
  en_transit: 'livree',
  livree: null,
  annulee: null,
}

const STATUT_LABEL: Record<string, string> = {
  planifiee:  'Planifiée',
  en_transit: 'En route',
  livree:     'Livrée',
  annulee:    'Annulée',
}

const STATUT_COLOR: Record<string, string> = {
  planifiee:  'bg-orange-100 text-orange-700',
  en_transit: 'bg-blue-100 text-blue-700',
  livree:     'bg-green-100 text-green-700',
  annulee:    'bg-gray-100 text-gray-500',
}

const ACTION_LABEL: Record<string, string> = {
  en_transit: 'Démarrer la livraison',
  livree:     'Marquer comme livrée',
}

type PendingAction =
  | { livraisonId: string; statut: 'en_transit' | 'livree' }
  | { livraisonId: string; statut: 'annulee'; motif: string }

export function LivreurPage() {
  const [livraisons, setLivraisons] = useState<Livraison[]>([])
  const [loading, setLoading]       = useState(true)
  const [error, setError]           = useState<string | null>(null)
  const [action, setAction]         = useState<{ livraisonId: string; targetStatut: LivraisonStatut } | null>(null)
  const [motif, setMotif]           = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [toast, setToast]           = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setLivraisons(await fetchMesLivraisons())
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(null), 3000)
  }

  function openAction(livraisonId: string, targetStatut: LivraisonStatut) {
    setMotif('')
    setAction({ livraisonId, targetStatut })
  }

  async function handleConfirm() {
    if (!action) return
    if (action.targetStatut === 'annulee' && !motif.trim()) return
    setSubmitting(true)
    try {
      const notes = action.targetStatut === 'annulee' ? motif.trim() : undefined
      await updateLivraisonStatut(action.livraisonId, action.targetStatut, notes)
      const msgs: Record<LivraisonStatut, string> = {
        planifiee:  'Statut mis à jour.',
        en_transit: 'Livraison démarrée.',
        livree:     'Livraison confirmée ✓',
        annulee:    'Livraison annulée.',
      }
      showToast(msgs[action.targetStatut])
      setAction(null)
      await load()
    } catch (e) {
      showToast(`Erreur : ${(e as Error).message}`)
    } finally {
      setSubmitting(false)
    }
  }

  const pendingLivraison = action ? livraisons.find(l => l.id === action.livraisonId) : null

  return (
    <div className="min-h-full">
      <TopBar
        title="Mes livraisons"
        subtitle={loading ? '…' : `${livraisons.length} en cours`}
      />

      {/* Toast */}
      {toast && (
        <div className="fixed top-16 inset-x-4 z-50 bg-gray-900 text-white text-sm font-medium px-4 py-3 rounded-xl shadow-lg text-center">
          {toast}
        </div>
      )}

      {/* Modal de confirmation */}
      {action && pendingLivraison && (
        <div className="fixed inset-0 z-40 flex items-end">
          <div className="absolute inset-0 bg-black/40" onClick={() => setAction(null)} />
          <div className="relative w-full bg-white rounded-t-2xl p-6 space-y-4">
            <h3 className="text-base font-bold text-gray-900">
              {action.targetStatut === 'annulee' ? '❌ Signaler un échec' : ACTION_LABEL[action.targetStatut]} — {pendingLivraison.numero}
            </h3>
            <p className="text-sm text-gray-500">{pendingLivraison.client_nom}</p>

            {action.targetStatut === 'annulee' && (
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  Motif de l'échec <span className="text-red-500">*</span>
                </label>
                <textarea
                  rows={3}
                  value={motif}
                  onChange={e => setMotif(e.target.value)}
                  placeholder="Client absent, adresse introuvable…"
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#C62828]"
                />
              </div>
            )}

            <div className="flex gap-3">
              <button
                onClick={() => setAction(null)}
                className="flex-1 border border-gray-200 rounded-xl py-3 text-sm font-medium text-gray-600"
              >
                Annuler
              </button>
              <button
                onClick={handleConfirm}
                disabled={submitting || (action.targetStatut === 'annulee' && !motif.trim())}
                className={`flex-1 rounded-xl py-3 text-sm font-semibold text-white transition-colors disabled:opacity-50 ${
                  action.targetStatut === 'annulee'
                    ? 'bg-[#C62828] active:bg-[#B71C1C]'
                    : 'bg-green-600 active:bg-green-700'
                }`}
              >
                {submitting ? '…' : 'Confirmer'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Contenu */}
      <div className="px-4 py-3 space-y-3">
        {loading && (
          <div className="flex justify-center py-16">
            <div className="w-8 h-8 border-2 border-[#C62828] border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {!loading && error && (
          <div className="text-center py-16 text-red-500 space-y-3">
            <p className="text-2xl">📡</p>
            <p className="text-sm font-medium">Impossible de charger les livraisons</p>
            <p className="text-xs text-gray-500">{error}</p>
            <button
              onClick={load}
              className="text-xs font-semibold bg-[#C62828] text-white px-4 py-2 rounded-xl"
            >
              Réessayer
            </button>
          </div>
        )}

        {!loading && !error && livraisons.length === 0 && (
          <div className="text-center py-16 text-gray-400 space-y-2">
            <p className="text-3xl">🚚</p>
            <p className="text-sm font-medium">Aucune livraison assignée</p>
            <p className="text-xs">Vos prochaines livraisons apparaîtront ici.</p>
          </div>
        )}

        {livraisons.map(liv => {
          const datePrevue = liv.date_livraison_prevue
            ? new Date(liv.date_livraison_prevue).toLocaleDateString('fr-FR', {
                day: '2-digit', month: 'short',
              })
            : null
          const nextStatut = NEXT_STATUT[liv.statut]

          return (
            <div key={liv.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
              {/* En-tête */}
              <div className="px-4 pt-4 pb-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-gray-900">{liv.numero}</p>
                    <p className="text-xs text-gray-500 mt-0.5">{liv.client_nom}</p>
                  </div>
                  <span className={`shrink-0 text-xs font-medium px-2 py-1 rounded-full ${STATUT_COLOR[liv.statut] ?? 'bg-gray-100 text-gray-500'}`}>
                    {STATUT_LABEL[liv.statut] ?? liv.statut}
                  </span>
                </div>

                {datePrevue && (
                  <p className="text-xs text-gray-400 mt-2">
                    Date prévue : <span className="font-medium text-gray-700">{datePrevue}</span>
                  </p>
                )}

                {liv.notes && (
                  <p className="text-xs text-gray-400 mt-1 italic">{liv.notes}</p>
                )}
              </div>

              {/* Actions */}
              {nextStatut && (
                <div className="flex border-t border-gray-100">
                  <button
                    onClick={() => openAction(liv.id, 'annulee')}
                    className="flex-1 py-3.5 text-sm font-semibold text-[#C62828] active:bg-red-50 transition-colors border-r border-gray-100"
                  >
                    Échec
                  </button>
                  <button
                    onClick={() => openAction(liv.id, nextStatut)}
                    className="flex-1 py-3.5 text-sm font-semibold text-green-600 active:bg-green-50 transition-colors"
                  >
                    {ACTION_LABEL[nextStatut] ?? 'Suivant'}
                  </button>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
