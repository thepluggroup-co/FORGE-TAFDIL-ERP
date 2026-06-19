import React, { useState, useMemo, useCallback, useEffect } from 'react'
import { motion } from 'framer-motion'
import { useNavigate } from 'react-router-dom'
import { Plus, Minus, RotateCcw, FileOutput, ShoppingCart } from 'lucide-react'
import { PageHeader, DataTable, StatusBadge, StockLevel, SlideOver, Button, Modal } from '@forge/ui'
import type { Column } from '@forge/ui'
import { formatXAF, formatNombre, formatDateTime } from '@/lib/utils'
import { KpiCard } from '@forge/ui'
import { Package, AlertTriangle, TrendingDown, DollarSign, History } from 'lucide-react'
import { toast } from 'sonner'
import { useStocks, useMouvement, useCreateProduit, useMouvementsStock } from '@/hooks/useStocks'
import { useBonsEnAttente } from '@/hooks/useBons'
import { useBonsApproBrouillonCount, useCreerApproManuel } from '@/hooks/useBonsAppro'
import type { StockProduit, CreateProduitPayload, MouvementStock } from '@/hooks/useStocks'

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

const buildColumns = (
  onEntree: (p: Product) => void,
  onSortie:  (p: Product) => void,
  onAppro:   (p: Product) => void,
): Column<Product>[] => [
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
        {formatNombre(v as number)} <span className="text-xs text-gray-400 font-normal">{row.unite as string}</span>
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
        <Button size="xs" onClick={() => onEntree(row)} title="Entrée stock"
          className="bg-green-600 hover:bg-green-700 text-white focus:ring-green-600">
          <Plus className="h-3 w-3" />
          Entrée
        </Button>
        <Button size="xs" variant="primary" onClick={() => onSortie(row)} title="Sortie stock">
          <Minus className="h-3 w-3" />
          Sortie
        </Button>
        {['alerte', 'critique', 'rupture'].includes(row.statut as string) && (
          <Button size="xs" onClick={() => onAppro(row)} title="Demander approvisionnement"
            className="bg-orange-500 hover:bg-orange-600 text-white focus:ring-orange-500">
            <AlertTriangle className="h-3 w-3" />
            Appro
          </Button>
        )}
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

interface ApproForm {
  produitId:              string
  quantite:               number
  fournisseurNom:         string
  dateLivraisonSouhaitee: string
  notes:                  string
}

const DEFAULT_APPRO: ApproForm = {
  produitId: '', quantite: 1, fournisseurNom: '', dateLivraisonSouhaitee: '', notes: '',
}

// ── Mouvement type config ──────────────────────────────────────────────────────

const MVT_TYPE_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  entree:     { label: 'Entrée',      color: '#15803d', bg: '#dcfce7' },
  sortie:     { label: 'Sortie',      color: '#dc2626', bg: '#fee2e2' },
  ajustement: { label: 'Ajustement', color: '#d97706', bg: '#fef3c7' },
  transfert:  { label: 'Transfert',  color: '#1d4ed8', bg: '#dbeafe' },
}

// ── Page component ─────────────────────────────────────────────────────────────

export default function Stocks() {
  const navigate = useNavigate()

  // ── Tab ────────────────────────────────────────────────────────────────────
  const [tab, setTab] = useState<'produits' | 'historique'>('produits')

  // ── Produits tab state ────────────────────────────────────────────────────
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

  // ── Historique tab state ──────────────────────────────────────────────────
  const [mvtPage, setMvtPage]           = useState(1)
  const [mvtType, setMvtType]           = useState('')
  const [mvtProduitId, setMvtProduitId] = useState('')
  const [mvtDateDebut, setMvtDateDebut] = useState('')
  const [mvtDateFin, setMvtDateFin]     = useState('')

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300)
    return () => clearTimeout(t)
  }, [search])

  const { data, isLoading, isError } = useStocks({ search: debouncedSearch, categorie, statut: statusFilter })
  const mouvement = useMouvement()
  const createProduit = useCreateProduit()
  const [approOpen, setApproOpen]   = useState(false)
  const [approForm, setApproForm]   = useState<ApproForm>(DEFAULT_APPRO)

  const { data: bonsEnAttenteCount = 0 } = useBonsEnAttente()
  const { data: approBrouillonCount = 0 } = useBonsApproBrouillonCount()
  const creerAppro = useCreerApproManuel()

  const { data: mvtData, isLoading: mvtLoading } = useMouvementsStock({
    type:       mvtType as MouvementStock['type'] | undefined || undefined,
    produit_id: mvtProduitId || undefined,
    date_debut: mvtDateDebut || undefined,
    date_fin:   mvtDateFin   || undefined,
    page:       mvtPage,
  })

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

  const openAppro = useCallback((p?: Product) => {
    const qteDefaut = p
      ? Math.max(1, Math.ceil((p.stock_min as number) - (p.stock_actuel as number)))
      : 1
    setApproForm({
      ...DEFAULT_APPRO,
      produitId:      p?.id ?? '',
      quantite:       qteDefaut,
      fournisseurNom: (p?.fournisseur as string | undefined) ?? '',
    })
    setApproOpen(true)
  }, [])

  const selectedProduct = produits.find((p) => p.id === form.produitId)
  const sortieError = form.type === 'sortie' && selectedProduct && form.quantite > (selectedProduct.stock_actuel as number)
    ? `Stock insuffisant (disponible : ${selectedProduct.stock_actuel} ${selectedProduct.unite})`
    : null
  const formValid = form.produitId !== '' && form.quantite > 0 && form.motif !== '' && !sortieError

  const critiques    = useMemo(() => produits.filter((p) => p.statut === 'critique').length, [produits])
  const alertes      = useMemo(() => produits.filter((p) => p.statut === 'alerte').length, [produits])
  const valeurTotale = useMemo(() => produits.reduce((sum, p) => sum + (p.stock_actuel as number) * (p.prix_unitaire_xaf as number), 0), [produits])

  const columns = useMemo(() => buildColumns(openEntree, openSortie, openAppro), [openEntree, openSortie, openAppro])

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
            <Button size="sm" onClick={() => { setNewProduit(DEFAULT_PRODUIT); setCreateError(null); setCreateDone(false); setNewProduitOpen(true) }}>
              <Plus className="h-3.5 w-3.5" />
              Nouveau produit
            </Button>
            <Button size="sm" onClick={() => navigate('/stocks/bons-sortie')} className="relative">
              <FileOutput className="h-3.5 w-3.5" />
              Bons de sortie
              {bonsEnAttenteCount > 0 && (
                <span className="absolute -top-1.5 -right-1.5 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-white px-1 text-[10px] font-bold text-[#C62828]">
                  {bonsEnAttenteCount > 99 ? '99+' : bonsEnAttenteCount}
                </span>
              )}
            </Button>
            <Button size="sm" onClick={() => navigate('/stocks/approvisionnement')} className="relative">
              <ShoppingCart className="h-3.5 w-3.5" />
              Approvisionnement
              {approBrouillonCount > 0 && (
                <span className="absolute -top-1.5 -right-1.5 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-white px-1 text-[10px] font-bold text-[#C62828]">
                  {approBrouillonCount > 99 ? '99+' : approBrouillonCount}
                </span>
              )}
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

      {/* ── Onglets ── */}
      <div className="flex border-b border-gray-200">
        {([
          { key: 'produits'   as const, label: 'Produits',                   icon: null },
          { key: 'historique' as const, label: 'Historique des mouvements',  icon: <History className="h-3.5 w-3.5" /> },
        ]).map(({ key, label, icon }) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              tab === key
                ? 'border-[#C62828] text-[#C62828]'
                : 'border-transparent text-gray-500 hover:text-[#212121]'
            }`}
          >
            {icon}{label}
          </button>
        ))}
      </div>

      {/* ── Onglet Produits ── */}
      {tab === 'produits' && (
        <>
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
        </>
      )}

      {/* ── Onglet Historique des mouvements ── */}
      {tab === 'historique' && (
        <div className="space-y-4">
          {/* Filtres */}
          <div className="flex flex-wrap items-center gap-3">
            <select
              value={mvtProduitId}
              onChange={(e) => { setMvtProduitId(e.target.value); setMvtPage(1) }}
              className="px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C62828] min-w-48"
            >
              <option value="">Tous les produits</option>
              {produits.map((p) => (
                <option key={p.id as string} value={p.id as string}>{p.designation as string}</option>
              ))}
            </select>
            <select
              value={mvtType}
              onChange={(e) => { setMvtType(e.target.value); setMvtPage(1) }}
              className="px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C62828]"
            >
              <option value="">Tous types</option>
              <option value="entree">Entrée</option>
              <option value="sortie">Sortie</option>
              <option value="ajustement">Ajustement</option>
            </select>
            <input
              type="date"
              value={mvtDateDebut}
              onChange={(e) => { setMvtDateDebut(e.target.value); setMvtPage(1) }}
              className="px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C62828]"
              title="Date début"
            />
            <input
              type="date"
              value={mvtDateFin}
              min={mvtDateDebut}
              onChange={(e) => { setMvtDateFin(e.target.value); setMvtPage(1) }}
              className="px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C62828]"
              title="Date fin"
            />
            {(mvtProduitId || mvtType || mvtDateDebut || mvtDateFin) && (
              <Button variant="ghost" size="sm" onClick={() => {
                setMvtProduitId(''); setMvtType(''); setMvtDateDebut(''); setMvtDateFin(''); setMvtPage(1)
              }}>
                <RotateCcw className="h-3.5 w-3.5" />
                Réinitialiser
              </Button>
            )}
            {mvtData && (
              <span className="ml-auto text-xs text-gray-400">
                {mvtData.total} mouvement{mvtData.total !== 1 ? 's' : ''}
              </span>
            )}
          </div>

          {/* Tableau */}
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
            {mvtLoading ? (
              <div className="flex justify-center items-center py-16">
                <div className="animate-spin h-6 w-6 rounded-full border-2 border-[#C62828] border-t-transparent" />
              </div>
            ) : !mvtData?.data.length ? (
              <div className="flex flex-col items-center justify-center py-14 text-gray-400">
                <History className="h-8 w-8 mb-2 opacity-30" />
                <p className="text-sm">Aucun mouvement trouvé</p>
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50/60">
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Date</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Produit</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Type</th>
                    <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Quantité</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Référence</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Auteur</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Notes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {mvtData.data.map((mvt) => {
                    const typeCfg = MVT_TYPE_CONFIG[mvt.type] ?? { label: mvt.type, color: '#6b7280', bg: '#f3f4f6' }
                    return (
                      <tr key={mvt.id} className="hover:bg-gray-50/50 transition-colors">
                        <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">
                          {formatDateTime(mvt.created_at)}
                        </td>
                        <td className="px-4 py-3">
                          <div className="font-medium text-[#212121] text-sm">{mvt.produits?.designation ?? '—'}</div>
                          <div className="text-xs text-gray-400 font-mono">{mvt.produits?.ref ?? ''}</div>
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className="text-xs font-semibold px-2 py-0.5 rounded-full"
                            style={{ color: typeCfg.color, backgroundColor: typeCfg.bg }}
                          >
                            {typeCfg.label}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <span className={`text-sm font-semibold tabular-nums ${
                            mvt.type === 'entree' ? 'text-green-700' : mvt.type === 'sortie' ? 'text-red-600' : 'text-gray-700'
                          }`}>
                            {mvt.type === 'entree' ? '+' : mvt.type === 'sortie' ? '−' : ''}
                            {formatNombre(mvt.quantite)} {mvt.produits?.unite ?? ''}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          {mvt.reference ? (
                            mvt.reference.startsWith('BS-') || mvt.reference.startsWith('BON-') ? (
                              <button
                                type="button"
                                onClick={() => navigate('/stocks/bons-sortie')}
                                className="text-xs font-mono font-semibold text-[#C62828] hover:underline"
                                title="Voir les bons de sortie"
                              >
                                {mvt.reference}
                              </button>
                            ) : (
                              <span className="text-xs font-mono text-gray-600">{mvt.reference}</span>
                            )
                          ) : (
                            <span className="text-gray-300">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-xs text-gray-500">
                          {mvt.profiles?.full_name ?? '—'}
                        </td>
                        <td className="px-4 py-3 text-xs text-gray-500 max-w-[160px]">
                          <span className="truncate block">{mvt.notes ?? '—'}</span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>

          {/* Pagination */}
          {mvtData && mvtData.total_pages > 1 && (
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-400">
                Page {mvtPage} / {mvtData.total_pages}
              </span>
              <div className="flex gap-2">
                <Button
                  variant="ghost" size="sm"
                  disabled={mvtPage <= 1}
                  onClick={() => setMvtPage((p) => p - 1)}
                >
                  ← Précédent
                </Button>
                <Button
                  variant="ghost" size="sm"
                  disabled={mvtPage >= mvtData.total_pages}
                  onClick={() => setMvtPage((p) => p + 1)}
                >
                  Suivant →
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

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

      {/* ── Modal Demander approvisionnement ── */}
      <Modal
        isOpen={approOpen}
        onClose={() => setApproOpen(false)}
        title="Demander un approvisionnement"
        size="md"
      >
        <div className="space-y-4">
          {/* Sélecteur article */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Article *</label>
            <select
              value={approForm.produitId}
              onChange={(e) => {
                const p = produits.find(pr => pr.id === e.target.value)
                setApproForm(f => ({
                  ...f,
                  produitId:      e.target.value,
                  fournisseurNom: p ? (p.fournisseur as string | undefined) ?? '' : f.fournisseurNom,
                  quantite:       p
                    ? Math.max(1, Math.ceil((p.stock_min as number) - (p.stock_actuel as number)))
                    : f.quantite,
                }))
              }}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-400"
            >
              <option value="">Sélectionner un article…</option>
              {produits.map((p) => (
                <option key={p.id as string} value={p.id as string}>
                  {p.designation as string}
                  {['alerte','critique','rupture'].includes(p.statut as string) ? ' ⚠' : ''}
                  {' — stock: '}{p.stock_actuel as number} {p.unite as string}
                </option>
              ))}
            </select>
          </div>

          {/* Quantité */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Quantité à commander *</label>
            <input
              type="number"
              min={1}
              value={approForm.quantite}
              onChange={(e) => setApproForm(f => ({ ...f, quantite: Math.max(1, Number(e.target.value)) }))}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-400"
            />
            {approForm.produitId && (() => {
              const p = produits.find(pr => pr.id === approForm.produitId)
              return p ? (
                <p className="text-xs text-gray-400 mt-1">
                  Stock actuel : {p.stock_actuel as number} — Seuil min : {p.stock_min as number} {p.unite as string}
                </p>
              ) : null
            })()}
          </div>

          {/* Fournisseur */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Fournisseur</label>
            <input
              type="text"
              placeholder="Nom du fournisseur"
              value={approForm.fournisseurNom}
              onChange={(e) => setApproForm(f => ({ ...f, fournisseurNom: e.target.value }))}
              list="fournisseurs-list"
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-400"
            />
            <datalist id="fournisseurs-list">
              {[...new Set(produits.map(p => p.fournisseur as string | undefined).filter(Boolean))]
                .map(f => <option key={f} value={f} />)}
            </datalist>
          </div>

          {/* Date livraison souhaitée */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Date de livraison souhaitée</label>
            <input
              type="date"
              value={approForm.dateLivraisonSouhaitee}
              min={new Date().toISOString().slice(0, 10)}
              onChange={(e) => setApproForm(f => ({ ...f, dateLivraisonSouhaitee: e.target.value }))}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-400"
            />
          </div>

          {/* Notes */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
            <textarea
              rows={2}
              placeholder="Instructions particulières, urgence, etc."
              value={approForm.notes}
              onChange={(e) => setApproForm(f => ({ ...f, notes: e.target.value }))}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-400 resize-none"
            />
          </div>

          {/* Actions */}
          <div className="flex gap-3 pt-2 border-t border-gray-100">
            <Button variant="ghost" className="flex-1" onClick={() => setApproOpen(false)}>
              Annuler
            </Button>
            <Button
              className="flex-1"
              style={{ backgroundColor: '#f97316' }}
              disabled={!approForm.produitId || approForm.quantite < 1 || creerAppro.isPending}
              onClick={() => {
                creerAppro.mutate(
                  {
                    produit_id:               approForm.produitId,
                    quantite:                 approForm.quantite,
                    fournisseur_nom:          approForm.fournisseurNom || undefined,
                    date_livraison_souhaitee: approForm.dateLivraisonSouhaitee || undefined,
                    notes:                    approForm.notes || undefined,
                  },
                  {
                    onSuccess: () => { setApproOpen(false); setApproForm(DEFAULT_APPRO) },
                  },
                )
              }}
            >
              {creerAppro.isPending ? 'Création…' : 'Créer le bon d\'appro'}
            </Button>
          </div>
        </div>
      </Modal>
    </motion.div>
  )
}
