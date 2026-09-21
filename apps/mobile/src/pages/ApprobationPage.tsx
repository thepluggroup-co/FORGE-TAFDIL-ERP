import React, { useCallback, useEffect, useState } from 'react'
import { TopBar } from '../components/TopBar'
import { fetchBonsSoumis, validerBon, type BonSortie } from '../lib/api'

type ActionState = { bonId: string; type: 'valide' | 'refuse' } | null

export function ApprobationPage() {
  const [bons, setBons] = useState<BonSortie[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [action, setAction] = useState<ActionState>(null)
  const [commentaire, setCommentaire] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [toast, setToast] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setBons(await fetchBonsSoumis())
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

  async function handleConfirm() {
    if (!action) return
    setSubmitting(true)
    try {
      await validerBon(action.bonId, action.type, commentaire || undefined)
      showToast(action.type === 'valide' ? 'Bon approuvé ✓' : 'Bon refusé')
      setAction(null)
      setCommentaire('')
      await load()
    } catch (e) {
      showToast(`Erreur : ${(e as Error).message}`)
    } finally {
      setSubmitting(false)
    }
  }

  const pendingBon = action ? bons.find(b => b.id === action.bonId) : null

  return (
    <div className="min-h-full">
      <TopBar
        title="Approbation"
        subtitle={loading ? '…' : `${bons.length} en attente`}
      />

      {/* Toast */}
      {toast && (
        <div className="fixed top-16 inset-x-4 z-50 bg-gray-900 text-white text-sm font-medium px-4 py-3 rounded-xl shadow-lg text-center">
          {toast}
        </div>
      )}

      {/* Confirm modal */}
      {action && pendingBon && (
        <div className="fixed inset-0 z-40 flex items-end">
          <div className="absolute inset-0 bg-black/40" onClick={() => setAction(null)} />
          <div className="relative w-full bg-white rounded-t-2xl p-6 space-y-4">
            <h3 className="text-base font-bold text-gray-900">
              {action.type === 'valide' ? '✅ Approuver' : '❌ Refuser'} — {pendingBon.numero}
            </h3>
            <p className="text-sm text-gray-500">
              {pendingBon.demandeur} · {pendingBon.motif}
            </p>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                Commentaire {action.type === 'refuse' ? '(recommandé)' : '(optionnel)'}
              </label>
              <textarea
                rows={2}
                value={commentaire}
                onChange={e => setCommentaire(e.target.value)}
                placeholder={action.type === 'refuse' ? 'Motif du refus…' : 'Remarque éventuelle…'}
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#C62828]"
              />
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => { setAction(null); setCommentaire('') }}
                className="flex-1 border border-gray-200 rounded-xl py-3 text-sm font-medium text-gray-600"
              >
                Annuler
              </button>
              <button
                onClick={handleConfirm}
                disabled={submitting}
                className={`flex-1 rounded-xl py-3 text-sm font-semibold text-white transition-colors disabled:opacity-50 ${
                  action.type === 'valide' ? 'bg-green-600 active:bg-green-700' : 'bg-[#C62828] active:bg-[#B71C1C]'
                }`}
              >
                {submitting ? '…' : action.type === 'valide' ? 'Approuver' : 'Refuser'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Content */}
      <div className="px-4 py-3 space-y-3">
        {loading && (
          <div className="flex justify-center py-16">
            <div className="w-8 h-8 border-2 border-[#C62828] border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {!loading && error && (
          <div className="text-center py-16 text-red-500 space-y-2">
            <p className="text-sm">{error}</p>
            <button onClick={load} className="text-xs underline text-gray-500">Réessayer</button>
          </div>
        )}

        {!loading && !error && bons.length === 0 && (
          <div className="text-center py-16 text-gray-400 space-y-2">
            <p className="text-3xl">✅</p>
            <p className="text-sm font-medium">Aucun bon en attente</p>
            <p className="text-xs">Tous les bons de sortie ont été traités.</p>
          </div>
        )}

        {bons.map(bon => {
          const date = new Date(bon.created_at).toLocaleDateString('fr-FR', {
            day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
          })
          const nbArticles = bon.bons_sortie_lignes?.length ?? 0

          return (
            <div key={bon.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
              {/* Header */}
              <div className="px-4 pt-4 pb-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-gray-900">{bon.numero}</p>
                    <p className="text-xs text-gray-500 mt-0.5">{bon.demandeur} · {date}</p>
                  </div>
                  <span className="shrink-0 text-xs font-medium bg-orange-100 text-orange-700 px-2 py-1 rounded-full">
                    En attente
                  </span>
                </div>
                <p className="text-xs text-gray-600 mt-2 leading-relaxed">{bon.motif}</p>
                {bon.notes && (
                  <p className="text-xs text-gray-400 mt-1 italic">{bon.notes}</p>
                )}
              </div>

              {/* Lignes */}
              {nbArticles > 0 && (
                <div className="mx-4 mb-3 border border-gray-100 rounded-xl overflow-hidden">
                  {bon.bons_sortie_lignes.map((l, i) => (
                    <div
                      key={l.id}
                      className={`flex items-center justify-between px-3 py-2 text-xs ${
                        i < nbArticles - 1 ? 'border-b border-gray-100' : ''
                      }`}
                    >
                      <span className="text-gray-700 truncate flex-1">{l.designation}</span>
                      <span className="shrink-0 font-semibold text-gray-900 ml-2">
                        {l.quantite_demandee} {l.unite}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {/* Actions */}
              <div className="flex border-t border-gray-100">
                <button
                  onClick={() => setAction({ bonId: bon.id, type: 'refuse' })}
                  className="flex-1 py-3.5 text-sm font-semibold text-[#C62828] active:bg-red-50 transition-colors border-r border-gray-100"
                >
                  Refuser
                </button>
                <button
                  onClick={() => setAction({ bonId: bon.id, type: 'valide' })}
                  className="flex-1 py-3.5 text-sm font-semibold text-green-600 active:bg-green-50 transition-colors"
                >
                  Approuver
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
