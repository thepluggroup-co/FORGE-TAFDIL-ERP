import React, { useState, useMemo, useCallback, useEffect } from 'react'
import { motion } from 'framer-motion'
import { useNavigate } from 'react-router-dom'
import { Plus, Minus, RotateCcw, FileOutput, PackagePlus } from 'lucide-react'
import { PageHeader, DataTable, StatusBadge, StockLevel, SlideOver, Button } from '@forge/ui'
import type { Column } from '@forge/ui'
import { formatXAF } from '@/lib/utils'
import { KpiCard } from '@forge/ui'
import { Package, AlertTriangle, TrendingDown, DollarSign } from 'lucide-react'
import { toast } from 'sonner'
import { useStocks, useMouvement, useCreateProduit } from '@/hooks/useStocks'
import type { StockProduit, CreateProduitPayload } from '@/hooks/useStocks'

// ── Types (alignés sur l'API) ─────────────────────────────────────────────────

type Product = StockProduit & Record<string, unknown>

// ── Constants ─────────────────────────────────────────────────────────────────

const MOTIFS = ['Achat fournisseur', 'Retour chantier', 'Correction inventaire', 'Don / perte', 'Autre']
const UNITES = ['pièce', 'kg', 'm', 'm²', 'm³', 'litre', 'barre', 'rouleau', 'unité']
const CATEGORIES_DEFAULT = ['Acier', 'Aluminium', 'Inox', 'Consommable soudure', 'EPI', 'Outillage', 'Autre']

const DEFAULT_PRODUIT: CreateProduitPayload = {
  ref: '', designation: '', categorie: '', unite: 'pièce',
  stock_actuel: 0, stock_min: 5, stock_critique: 2, prix_unitaire_xaf: 0,
  emplacement: '', fournisseur: '',
}

// ── Columns ────────────────────────────────────────────────────────────────────

const buildColumns = (onEntree: (p: Product) => void, onSortie: (p: Product) => void): Column<Product>[] => [
  {
    id: 'reference',
    header: 'Réf.',
    accessor: 'ref',
    render: (v) => <span className="font-mono text-xs text-gray-500">{v as string}</span>,
  },
  {
    id: 'designation',
    header: 'Produit',
    accessor: 'designation',
    csvValue: (row) => `${row.designation} (${row.categorie})`,
    render: (v, row) => (
      <div>
        <div className="text-sm font-medium text-[#212121]">{v as string}</div>
        <div className="text-xs text-gray-400">{row.categorie as string}</div>
      </div>
    ),
  },
  {
    id: 'niveau',
    header: 'Niveau stock',
    accessor: 'stock_actuel',
    sortable: false,
    csvSkip: true,  // bar chart visual — skip in CSV; stock qty column is enough
    render: (_, row) => (
      <div className="w-36">
        <StockLevel
          current={row.stock_actuel as number}
          alertThreshold={row.stock_min as number}
          criticalThreshold={row.stock_critique as number}
          max={(row.stock_max as number | undefined) ?? Math.max((row.stock_actuel as number) * 2, (row.stock_min as number) * 4, 10)}
          unit={row.unite as string}
        />
      </div>
    ),
  },
  {
    id: 'stock',
    header: 'Qté',
    accessor: 'stock_actuel',
    csvValue: (row) => `${row.stock_actuel} ${row.unite}`,
    render: (v, row) => (
      <span className="text-sm font-semibold">
        {(v as number).toLocaleString('fr-CM')} <span className="text-xs text-gray-400 font-normal">{row.unite as string}</span>
      </span>
    ),
  },
  {
    id: 'valeur',
    header: 'Valeur FCFA',
    accessor: 'prix_unitaire_xaf',
    csvValue: (row) => String((row.stock_actuel as number) * (row.prix_unitaire_xaf as number)),
    render: (_, row) => <span className="text-sm font-medium">{formatXAF((row.stock_actuel as number) * (row.prix_unitaire_xaf as number))}</span>,
  },
  {
    id: 'statut',
    header: 'Statut',
    accessor: 'statut',
    render: (v) => <StatusBadge status={v as string} />,
  },
  {
    id: 'actions',
    header: 'Actions',
    accessor: 'id',
    sortable: false,
    csvSkip: true,   // action buttons make no sense in CSV
    render: (_, row) => (
      <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
        {/* Entrée — green, clearly labelled */}
        <button
          onClick={() => onEntree(row)}
          title="Entrée stock"
          className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg
            bg-green-600 text-white hover:bg-green-700
            transition-colors text-xs font-semibold shadow-sm"
        >
          <Plus className="h-3.5 w-3.5" />
          Entrée
        </button>
        {/* Sortie — red, clearly labelled */}
        <button
          onClick={() => onSortie(row)}
          title="Sortie stock"
          className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg
            bg-[#C62828] text-white hover:bg-[#B71C1C]
            transition-colors text-xs font-semibold shadow-sm"
        >
          <Minus className="h-3.5 w-3.5" />
          Sortie
        </button>
      </div>
    ),
  },
]

// ── SlideOver form ─────────────────────────────────────────────────────────────

interface MvtForm {
  type: 'entree' | 'sortie'
  produitId: string
  quantite: number
  reference: string
  motif: string
}

const DEFAULT_FORM: MvtForm = { type: 'entree', produitId: '', quantite: 1, reference: '', motif: '' }

// ── Page component ─────────────────────────────────────────────────────────────

export default function Stocks() {
  const navigate = useNavigate()
  const [search, setSearch]           = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [categorie, setCategorie]     = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [slideOpen, setSlideOpen]     = useState(false)
  const [form, setForm]               = useState<MvtForm>(DEFAULT_FORM)
  const [newProduitOpen, setNewProduitOpen] = useState(false)
  const [newProduit, setNewProduit]   = useState<CreateProduitPayload>(DEFAULT_PRODUIT)
  const [createError, setCreateError] = useState<string | null>(null)
  const [createDone, setCreateDone]   = useState(false)

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300)
    return () => clearTimeout(t)
  }, [search])

  const { data, isLoading, isError } = useStocks({ search: debouncedSearch, categorie, statut: statusFilter })
  const mouvement = useMouvement()
  const createProduit = useCreateProduit()

  const produits = (data?.data ?? []) as Product[]
  const categories = useMemo(() => [...new Set(produits.map((p) => p.categorie as string))], [produits])

  const openEntree = useCallback((p?: Product) => {
    setForm({ ...DEFAULT_FORM, type: 'entree', produitId: p?.id ?? '' })
    setSlideOpen(true)
  }, [])

  const openSortie = useCallback((p?: Product) => {
    setForm({ ...DEFAULT_FORM, type: 'sortie', produitId: p?.id ?? '' })
    setSlideOpen(true)
  }, [])

  const selectedProduct = produits.find((p) => p.id === form.produitId)
  const sortieError = form.type === 'sortie' && selectedProduct && form.quantite > (selectedProduct.stock_actuel as number)
    ? `Stock insuffisant (disponible : ${selectedProduct.stock_actuel} ${selectedProduct.unite})`
    : null
  const formValid = form.produitId !== '' && form.quantite > 0 && form.motif !== '' && !sortieError

  const critiques    = useMemo(() => produits.filter((p) => p.statut === 'critique').length, [produits])
  const alertes      = useMemo(() => produits.filter((p) => p.statut === 'alerte').length, [produits])
  const valeurTotale = useMemo(() => produits.reduce((sum, p) => sum + (p.stock_actuel as number) * (p.prix_unitaire_xaf as number), 0), [produits])

  const columns = useMemo(() => buildColumns(openEntree, openSortie), [openEntree, openSortie])

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3, ease: 'easeOut' }}
      className="space-y-6"
    >
      <PageHeader
        title="Gestion des Stocks"
        subtitle="Inventaire temps réel · TAFDIL Douala"
        breadcrumbs={[{ label: 'FORGE', href: '/' }, { label: 'Stocks' }]}
        actions={
          <>
            <Button variant="secondary" size="sm" onClick={() => navigate('/stocks/bons-sortie')}>
              <FileOutput className="h-3.5 w-3.5" />
              Bons de sortie
            </Button>
            <Button variant="ghost" size="sm" onClick={() => openSortie()}>
              <Minus className="h-3.5 w-3.5" />
              Sortie
            </Button>
            <Button size="sm" onClick={() => openEntree()}>
              <PackagePlus className="h-3.5 w-3.5" />
              Entrée stock
            </Button>
            <Button variant="secondary" size="sm" onClick={() => { setNewProduit(DEFAULT_PRODUIT); setCreateError(null); setCreateDone(false); setNewProduitOpen(true) }}>
              <Plus className="h-3.5 w-3.5" />
              Nouveau produit
            </Button>
          </>
        }
      />

      {/* KPIs */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <KpiCard title="Total produits" value={data?.total ?? 0} icon={<Package className="h-5 w-5" />} color="#1d4ed8" delay={0} />
        <KpiCard title="Valeur totale" value={formatXAF(valeurTotale)} icon={<DollarSign className="h-5 w-5" />} color="#15803d" delay={0.05} />
        <KpiCard title="Produits critiques" value={critiques} icon={<AlertTriangle className="h-5 w-5" />} color="#C62828" trend="down" trendValue="Rupture imminente" delay={0.1} />
        <KpiCard title="Produits en alerte" value={alertes} icon={<TrendingDown className="h-5 w-5" />} color="#d97706" delay={0.15} />
      </div>

      {isError && (
        <div className="flex items-center gap-2 p-4 bg-red-50 border border-red-200 rounded-xl text-sm text-[#dc2626]">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          Impossible de charger les stocks. Veuillez réessayer.
        </div>
      )}

      {/* Filtres */}
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="search"
          placeholder="Rechercher un produit..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 min-w-48 px-3 py-2 text-sm border border-gray-200 rounded-lg
            focus:outline-none focus:ring-2 focus:ring-[#C62828] focus:border-transparent"
        />
        <select
          value={categorie}
          onChange={(e) => setCategorie(e.target.value)}
          className="px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C62828]"
        >
          <option value="">Toutes catégories</option>
          {categories.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C62828]"
        >
          <option value="">Tous statuts</option>
          <option value="normal">Normal</option>
          <option value="alerte">Alerte</option>
          <option value="critique">Critique</option>
          <option value="rupture">Rupture</option>
        </select>
        {(search || categorie || statusFilter) && (
          <Button variant="ghost" size="sm" onClick={() => { setSearch(''); setCategorie(''); setStatusFilter('') }}>
            <RotateCcw className="h-3.5 w-3.5" />
            Réinitialiser
          </Button>
        )}
      </div>

      {/* Table */}
      <DataTable<Product>
        columns={columns}
        data={produits}
        keyField="id"
        onRowClick={(row) => openEntree(row)}
        loading={isLoading}
      />

      {/* SlideOver nouveau produit */}
      <SlideOver
        isOpen={newProduitOpen}
        onClose={() => {
          if (createProduit.isPending) return
          setNewProduitOpen(false)
          setNewProduit(DEFAULT_PRODUIT)
          setCreateError(null)
          setCreateDone(false)
        }}
        title="Nouveau produit"
        width="md"
      >
        {/* ── Succès ── */}
        {createDone ? (
          <div className="flex flex-col items-center justify-center py-16 space-y-4">
            <div className="flex items-center justify-center w-16 h-16 rounded-full bg-green-100">
              <svg className="w-8 h-8 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <div className="text-center">
              <p className="text-base font-semibold text-gray-800">Produit créé avec succès</p>
              <p className="text-sm text-gray-500 mt-1">
                <span className="font-mono font-medium">{newProduit.ref}</span> — {newProduit.designation}
              </p>
            </div>
            <Button
              className="mt-2"
              onClick={() => {
                setNewProduitOpen(false)
                setNewProduit(DEFAULT_PRODUIT)
                setCreateDone(false)
                setCreateError(null)
              }}
            >
              Fermer
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">Référence *</label>
                <input value={newProduit.ref} onChange={(e) => setNewProduit((p) => ({ ...p, ref: e.target.value }))}
                  placeholder="ex. AC-001" className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C62828]" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">Unité</label>
                <select value={newProduit.unite} onChange={(e) => setNewProduit((p) => ({ ...p, unite: e.target.value }))}
                  className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C62828]">
                  {UNITES.map((u) => <option key={u} value={u}>{u}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">Désignation *</label>
              <input value={newProduit.designation} onChange={(e) => setNewProduit((p) => ({ ...p, designation: e.target.value }))}
                placeholder="ex. Fer plat 40×5 mm" className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C62828]" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">Catégorie *</label>
              <select value={newProduit.categorie} onChange={(e) => setNewProduit((p) => ({ ...p, categorie: e.target.value }))}
                className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C62828]">
                <option value="">Sélectionner…</option>
                {CATEGORIES_DEFAULT.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">Stock initial</label>
                <input type="number" min="0" value={newProduit.stock_actuel}
                  onChange={(e) => setNewProduit((p) => ({ ...p, stock_actuel: Number(e.target.value) }))}
                  className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C62828]" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">Seuil alerte</label>
                <input type="number" min="0" value={newProduit.stock_min}
                  onChange={(e) => setNewProduit((p) => ({ ...p, stock_min: Number(e.target.value) }))}
                  className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C62828]" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">Seuil critique</label>
                <input type="number" min="0" value={newProduit.stock_critique}
                  onChange={(e) => setNewProduit((p) => ({ ...p, stock_critique: Number(e.target.value) }))}
                  className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C62828]" />
              </div>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">Prix unitaire (FCFA)</label>
              <input type="number" min="0" value={newProduit.prix_unitaire_xaf}
                onChange={(e) => setNewProduit((p) => ({ ...p, prix_unitaire_xaf: Number(e.target.value) }))}
                className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C62828]" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">Emplacement</label>
                <input value={newProduit.emplacement ?? ''} onChange={(e) => setNewProduit((p) => ({ ...p, emplacement: e.target.value }))}
                  placeholder="ex. Rack A-3" className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C62828]" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">Fournisseur</label>
                <input value={newProduit.fournisseur ?? ''} onChange={(e) => setNewProduit((p) => ({ ...p, fournisseur: e.target.value }))}
                  placeholder="ex. ACIER CM" className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C62828]" />
              </div>
            </div>

            {/* Champs requis manquants */}
            {(() => {
              const missing: string[] = []
              if (!newProduit.ref) missing.push('Référence')
              if (!newProduit.designation) missing.push('Désignation')
              if (!newProduit.categorie) missing.push('Catégorie')
              return missing.length > 0 ? (
                <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                  Champs requis manquants : <strong>{missing.join(', ')}</strong>
                </p>
              ) : null
            })()}

            {/* Erreur API inline */}
            {createError && (
              <div className="flex items-start gap-2 px-3 py-2.5 bg-red-50 border border-red-200 rounded-lg">
                <svg className="w-4 h-4 text-red-500 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <p className="text-xs font-medium text-red-700">{createError}</p>
              </div>
            )}

            <div className="flex gap-3 pt-2 border-t border-gray-100">
              <Button variant="ghost" className="flex-1" onClick={() => {
                setNewProduitOpen(false)
                setNewProduit(DEFAULT_PRODUIT)
                setCreateError(null)
              }}>
                Annuler
              </Button>
              <Button
                className="flex-1"
                disabled={!newProduit.ref || !newProduit.designation || !newProduit.categorie || createProduit.isPending}
                onClick={() => {
                  if (!newProduit.ref || !newProduit.designation || !newProduit.categorie) return
                  setCreateError(null)
                  createProduit.mutate(newProduit, {
                    onSuccess: () => setCreateDone(true),
                    onError: (err: Error) => setCreateError(err.message || 'Erreur serveur — réessayez'),
                  })
                }}
              >
                {createProduit.isPending ? (
                  <span className="flex items-center justify-center gap-2">
                    <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    Création…
                  </span>
                ) : 'Créer le produit'}
              </Button>
            </div>
          </div>
        )}
      </SlideOver>

      {/* SlideOver mouvement */}
      <SlideOver
        isOpen={slideOpen}
        onClose={() => setSlideOpen(false)}
        title="Mouvement de stock"
        width="md"
      >
        <div className="space-y-5">
          {/* Type */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase mb-2">Type de mouvement</label>
            <div className="grid grid-cols-2 gap-2">
              {(['entree', 'sortie'] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setForm((f) => ({ ...f, type: t, quantite: 1 }))}
                  className="flex items-center justify-center gap-2 py-3 rounded-xl border-2 font-medium text-sm transition-all"
                  style={{
                    borderColor: form.type === t ? (t === 'entree' ? '#16a34a' : '#C62828') : '#e5e7eb',
                    backgroundColor: form.type === t ? (t === 'entree' ? '#dcfce7' : '#fee2e2') : 'transparent',
                    color: form.type === t ? (t === 'entree' ? '#15803d' : '#C62828') : '#6b7280',
                  }}
                >
                  {t === 'entree' ? <Plus className="h-4 w-4" /> : <Minus className="h-4 w-4" />}
                  {t === 'entree' ? 'Entrée' : 'Sortie'}
                </button>
              ))}
            </div>
          </div>

          {/* Produit */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">Produit</label>
            <select
              value={form.produitId}
              onChange={(e) => setForm((f) => ({ ...f, produitId: e.target.value, quantite: 1 }))}
              className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg
                focus:outline-none focus:ring-2 focus:ring-[#C62828]"
            >
              <option value="">Sélectionner un produit...</option>
              {produits.map((p) => (
                <option key={p.id} value={p.id as string}>
                  {p.designation as string} — Stock : {p.stock_actuel as number} {p.unite as string}
                </option>
              ))}
            </select>
            {selectedProduct && (
              <div className="mt-2 flex items-center gap-2">
                <span className="text-xs text-gray-500">Stock actuel :</span>
                <span className="text-xs font-semibold" style={{
                  color: selectedProduct.statut === 'critique' ? '#dc2626'
                    : selectedProduct.statut === 'alerte' ? '#d97706' : '#15803d',
                }}>
                  {selectedProduct.stock_actuel as number} {selectedProduct.unite as string}
                </span>
              </div>
            )}
          </div>

          {/* Quantité */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">
              Quantité {selectedProduct ? `(${selectedProduct.unite})` : ''}
            </label>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setForm((f) => ({ ...f, quantite: Math.max(1, f.quantite - 1) }))}
                className="flex items-center justify-center w-10 h-10 rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors"
              >
                <Minus className="h-4 w-4" />
              </button>
              <input
                type="number"
                min="1"
                value={form.quantite}
                onChange={(e) => setForm((f) => ({ ...f, quantite: Math.max(1, Number(e.target.value)) }))}
                className="flex-1 text-center px-3 py-2 text-sm border border-gray-200 rounded-lg
                  focus:outline-none focus:ring-2 focus:ring-[#C62828] font-semibold"
              />
              <button
                onClick={() => setForm((f) => ({ ...f, quantite: f.quantite + 1 }))}
                className="flex items-center justify-center w-10 h-10 rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors"
              >
                <Plus className="h-4 w-4" />
              </button>
            </div>
            {sortieError && <p className="mt-1.5 text-xs font-medium text-[#C62828]">{sortieError}</p>}
          </div>

          {/* Référence bon */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">
              Référence bon <span className="text-gray-300 normal-case font-normal">(optionnel)</span>
            </label>
            <input
              type="text"
              placeholder="ex. BS-2026-042"
              value={form.reference}
              onChange={(e) => setForm((f) => ({ ...f, reference: e.target.value }))}
              className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg
                focus:outline-none focus:ring-2 focus:ring-[#C62828]"
            />
          </div>

          {/* Motif */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">Motif</label>
            <select
              value={form.motif}
              onChange={(e) => setForm((f) => ({ ...f, motif: e.target.value }))}
              className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg
                focus:outline-none focus:ring-2 focus:ring-[#C62828]"
            >
              <option value="">Sélectionner un motif...</option>
              {MOTIFS.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>

          {/* Actions */}
          <div className="flex gap-3 pt-2 border-t border-gray-100">
            <Button variant="ghost" className="flex-1" onClick={() => setSlideOpen(false)}>
              Annuler
            </Button>
            <Button
              className="flex-1"
              disabled={!formValid || mouvement.isPending}
              style={form.type === 'sortie' ? { backgroundColor: '#C62828' } : {}}
              onClick={() => {
                mouvement.mutate(
                  {
                    produitId: form.produitId,
                    payload: { type: form.type, quantite: form.quantite, reference: form.reference || undefined, motif: form.motif },
                  },
                  {
                    onSuccess: () => {
                      setSlideOpen(false)
                      setForm(DEFAULT_FORM)
                    },
                    onError: (err: Error) => toast.error(err.message),
                  },
                )
              }}
            >
              {mouvement.isPending ? 'Enregistrement…' : `Valider ${form.type === 'entree' ? "l'entrée" : 'la sortie'}`}
            </Button>
          </div>
        </div>
      </SlideOver>
    </motion.div>
  )
}
