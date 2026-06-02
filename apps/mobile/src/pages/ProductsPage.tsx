import React, { useState } from 'react'
import { TopBar } from '../components/TopBar'
import { mockProducts, formatXAF } from '../data/mock'

export function ProductsPage() {
  const [search, setSearch] = useState('')

  const filtered = mockProducts.filter(
    p =>
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      p.sku.toLowerCase().includes(search.toLowerCase()) ||
      p.category.toLowerCase().includes(search.toLowerCase()),
  )

  return (
    <div>
      <TopBar title="Produits" subtitle={`${mockProducts.length} articles`} />

      <div className="px-4 py-3">
        <input
          type="search"
          placeholder="Rechercher un produit..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full bg-white border border-gray-200 rounded-xl px-4 py-2.5 text-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#C62828] focus:border-transparent"
        />
      </div>

      <div className="px-4 pb-4 space-y-2">
        {filtered.length === 0 && (
          <div className="text-center py-16 text-gray-400">
            <p className="text-3xl mb-2">🧵</p>
            <p className="text-sm">Aucun produit trouvé</p>
          </div>
        )}
        {filtered.map(product => {
          const stockStatus =
            product.stock === 0
              ? { label: 'Épuisé', cls: 'text-red-600 bg-red-50' }
              : product.stock < 10
              ? { label: `${product.stock} restants`, cls: 'text-orange-600 bg-orange-50' }
              : { label: `${product.stock} en stock`, cls: 'text-green-700 bg-green-50' }

          return (
            <div
              key={product.id}
              className="bg-white rounded-xl border border-gray-100 shadow-sm px-4 py-3"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-gray-900 truncate">{product.name}</p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {product.sku} · {product.category}
                  </p>
                </div>
                <span className={`text-xs font-medium px-2 py-1 rounded-full shrink-0 ${stockStatus.cls}`}>
                  {stockStatus.label}
                </span>
              </div>
              <div className="flex items-center justify-between mt-2">
                <span className="text-sm font-bold text-[#C62828]">
                  {formatXAF(product.priceXAF)}
                </span>
                <span className="text-xs text-gray-400">/ {product.unit}</span>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
