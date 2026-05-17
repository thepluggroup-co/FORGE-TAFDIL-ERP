'use client'

import { useState, useEffect, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Search, SlidersHorizontal, Package } from 'lucide-react'
import { createClient } from '@/lib/supabase'
import { ProductCard } from './ProductCard'
import type { Produit, Disponibilite } from '@/lib/types'

// ── Catégories ─────────────────────────────────────────────────────────────────

const CATEGORIES = ['Tout', 'Aluminium', 'Ferronnerie', 'Construction', 'Formation']

// ── Skeleton card ──────────────────────────────────────────────────────────────

function CardSkeleton() {
  return (
    <div className="animate-pulse rounded-2xl border border-gray-100 bg-white">
      <div className="h-52 rounded-t-2xl bg-gray-100" />
      <div className="p-4 space-y-3">
        <div className="h-3 w-16 bg-gray-100 rounded" />
        <div className="h-4 w-3/4 bg-gray-100 rounded" />
        <div className="h-3 w-full bg-gray-100 rounded" />
        <div className="h-3 w-2/3 bg-gray-100 rounded" />
        <div className="h-6 w-24 bg-gray-100 rounded" />
      </div>
      <div className="border-t border-gray-50 p-3 flex gap-2">
        <div className="flex-1 h-8 bg-gray-100 rounded-xl" />
        <div className="flex-1 h-8 bg-gray-100 rounded-xl" />
        <div className="w-10 h-8 bg-gray-100 rounded-xl" />
      </div>
    </div>
  )
}

// ── CatalogueClient ────────────────────────────────────────────────────────────

interface Props {
  initialProduits: Produit[]
}

export function CatalogueClient({ initialProduits }: Props) {
  const [produits, setProduits] = useState<Produit[]>(initialProduits)
  const [search, setSearch]     = useState('')
  const [categorie, setCategorie] = useState('Tout')
  const [enStockSeul, setEnStockSeul] = useState(false)

  // ── Realtime : mise à jour des stocks sans rechargement ──────────────────────

  useEffect(() => {
    const supabase = createClient()

    const channel = supabase
      .channel('catalogue-produits')
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'produits' },
        (payload) => {
          const updated = payload.new as { id: string; stock_actuel: number; stock_min: number }
          setProduits((prev) =>
            prev.map((p) => {
              if (p.id !== updated.id) return p
              const stock = updated.stock_actuel
              const seuil = updated.stock_min ?? p.seuil_alerte
              const dispo: Disponibilite =
                stock <= 0             ? 'indisponible' :
                stock <= seuil         ? 'stock_faible' : 'disponible'
              return { ...p, stock_actuel: stock, seuil_alerte: seuil, disponibilite: dispo }
            })
          )
        }
      )
      .subscribe()

    return () => { void supabase.removeChannel(channel) }
  }, [])

  // ── Filtres côté client ──────────────────────────────────────────────────────

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim()
    return produits.filter((p) => {
      if (q && !p.nom.toLowerCase().includes(q) && !p.ref.toLowerCase().includes(q)) return false
      if (categorie !== 'Tout' && !p.categorie.toLowerCase().includes(categorie.toLowerCase())) return false
      if (enStockSeul && p.disponibilite === 'indisponible') return false
      return true
    })
  }, [produits, search, categorie, enStockSeul])

  return (
    <div>
      {/* Barre de filtres sticky */}
      <div className="sticky top-16 z-30 border-b border-gray-100 bg-white/95 px-4 py-3 backdrop-blur-md shadow-sm">
        <div className="mx-auto max-w-7xl">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">

            {/* Recherche */}
            <div className="relative flex-1 max-w-xs">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Rechercher un produit…"
                className="w-full rounded-xl border border-gray-200 bg-gray-50 py-2.5 pl-9 pr-4 text-sm outline-none transition-all focus:border-forge-red focus:bg-white focus:ring-2 focus:ring-forge-red/10"
              />
            </div>

            {/* Chips catégories */}
            <div className="flex flex-wrap gap-1.5">
              {CATEGORIES.map((cat) => (
                <button
                  key={cat}
                  onClick={() => setCategorie(cat)}
                  className="rounded-full px-3.5 py-1.5 text-xs font-semibold transition-all"
                  style={{
                    backgroundColor: categorie === cat ? '#C62828' : '#ECEFF1',
                    color: categorie === cat ? '#fff' : '#37474F',
                  }}
                >
                  {cat}
                </button>
              ))}
            </div>

            {/* Toggle en stock */}
            <label className="flex cursor-pointer items-center gap-2 ml-auto">
              <span className="text-xs font-medium text-forge-steel whitespace-nowrap">En stock seulement</span>
              <button
                role="switch"
                aria-checked={enStockSeul}
                onClick={() => setEnStockSeul((v) => !v)}
                className="relative h-5 w-9 rounded-full transition-colors"
                style={{ backgroundColor: enStockSeul ? '#C62828' : '#ECEFF1' }}
              >
                <span
                  className="absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform"
                  style={{ transform: enStockSeul ? 'translateX(16px)' : 'translateX(2px)' }}
                />
              </button>
            </label>

            {/* Compteur */}
            <span className="flex items-center gap-1.5 whitespace-nowrap text-xs text-gray-400">
              <SlidersHorizontal size={12} />
              {filtered.length} produit{filtered.length !== 1 ? 's' : ''} trouvé{filtered.length !== 1 ? 's' : ''}
            </span>
          </div>
        </div>
      </div>

      {/* Grille produits */}
      <div className="mx-auto max-w-7xl px-4 py-8">
        {filtered.length === 0 ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex flex-col items-center justify-center py-20 text-center"
          >
            <Package size={48} className="mb-4 text-gray-200" />
            <p className="text-forge-dark font-semibold">Aucun produit trouvé</p>
            <p className="mt-1 text-sm text-forge-steel">Essayez d'autres critères de recherche.</p>
            <button
              onClick={() => { setSearch(''); setCategorie('Tout'); setEnStockSeul(false) }}
              className="mt-4 rounded-xl border border-forge-red px-5 py-2 text-sm font-semibold text-forge-red hover:bg-forge-red-light"
            >
              Réinitialiser les filtres
            </button>
          </motion.div>
        ) : (
          <motion.div
            layout
            className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3"
          >
            <AnimatePresence mode="popLayout">
              {filtered.map((produit) => (
                <motion.div
                  key={produit.id}
                  layout
                  initial={{ opacity: 0, scale: 0.96 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.96 }}
                  transition={{ duration: 0.2 }}
                >
                  <ProductCard produit={produit} />
                </motion.div>
              ))}
            </AnimatePresence>
          </motion.div>
        )}
      </div>
    </div>
  )
}
