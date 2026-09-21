import React, { useState, useEffect, useRef } from 'react'
import { motion } from 'framer-motion'
import {
  ShoppingBag, Clock, CheckCircle, TrendingUp, Search,
  RefreshCw, Wifi, WifiOff,
} from 'lucide-react'
import { DataTable, StatusBadge, Button } from '@forge/ui'
import type { Column } from '@forge/ui'
import { toast } from 'sonner'
import { formatXAF, formatDateTime } from '@/lib/utils'
import { supabase } from '@/lib/supabase'
import { useCommandesShop } from '@/hooks/useCommandesShop'
import { CommandesWebDetail } from './CommandesWebDetail'
import type { CommandeShop, StatutCommandeShop, StatutPaiement } from '@/hooks/useCommandesShop'
import { useQueryClient } from '@tanstack/react-query'

// ── Types ──────────────────────────────────────────────────────────────────────

type CommandeShopRecord = CommandeShop & Record<string, unknown>

// ── KPI Card ──────────────────────────────────────────────────────────────────

interface KpiProps {
  label: string
  value: string | number
  icon: React.ElementType
  color: string
  badge?: boolean
}

function KpiCard({ label, value, icon: Icon, color, badge }: KpiProps) {
  return (
    <div className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-xs font-medium text-gray-400">{label}</span>
        <div className="relative rounded-lg p-2" style={{ backgroundColor: `${color}15` }}>
          <Icon size={16} style={{ color }} />
          {badge && (
            <span className="absolute -right-1 -top-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-[#C62828] text-[9px] font-bold text-white">
              !
            </span>
          )}
        </div>
      </div>
      <p className="text-xl font-bold text-[#212121]">{value}</p>
    </div>
  )
}

// ── Colonnes DataTable ────────────────────────────────────────────────────────

const LABELS_PAIEMENT: Record<string, string> = {
  en_attente: 'En attente', paye: 'Payé', echec: 'Échec', rembourse: 'Remboursé',
}
const COLORS_PAIEMENT: Record<string, string> = {
  en_attente: '#d97706', paye: '#15803d', echec: '#dc2626', rembourse: '#6b7280',
}

const TABLE_COLS: Column<CommandeShopRecord>[] = [
  {
    id: 'ref', header: 'Référence', accessor: 'ref',
    render: (v) => <span className="font-mono text-xs font-semibold text-[#C62828]">{v as string}</span>,
  },
  {
    id: 'client', header: 'Client', accessor: 'client_nom',
    render: (v, row) => (
      <div>
        <p className="text-sm font-medium text-[#212121]">{v as string}</p>
        <p className="text-xs text-gray-400">{(row as CommandeShop).client_telephone}</p>
      </div>
    ),
  },
  {
    id: 'montant_ttc', header: 'Montant TTC', accessor: 'montant_ttc',
    render: (v) => <span className="font-semibold">{formatXAF(v as number)}</span>,
  },
  {
    id: 'statut_paiement', header: 'Paiement', accessor: 'statut_paiement',
    render: (v) => (
      <span
        className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold"
        style={{
          backgroundColor: `${COLORS_PAIEMENT[v as string]}20`,
          color: COLORS_PAIEMENT[v as string],
        }}
      >
        {LABELS_PAIEMENT[v as string] ?? v as string}
      </span>
    ),
  },
  {
    id: 'statut_commande', header: 'Statut', accessor: 'statut_commande',
    render: (v) => <StatusBadge status={v as string} />,
  },
  {
    id: 'created_at', header: 'Date', accessor: 'created_at',
    render: (v) => <span className="text-xs text-gray-400">{formatDateTime(v as string)}</span>,
  },
]

// ── Filtres ───────────────────────────────────────────────────────────────────

const FILTRES_STATUT_COMMANDE: { value: StatutCommandeShop | 'tous'; label: string }[] = [
  { value: 'tous',          label: 'Tous statuts'    },
  { value: 'recue',         label: 'Reçues'          },
  { value: 'confirmee',     label: 'Confirmées'      },
  { value: 'en_preparation',label: 'En préparation'  },
  { value: 'expediee',      label: 'Expédiées'       },
  { value: 'livree',        label: 'Livrées'         },
  { value: 'annulee',       label: 'Annulées'        },
]

const FILTRES_PAIEMENT: { value: StatutPaiement | 'tous'; label: string }[] = [
  { value: 'tous',       label: 'Tout paiement' },
  { value: 'en_attente', label: 'En attente'    },
  { value: 'paye',       label: 'Payé'          },
  { value: 'echec',      label: 'Échec'         },
]

// ── Page ───────────────────────────────────────────────────────────────────────

export function CommandesWebPage() {
  const [search, setSearch]               = useState('')
  const [filtreStatut, setFiltreStatut]   = useState<StatutCommandeShop | 'tous'>('tous')
  const [filtrePaiement, setFiltrePaiement] = useState<StatutPaiement | 'tous'>('tous')
  const [selected, setSelected]           = useState<CommandeShop | null>(null)
  const [realtimeOk, setRealtimeOk]       = useState(true)
  const audioCtx = useRef<AudioContext | null>(null)
  const qc = useQueryClient()

  const { data, isLoading, refetch } = useCommandesShop({
    statut_commande: filtreStatut,
    statut_paiement: filtrePaiement,
    search,
  })

  const commandes = (data?.data ?? []) as CommandeShopRecord[]
  const stats     = data?.stats

  // ── Son de notification ──────────────────────────────────────────────────────

  const playBeep = () => {
    try {
      if (!audioCtx.current) audioCtx.current = new AudioContext()
      const ctx  = audioCtx.current
      const osc  = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.frequency.setValueAtTime(880, ctx.currentTime)
      gain.gain.setValueAtTime(0.3, ctx.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4)
      osc.start(ctx.currentTime)
      osc.stop(ctx.currentTime + 0.4)
    } catch {
      // AudioContext non disponible (pas critique)
    }
  }

  // ── Realtime Supabase ────────────────────────────────────────────────────────

  useEffect(() => {
    const channel = supabase
      .channel('commandes_web_nouvelles')
      .on('broadcast', { event: 'nouvelle_commande_web' }, ({ payload }) => {
        playBeep()
        toast.success(`Nouvelle commande web : ${payload.ref} — ${formatXAF(payload.montant_ttc)}`, {
          duration: 8000,
          action: { label: 'Voir', onClick: () => void refetch() },
        })
        void qc.invalidateQueries({ queryKey: ['commandes-shop'] })
      })
      .on('broadcast', { event: 'nouvelle_demande_devis' }, ({ payload }) => {
        toast.info(`Nouvelle demande de devis : ${payload.nom} (${payload.telephone})`, { duration: 6000 })
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'commandes_shop' }, () => {
        void qc.invalidateQueries({ queryKey: ['commandes-shop'] })
      })
      .subscribe((status) => {
        setRealtimeOk(status === 'SUBSCRIBED')
      })

    return () => { void supabase.removeChannel(channel) }
  }, [qc, refetch])

  return (
    <div className="space-y-5">

      {/* En-tête statuts realtime */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiCard
          label="Nouvelles ce jour"
          value={stats?.nouvelles_ce_jour ?? 0}
          icon={ShoppingBag}
          color="#C62828"
          badge={(stats?.nouvelles_ce_jour ?? 0) > 0}
        />
        <KpiCard
          label="Attente paiement"
          value={stats?.en_attente_paiement ?? 0}
          icon={Clock}
          color="#d97706"
        />
        <KpiCard
          label="Confirmées (payées)"
          value={stats?.confirmees ?? 0}
          icon={CheckCircle}
          color="#15803d"
        />
        <KpiCard
          label="CA web ce mois"
          value={formatXAF(stats?.ca_web_mois ?? 0)}
          icon={TrendingUp}
          color="#1d4ed8"
        />
      </div>

      {/* Barre filtres */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Recherche */}
        <div className="relative flex-1 min-w-[180px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Référence ou client…"
            className="w-full rounded-lg border border-gray-200 bg-white py-2 pl-9 pr-3 text-sm outline-none focus:border-[#C62828] focus:ring-1 focus:ring-[#C62828]/20"
          />
        </div>

        {/* Filtre statut commande */}
        <select
          value={filtreStatut}
          onChange={(e) => setFiltreStatut(e.target.value as StatutCommandeShop | 'tous')}
          className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-[#C62828]"
        >
          {FILTRES_STATUT_COMMANDE.map((f) => (
            <option key={f.value} value={f.value}>{f.label}</option>
          ))}
        </select>

        {/* Filtre paiement */}
        <select
          value={filtrePaiement}
          onChange={(e) => setFiltrePaiement(e.target.value as StatutPaiement | 'tous')}
          className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-[#C62828]"
        >
          {FILTRES_PAIEMENT.map((f) => (
            <option key={f.value} value={f.value}>{f.label}</option>
          ))}
        </select>

        {/* Realtime indicator + refresh */}
        <div className="ml-auto flex items-center gap-2">
          <span className="flex items-center gap-1.5 text-xs text-gray-400">
            {realtimeOk
              ? <Wifi size={12} className="text-green-500" />
              : <WifiOff size={12} className="text-red-400" />
            }
            {realtimeOk ? 'Temps réel' : 'Hors ligne'}
          </span>
          <Button size="sm" variant="secondary" onClick={() => void refetch()}>
            <RefreshCw size={13} />
          </Button>
        </div>
      </div>

      {/* Table */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.2 }}
      >
        <DataTable<CommandeShopRecord>
          columns={TABLE_COLS}
          data={commandes}
          keyField="id"
          onRowClick={(row) => setSelected(row as CommandeShop)}
          loading={isLoading}
          emptyMessage="Aucune commande web pour ces critères."
        />
      </motion.div>

      {/* SlideOver détail */}
      {selected && (
        <CommandesWebDetail commande={selected} onClose={() => setSelected(null)} />
      )}
    </div>
  )
}
