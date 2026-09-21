'use client'

import Image from 'next/image'
import Link from 'next/link'
import type { ReactNode } from 'react'
import { useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  ArrowRight,
  Eye,
  Grid3X3,
  Heart,
  List,
  Package,
  RotateCcw,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Truck,
  Wallet,
  Headphones,
  ShoppingCart,
} from 'lucide-react'
import { createClient } from '@/lib/supabase'
import { useCart } from '@/lib/cart'
import type { Disponibilite, Produit } from '@/lib/types'

interface Props {
  initialProduits: Produit[]
  initialSearch?: string
  initialCategorie?: string
}

type SortKey = 'populaires' | 'prix_asc' | 'prix_desc' | 'stock'
type ViewMode = 'grid' | 'list'

const FALLBACK_CATEGORY_IMAGES = [
  'https://images.unsplash.com/photo-1564540583246-934409427776?auto=format&fit=crop&w=600&q=80',
  'https://images.unsplash.com/photo-1600607686527-6fb886090705?auto=format&fit=crop&w=600&q=80',
  'https://images.unsplash.com/photo-1504917595217-d4dc5ebe6122?auto=format&fit=crop&w=600&q=80',
  'https://images.unsplash.com/photo-1504148455328-c376907d081c?auto=format&fit=crop&w=600&q=80',
  'https://images.unsplash.com/photo-1586864387789-628af9feed72?auto=format&fit=crop&w=600&q=80',
  'https://images.unsplash.com/photo-1581092160607-ee22621dd758?auto=format&fit=crop&w=600&q=80',
]

const FALLBACK_PRODUCT_IMAGES = [
  'https://images.unsplash.com/photo-1564540583246-934409427776?auto=format&fit=crop&w=700&q=80',
  'https://images.unsplash.com/photo-1504148455328-c376907d081c?auto=format&fit=crop&w=700&q=80',
  'https://images.unsplash.com/photo-1518709268805-4e9042af2176?auto=format&fit=crop&w=700&q=80',
]

const CATEGORY_FALLBACKS = ['Aluminium', 'Ferronnerie', 'Construction metallique', 'Outils & Accessoires', 'Fixations', 'Protection & Securite']
const BRAND_FALLBACKS = ['ALUMCO', 'BOSCH', 'WURTH', 'HILTI', 'SOUDAL']
const PAGE_SIZE = 12

function formatXAF(value: number | null | undefined) {
  if (!value) return 'Prix sur devis'
  return new Intl.NumberFormat('fr-CM', { maximumFractionDigits: 0 }).format(value) + ' FCFA'
}

function normalize(value: string) {
  return value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

function statusLabel(disponibilite: Disponibilite) {
  if (disponibilite === 'stock_faible') return 'Stock faible'
  if (disponibilite === 'indisponible') return 'Sur commande'
  return 'Disponible'
}

function statusClass(disponibilite: Disponibilite) {
  if (disponibilite === 'stock_faible') return 'bg-amber-100 text-amber-700'
  if (disponibilite === 'indisponible') return 'bg-gray-100 text-gray-600'
  return 'bg-green-100 text-green-700'
}

function productImage(produit: Produit, index: number) {
  return produit.images?.[0] || FALLBACK_PRODUCT_IMAGES[index % FALLBACK_PRODUCT_IMAGES.length]
}

function categoryMatches(productCategory: string, selected: string) {
  if (selected === 'Tous les produits') return true
  const product = normalize(productCategory)
  const category = normalize(selected)
  return product.includes(category) || category.includes(product)
}

function categoryCards(produits: Produit[]) {
  const categories = [...new Set(produits.map((p) => p.categorie).filter(Boolean))]
  const source = categories.length ? categories : CATEGORY_FALLBACKS

  return source.slice(0, 6).map((name, index) => {
    const matching = produits.filter((p) => categoryMatches(p.categorie, name))
    return {
      name,
      count: matching.length,
      image: matching[0]?.images?.[0] || FALLBACK_CATEGORY_IMAGES[index % FALLBACK_CATEGORY_IMAGES.length],
    }
  })
}

function derivedBrands(produits: Produit[]) {
  const tags = produits.flatMap((p) => p.tags ?? []).filter((tag) => tag.length <= 16)
  const unique = [...new Set(tags)]
  return unique.length ? unique.slice(0, 5) : BRAND_FALLBACKS
}

export function CatalogueClient({ initialProduits, initialSearch = '', initialCategorie = 'Tout' }: Props) {
  const initialMaxPrice = Math.max(500000, ...initialProduits.map((p) => p.prix_public ?? 0).filter((value) => value > 0))
  const [produits, setProduits] = useState<Produit[]>(initialProduits)
  const [search, setSearch] = useState(initialSearch)
  const [categorie, setCategorie] = useState(initialCategorie === 'Tout' ? 'Tous les produits' : initialCategorie)
  const [availability, setAvailability] = useState<'all' | 'stock' | 'stock_faible'>('all')
  const [selectedBrands, setSelectedBrands] = useState<string[]>([])
  const [delivery, setDelivery] = useState<'all' | '24h' | '48h' | '7j'>('all')
  const [maxPrice, setMaxPrice] = useState(initialMaxPrice)
  const [sort, setSort] = useState<SortKey>('populaires')
  const [viewMode, setViewMode] = useState<ViewMode>('grid')
  const [page, setPage] = useState(1)
  const { addItem } = useCart()

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
                stock <= 0 ? 'indisponible' :
                stock <= seuil ? 'stock_faible' : 'disponible'
              return { ...p, stock_actuel: stock, seuil_alerte: seuil, disponibilite: dispo }
            }),
          )
        },
      )
      .subscribe()

    return () => { void supabase.removeChannel(channel) }
  }, [])

  const categories = useMemo(() => categoryCards(produits), [produits])
  const brands = useMemo(() => derivedBrands(produits), [produits])
  const maxAvailablePrice = useMemo(() => {
    const prices = produits.map((p) => p.prix_public ?? 0).filter((value) => value > 0)
    return Math.max(500000, ...prices)
  }, [produits])

  useEffect(() => {
    if (maxPrice === 0) setMaxPrice(maxAvailablePrice)
  }, [maxAvailablePrice, maxPrice])

  useEffect(() => {
    setPage(1)
  }, [search, categorie, availability, selectedBrands, delivery, maxPrice, sort])

  const stats = useMemo(() => ({
    total: produits.length,
    stock: produits.filter((p) => p.disponibilite === 'disponible').length,
    stockFaible: produits.filter((p) => p.disponibilite === 'stock_faible').length,
  }), [produits])

  const filtered = useMemo(() => {
    const q = normalize(search.trim())

    const result = produits.filter((p) => {
      const searchable = normalize(`${p.nom} ${p.ref} ${p.categorie} ${(p.tags ?? []).join(' ')}`)
      if (q && !searchable.includes(q)) return false
      if (categorie !== 'Tous les produits' && !categoryMatches(p.categorie, categorie)) return false
      if (availability === 'stock' && p.disponibilite === 'indisponible') return false
      if (availability === 'stock_faible' && p.disponibilite !== 'stock_faible') return false
      if ((p.prix_public ?? 0) > maxPrice) return false
      if (selectedBrands.length > 0 && !selectedBrands.some((brand) => (p.tags ?? []).some((tag) => normalize(tag).includes(normalize(brand))))) return false
      if (delivery === '24h' && p.delai_fabrication_jours > 1) return false
      if (delivery === '48h' && p.delai_fabrication_jours > 2) return false
      if (delivery === '7j' && p.delai_fabrication_jours > 7) return false
      return true
    })

    return result.sort((a, b) => {
      if (sort === 'prix_asc') return (a.prix_public ?? Number.MAX_SAFE_INTEGER) - (b.prix_public ?? Number.MAX_SAFE_INTEGER)
      if (sort === 'prix_desc') return (b.prix_public ?? 0) - (a.prix_public ?? 0)
      if (sort === 'stock') return b.stock_actuel - a.stock_actuel
      return Number(b.disponibilite === 'disponible') - Number(a.disponibilite === 'disponible')
    })
  }, [availability, categorie, delivery, maxPrice, produits, search, selectedBrands, sort])

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const currentPage = Math.min(page, pageCount)
  const paginated = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)

  const resetFilters = () => {
    setSearch('')
    setCategorie('Tous les produits')
    setAvailability('all')
    setSelectedBrands([])
    setDelivery('all')
    setMaxPrice(maxAvailablePrice)
    setSort('populaires')
  }

  const toggleBrand = (brand: string) => {
    setSelectedBrands((prev) => prev.includes(brand) ? prev.filter((item) => item !== brand) : [...prev, brand])
  }

  const handleAddToCart = (produit: Produit) => {
    void addItem({ id: produit.id, ref: produit.ref, nom: produit.nom, prix: produit.prix_public, image: produit.images?.[0] ?? null }, 1)
  }

  return (
    <div className="bg-white">
      <section className="border-b border-gray-100 bg-gradient-to-r from-white via-white to-gray-50">
        <div className="mx-auto max-w-7xl px-4 py-4 text-xs font-semibold text-gray-500 sm:px-6 lg:px-8">
          <Link href="/" className="hover:text-forge-red">Accueil</Link>
          <span className="mx-2">/</span>
          <span className="text-forge-dark">Catalogue</span>
        </div>

        <div className="mx-auto grid max-w-7xl gap-8 px-4 pb-8 sm:px-6 lg:grid-cols-[1fr_300px] lg:px-8">
          <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45 }} className="relative overflow-hidden rounded-lg bg-gray-50 p-8 sm:p-10">
            <div className="relative z-10 max-w-xl">
              <p className="text-xs font-black uppercase tracking-widest text-forge-red">Catalogue</p>
              <h1 className="mt-3 text-4xl font-black leading-tight text-forge-dark sm:text-5xl">
                Nos produits <br />& <span className="text-forge-red">services</span>
              </h1>
              <p className="mt-5 max-w-lg text-sm leading-7 text-forge-steel">
                Decouvrez notre large gamme de fournitures industrielles et metalliques de qualite professionnelle.
              </p>
            </div>
            <Image
              src="https://images.unsplash.com/photo-1564540583246-934409427776?auto=format&fit=crop&w=1200&q=85"
              alt="Profils aluminium MetalForge"
              fill
              priority
              sizes="(max-width: 1024px) 100vw, 820px"
              className="object-cover object-right opacity-35"
            />
            <div className="absolute right-0 top-0 h-full w-1/3 bg-forge-red/80 [clip-path:polygon(45%_0,100%_0,100%_100%,0_100%)]" />
          </motion.div>

          <motion.aside initial={{ opacity: 0, x: 18 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.45, delay: 0.1 }} className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
            {[
              { icon: ShieldCheck, title: 'Produits de qualite', text: 'Certifies et garantis' },
              { icon: Wallet, title: 'Prix competitifs', text: 'Le meilleur rapport qualite/prix' },
              { icon: Truck, title: 'Livraison rapide', text: 'Partout au Cameroun' },
              { icon: Headphones, title: 'Support dedie', text: 'Conseils et accompagnement' },
            ].map(({ icon: Icon, title, text }) => (
              <div key={title} className="flex gap-4 py-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-forge-red-light text-forge-red">
                  <Icon size={18} />
                </span>
                <span>
                  <span className="block text-sm font-black text-forge-dark">{title}</span>
                  <span className="text-xs text-gray-500">{text}</span>
                </span>
              </div>
            ))}
          </motion.aside>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <div className="flex gap-4 overflow-x-auto pb-2">
          {categories.map((cat, index) => (
            <button
              key={cat.name}
              onClick={() => setCategorie(cat.name)}
              className={`group flex min-w-[180px] items-center gap-3 rounded-lg border bg-white p-4 text-left shadow-sm transition hover:-translate-y-1 hover:shadow-md ${categorie === cat.name ? 'border-forge-red ring-2 ring-forge-red/10' : 'border-gray-200'}`}
            >
              <span className="relative h-14 w-16 shrink-0 overflow-hidden rounded-md bg-gray-100">
                <Image src={cat.image} alt={cat.name} fill sizes="80px" className="object-cover transition group-hover:scale-110" />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-black text-forge-dark">{cat.name}</span>
                <span className="text-xs text-gray-500">{cat.count || stats.total} produits</span>
              </span>
            </button>
          ))}
        </div>
      </section>

      <section className="mx-auto grid max-w-7xl gap-6 px-4 pb-10 sm:px-6 lg:grid-cols-[260px_1fr] lg:px-8">
        <aside className="h-fit rounded-lg border border-gray-200 bg-white shadow-sm lg:sticky lg:top-28">
          <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4">
            <h2 className="font-black text-forge-dark">Filtres</h2>
            <SlidersHorizontal size={16} className="text-forge-red" />
          </div>

          <FilterSection title="Categories">
            <RadioRow label="Tous les produits" count={stats.total} active={categorie === 'Tous les produits'} onClick={() => setCategorie('Tous les produits')} />
            {categories.map((cat) => (
              <RadioRow key={cat.name} label={cat.name} count={cat.count} active={categorie === cat.name} onClick={() => setCategorie(cat.name)} />
            ))}
          </FilterSection>

          <FilterSection title="Disponibilite">
            <CheckRow label="En stock" count={stats.stock} checked={availability === 'stock'} onClick={() => setAvailability(availability === 'stock' ? 'all' : 'stock')} />
            <CheckRow label="Stock faible" count={stats.stockFaible} checked={availability === 'stock_faible'} onClick={() => setAvailability(availability === 'stock_faible' ? 'all' : 'stock_faible')} />
          </FilterSection>

          <FilterSection title="Prix">
            <input
              type="range"
              min={0}
              max={maxAvailablePrice}
              step={500}
              value={maxPrice}
              onChange={(event) => setMaxPrice(Number(event.target.value))}
              className="w-full accent-forge-red"
            />
            <div className="mt-2 flex justify-between text-xs font-semibold text-gray-500">
              <span>0 FCFA</span>
              <span>{formatXAF(maxPrice)}</span>
            </div>
          </FilterSection>

          <FilterSection title="Marques">
            {brands.map((brand) => (
              <CheckRow key={brand} label={brand} count={produits.filter((p) => (p.tags ?? []).some((tag) => normalize(tag).includes(normalize(brand)))).length || undefined} checked={selectedBrands.includes(brand)} onClick={() => toggleBrand(brand)} />
            ))}
          </FilterSection>

          <FilterSection title="Livraison">
            <CheckRow label="Sous 24h" count={produits.filter((p) => p.delai_fabrication_jours <= 1).length} checked={delivery === '24h'} onClick={() => setDelivery(delivery === '24h' ? 'all' : '24h')} />
            <CheckRow label="Sous 48h" count={produits.filter((p) => p.delai_fabrication_jours <= 2).length} checked={delivery === '48h'} onClick={() => setDelivery(delivery === '48h' ? 'all' : '48h')} />
            <CheckRow label="Sous 7 jours" count={produits.filter((p) => p.delai_fabrication_jours <= 7).length} checked={delivery === '7j'} onClick={() => setDelivery(delivery === '7j' ? 'all' : '7j')} />
          </FilterSection>

          <div className="border-t border-gray-200 p-5">
            <button onClick={resetFilters} className="flex w-full items-center justify-center gap-2 rounded-md border border-gray-200 px-4 py-2.5 text-sm font-black text-forge-dark hover:border-forge-red hover:text-forge-red">
              <RotateCcw size={15} /> Reinitialiser les filtres
            </button>
          </div>
        </aside>

        <div>
          <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="relative max-w-sm flex-1">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Rechercher dans le catalogue..."
                className="w-full rounded-lg border border-gray-200 bg-white py-3 pl-10 pr-4 text-sm outline-none transition focus:border-forge-red focus:ring-2 focus:ring-forge-red/10"
              />
            </div>
            <p className="text-sm font-semibold text-gray-500">{filtered.length} produit{filtered.length > 1 ? 's' : ''} trouve{filtered.length > 1 ? 's' : ''}</p>
            <div className="flex items-center gap-2">
              <label className="text-xs font-black uppercase text-gray-500">Trier par :</label>
              <select value={sort} onChange={(event) => setSort(event.target.value as SortKey)} className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-semibold outline-none focus:border-forge-red">
                <option value="populaires">Plus populaires</option>
                <option value="prix_asc">Prix croissant</option>
                <option value="prix_desc">Prix decroissant</option>
                <option value="stock">Stock disponible</option>
              </select>
              <button onClick={() => setViewMode('grid')} className={`flex h-9 w-9 items-center justify-center rounded-md border ${viewMode === 'grid' ? 'border-forge-red bg-forge-red text-white' : 'border-gray-200 text-gray-500'}`} aria-label="Vue grille">
                <Grid3X3 size={15} />
              </button>
              <button onClick={() => setViewMode('list')} className={`flex h-9 w-9 items-center justify-center rounded-md border ${viewMode === 'list' ? 'border-forge-red bg-forge-red text-white' : 'border-gray-200 text-gray-500'}`} aria-label="Vue liste">
                <List size={15} />
              </button>
            </div>
          </div>

          {paginated.length === 0 ? (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex min-h-80 flex-col items-center justify-center rounded-lg border border-dashed border-gray-300 bg-gray-50 text-center">
              <Package size={46} className="text-gray-300" />
              <p className="mt-4 font-black text-forge-dark">Aucun produit trouve</p>
              <p className="mt-1 text-sm text-gray-500">Essayez d autres filtres ou une autre recherche.</p>
              <button onClick={resetFilters} className="mt-5 rounded-md bg-forge-red px-5 py-2.5 text-sm font-black text-white hover:bg-forge-red-dark">Reinitialiser</button>
            </motion.div>
          ) : (
            <motion.div layout className={viewMode === 'grid' ? 'grid gap-5 sm:grid-cols-2 xl:grid-cols-4' : 'grid gap-4'}>
              <AnimatePresence mode="popLayout">
                {paginated.map((produit, index) => (
                  <motion.div
                    key={produit.id}
                    layout
                    initial={{ opacity: 0, y: 14, scale: 0.98 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 10, scale: 0.96 }}
                    transition={{ duration: 0.22, delay: Math.min(index * 0.025, 0.18) }}
                  >
                    <CatalogueProductCard produit={produit} index={index} viewMode={viewMode} onAdd={() => handleAddToCart(produit)} />
                  </motion.div>
                ))}
              </AnimatePresence>
            </motion.div>
          )}

          {pageCount > 1 && (
            <div className="mt-8 flex items-center justify-center gap-2">
              {Array.from({ length: Math.min(pageCount, 5) }, (_, index) => index + 1).map((item) => (
                <button key={item} onClick={() => setPage(item)} className={`h-9 min-w-9 rounded-md px-3 text-sm font-black ${currentPage === item ? 'bg-forge-red text-white' : 'border border-gray-200 text-forge-dark hover:border-forge-red'}`}>
                  {item}
                </button>
              ))}
              {pageCount > 5 && <span className="px-2 text-gray-400">...</span>}
              {pageCount > 5 && <button onClick={() => setPage(pageCount)} className="h-9 min-w-9 rounded-md border border-gray-200 px-3 text-sm font-black text-forge-dark hover:border-forge-red">{pageCount}</button>}
              <button onClick={() => setPage(Math.min(pageCount, currentPage + 1))} disabled={currentPage === pageCount} className="flex h-9 items-center gap-2 rounded-md border border-gray-200 px-4 text-sm font-black text-forge-dark hover:border-forge-red disabled:opacity-40">
                Suivant <ArrowRight size={14} />
              </button>
            </div>
          )}
        </div>
      </section>

      <section className="mx-auto grid max-w-7xl gap-5 px-4 pb-12 sm:px-6 lg:grid-cols-2 lg:px-8">
        <div className="rounded-lg bg-gray-50 p-7">
          <h2 className="text-2xl font-black text-forge-dark">Vous ne trouvez pas ce que vous cherchez ?</h2>
          <p className="mt-3 max-w-md text-sm leading-6 text-gray-600">Contactez notre equipe, nous vous aidons a trouver le produit qu il vous faut.</p>
          <Link href="/contact" className="mt-5 inline-flex items-center gap-2 rounded-md border border-forge-red px-5 py-3 text-sm font-black text-forge-red hover:bg-forge-red-light">
            Nous contacter <ArrowRight size={14} />
          </Link>
        </div>
        <div className="relative overflow-hidden rounded-lg bg-gray-50 p-7">
          <Image src="https://images.unsplash.com/photo-1564540583246-934409427776?auto=format&fit=crop&w=900&q=80" alt="Profils aluminium" fill sizes="(max-width: 1024px) 100vw, 600px" className="object-cover opacity-20" />
          <div className="relative">
            <h2 className="text-2xl font-black text-forge-dark">Besoin d un devis personnalise ?</h2>
            <p className="mt-3 max-w-md text-sm leading-6 text-gray-600">Decrivez votre projet et recevez une offre sous 24h.</p>
            <Link href="/devis" className="mt-5 inline-flex items-center gap-2 rounded-md bg-forge-red px-5 py-3 text-sm font-black text-white hover:bg-forge-red-dark">
              Demander un devis <ArrowRight size={14} />
            </Link>
          </div>
        </div>
      </section>
    </div>
  )
}

function FilterSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="border-b border-gray-200 px-5 py-5">
      <h3 className="mb-3 text-sm font-black text-forge-dark">{title}</h3>
      <div className="space-y-2">{children}</div>
    </div>
  )
}

function RadioRow({ label, count, active, onClick }: { label: string; count?: number; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className={`flex w-full items-center gap-2 text-left text-sm ${active ? 'font-black text-forge-red' : 'font-semibold text-gray-600 hover:text-forge-red'}`}>
      <span className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border ${active ? 'border-forge-red' : 'border-gray-300'}`}>
        {active && <span className="h-1.5 w-1.5 rounded-full bg-forge-red" />}
      </span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {typeof count === 'number' && <span className="text-xs text-gray-400">{count}</span>}
    </button>
  )
}

function CheckRow({ label, count, checked, onClick }: { label: string; count?: number; checked: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className={`flex w-full items-center gap-2 text-left text-sm ${checked ? 'font-black text-forge-red' : 'font-semibold text-gray-600 hover:text-forge-red'}`}>
      <span className={`h-3.5 w-3.5 shrink-0 rounded-sm border ${checked ? 'border-forge-red bg-forge-red' : 'border-gray-300'}`} />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {typeof count === 'number' && <span className="text-xs text-gray-400">{count}</span>}
    </button>
  )
}

function CatalogueProductCard({ produit, index, viewMode, onAdd }: { produit: Produit; index: number; viewMode: ViewMode; onAdd: () => void }) {
  const image = productImage(produit, index)
  const unavailable = produit.disponibilite === 'indisponible'
  const hasPromo = Boolean(produit.promotion && produit.prix_barre_xaf && produit.prix_public)

  if (viewMode === 'list') {
    return (
      <article className="group grid gap-4 rounded-lg border border-gray-200 bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md sm:grid-cols-[180px_1fr_auto]">
        <Link href={`/catalogue/${produit.id}`} className="relative block h-40 overflow-hidden rounded-md bg-gray-100">
          <Image src={image} alt={produit.nom} fill sizes="180px" className="object-cover transition group-hover:scale-105" />
        </Link>
        <div className="min-w-0">
          <span className={`rounded-full px-2 py-1 text-[10px] font-black uppercase ${statusClass(produit.disponibilite)}`}>{statusLabel(produit.disponibilite)}</span>
          <p className="mt-4 font-mono text-xs text-gray-400">{produit.ref}</p>
          <Link href={`/catalogue/${produit.id}`} className="mt-1 block text-lg font-black text-forge-dark hover:text-forge-red">{produit.nom}</Link>
          <p className="mt-2 line-clamp-2 text-sm leading-6 text-gray-500">{produit.description_longue || produit.categorie}</p>
        </div>
        <div className="flex flex-col justify-between gap-4 sm:items-end">
          <div className="text-right">
            {hasPromo && <p className="text-xs font-bold text-gray-400 line-through">{formatXAF(produit.prix_barre_xaf)}</p>}
            <p className="text-xl font-black text-forge-red">{formatXAF(produit.prix_public)} {produit.prix_public ? <span className="text-xs font-semibold text-gray-500">/ {produit.unite}</span> : null}</p>
            {produit.promotion && <p className="mt-1 text-[10px] font-black uppercase text-forge-red">{produit.promotion.nom}</p>}
          </div>
          <button onClick={onAdd} disabled={unavailable} className="inline-flex items-center justify-center gap-2 rounded-md bg-forge-red px-5 py-3 text-sm font-black text-white hover:bg-forge-red-dark disabled:cursor-not-allowed disabled:opacity-40">
            <ShoppingCart size={15} /> Panier
          </button>
        </div>
      </article>
    )
  }

  return (
    <article className="group overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm transition hover:-translate-y-1 hover:border-forge-red/30 hover:shadow-lg">
      <Link href={`/catalogue/${produit.id}`} className="relative block aspect-[1.18] overflow-hidden bg-gray-50">
        <Image src={image} alt={produit.nom} fill sizes="(max-width: 768px) 50vw, 25vw" className="object-cover transition duration-500 group-hover:scale-105" />
        <span className={`absolute left-3 top-3 rounded-full px-2 py-1 text-[10px] font-black uppercase ${statusClass(produit.disponibilite)}`}>{statusLabel(produit.disponibilite)}</span>
        {hasPromo && <span className="absolute right-3 top-3 rounded-full bg-forge-red px-2 py-1 text-[10px] font-black uppercase text-white">Promo</span>}
      </Link>
      <div className="p-4">
        <p className="font-mono text-xs text-gray-400">{produit.ref}</p>
        <Link href={`/catalogue/${produit.id}`} className="mt-1 block min-h-10 text-sm font-black leading-tight text-forge-dark hover:text-forge-red">{produit.nom}</Link>
        {hasPromo && <p className="mt-3 text-xs font-bold text-gray-400 line-through">{formatXAF(produit.prix_barre_xaf)}</p>}
        <p className={`${hasPromo ? 'mt-0.5' : 'mt-3'} text-lg font-black text-forge-red`}>
          {formatXAF(produit.prix_public)}
          {produit.prix_public ? <span className="text-xs font-semibold text-gray-500"> / {produit.unite}</span> : null}
        </p>
        {produit.promotion && <p className="mt-1 text-[10px] font-black uppercase text-forge-red">{produit.promotion.nom}</p>}
        <p className={`mt-2 text-xs font-semibold ${produit.disponibilite === 'stock_faible' ? 'text-amber-600' : unavailable ? 'text-gray-500' : 'text-green-700'}`}>
          {unavailable ? 'Sur commande' : produit.disponibilite === 'stock_faible' ? 'Stock faible' : 'En stock'}
        </p>
      </div>
      <div className="grid grid-cols-3 border-t border-gray-100">
        <Link href={`/catalogue/${produit.id}`} className="flex h-10 items-center justify-center text-gray-500 hover:text-forge-red" aria-label="Voir">
          <Eye size={15} />
        </Link>
        <button className="flex h-10 items-center justify-center border-x border-gray-100 text-gray-500 hover:text-forge-red" aria-label="Favori">
          <Heart size={15} />
        </button>
        <button onClick={onAdd} disabled={unavailable} className="flex h-10 items-center justify-center bg-forge-red-light text-forge-red hover:bg-forge-red hover:text-white disabled:cursor-not-allowed disabled:opacity-40" aria-label="Ajouter au panier">
          <ShoppingCart size={15} />
        </button>
      </div>
    </article>
  )
}
