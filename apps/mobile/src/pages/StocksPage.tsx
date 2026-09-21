import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { TopBar } from '../components/TopBar'
import { fetchStocks, createStock, uploadStockImages, createStockMouvement, type ApiStock, type CreateStockPayload } from '../lib/api'

function formatXAF(amount: number): string {
  return new Intl.NumberFormat('fr-CM', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount) + ' FCFA'
}

export function StocksPage() {
  const [search, setSearch] = useState('')
  const [stocks, setStocks] = useState<ApiStock[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [actionLoading, setActionLoading] = useState(false)
  const [actionError, setActionError] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [createLoading, setCreateLoading] = useState(false)
  const [createError, setCreateError] = useState('')
  const [createSuccess, setCreateSuccess] = useState('')
  const [newStock, setNewStock] = useState<CreateStockPayload>({
    ref: '',
    designation: '',
    description: '',
    categorie: '',
    unite: 'pièce',
    stock_actuel: 0,
    stock_min: 5,
    stock_critique: 2,
    prix_unitaire_xaf: 0,
    emplacement: '',
    fournisseur: '',
  })
  const [newStockFiles, setNewStockFiles] = useState<File[]>([])
  const [uploadTargetProductId, setUploadTargetProductId] = useState<string | null>(null)
  const [filePreviews, setFilePreviews] = useState<Array<{ file: File; url: string }>>([])

  const loadStocks = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const result = await fetchStocks({ search, per_page: 100 })
      setStocks(result.data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur de chargement des stocks')
    } finally {
      setLoading(false)
    }
  }, [search])

  useEffect(() => {
    const previews = newStockFiles.map((file) => ({ file, url: URL.createObjectURL(file) }))
    setFilePreviews(previews)
    return () => previews.forEach((preview) => URL.revokeObjectURL(preview.url))
  }, [newStockFiles])

  const navigate = useNavigate()

  useEffect(() => {
    const timer = setTimeout(loadStocks, 200)
    return () => clearTimeout(timer)
  }, [loadStocks])

  const updateStock = useCallback(async (stock: ApiStock, type: 'entree' | 'sortie') => {
    setActionLoading(true)
    setActionError('')
    try {
      const qty = Math.max(1, Math.ceil(stock.stock_actuel * 0.1))
      const result = await createStockMouvement(stock.id, {
        type,
        quantite: qty,
        motif: type === 'entree' ? 'Entrée mobile' : 'Sortie mobile',
      })
      setStocks((prev) => prev.map((item) => item.id === result.produit.id ? result.produit : item))
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Erreur de mise à jour du stock')
    } finally {
      setActionLoading(false)
    }
  }, [])

  const createStockProduct = useCallback(async () => {
    setCreateLoading(true)
    setCreateError('')
    setCreateSuccess('')
    try {
      const created = await createStock(newStock)
      setStocks((prev) => [created, ...prev])

      if (newStockFiles && newStockFiles.length > 0) {
        try {
          await uploadStockImages(created.id, newStockFiles)
        } catch (upErr) {
          const msg = upErr instanceof Error ? upErr.message : String(upErr)
          setUploadTargetProductId(created.id)
          setCreateError('Erreur téléversement des images : ' + msg)
          setCreateLoading(false)
          return
        }
      }

      setCreateSuccess('Produit créé avec succès')
      setCreateOpen(false)
      setNewStock({
        ref: '',
        designation: '',
        description: '',
        categorie: '',
        unite: 'pièce',
        stock_actuel: 0,
        stock_min: 5,
        stock_critique: 2,
        prix_unitaire_xaf: 0,
        emplacement: '',
        fournisseur: '',
      })
      setNewStockFiles([])
      setUploadTargetProductId(null)
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Erreur de création du produit')
    } finally {
      setCreateLoading(false)
    }
  }, [newStock, newStockFiles])

  const retryUploadImages = useCallback(async () => {
    if (!uploadTargetProductId) return
    if (newStockFiles.length === 0) {
      setCreateError('Aucune image à téléverser.')
      return
    }

    setCreateLoading(true)
    setCreateError('')
    try {
      await uploadStockImages(uploadTargetProductId, newStockFiles)
      setCreateSuccess('Images téléversées avec succès.')
      setCreateOpen(false)
      setNewStock({
        ref: '',
        designation: '',
        description: '',
        categorie: '',
        unite: 'pièce',
        stock_actuel: 0,
        stock_min: 5,
        stock_critique: 2,
        prix_unitaire_xaf: 0,
        emplacement: '',
        fournisseur: '',
      })
      setNewStockFiles([])
      setUploadTargetProductId(null)
    } catch (upErr) {
      const msg = upErr instanceof Error ? upErr.message : String(upErr)
      setCreateError('Erreur téléversement des images : ' + msg)
    } finally {
      setCreateLoading(false)
    }
  }, [uploadTargetProductId, newStockFiles])

  return (
    <div>
      <TopBar title="Stocks" subtitle={`${stocks.length} articles`} />

      <div className="px-4 py-3 space-y-3">
        <div className="flex gap-3 flex-col sm:flex-row">
          <input
            type="search"
            placeholder="Rechercher un article..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="flex-1 bg-white border border-gray-200 rounded-xl px-4 py-2.5 text-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#C62828] focus:border-transparent"
          />
          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            className="rounded-2xl bg-[#C62828] text-white py-3 px-4 text-sm font-semibold hover:bg-[#B71C1C]"
          >
            Nouveau produit
          </button>
        </div>
        {createSuccess && (
          <div className="rounded-2xl bg-green-50 border border-green-100 p-3 text-sm text-green-700">{createSuccess}</div>
        )}
      </div>

      {createOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4">
          <div className="w-full max-w-xl rounded-3xl bg-white shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
              <div>
                <h2 className="text-base font-semibold text-gray-900">Nouveau produit</h2>
                <p className="text-xs text-gray-500">Saisis les informations du produit pour l’ajouter au stock.</p>
              </div>
              <button
                type="button"
                onClick={() => { setCreateOpen(false); setCreateError('') }}
                className="text-gray-500 hover:text-gray-900"
              >
                Fermer
              </button>
            </div>
            <div className="space-y-4 p-5">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="space-y-1 text-xs text-gray-600">
                  Référence
                  <input
                    value={newStock.ref}
                    onChange={e => setNewStock({ ...newStock, ref: e.target.value })}
                    className="w-full rounded-2xl border border-gray-200 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#C62828]"
                  />
                </label>
                <label className="space-y-1 text-xs text-gray-600">
                  Désignation
                  <input
                    value={newStock.designation}
                    onChange={e => setNewStock({ ...newStock, designation: e.target.value })}
                    className="w-full rounded-2xl border border-gray-200 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#C62828]"
                  />
                </label>
                <label className="space-y-1 text-xs text-gray-600">
                  Catégorie
                  <input
                    value={newStock.categorie}
                    onChange={e => setNewStock({ ...newStock, categorie: e.target.value })}
                    className="w-full rounded-2xl border border-gray-200 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#C62828]"
                  />
                </label>
                <label className="space-y-1 text-xs text-gray-600">
                  Unité
                  <input
                    value={newStock.unite}
                    onChange={e => setNewStock({ ...newStock, unite: e.target.value })}
                    className="w-full rounded-2xl border border-gray-200 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#C62828]"
                  />
                </label>
              </div>
              <label className="space-y-1 text-xs text-gray-600">
                Description
                <textarea
                  rows={3}
                  value={newStock.description ?? ''}
                  onChange={e => setNewStock({ ...newStock, description: e.target.value })}
                  className="w-full rounded-2xl border border-gray-200 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#C62828]"
                />
              </label>
              <label className="space-y-1 text-xs text-gray-600">
                Images (optionnel)
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={e => setNewStockFiles(Array.from(e.target.files ?? []))}
                  className="w-full rounded-2xl border border-gray-200 px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#C62828]"
                />
              </label>
              {filePreviews.length > 0 && (
                <div className="space-y-2">
                  <div className="text-xs font-semibold text-gray-600">Aperçu des images</div>
                  <div className="grid grid-cols-2 gap-2">
                    {filePreviews.map((preview) => (
                      <div key={preview.url} className="relative rounded-2xl overflow-hidden border border-gray-200">
                        <img src={preview.url} alt={preview.file.name} className="h-24 w-full object-cover" />
                        <button
                          type="button"
                          onClick={() => setNewStockFiles((prev) => prev.filter((file) => file !== preview.file))}
                          className="absolute top-2 right-2 rounded-full bg-black/60 text-white w-7 h-7 flex items-center justify-center text-xs"
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {uploadTargetProductId && (
                <div className="rounded-2xl bg-yellow-50 border border-yellow-200 p-3 text-sm text-yellow-900">
                  <div>Le produit a été créé, mais le téléversement des images a échoué.</div>
                  <button
                    type="button"
                    onClick={retryUploadImages}
                    disabled={createLoading}
                    className="mt-3 rounded-2xl bg-[#C62828] text-white py-2 px-3 text-sm"
                  >
                    {createLoading ? 'Réessai…' : 'Réessayer le téléversement'}
                  </button>
                </div>
              )}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="space-y-1 text-xs text-gray-600">
                  Stock initial
                  <input
                    type="number"
                    min={0}
                    value={newStock.stock_actuel}
                    onChange={e => setNewStock({ ...newStock, stock_actuel: Number(e.target.value) })}
                    className="w-full rounded-2xl border border-gray-200 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#C62828]"
                  />
                </label>
                <label className="space-y-1 text-xs text-gray-600">
                  Prix unitaire
                  <input
                    type="number"
                    min={0}
                    value={newStock.prix_unitaire_xaf}
                    onChange={e => setNewStock({ ...newStock, prix_unitaire_xaf: Number(e.target.value) })}
                    className="w-full rounded-2xl border border-gray-200 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#C62828]"
                  />
                </label>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="space-y-1 text-xs text-gray-600">
                  Stock minimum
                  <input
                    type="number"
                    min={0}
                    value={newStock.stock_min}
                    onChange={e => setNewStock({ ...newStock, stock_min: Number(e.target.value) })}
                    className="w-full rounded-2xl border border-gray-200 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#C62828]"
                  />
                </label>
                <label className="space-y-1 text-xs text-gray-600">
                  Seuil critique
                  <input
                    type="number"
                    min={0}
                    value={newStock.stock_critique}
                    onChange={e => setNewStock({ ...newStock, stock_critique: Number(e.target.value) })}
                    className="w-full rounded-2xl border border-gray-200 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#C62828]"
                  />
                </label>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="space-y-1 text-xs text-gray-600">
                  Emplacement
                  <input
                    value={newStock.emplacement ?? ''}
                    onChange={e => setNewStock({ ...newStock, emplacement: e.target.value })}
                    className="w-full rounded-2xl border border-gray-200 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#C62828]"
                  />
                </label>
                <label className="space-y-1 text-xs text-gray-600">
                  Fournisseur
                  <input
                    value={newStock.fournisseur ?? ''}
                    onChange={e => setNewStock({ ...newStock, fournisseur: e.target.value })}
                    className="w-full rounded-2xl border border-gray-200 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#C62828]"
                  />
                </label>
              </div>
              {createError && <div className="text-sm text-red-600">{createError}</div>}
              <div className="flex flex-col gap-3 sm:flex-row">
                <button
                  type="button"
                  onClick={() => setCreateOpen(false)}
                  className="flex-1 rounded-2xl border border-gray-200 py-3 text-sm font-semibold text-gray-700"
                >
                  Annuler
                </button>
                <button
                  type="button"
                  onClick={createStockProduct}
                  disabled={createLoading}
                  className="flex-1 rounded-2xl bg-[#C62828] text-white py-3 text-sm font-semibold hover:bg-[#B71C1C] disabled:opacity-60"
                >
                  {createLoading ? 'Création…' : 'Créer le produit'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {loading ? (
        <div className="px-4 py-10 text-center text-gray-500">Chargement des stocks…</div>
      ) : error ? (
        <div className="px-4 py-10 text-center text-red-600">{error}</div>
      ) : stocks.length === 0 ? (
        <div className="px-4 py-16 text-center text-gray-400">
          <p className="text-3xl mb-2">🧵</p>
          <p className="text-sm">Aucun article trouvé</p>
        </div>
      ) : (
        <div className="px-4 pb-4 space-y-2">
          {stocks.map(stock => {
            const stockStatus =
              stock.stock_actuel === 0
                ? { label: 'Épuisé', cls: 'text-red-600 bg-red-50' }
                : stock.stock_actuel < 10
                ? { label: `${stock.stock_actuel} restants`, cls: 'text-orange-600 bg-orange-50' }
                : { label: `${stock.stock_actuel} en stock`, cls: 'text-green-700 bg-green-50' }

            return (
              <div
                key={stock.id}
                className="bg-white rounded-xl border border-gray-100 shadow-sm px-4 py-3"
              >
                <div
                  onClick={() => navigate(`/stocks/${stock.id}`)}
                  role="button"
                  className="w-full text-left cursor-pointer"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-gray-900 truncate">{stock.designation}</p>
                      <p className="text-xs text-gray-400 mt-0.5">
                        {stock.ref} · {stock.categorie}
                      </p>
                    </div>
                    <span className={`text-xs font-medium px-2 py-1 rounded-full shrink-0 ${stockStatus.cls}`}>
                      {stockStatus.label}
                    </span>
                  </div>
                </div>
                <div className="flex flex-col gap-3 mt-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-xs text-gray-500">Prix unitaire</div>
                      <div className="text-sm font-bold text-[#C62828]">{formatXAF(stock.prix_unitaire_xaf)}</div>
                    </div>
                    <div>
                      <div className="text-xs text-gray-500">Quantité</div>
                      <div className="text-sm font-semibold text-gray-900">{stock.stock_actuel} {stock.unite}</div>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => updateStock(stock, 'entree')}
                      disabled={actionLoading}
                      className="flex-1 rounded-2xl bg-green-600 text-white py-2 text-sm font-semibold hover:bg-green-700 disabled:opacity-60"
                    >
                      Entrée
                    </button>
                    <button
                      type="button"
                      onClick={() => updateStock(stock, 'sortie')}
                      disabled={actionLoading || stock.stock_actuel === 0}
                      className="flex-1 rounded-2xl bg-[#C62828] text-white py-2 text-sm font-semibold hover:bg-[#B71C1C] disabled:opacity-60"
                    >
                      Sortie
                    </button>
                    {['alerte', 'critique', 'rupture'].includes(stock.statut) && (
                      <button
                        type="button"
                        onClick={() => updateStock(stock, 'entree')}
                        disabled={actionLoading}
                        className="flex-1 rounded-2xl bg-orange-500 text-white py-2 text-sm font-semibold hover:bg-orange-600 disabled:opacity-60"
                      >
                        Appro
                      </button>
                    )}
                  </div>
                </div>
                {actionError && (
                  <p className="mt-3 text-xs text-red-600">{actionError}</p>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
