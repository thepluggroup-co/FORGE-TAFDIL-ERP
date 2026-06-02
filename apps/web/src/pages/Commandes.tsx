import React, { useState, useRef, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  LayoutGrid, Table2, Plus, GripVertical, Globe,
  Truck, Package, CheckCircle, XCircle, Wrench,
  Search, Trash2, BookOpen, CalendarDays, ChevronRight,
  Info, BadgePercent, OctagonX,
} from 'lucide-react'
import { PageHeader, DataTable, StatusBadge, SlideOver, Button, Modal } from '@forge/ui'
import type { Column } from '@forge/ui'
import { formatXAF, formatDate } from '@/lib/utils'
import { toast } from 'sonner'
import { useCommandes, useStatutCommande, useCreateCommande } from '@/hooks/useCommandes'
import type { Commande, CommandeLigne, CommandeHistorique } from '@/hooks/useCommandes'
import { useClients } from '@/hooks/useClients'
import type { Client } from '@/hooks/useClients'
import { useCommandesShop } from '@/hooks/useCommandesShop'
import { CommandesWebPage } from './commandes/CommandesWebPage'
import { useProduitsShop } from '@/hooks/useProduitsShop'
import type { ProduitShopErp } from '@/hooks/useProduitsShop'

// ── Types ──────────────────────────────────────────────────────────────────────

type KanbanCol = 'confirmed' | 'in_production' | 'pret' | 'delivered' | 'cancelled'
type CommandeRecord = Commande & Record<string, unknown>

// ── Kanban config ─────────────────────────────────────────────────────────────

const KANBAN_COLS: { id: KanbanCol; label: string; color: string; desc: string }[] = [
  { id: 'confirmed',     label: 'Confirmée',      color: '#1d4ed8', desc: 'Commande enregistrée, en attente de démarrage' },
  { id: 'in_production', label: 'En Production',  color: '#d97706', desc: 'Fabrication / préparation en cours' },
  { id: 'pret',          label: 'Prête à Livrer', color: '#7c3aed', desc: 'Produit finalisé, en attente de livraison' },
  { id: 'delivered',     label: 'Livrée',          color: '#15803d', desc: 'Remise au client — cycle terminé' },
  { id: 'cancelled',     label: 'Annulée',         color: '#6b7280', desc: 'Commande annulée' },
]

const STATUS_LABELS: Record<KanbanCol, string> = {
  confirmed: 'Confirmée', in_production: 'En Production',
  pret: 'Prête à Livrer', delivered: 'Livrée', cancelled: 'Annulée',
}

// ── Pipeline stepper ──────────────────────────────────────────────────────────

const PIPELINE_STEPS: { id: string; label: string; Icon: React.ElementType }[] = [
  { id: 'confirmed',     label: 'Confirmée',    Icon: CheckCircle },
  { id: 'in_production', label: 'Production',   Icon: Wrench      },
  { id: 'pret',          label: 'Prête',        Icon: Package     },
  { id: 'delivered',     label: 'Livrée',       Icon: Truck       },
]

function PipelineStepper({ statut }: { statut: string }) {
  if (statut === 'cancelled') {
    return (
      <div className="flex items-center gap-2 rounded-lg bg-gray-50 px-3 py-2">
        <XCircle className="h-4 w-4 text-gray-400" />
        <span className="text-sm font-medium text-gray-500">Commande annulée</span>
      </div>
    )
  }
  const currentIdx = PIPELINE_STEPS.findIndex((s) => s.id === statut)
  return (
    <div className="flex items-center gap-0">
      {PIPELINE_STEPS.map((step, i) => {
        const done    = i <= currentIdx
        const current = i === currentIdx
        const { Icon } = step
        return (
          <React.Fragment key={step.id}>
            <div className="flex flex-col items-center gap-1">
              <div
                className="flex h-8 w-8 items-center justify-center rounded-full border-2 transition-colors"
                style={{
                  backgroundColor: done ? '#C62828' : '#f3f4f6',
                  borderColor:     done ? '#C62828' : '#e5e7eb',
                  boxShadow:       current ? '0 0 0 3px #C6282820' : 'none',
                }}
              >
                <Icon className="h-3.5 w-3.5" style={{ color: done ? '#fff' : '#9ca3af' }} />
              </div>
              <span
                className="text-[10px] font-semibold whitespace-nowrap"
                style={{ color: done ? '#C62828' : '#9ca3af' }}
              >
                {step.label}
              </span>
            </div>
            {i < PIPELINE_STEPS.length - 1 && (
              <div
                className="mb-5 h-0.5 flex-1 min-w-[20px]"
                style={{ backgroundColor: i < currentIdx ? '#C62828' : '#e5e7eb' }}
              />
            )}
          </React.Fragment>
        )
      })}
    </div>
  )
}

// ── CatalogueShopModal ────────────────────────────────────────────────────────

interface CatalogueModalProps {
  isOpen: boolean
  onClose: () => void
  onSelect: (p: ProduitShopErp) => void
}

function CatalogueShopModal({ isOpen, onClose, onSelect }: CatalogueModalProps) {
  const [search, setSearch] = useState('')
  const { data: produits, isLoading } = useProduitsShop()

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim()
    return (produits ?? []).filter((p) =>
      !q ||
      p.nom.toLowerCase().includes(q) ||
      p.ref.toLowerCase().includes(q) ||
      p.categorie.toLowerCase().includes(q),
    )
  }, [produits, search])

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Catalogue TAFDIL Shop" size="lg">
      <div className="space-y-3">
        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Chercher un article, référence, catégorie…"
            autoFocus
            className="w-full rounded-lg border border-gray-200 py-2 pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-[#C62828]"
          />
        </div>

        {/* List */}
        {isLoading ? (
          <div className="space-y-2">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-14 animate-pulse rounded-lg bg-gray-100" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-center">
            <Package className="mb-2 h-8 w-8 text-gray-200" />
            <p className="text-sm text-gray-400">Aucun article trouvé</p>
          </div>
        ) : (
          <div className="max-h-[52vh] space-y-1.5 overflow-y-auto pr-1">
            {filtered.map((p) => (
              <button
                key={p.id}
                onClick={() => { onSelect(p); onClose(); setSearch('') }}
                className="flex w-full items-center justify-between rounded-lg border border-gray-100 px-3 py-2.5 text-left transition-all hover:border-[#C62828] hover:bg-red-50"
              >
                <div>
                  <p className="text-sm font-semibold text-[#212121]">{p.nom}</p>
                  <p className="text-xs text-gray-400">{p.categorie} · {p.ref}</p>
                </div>
                <div className="ml-4 text-right">
                  {p.prix_public ? (
                    <p className="text-sm font-bold text-[#C62828]">{formatXAF(p.prix_public)}</p>
                  ) : (
                    <p className="text-xs italic text-gray-400">Prix non défini</p>
                  )}
                  <p className="text-xs" style={{ color: p.stock_actuel <= p.stock_min ? '#C62828' : '#15803d' }}>
                    Stock : {p.stock_actuel} {p.unite}
                  </p>
                </div>
              </button>
            ))}
          </div>
        )}

        {/* Footer hint */}
        <p className="flex items-center gap-1.5 border-t border-gray-100 pt-2 text-xs text-gray-400">
          <Info className="h-3 w-3" />
          Cliquez sur un article pour l'ajouter à la commande. Prix HT à ajuster si besoin.
        </p>
      </div>
    </Modal>
  )
}

// ── KanbanCard ────────────────────────────────────────────────────────────────

interface KanbanCardProps {
  order: CommandeRecord
  containerRef: React.RefObject<HTMLDivElement | null>
  columnRefs: React.MutableRefObject<Record<string, HTMLDivElement | null>>
  onDrop: (orderId: string, colId: KanbanCol) => void
  onClick: () => void
}

function KanbanCard({ order, containerRef, columnRefs, onDrop, onClick }: KanbanCardProps) {
  const isDragging = useRef(false)
  const nbLignes   = (order.lignes as CommandeLigne[])?.length ?? 0

  return (
    <motion.div
      layoutId={`card-${order.id}`}
      drag
      dragConstraints={containerRef}
      dragElastic={0.05}
      dragMomentum={false}
      whileDrag={{ scale: 1.04, boxShadow: '0 16px 40px rgba(0,0,0,0.18)', zIndex: 50, cursor: 'grabbing' }}
      onDragStart={() => { isDragging.current = true }}
      onDragEnd={(e) => {
        const clientX = (e as MouseEvent).clientX ?? (e as TouchEvent).changedTouches?.[0]?.clientX
        const clientY = (e as MouseEvent).clientY ?? (e as TouchEvent).changedTouches?.[0]?.clientY
        for (const [colId, ref] of Object.entries(columnRefs.current)) {
          if (!ref) continue
          const rect = ref.getBoundingClientRect()
          if (clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom) {
            if (colId !== order.statut) onDrop(order.id, colId as KanbanCol)
            break
          }
        }
        setTimeout(() => { isDragging.current = false }, 50)
      }}
      onClick={() => { if (!isDragging.current) onClick() }}
      className="bg-white rounded-xl border border-gray-100 shadow-sm p-3.5 cursor-grab select-none"
    >
      {/* En-tête : référence + poignée */}
      <div className="flex items-start justify-between gap-2 mb-2">
        <span className="text-xs font-mono text-gray-400">{order.reference}</span>
        <GripVertical className="h-3.5 w-3.5 text-gray-300 shrink-0" />
      </div>

      {/* Client */}
      <p className="text-sm font-semibold text-[#212121] mb-1 truncate">{order.client?.nom ?? '—'}</p>

      {/* Montant */}
      <p className="text-base font-bold text-[#212121]">{formatXAF(order.montant_ttc_xaf)}</p>

      {/* Lignes articles */}
      {nbLignes > 0 && (
        <p className="text-xs text-gray-400 mt-0.5">
          {nbLignes} article{nbLignes > 1 ? 's' : ''}
        </p>
      )}

      {/* Footer : date commande + livraison prévue + statut */}
      <div className="flex items-center justify-between mt-2.5 gap-1">
        <span className="text-xs text-gray-400">{formatDate(order.date_commande)}</span>
        <StatusBadge status={order.statut} />
      </div>

      {/* Livraison prévue si définie */}
      {order.date_livraison_prevue && (
        <div className="flex items-center gap-1 mt-1.5">
          <CalendarDays className="h-3 w-3 text-[#7c3aed]" />
          <span className="text-[10px] font-medium text-[#7c3aed]">
            Livr. {formatDate(order.date_livraison_prevue as string)}
          </span>
        </div>
      )}

      {/* Acompte reçu si > 0 */}
      {(order.acompte_recu_xaf as number) > 0 && (
        <div className="flex items-center gap-1 mt-1">
          <BadgePercent className="h-3 w-3 text-green-600" />
          <span className="text-[10px] text-green-700">
            Acompte : {formatXAF(order.acompte_recu_xaf as number)}
          </span>
        </div>
      )}
    </motion.div>
  )
}

// ── KanbanColumn ──────────────────────────────────────────────────────────────

interface KanbanColumnProps {
  col: typeof KANBAN_COLS[0]
  orders: CommandeRecord[]
  containerRef: React.RefObject<HTMLDivElement | null>
  columnRefs: React.MutableRefObject<Record<string, HTMLDivElement | null>>
  onDrop: (orderId: string, colId: KanbanCol) => void
  onCardClick: (order: CommandeRecord) => void
}

function KanbanColumn({ col, orders, containerRef, columnRefs, onDrop, onCardClick }: KanbanColumnProps) {
  const total = orders.reduce((s, o) => s + o.montant_ttc_xaf, 0)

  return (
    <div ref={(el) => { columnRefs.current[col.id] = el }} className="flex flex-col gap-2 min-w-[240px] w-[240px]">
      <div className="flex items-center gap-2 px-1 mb-0.5">
        <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: col.color }} />
        <span className="text-xs font-semibold text-[#212121]">{col.label}</span>
        <span
          className="ml-auto flex items-center justify-center w-5 h-5 rounded-full text-white text-xs font-bold"
          style={{ backgroundColor: col.color }}
        >
          {orders.length}
        </span>
      </div>
      <div className="text-xs text-gray-400 px-1 -mt-1 mb-0.5">{formatXAF(total)}</div>
      {/* Tooltip desc */}
      <div className="px-1 -mt-1 mb-1">
        <span className="text-[10px] text-gray-300 italic">{col.desc}</span>
      </div>
      <div className="flex flex-col gap-2 min-h-[80px] rounded-xl p-1" style={{ backgroundColor: `${col.color}08` }}>
        <AnimatePresence>
          {orders.map((order) => (
            <KanbanCard
              key={order.id}
              order={order}
              containerRef={containerRef}
              columnRefs={columnRefs}
              onDrop={onDrop}
              onClick={() => onCardClick(order)}
            />
          ))}
        </AnimatePresence>
      </div>
    </div>
  )
}

// ── Table columns ─────────────────────────────────────────────────────────────

const TABLE_COLS: Column<CommandeRecord>[] = [
  {
    id: 'reference', header: 'Référence', accessor: 'reference',
    render: (v) => <span className="font-mono text-xs font-semibold">{v as string}</span>,
  },
  {
    id: 'client', header: 'Client',
    accessor: (r) => r.client?.nom ?? '—',
    csvValue: (r) => r.client?.nom ?? '—',
    render: (v, row) => (
      <div>
        <p className="text-sm font-medium">{v as string}</p>
        {(row as Commande).client?.telephone && (
          <p className="text-xs text-gray-400">{(row as Commande).client.telephone}</p>
        )}
      </div>
    ),
  },
  {
    id: 'lignes_count', header: 'Articles',
    accessor: (r) => (r.lignes as CommandeLigne[])?.length ?? 0,
    render: (v) => (
      <span className="text-xs font-medium text-gray-600">
        {v as number} art.
      </span>
    ),
  },
  {
    id: 'montant_ttc_xaf', header: 'Montant TTC', accessor: 'montant_ttc_xaf',
    csvValue: (r) => String(r.montant_ttc_xaf ?? 0),
    render: (v) => <span className="font-semibold">{formatXAF(v as number)}</span>,
  },
  {
    id: 'date_commande', header: 'Date commande', accessor: 'date_commande',
    render: (v) => <span className="text-xs text-gray-500">{formatDate(v as string)}</span>,
  },
  {
    id: 'date_livraison_prevue', header: 'Livraison prévue', accessor: 'date_livraison_prevue',
    render: (v) => v
      ? <span className="flex items-center gap-1 text-xs font-medium text-[#7c3aed]"><CalendarDays className="h-3 w-3" />{formatDate(v as string)}</span>
      : <span className="text-xs text-gray-300">—</span>,
  },
  {
    id: 'statut', header: 'Statut', accessor: 'statut',
    render: (v) => <StatusBadge status={v as string} />,
  },
]

// ── OrderDetail (ERP) ──────────────────────────────────────────────────────────

function OrderDetail({ order, onClose }: { order: CommandeRecord; onClose: () => void }) {
  const lignes    = (order.lignes as CommandeLigne[]) ?? []
  const historique = (order.historique as CommandeHistorique[]) ?? []
  const totalHT   = lignes.reduce((s, l) => s + l.quantite * l.prix_unitaire_ht_xaf, 0)
  const tva       = Math.round(totalHT * 0.1925)
  const ttc       = Math.round(totalHT + tva)
  const soldeRestant = Math.max(0, ttc - ((order.acompte_recu_xaf as number) ?? 0))

  return (
    <SlideOver isOpen={true} onClose={onClose} title={`Commande ${order.reference}`} width="lg">
      <div className="space-y-6">

        {/* Pipeline */}
        <div>
          <h3 className="mb-3 text-xs font-semibold uppercase text-gray-400">Progression</h3>
          <PipelineStepper statut={order.statut} />
        </div>

        {/* Client */}
        <div>
          <h3 className="text-xs font-semibold text-gray-400 uppercase mb-2">Client</h3>
          <p className="text-sm font-semibold text-[#212121]">{order.client?.nom ?? '—'}</p>
          {order.client?.telephone && (
            <p className="text-sm text-gray-500">{order.client.telephone}</p>
          )}
        </div>

        {/* Dates */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <h3 className="text-xs font-semibold text-gray-400 uppercase mb-1">Date commande</h3>
            <p className="text-sm text-[#212121]">{formatDate(order.date_commande)}</p>
          </div>
          {order.date_livraison_prevue && (
            <div>
              <h3 className="text-xs font-semibold text-gray-400 uppercase mb-1">Livraison prévue</h3>
              <p className="text-sm font-medium text-[#7c3aed]">{formatDate(order.date_livraison_prevue as string)}</p>
            </div>
          )}
        </div>

        {/* Notes */}
        {order.notes && (
          <div>
            <h3 className="text-xs font-semibold text-gray-400 uppercase mb-1">Notes</h3>
            <p className="rounded-lg bg-yellow-50 px-3 py-2 text-sm text-yellow-800 whitespace-pre-wrap">{order.notes as string}</p>
          </div>
        )}

        {/* Lignes */}
        <div>
          <h3 className="text-xs font-semibold text-gray-400 uppercase mb-2">Lignes de commande</h3>
          <div className="border border-gray-100 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead style={{ backgroundColor: '#C62828' }}>
                <tr>
                  {['Désignation', 'Qté', 'P.U. HT', 'Total HT'].map((h) => (
                    <th key={h} className="px-3 py-2 text-left text-xs font-semibold text-white">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {lignes.map((l, i) => (
                  <tr key={i} className="hover:bg-gray-50">
                    <td className="px-3 py-2">{l.designation}</td>
                    <td className="px-3 py-2 text-center">{l.quantite} {l.unite ?? ''}</td>
                    <td className="px-3 py-2 text-right">{formatXAF(l.prix_unitaire_ht_xaf)}</td>
                    <td className="px-3 py-2 text-right font-semibold">{formatXAF(l.quantite * l.prix_unitaire_ht_xaf)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="bg-gray-50 px-3 py-2 space-y-1">
              <div className="flex justify-between text-xs text-gray-500"><span>Total HT</span><span>{formatXAF(totalHT)}</span></div>
              <div className="flex justify-between text-xs text-gray-500"><span>TVA 19.25%</span><span>{formatXAF(tva)}</span></div>
              <div className="flex justify-between text-sm font-bold text-[#212121]"><span>Total TTC</span><span>{formatXAF(ttc)}</span></div>
              {(order.acompte_recu_xaf as number) > 0 && (
                <>
                  <div className="flex justify-between text-xs text-green-700"><span>Acompte reçu</span><span>− {formatXAF(order.acompte_recu_xaf as number)}</span></div>
                  <div className="flex justify-between text-sm font-bold text-[#C62828]"><span>Solde restant</span><span>{formatXAF(soldeRestant)}</span></div>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Historique */}
        {historique.length > 0 && (
          <div>
            <h3 className="text-xs font-semibold text-gray-400 uppercase mb-2">Historique</h3>
            <div className="space-y-2">
              {historique.map((h, i) => (
                <div key={i} className="flex items-center gap-3">
                  <div className="flex flex-col items-center">
                    <div className="w-2 h-2 rounded-full bg-[#C62828]" />
                    {i < historique.length - 1 && <div className="w-px h-4 bg-gray-200" />}
                  </div>
                  <div className="flex-1 pb-1">
                    <span className="text-xs font-medium text-[#212121]">
                      {STATUS_LABELS[h.statut as KanbanCol] ?? h.statut}
                    </span>
                    <span className="text-xs text-gray-400 ml-2">· {formatDate(h.created_at)}</span>
                    {h.commentaire && (
                      <p className="text-xs text-gray-500 italic mt-0.5">{h.commentaire}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="pt-2 border-t border-gray-100">
          <Button className="w-full" variant="ghost" onClick={onClose}>Fermer</Button>
        </div>
      </div>
    </SlideOver>
  )
}

// ── Form types ─────────────────────────────────────────────────────────────────

interface LigneForm {
  produit_id?: string
  designation: string
  quantite: number
  prix_unitaire_ht_xaf: number
  unite: string
}

interface NouvelleCommandeForm {
  client_nom: string
  client_telephone: string
  date_livraison_prevue: string
  notes: string
  lignes: LigneForm[]
}

const DEFAULT_LIGNE: LigneForm = { designation: '', quantite: 1, prix_unitaire_ht_xaf: 0, unite: 'unité' }
const DEFAULT_CMD: NouvelleCommandeForm = {
  client_nom: '', client_telephone: '',
  date_livraison_prevue: '', notes: '',
  lignes: [{ ...DEFAULT_LIGNE }],
}

// ── Page ───────────────────────────────────────────────────────────────────────

type Tab = 'erp' | 'web'

export default function Commandes() {
  const [tab, setTab]             = useState<Tab>('erp')
  const [view, setView]           = useState<'kanban' | 'table'>('kanban')
  const [selected, setSelected]   = useState<CommandeRecord | null>(null)
  const [cmdSlide, setCmdSlide]   = useState(false)
  const [cmdForm, setCmdForm]     = useState<NouvelleCommandeForm>(DEFAULT_CMD)
  const [showCatalogue, setShowCatalogue] = useState(false)
  const containerRef  = useRef<HTMLDivElement>(null)
  const columnRefs    = useRef<Record<string, HTMLDivElement | null>>({})

  const [selectedClient, setSelectedClient] = useState<Client | null>(null)
  const [clientDropdownOpen, setClientDropdownOpen] = useState(false)

  const { data, isLoading, isError } = useCommandes()
  const statutMutation  = useStatutCommande()
  const createCommande  = useCreateCommande()
  const { data: clientsData } = useClients()

  const { data: shopData } = useCommandesShop()

  const allClients = (clientsData?.data ?? []) as Client[]
  const filteredClients = cmdForm.client_nom.trim()
    ? allClients.filter((c) => c.nom.toLowerCase().includes(cmdForm.client_nom.toLowerCase())).slice(0, 8)
    : allClients.slice(0, 8)
  const webBadge = shopData?.stats?.nouvelles_ce_jour ?? 0

  const orders = (data?.data ?? []) as CommandeRecord[]

  const [pendingMove, setPendingMove] = useState<{ orderId: string; colId: KanbanCol } | null>(null)

  // ── Helpers form lignes ────────────────────────────────────────────────────

  const updateLigne = (idx: number, patch: Partial<LigneForm>) =>
    setCmdForm((f) => ({ ...f, lignes: f.lignes.map((l, i) => i === idx ? { ...l, ...patch } : l) }))

  const addLigne = () =>
    setCmdForm((f) => ({ ...f, lignes: [...f.lignes, { ...DEFAULT_LIGNE }] }))

  const removeLigne = (idx: number) =>
    setCmdForm((f) => ({ ...f, lignes: f.lignes.filter((_, i) => i !== idx) }))

  const addProduitFromCatalogue = (p: ProduitShopErp) => {
    const newLigne: LigneForm = {
      produit_id:           p.id,
      designation:          p.nom,
      quantite:             1,
      prix_unitaire_ht_xaf: p.prix_public ? Math.round(p.prix_public / 1.1925) : 0,
      unite:                p.unite || 'unité',
    }
    setCmdForm((f) => {
      // Remplacer la première ligne vide, sinon ajouter
      const firstEmpty = f.lignes.findIndex((l) => !l.designation.trim())
      if (firstEmpty >= 0) {
        return { ...f, lignes: f.lignes.map((l, i) => i === firstEmpty ? newLigne : l) }
      }
      return { ...f, lignes: [...f.lignes, newLigne] }
    })
  }

  // ── Totaux form ────────────────────────────────────────────────────────────

  const formTotalHT = cmdForm.lignes.reduce(
    (s, l) => s + (l.quantite > 0 ? l.quantite * l.prix_unitaire_ht_xaf : 0), 0,
  )
  const formTTC = Math.round(formTotalHT * 1.1925)

  const canSubmit =
    !!cmdForm.client_nom.trim() &&
    cmdForm.lignes.some((l) => l.designation.trim() && l.quantite > 0) &&
    !createCommande.isPending &&
    selectedClient?.statut !== 'bloque'

  // ── Kanban ─────────────────────────────────────────────────────────────────

  const moveOrder = (orderId: string, colId: KanbanCol) => {
    if (colId === 'cancelled') {
      setPendingMove({ orderId, colId })
      return
    }
    statutMutation.mutate({ id: orderId, statut: colId }, {
      onSuccess: () => toast.success(`Statut → ${STATUS_LABELS[colId]}`),
    })
  }

  const ordersByStatus = useMemo(
    () => Object.fromEntries(
      KANBAN_COLS.map((col) => [col.id, orders.filter((o) => o.statut === col.id)])
    ) as Record<KanbanCol, CommandeRecord[]>,
    [orders],
  )

  const totalErp = useMemo(() => orders.reduce((s, o) => s + o.montant_ttc_xaf, 0), [orders])

  // ── Submit ─────────────────────────────────────────────────────────────────

  const handleCreateCommande = () => {
    const notes = [
      cmdForm.client_telephone ? `Tél : ${cmdForm.client_telephone}` : '',
      cmdForm.notes,
    ].filter(Boolean).join('\n') || undefined

    createCommande.mutate(
      {
        client_id:             selectedClient?.id,
        client_nom:            cmdForm.client_nom,
        date_commande:         new Date().toISOString().split('T')[0],
        date_livraison_prevue: cmdForm.date_livraison_prevue || undefined,
        notes,
        lignes: cmdForm.lignes
          .filter((l) => l.designation.trim() && l.quantite > 0)
          .map((l, i) => ({
            produit_id:           l.produit_id,
            designation:          l.designation,
            unite:                l.unite,
            quantite:             l.quantite,
            prix_unitaire_ht_xaf: l.prix_unitaire_ht_xaf,
            ordre:                i,
          })),
      },
      {
        onSuccess: () => {
          setCmdSlide(false)
          setCmdForm(DEFAULT_CMD)
          setSelectedClient(null)
        },
      },
    )
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3 }}
      className="space-y-6"
    >
      <PageHeader
        title="Commandes"
        subtitle={
          tab === 'erp'
            ? `${orders.length} commandes ERP · ${formatXAF(totalErp)}`
            : 'Commandes reçues depuis TAFDIL Shop'
        }
        breadcrumbs={[{ label: 'FORGE', href: '/' }, { label: 'Commandes' }]}
        actions={
          tab === 'erp' ? (
            <>
              <div className="flex items-center bg-gray-100 rounded-lg p-1 gap-1">
                <button
                  onClick={() => setView('kanban')}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all"
                  style={{ backgroundColor: view === 'kanban' ? '#fff' : 'transparent', color: view === 'kanban' ? '#212121' : '#6b7280', boxShadow: view === 'kanban' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none' }}
                >
                  <LayoutGrid className="h-3.5 w-3.5" /> Kanban
                </button>
                <button
                  onClick={() => setView('table')}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all"
                  style={{ backgroundColor: view === 'table' ? '#fff' : 'transparent', color: view === 'table' ? '#212121' : '#6b7280', boxShadow: view === 'table' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none' }}
                >
                  <Table2 className="h-3.5 w-3.5" /> Tableau
                </button>
              </div>
              <Button size="sm" onClick={() => { setCmdForm(DEFAULT_CMD); setCmdSlide(true) }}>
                <Plus className="h-3.5 w-3.5" /> Nouvelle commande
              </Button>
            </>
          ) : null
        }
      />

      {/* Onglets ERP / Web */}
      <div className="flex items-center gap-1 border-b border-gray-200">
        {(['erp', 'web'] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`relative flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors ${
              tab === t
                ? 'text-[#C62828] after:absolute after:bottom-0 after:left-0 after:h-0.5 after:w-full after:bg-[#C62828]'
                : 'text-gray-500 hover:text-[#212121]'
            }`}
          >
            {t === 'web' && <Globe size={14} />}
            {t === 'erp' ? 'Commandes ERP' : 'Commandes Web'}
            {t === 'erp' && (
              <span className="rounded-full bg-gray-100 px-1.5 py-0.5 text-xs font-semibold text-gray-600">
                {orders.length}
              </span>
            )}
            {t === 'web' && webBadge > 0 && (
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[#C62828] text-xs font-bold text-white">
                {webBadge > 9 ? '9+' : webBadge}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Contenu principal */}
      <AnimatePresence mode="wait">
        {tab === 'erp' ? (
          <motion.div key="erp" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
            {isError && (
              <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
                Impossible de charger les commandes. Veuillez réessayer.
              </div>
            )}

            <AnimatePresence mode="wait">
              {view === 'kanban' ? (
                <motion.div
                  key="kanban"
                  initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}
                  ref={containerRef}
                  className="flex gap-4 overflow-x-auto pb-4"
                >
                  {isLoading
                    ? KANBAN_COLS.map((col) => (
                        <div key={col.id} className="flex flex-col gap-2 min-w-[240px] w-[240px]">
                          <div className="h-4 bg-gray-200 rounded animate-pulse w-24 mx-1 mb-1" />
                          {[0, 1].map((i) => (
                            <div key={i} className="bg-white rounded-xl border border-gray-100 p-3.5 space-y-2.5 animate-pulse">
                              <div className="h-2.5 bg-gray-100 rounded w-16" />
                              <div className="h-3.5 bg-gray-100 rounded w-32" />
                              <div className="h-4 bg-gray-100 rounded w-20" />
                            </div>
                          ))}
                        </div>
                      ))
                    : KANBAN_COLS.map((col) => (
                        <KanbanColumn
                          key={col.id}
                          col={col}
                          orders={ordersByStatus[col.id] ?? []}
                          containerRef={containerRef}
                          columnRefs={columnRefs}
                          onDrop={moveOrder}
                          onCardClick={setSelected}
                        />
                      ))
                  }
                </motion.div>
              ) : (
                <motion.div key="table" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
                  <DataTable<CommandeRecord>
                    columns={TABLE_COLS}
                    data={orders}
                    keyField="id"
                    onRowClick={setSelected}
                    loading={isLoading}
                  />
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        ) : (
          <motion.div key="web" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
            <CommandesWebPage />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Détail commande */}
      {selected && <OrderDetail order={selected} onClose={() => setSelected(null)} />}

      {/* ── Slide-over : Nouvelle commande ───────────────────────────────────── */}
      <SlideOver isOpen={cmdSlide} onClose={() => setCmdSlide(false)} title="Nouvelle commande ERP" width="lg">
        <div className="space-y-5">

          {/* Client */}
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2 sm:col-span-1">
              <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">Nom du client *</label>
              <div className="relative">
                <input
                  value={cmdForm.client_nom}
                  onChange={(e) => {
                    setCmdForm((f) => ({ ...f, client_nom: e.target.value }))
                    setSelectedClient(null)
                    setClientDropdownOpen(true)
                  }}
                  onFocus={() => setClientDropdownOpen(true)}
                  onBlur={() => setTimeout(() => setClientDropdownOpen(false), 150)}
                  placeholder="ex. CAMRAIL SA"
                  className="w-full px-3 py-2.5 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C62828]"
                  style={{ borderColor: selectedClient?.statut === 'bloque' ? '#dc2626' : '#e5e7eb' }}
                />
                {clientDropdownOpen && filteredClients.length > 0 && (
                  <div className="absolute z-50 left-0 right-0 top-full mt-1 bg-white rounded-xl border border-gray-200 shadow-xl max-h-52 overflow-y-auto">
                    {filteredClients.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => {
                          setSelectedClient(c)
                          setCmdForm((f) => ({ ...f, client_nom: c.nom }))
                          setClientDropdownOpen(false)
                        }}
                        className="flex items-center justify-between w-full px-3 py-2.5 text-sm hover:bg-gray-50 transition-colors border-b border-gray-50 last:border-0"
                      >
                        <span className="font-medium text-[#212121] truncate">{c.nom}</span>
                        {c.statut === 'bloque' ? (
                          <span className="flex items-center gap-1 text-[10px] font-bold text-red-600 bg-red-50 px-1.5 py-0.5 rounded-full ml-2 shrink-0">
                            <OctagonX className="h-2.5 w-2.5" /> Bloqué
                          </span>
                        ) : c.statut === 'inactif' ? (
                          <span className="text-[10px] font-medium text-amber-500 bg-amber-50 px-1.5 py-0.5 rounded-full ml-2 shrink-0">Inactif</span>
                        ) : null}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">Téléphone</label>
              <input
                value={cmdForm.client_telephone}
                onChange={(e) => setCmdForm((f) => ({ ...f, client_telephone: e.target.value }))}
                placeholder="+237 6XX XXX XXX"
                className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C62828]"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">
                <span className="flex items-center gap-1"><CalendarDays className="h-3 w-3" /> Livraison prévue</span>
              </label>
              <input
                type="date"
                value={cmdForm.date_livraison_prevue}
                onChange={(e) => setCmdForm((f) => ({ ...f, date_livraison_prevue: e.target.value }))}
                className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C62828]"
              />
            </div>
          </div>

          {/* Alerte client bloqué */}
          {selectedClient?.statut === 'bloque' && (
            <div className="flex items-start gap-2.5 px-3 py-3 bg-red-50 border border-red-300 rounded-xl">
              <OctagonX className="h-4 w-4 text-red-600 shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-bold text-red-700">Client bloqué — commande impossible</p>
                <p className="text-xs text-red-500 mt-0.5">
                  Débloquez ce client dans sa fiche avant de pouvoir créer une commande.
                </p>
              </div>
            </div>
          )}

          {/* Lignes de commande */}
          <div className="border-t border-gray-100 pt-4">
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs font-semibold text-gray-500 uppercase">Articles commandés *</p>
              <button
                onClick={() => setShowCatalogue(true)}
                className="flex items-center gap-1.5 text-xs font-medium text-[#C62828] hover:bg-red-50 px-2.5 py-1.5 rounded-lg border border-[#C62828]/30 transition-colors"
              >
                <BookOpen className="h-3.5 w-3.5" />
                Catalogue TAFDIL Shop
              </button>
            </div>

            <div className="space-y-2">
              {cmdForm.lignes.map((ligne, idx) => (
                <div key={idx} className="rounded-lg border border-gray-100 bg-gray-50 p-3 space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-gray-400 w-5 shrink-0">#{idx + 1}</span>
                    <input
                      value={ligne.designation}
                      onChange={(e) => updateLigne(idx, { designation: e.target.value })}
                      placeholder="Désignation de l'article *"
                      className="flex-1 px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-[#C62828]"
                    />
                    {cmdForm.lignes.length > 1 && (
                      <button
                        onClick={() => removeLigne(idx)}
                        className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                  <div className="grid grid-cols-3 gap-2 pl-7">
                    <div>
                      <label className="block text-[10px] font-medium text-gray-400 mb-1">Qté *</label>
                      <input
                        type="number" min="0.001" step="any"
                        value={ligne.quantite}
                        onChange={(e) => updateLigne(idx, { quantite: Number(e.target.value) })}
                        className="w-full px-2.5 py-1.5 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-[#C62828]"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-medium text-gray-400 mb-1">Unité</label>
                      <input
                        value={ligne.unite}
                        onChange={(e) => updateLigne(idx, { unite: e.target.value })}
                        placeholder="unité"
                        className="w-full px-2.5 py-1.5 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-[#C62828]"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-medium text-gray-400 mb-1">P.U. HT (FCFA)</label>
                      <input
                        type="number" min="0"
                        value={ligne.prix_unitaire_ht_xaf}
                        onChange={(e) => updateLigne(idx, { prix_unitaire_ht_xaf: Number(e.target.value) })}
                        className="w-full px-2.5 py-1.5 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-[#C62828]"
                      />
                    </div>
                  </div>
                  {ligne.designation && ligne.quantite > 0 && ligne.prix_unitaire_ht_xaf > 0 && (
                    <p className="pl-7 text-xs text-gray-500">
                      Sous-total HT : <span className="font-semibold text-[#212121]">{formatXAF(ligne.quantite * ligne.prix_unitaire_ht_xaf)}</span>
                    </p>
                  )}
                </div>
              ))}
            </div>

            <button
              onClick={addLigne}
              className="mt-2 flex items-center gap-1.5 text-xs font-medium text-gray-500 hover:text-[#C62828] transition-colors"
            >
              <Plus className="h-3.5 w-3.5" /> Ajouter une ligne
            </button>
          </div>

          {/* Résumé total */}
          {formTotalHT > 0 && (
            <div className="bg-gray-50 rounded-lg px-3 py-2.5 space-y-1">
              <div className="flex justify-between text-xs text-gray-500">
                <span>Total HT</span>
                <span className="font-semibold text-[#212121]">{formatXAF(formTotalHT)}</span>
              </div>
              <div className="flex justify-between text-xs text-gray-500">
                <span>TVA 19.25%</span>
                <span>{formatXAF(Math.round(formTotalHT * 0.1925))}</span>
              </div>
              <div className="flex justify-between text-sm font-bold text-[#212121] border-t border-gray-200 pt-1">
                <span>Total TTC</span>
                <span>{formatXAF(formTTC)}</span>
              </div>
            </div>
          )}

          {/* Notes */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">Notes internes</label>
            <textarea
              value={cmdForm.notes}
              onChange={(e) => setCmdForm((f) => ({ ...f, notes: e.target.value }))}
              rows={2}
              placeholder="Instructions de livraison, spécifications particulières…"
              className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C62828] resize-none"
            />
          </div>

          {/* Info pipeline */}
          <div className="flex items-center gap-2 rounded-lg bg-blue-50 border border-blue-100 px-3 py-2">
            <Info className="h-3.5 w-3.5 text-blue-500 shrink-0" />
            <p className="text-xs text-blue-700">
              La commande démarrera au statut <strong>Confirmée</strong>.
              Avancement ensuite : <span className="inline-flex items-center gap-0.5">Confirmée <ChevronRight className="h-3 w-3" /> En Production <ChevronRight className="h-3 w-3" /> Prête <ChevronRight className="h-3 w-3" /> Livrée</span>
            </p>
          </div>

          {/* Actions */}
          <div className="flex gap-3 pt-2 border-t border-gray-100">
            <Button variant="ghost" className="flex-1" onClick={() => { setCmdSlide(false); setCmdForm(DEFAULT_CMD); setSelectedClient(null) }}>Annuler</Button>
            <Button className="flex-1" disabled={!canSubmit} onClick={handleCreateCommande}>
              {createCommande.isPending ? 'Création…' : 'Créer la commande'}
            </Button>
          </div>
        </div>
      </SlideOver>

      {/* Catalogue modal */}
      <CatalogueShopModal
        isOpen={showCatalogue}
        onClose={() => setShowCatalogue(false)}
        onSelect={(p) => {
          addProduitFromCatalogue(p)
          toast.success(`"${p.nom}" ajouté à la commande`)
        }}
      />

      {/* Confirmation annulation */}
      <Modal isOpen={!!pendingMove} onClose={() => setPendingMove(null)} title="Confirmer l'annulation" size="sm">
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            Êtes-vous sûr de vouloir annuler cette commande ? Cette action est difficile à défaire.
          </p>
          <div className="flex gap-2 justify-end">
            <Button variant="ghost" onClick={() => setPendingMove(null)}>Retour</Button>
            <Button
              onClick={() => {
                if (!pendingMove) return
                statutMutation.mutate({ id: pendingMove.orderId, statut: pendingMove.colId }, {
                  onSuccess: () => { toast.success('Commande annulée'); setPendingMove(null) },
                })
              }}
              disabled={statutMutation.isPending}
            >
              Confirmer l'annulation
            </Button>
          </div>
        </div>
      </Modal>
    </motion.div>
  )
}
