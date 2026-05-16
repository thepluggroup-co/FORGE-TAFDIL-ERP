import React, { useState, useMemo } from 'react'
import { motion } from 'framer-motion'
import { useNavigate } from 'react-router-dom'
import { Plus, Minus, RotateCcw, FileOutput, PackagePlus } from 'lucide-react'
import { PageHeader, DataTable, StatusBadge, StockLevel, SlideOver, Button } from '@forge/ui'
import type { Column } from '@forge/ui'
import { formatXAF } from '@/lib/utils'
import { KpiCard } from '@forge/ui'
import { Package, AlertTriangle, TrendingDown, DollarSign } from 'lucide-react'

// ── Types ──────────────────────────────────────────────────────────────────────

interface Product extends Record<string, unknown> {
  id: string
  ref: string
  nom: string
  categorie: string
  stock: number
  alertThreshold: number
  criticalThreshold: number
  maxStock: number
  unite: string
  valeurUnitaire: number
  valeurTotal: number
  status: string
}

// ── Mock data ──────────────────────────────────────────────────────────────────

const PRODUCTS: Product[] = [
  { id: '1', ref: 'ALU-6060-T5', nom: 'Aluminium 6060 T5', categorie: 'Métaux', stock: 2, alertThreshold: 50, criticalThreshold: 20, maxStock: 500, unite: 'kg', valeurUnitaire: 3500, valeurTotal: 7000, status: 'critique' },
  { id: '2', ref: 'TOL-GALV-2MM', nom: 'Tôle galvanisée 2mm', categorie: 'Tôlerie', stock: 185, alertThreshold: 100, criticalThreshold: 50, maxStock: 500, unite: 'kg', valeurUnitaire: 850, valeurTotal: 157250, status: 'normal' },
  { id: '3', ref: 'FER-PLAT-40X4', nom: 'Fer plat 40×4', categorie: 'Métaux', stock: 35, alertThreshold: 80, criticalThreshold: 30, maxStock: 400, unite: 'kg', valeurUnitaire: 650, valeurTotal: 22750, status: 'alerte' },
  { id: '4', ref: 'PROF-U100', nom: 'Profilé U 100', categorie: 'Profilés', stock: 150, alertThreshold: 80, criticalThreshold: 30, maxStock: 300, unite: 'kg', valeurUnitaire: 720, valeurTotal: 108000, status: 'normal' },
  { id: '5', ref: 'VIT-CLAIRE-4MM', nom: 'Vitre claire 4mm', categorie: 'Vitrage', stock: 20, alertThreshold: 30, criticalThreshold: 10, maxStock: 100, unite: 'm²', valeurUnitaire: 8500, valeurTotal: 170000, status: 'alerte' },
  { id: '6', ref: 'CAB-ELEC-2.5', nom: 'Câble électrique 2.5mm²', categorie: 'Électricité', stock: 450, alertThreshold: 200, criticalThreshold: 100, maxStock: 1000, unite: 'm', valeurUnitaire: 950, valeurTotal: 427500, status: 'normal' },
  { id: '7', ref: 'ELEC-SOUD-3.2', nom: 'Électrode soudure 3.2mm', categorie: 'Soudure', stock: 5, alertThreshold: 50, criticalThreshold: 20, maxStock: 500, unite: 'kg', valeurUnitaire: 2800, valeurTotal: 14000, status: 'critique' },
  { id: '8', ref: 'DISC-MEUL-230', nom: 'Disque meulage 230mm', categorie: 'Abrasifs', stock: 120, alertThreshold: 80, criticalThreshold: 40, maxStock: 300, unite: 'pcs', valeurUnitaire: 1200, valeurTotal: 144000, status: 'normal' },
  { id: '9', ref: 'PEIN-ANTI-R', nom: 'Peinture anti-rouille grise', categorie: 'Peinture', stock: 18, alertThreshold: 30, criticalThreshold: 15, maxStock: 100, unite: 'L', valeurUnitaire: 6500, valeurTotal: 117000, status: 'alerte' },
  { id: '10', ref: 'BOU-INOX-M8', nom: 'Boulonnerie inox M8', categorie: 'Fixation', stock: 2500, alertThreshold: 1000, criticalThreshold: 500, maxStock: 5000, unite: 'pcs', valeurUnitaire: 25, valeurTotal: 62500, status: 'normal' },
]

const CATEGORIES = [...new Set(PRODUCTS.map((p) => p.categorie))]
const MOTIFS = ['Achat fournisseur', 'Retour chantier', 'Correction inventaire', 'Don / perte', 'Autre']

// ── Columns ────────────────────────────────────────────────────────────────────

const buildColumns = (onEntree: (p: Product) => void, onSortie: (p: Product) => void): Column<Product>[] => [
  {
    id: 'ref',
    header: 'Réf.',
    accessor: 'ref',
    render: (v) => <span className="font-mono text-xs text-gray-500">{v as string}</span>,
  },
  {
    id: 'nom',
    header: 'Produit',
    accessor: 'nom',
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
    accessor: 'stock',
    sortable: false,
    render: (_, row) => (
      <div className="w-36">
        <StockLevel
          current={row.stock as number}
          alertThreshold={row.alertThreshold as number}
          criticalThreshold={row.criticalThreshold as number}
          max={row.maxStock as number}
          unit={row.unite as string}
        />
      </div>
    ),
  },
  {
    id: 'stock',
    header: 'Qté',
    accessor: 'stock',
    render: (v, row) => (
      <span className="text-sm font-semibold">
        {(v as number).toLocaleString('fr-CM')} <span className="text-xs text-gray-400 font-normal">{row.unite as string}</span>
      </span>
    ),
  },
  {
    id: 'valeur',
    header: 'Valeur FCFA',
    accessor: 'valeurTotal',
    render: (v) => <span className="text-sm font-medium">{formatXAF(v as number)}</span>,
  },
  {
    id: 'status',
    header: 'Statut',
    accessor: 'status',
    render: (v) => <StatusBadge status={v as string} />,
  },
  {
    id: 'actions',
    header: 'Actions',
    accessor: 'id',
    sortable: false,
    render: (_, row) => (
      <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
        <button
          onClick={() => onEntree(row)}
          title="Entrée stock"
          className="flex items-center justify-center w-7 h-7 rounded-lg bg-green-50 text-green-700
            hover:bg-green-100 transition-colors text-xs font-bold"
        >
          +
        </button>
        <button
          onClick={() => onSortie(row)}
          title="Sortie stock"
          className="flex items-center justify-center w-7 h-7 rounded-lg bg-red-50 text-[#C62828]
            hover:bg-red-100 transition-colors text-xs font-bold"
        >
          −
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
  const [search, setSearch] = useState('')
  const [categorie, setCategorie] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [slideOpen, setSlideOpen] = useState(false)
  const [form, setForm] = useState<MvtForm>(DEFAULT_FORM)

  const openEntree = (p?: Product) => {
    setForm({ ...DEFAULT_FORM, type: 'entree', produitId: p?.id ?? '' })
    setSlideOpen(true)
  }
  const openSortie = (p?: Product) => {
    setForm({ ...DEFAULT_FORM, type: 'sortie', produitId: p?.id ?? '' })
    setSlideOpen(true)
  }

  const selectedProduct = PRODUCTS.find((p) => p.id === form.produitId)

  const sortieError = form.type === 'sortie' && selectedProduct && form.quantite > selectedProduct.stock
    ? `Stock insuffisant (disponible : ${selectedProduct.stock} ${selectedProduct.unite})`
    : null

  const formValid = form.produitId !== '' && form.quantite > 0 && form.motif !== '' && !sortieError

  const filtered = useMemo(() => {
    return PRODUCTS.filter((p) => {
      const matchSearch = !search || p.nom.toLowerCase().includes(search.toLowerCase()) || p.ref.toLowerCase().includes(search.toLowerCase())
      const matchCat = !categorie || p.categorie === categorie
      const matchStatus = !statusFilter || p.status === statusFilter
      return matchSearch && matchCat && matchStatus
    })
  }, [search, categorie, statusFilter])

  const columns = buildColumns(openEntree, openSortie)

  const critiques = PRODUCTS.filter((p) => p.status === 'critique').length
  const alertes = PRODUCTS.filter((p) => p.status === 'alerte').length
  const valeurTotale = PRODUCTS.reduce((sum, p) => sum + p.valeurTotal, 0)

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
          </>
        }
      />

      {/* KPIs */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <KpiCard title="Total produits" value={PRODUCTS.length} icon={<Package className="h-5 w-5" />} color="#1d4ed8" delay={0} />
        <KpiCard title="Valeur totale" value={formatXAF(valeurTotale)} icon={<DollarSign className="h-5 w-5" />} color="#15803d" delay={0.05} />
        <KpiCard title="Produits critiques" value={critiques} icon={<AlertTriangle className="h-5 w-5" />} color="#C62828" trend="down" trendValue="Rupture imminente" delay={0.1} />
        <KpiCard title="Produits en alerte" value={alertes} icon={<TrendingDown className="h-5 w-5" />} color="#d97706" delay={0.15} />
      </div>

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
          {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
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
          <Button
            variant="ghost"
            size="sm"
            onClick={() => { setSearch(''); setCategorie(''); setStatusFilter('') }}
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Réinitialiser
          </Button>
        )}
      </div>

      {/* Table */}
      <DataTable<Product>
        columns={columns}
        data={filtered}
        keyField="id"
        onRowClick={(row) => openEntree(row)}
      />

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
                    borderColor: form.type === t
                      ? (t === 'entree' ? '#16a34a' : '#C62828')
                      : '#e5e7eb',
                    backgroundColor: form.type === t
                      ? (t === 'entree' ? '#dcfce7' : '#fee2e2')
                      : 'transparent',
                    color: form.type === t
                      ? (t === 'entree' ? '#15803d' : '#C62828')
                      : '#6b7280',
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
              {PRODUCTS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nom} — Stock : {p.stock} {p.unite}
                </option>
              ))}
            </select>
            {selectedProduct && (
              <div className="mt-2 flex items-center gap-2">
                <span className="text-xs text-gray-500">Stock actuel :</span>
                <span className="text-xs font-semibold" style={{
                  color: selectedProduct.status === 'critique' ? '#dc2626'
                    : selectedProduct.status === 'alerte' ? '#d97706' : '#15803d',
                }}>
                  {selectedProduct.stock} {selectedProduct.unite}
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
                className="flex items-center justify-center w-10 h-10 rounded-lg border border-gray-200
                  hover:bg-gray-50 transition-colors"
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
                className="flex items-center justify-center w-10 h-10 rounded-lg border border-gray-200
                  hover:bg-gray-50 transition-colors"
              >
                <Plus className="h-4 w-4" />
              </button>
            </div>
            {sortieError && (
              <p className="mt-1.5 text-xs font-medium text-[#C62828]">{sortieError}</p>
            )}
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
              disabled={!formValid}
              style={form.type === 'sortie' ? { backgroundColor: '#C62828' } : {}}
              onClick={() => {
                // TODO: persist via API
                setSlideOpen(false)
                setForm(DEFAULT_FORM)
              }}
            >
              Valider {form.type === 'entree' ? 'l\'entrée' : 'la sortie'}
            </Button>
          </div>
        </div>
      </SlideOver>
    </motion.div>
  )
}
