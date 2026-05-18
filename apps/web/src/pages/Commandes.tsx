import React, { useState, useRef, useEffect, useMemo } from 'react'
import { motion, AnimatePresence, useDragControls } from 'framer-motion'
import { LayoutGrid, Table2, Plus, GripVertical, Globe } from 'lucide-react'
import { PageHeader, DataTable, StatusBadge, SlideOver, Button, Modal } from '@forge/ui'
import type { Column } from '@forge/ui'
import { formatXAF, formatDate } from '@/lib/utils'
import { toast } from 'sonner'
import { useCommandes, useStatutCommande } from '@/hooks/useCommandes'
import type { Commande, CommandeLigne, CommandeHistorique } from '@/hooks/useCommandes'
import { useCommandesShop } from '@/hooks/useCommandesShop'
import { CommandesWebPage } from './commandes/CommandesWebPage'
import { supabase } from '@/lib/supabase'

// ── Types ──────────────────────────────────────────────────────────────────────

type KanbanCol = 'confirmed' | 'in_production' | 'pret' | 'delivered' | 'cancelled'
type CommandeRecord = Commande & Record<string, unknown>

// ── Kanban config ─────────────────────────────────────────────────────────────

const KANBAN_COLS: { id: KanbanCol; label: string; color: string }[] = [
  { id: 'confirmed',     label: 'Confirmée',      color: '#1d4ed8' },
  { id: 'in_production', label: 'En Production',  color: '#d97706' },
  { id: 'pret',          label: 'Prête à Livrer', color: '#7c3aed' },
  { id: 'delivered',     label: 'Livrée',          color: '#15803d' },
  { id: 'cancelled',     label: 'Annulée',         color: '#6b7280' },
]

const STATUS_LABELS: Record<KanbanCol, string> = {
  confirmed: 'Confirmée', in_production: 'En Production',
  pret: 'Prête à Livrer', delivered: 'Livrée', cancelled: 'Annulée',
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
      <div className="flex items-start justify-between gap-2 mb-2">
        <span className="text-xs font-mono text-gray-400">{order.reference}</span>
        <GripVertical className="h-3.5 w-3.5 text-gray-300 shrink-0" />
      </div>
      <p className="text-sm font-semibold text-[#212121] mb-1">{order.client.nom}</p>
      <p className="text-base font-bold text-[#212121]">{formatXAF(order.montant_ttc_xaf)}</p>
      <div className="flex items-center justify-between mt-2.5">
        <span className="text-xs text-gray-400">{formatDate(order.date_commande)}</span>
        <StatusBadge status={order.statut} />
      </div>
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
    <div
      ref={(el) => { columnRefs.current[col.id] = el }}
      className="flex flex-col gap-2 min-w-[240px] w-[240px]"
    >
      <div className="flex items-center gap-2 px-1 mb-1">
        <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: col.color }} />
        <span className="text-xs font-semibold text-[#212121]">{col.label}</span>
        <span
          className="ml-auto flex items-center justify-center w-5 h-5 rounded-full text-white text-xs font-bold"
          style={{ backgroundColor: col.color }}
        >
          {orders.length}
        </span>
      </div>
      <div className="text-xs text-gray-400 px-1 -mt-1 mb-1">{formatXAF(total)}</div>
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
  { id: 'reference',       header: 'Référence',   accessor: 'reference',           render: (v) => <span className="font-mono text-xs">{v as string}</span> },
  { id: 'client',          header: 'Client',       accessor: (r) => r.client.nom,   render: (v) => <span className="font-medium text-sm">{v as string}</span> },
  { id: 'montant_ttc_xaf', header: 'Montant TTC', accessor: 'montant_ttc_xaf',     render: (v) => <span className="font-semibold">{formatXAF(v as number)}</span> },
  { id: 'date_commande',   header: 'Date',         accessor: 'date_commande',       render: (v) => <span className="text-xs text-gray-500">{formatDate(v as string)}</span> },
  { id: 'statut',          header: 'Statut',       accessor: 'statut',              render: (v) => <StatusBadge status={v as string} /> },
]

// ── OrderDetail (ERP) ──────────────────────────────────────────────────────────

function OrderDetail({ order, onClose }: { order: CommandeRecord; onClose: () => void }) {
  const totalHT = (order.lignes as CommandeLigne[]).reduce((s, l) => s + l.quantite * l.prix_unitaire_ht_xaf, 0)
  const tva = totalHT * 0.1925
  const ttc = totalHT + tva

  return (
    <SlideOver isOpen={true} onClose={onClose} title={`Commande ${order.reference}`} width="lg">
      <div className="space-y-6">
        <div>
          <h3 className="text-xs font-semibold text-gray-400 uppercase mb-2">Client</h3>
          <p className="text-sm font-semibold text-[#212121]">{order.client.nom}</p>
          <p className="text-sm text-gray-500">{order.client.telephone}</p>
        </div>

        <div>
          <h3 className="text-xs font-semibold text-gray-400 uppercase mb-2">Lignes de commande</h3>
          <div className="border border-gray-100 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead style={{ backgroundColor: '#C62828' }}>
                <tr>
                  {['Désignation', 'Qté', 'P.U.', 'Total HT'].map((h) => (
                    <th key={h} className="px-3 py-2 text-left text-xs font-semibold text-white">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {(order.lignes as CommandeLigne[]).map((l, i) => (
                  <tr key={i}>
                    <td className="px-3 py-2">{l.designation}</td>
                    <td className="px-3 py-2 text-center">{l.quantite}</td>
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
            </div>
          </div>
        </div>

        <div>
          <h3 className="text-xs font-semibold text-gray-400 uppercase mb-2">Historique</h3>
          <div className="space-y-2">
            {(order.historique as CommandeHistorique[]).map((h, i) => (
              <div key={i} className="flex items-center gap-3">
                <div className="flex flex-col items-center">
                  <div className="w-2 h-2 rounded-full bg-[#C62828]" />
                  {i < (order.historique as CommandeHistorique[]).length - 1 && <div className="w-px h-4 bg-gray-200" />}
                </div>
                <div className="flex-1 pb-1">
                  <span className="text-xs font-medium text-[#212121]">{STATUS_LABELS[h.statut as KanbanCol] ?? h.statut}</span>
                  <span className="text-xs text-gray-400 ml-2">· {formatDate(h.created_at)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="pt-2 border-t border-gray-100">
          <Button className="w-full" onClick={onClose}>Fermer</Button>
        </div>
      </div>
    </SlideOver>
  )
}

// ── Page ───────────────────────────────────────────────────────────────────────

type Tab = 'erp' | 'web'

export default function Commandes() {
  const [tab, setTab]         = useState<Tab>('erp')
  const [view, setView]       = useState<'kanban' | 'table'>('kanban')
  const [selected, setSelected] = useState<CommandeRecord | null>(null)
  const containerRef  = useRef<HTMLDivElement>(null)
  const columnRefs    = useRef<Record<string, HTMLDivElement | null>>({})

  const { data, isLoading, isError } = useCommandes()
  const statutMutation = useStatutCommande()

  // Badge commandes web (nouvelles non traitées)
  const { data: shopData } = useCommandesShop()
  const webBadge = shopData?.stats?.nouvelles_ce_jour ?? 0

  const orders = (data?.data ?? []) as CommandeRecord[]

  const [pendingMove, setPendingMove] = useState<{ orderId: string; colId: KanbanCol } | null>(null)

  const moveOrder = (orderId: string, colId: KanbanCol) => {
    if (colId === 'cancelled') {
      setPendingMove({ orderId, colId })
      return
    }
    statutMutation.mutate({ id: orderId, statut: colId }, {
      onSuccess: () => toast.success('Statut mis à jour'),
    })
  }

  const ordersByStatus = useMemo(
    () => Object.fromEntries(
      KANBAN_COLS.map((col) => [col.id, orders.filter((o) => o.statut === col.id)])
    ) as Record<KanbanCol, CommandeRecord[]>,
    [orders]
  )

  const totalErp = useMemo(() => orders.reduce((s, o) => s + o.montant_ttc_xaf, 0), [orders])

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
            : 'Commandes reçues depuis FORGE Shop'
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
              <Button size="sm">
                <Plus className="h-3.5 w-3.5" /> Nouvelle commande
              </Button>
            </>
          ) : null
        }
      />

      {/* Onglets */}
      <div className="flex items-center gap-1 border-b border-gray-200">
        <button
          onClick={() => setTab('erp')}
          className={`relative flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors ${
            tab === 'erp'
              ? 'text-[#C62828] after:absolute after:bottom-0 after:left-0 after:h-0.5 after:w-full after:bg-[#C62828]'
              : 'text-gray-500 hover:text-[#212121]'
          }`}
        >
          Commandes ERP
          <span className="rounded-full bg-gray-100 px-1.5 py-0.5 text-xs font-semibold text-gray-600">
            {orders.length}
          </span>
        </button>
        <button
          onClick={() => setTab('web')}
          className={`relative flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors ${
            tab === 'web'
              ? 'text-[#C62828] after:absolute after:bottom-0 after:left-0 after:h-0.5 after:w-full after:bg-[#C62828]'
              : 'text-gray-500 hover:text-[#212121]'
          }`}
        >
          <Globe size={14} />
          Commandes Web
          {webBadge > 0 && (
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[#C62828] text-xs font-bold text-white">
              {webBadge > 9 ? '9+' : webBadge}
            </span>
          )}
        </button>
      </div>

      {/* Contenu */}
      <AnimatePresence mode="wait">
        {tab === 'erp' ? (
          <motion.div
            key="erp"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            {isError && (
              <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
                Impossible de charger les commandes. Veuillez réessayer.
              </div>
            )}
            <AnimatePresence mode="wait">
              {view === 'kanban' ? (
                <motion.div
                  key="kanban"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  ref={containerRef}
                  className="flex gap-4 overflow-x-auto pb-4"
                >
                  {isLoading ? (
                    KANBAN_COLS.map((col) => (
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
                  ) : (
                    KANBAN_COLS.map((col) => (
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
                  )}
                </motion.div>
              ) : (
                <motion.div
                  key="table"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.2 }}
                >
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
          <motion.div
            key="web"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            <CommandesWebPage />
          </motion.div>
        )}
      </AnimatePresence>

      {selected && <OrderDetail order={selected} onClose={() => setSelected(null)} />}

      <Modal
        isOpen={!!pendingMove}
        onClose={() => setPendingMove(null)}
        title="Confirmer l'annulation"
        size="sm"
      >
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
