import { NumberInput } from '@forge/ui'
import React, { useCallback, useEffect, useState } from 'react'
import { usePermissions } from '../context/PermissionsContext'
import { useParams } from 'react-router-dom'
import { TopBar } from '../components/TopBar'
import { Icon } from '../components/ui'
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
  // Les mouvements de stock exigent STOCK:CREATE côté API.
  const { can } = usePermissions()
  const canWriteStock = can('STOCK', 'CREATE')
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
      <TopBar title="Détail produit" back />

      <div className="px-4 py-3 space-y-4">
        {loading ? (
          <div className="py-16 text-center text-gray-500">Chargement...</div>
        ) : error ? (
          <div className="py-16 text-center text-red-600">{error}</div>
        ) : stock ? (
          <>
            <section className="bg-white rounded-2xl border border-gray-100 shadow-[0_1px_3px_rgba(16,24,40,0.06)] overflow-hidden">
              <div className="aspect-[4/3] bg-gray-100 flex items-center justify-center text-gray-300">
                {stock.image_url
                  ? <img src={stock.image_url} alt={stock.designation} className="w-full h-full object-cover" />
                  : <Icon name="box" size={56} strokeWidth={1.4} />}
              </div>
              <div className="p-4 space-y-3">
                <div>
                  <h2 className="text-xl font-bold text-gray-900">{stock.designation}</h2>
                  {stock.description && <p className="text-sm text-gray-500 mt-0.5">{stock.description}</p>}
                </div>
                <p className="text-2xl font-extrabold text-gray-900">
                  {formatXAF(stock.prix_unitaire_xaf)} <span className="text-sm font-medium text-gray-400">/ {stock.unite}</span>
                </p>
                <div className={`flex items-center justify-between rounded-xl px-3.5 py-2.5 text-sm font-medium ${
                  stock.stock_actuel <= stock.stock_critique ? 'bg-red-50 text-red-700'
                    : stock.stock_actuel <= stock.stock_min ? 'bg-orange-50 text-orange-700'
                    : 'bg-green-50 text-green-700'}`}
                >
                  <span className="flex items-center gap-2">
                    <Icon name={stock.stock_actuel <= stock.stock_min ? 'alert' : 'check'} size={16} />
                    {stock.stock_actuel === 0 ? 'Épuisé'
                      : stock.stock_actuel <= stock.stock_critique ? 'Stock critique'
                      : stock.stock_actuel <= stock.stock_min ? 'Stock faible'
                      : 'Stock disponible'}
                  </span>
                  <span className="font-bold">{stock.stock_actuel} {stock.unite}</span>
                </div>
                <div>
                  <p className="text-sm font-bold text-gray-900 mb-1">Détails</p>
                  <dl className="divide-y divide-gray-100 text-sm">
                    {([
                      ['Référence', stock.ref],
                      ['Catégorie', stock.categorie],
                      ['Unité', stock.unite],
                      ['Seuil minimum', `${stock.stock_min} ${stock.unite}`],
                      ['Seuil critique', `${stock.stock_critique} ${stock.unite}`],
                    ] as Array<[string, string]>).map(([k, v]) => (
                      <div key={k} className="flex items-center justify-between py-2.5">
                        <dt className="text-gray-500">{k}</dt>
                        <dd className="font-medium text-gray-900">{v}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              </div>
            </section>

            {canWriteStock && (
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
                  <NumberInput

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
            )}

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
