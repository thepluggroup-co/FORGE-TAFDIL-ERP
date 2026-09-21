import React, { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { TopBar } from '../components/TopBar'
import { fetchStockDetail, createStockMouvement, type StockDetail } from '../lib/api'

function formatXAF(amount: number): string {
  return new Intl.NumberFormat('fr-CM', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount) + ' FCFA'
}

function formatDate(value: string): string {
  return new Date(value).toLocaleString('fr-FR', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  })
}

export function StockDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [stock, setStock] = useState<StockDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [actionType, setActionType] = useState<'entree' | 'sortie' | 'ajustement'>('entree')
  const [quantite, setQuantite] = useState(1)
  const [motif, setMotif] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')

  const loadStock = useCallback(async () => {
    if (!id) return
    setLoading(true)
    setError('')
    try {
      setStock(await fetchStockDetail(id))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Impossible de charger le stock')
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    loadStock()
  }, [loadStock])

  const handleSubmit = useCallback(async () => {
    if (!stock) return
    setSubmitting(true)
    setSubmitError('')
    try {
      await createStockMouvement(stock.id, {
        type: actionType,
        quantite,
        motif: motif || (actionType === 'entree' ? 'Entrée mobile' : actionType === 'sortie' ? 'Sortie mobile' : 'Ajustement mobile'),
      })
      setMotif('')
      setQuantite(1)
      await loadStock()
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Erreur lors de l’opération')
    } finally {
      setSubmitting(false)
    }
  }, [actionType, quantite, motif, stock, loadStock])

  return (
    <div>
      <TopBar title="Détail stock" subtitle={stock ? stock.designation : '...'} />

      <div className="px-4 py-3 space-y-4">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="text-sm text-[#C62828] font-semibold"
        >
          ← Retour
        </button>

        {loading ? (
          <div className="py-16 text-center text-gray-500">Chargement...</div>
        ) : error ? (
          <div className="py-16 text-center text-red-600">{error}</div>
        ) : stock ? (
          <>
            <section className="bg-white rounded-3xl border border-gray-100 shadow-sm p-4 space-y-4">
              <div className="space-y-1">
                <p className="text-sm font-semibold text-gray-900">{stock.designation}</p>
                <p className="text-xs text-gray-500">{stock.ref} · {stock.categorie}</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-3xl bg-gray-50 p-3">
                  <p className="text-xs text-gray-500">Quantité</p>
                  <p className="text-lg font-semibold text-gray-900">{stock.stock_actuel} {stock.unite}</p>
                </div>
                <div className="rounded-3xl bg-gray-50 p-3">
                  <p className="text-xs text-gray-500">Valeur unitaire</p>
                  <p className="text-lg font-semibold text-[#C62828]">{formatXAF(stock.prix_unitaire_xaf)}</p>
                </div>
                <div className="rounded-3xl bg-gray-50 p-3">
                  <p className="text-xs text-gray-500">Seuil alerte</p>
                  <p className="text-lg font-semibold text-gray-900">{stock.stock_min} {stock.unite}</p>
                </div>
                <div className="rounded-3xl bg-gray-50 p-3">
                  <p className="text-xs text-gray-500">Seuil critique</p>
                  <p className="text-lg font-semibold text-gray-900">{stock.stock_critique} {stock.unite}</p>
                </div>
              </div>
            </section>

            <section className="bg-white rounded-3xl border border-gray-100 shadow-sm p-4 space-y-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-gray-900">Actions</p>
                  <p className="text-xs text-gray-500">Entrée, sortie ou ajustement du stock</p>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2">
                {['entree', 'sortie', 'ajustement'].map((type) => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => setActionType(type as 'entree' | 'sortie' | 'ajustement')}
                    className={`rounded-2xl py-2 text-sm font-semibold ${actionType === type ? 'bg-[#C62828] text-white' : 'bg-gray-100 text-gray-700'}`}
                  >
                    {type === 'entree' ? 'Entrée' : type === 'sortie' ? 'Sortie' : 'Ajustement'}
                  </button>
                ))}
              </div>

              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Quantité</label>
                  <input
                    type="number"
                    min={1}
                    value={quantite}
                    onChange={(e) => setQuantite(Math.max(1, Number(e.target.value) || 1))}
                    className="w-full rounded-2xl border border-gray-200 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#C62828]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Motif</label>
                  <input
                    type="text"
                    value={motif}
                    onChange={(e) => setMotif(e.target.value)}
                    placeholder="Ex: réapprovisionnement, correction..."
                    className="w-full rounded-2xl border border-gray-200 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#C62828]"
                  />
                </div>
                {submitError && <p className="text-xs text-red-600">{submitError}</p>}
                <button
                  type="button"
                  onClick={handleSubmit}
                  disabled={submitting}
                  className="w-full rounded-2xl bg-[#C62828] text-white py-3 text-sm font-semibold disabled:opacity-60"
                >
                  {submitting ? 'Traitement…' : 'Valider'}
                </button>
              </div>
            </section>

            <section className="bg-white rounded-3xl border border-gray-100 shadow-sm p-4 space-y-3">
              <div>
                <p className="text-sm font-semibold text-gray-900">Historique 30 jours</p>
                <p className="text-xs text-gray-500">Mouvements récents du produit</p>
              </div>
              {stock.historique_30j.length === 0 ? (
                <div className="rounded-3xl bg-gray-50 p-4 text-center text-sm text-gray-400">
                  Aucun mouvement récent.
                </div>
              ) : (
                <div className="space-y-2">
                  {stock.historique_30j.map((m) => (
                    <div key={m.id} className="rounded-3xl border border-gray-100 bg-gray-50 p-3">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-semibold text-gray-900">{m.type === 'entree' ? 'Entrée' : m.type === 'sortie' ? 'Sortie' : 'Ajustement'}</span>
                        <span className="text-xs text-gray-500">{formatDate(m.created_at)}</span>
                      </div>
                      <div className="mt-2 flex items-center justify-between gap-2 text-sm text-gray-600">
                        <span>{m.quantite} {stock.unite}</span>
                        <span>{m.reference ?? m.notes ?? '—'}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </>
        ) : null}
      </div>
    </div>
  )
}
