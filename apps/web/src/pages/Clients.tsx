import React from 'react'
import { motion } from 'framer-motion'
import { useNavigate } from 'react-router-dom'
import { Plus, Eye, Phone, Building2, User, Landmark } from 'lucide-react'
import { PageHeader, DataTable, StatusBadge, Button } from '@forge/ui'
import type { Column } from '@forge/ui'
import { formatXAF } from '@/lib/utils'
import { useClients } from '@/hooks/useClients'
import type { Client as ClientApi } from '@/hooks/useClients'

// ── Types ──────────────────────────────────────────────────────────────────────

export type ClientType = 'entreprise' | 'particulier' | 'institution'
export type Client = ClientApi & Record<string, unknown>

// ── Score component ────────────────────────────────────────────────────────────

export function ScoreFiabilite({ score }: { score: number }) {
  const color = score >= 80 ? '#15803d' : score >= 50 ? '#d97706' : '#dc2626'
  const bg    = score >= 80 ? '#dcfce7' : score >= 50 ? '#fef3c7' : '#fee2e2'

  return (
    <div className="flex items-center gap-2 min-w-[80px]">
      <div className="flex-1 h-1.5 rounded-full bg-gray-100 overflow-hidden">
        <div className="h-full rounded-full transition-all" style={{ width: `${score}%`, backgroundColor: color }} />
      </div>
      <span className="text-xs font-bold px-1.5 py-0.5 rounded-full shrink-0" style={{ color, backgroundColor: bg }}>
        {score}
      </span>
    </div>
  )
}

// ── Type icon ─────────────────────────────────────────────────────────────────

const TYPE_ICONS: Record<ClientType, React.ElementType> = {
  entreprise: Building2, particulier: User, institution: Landmark,
}

const TYPE_LABELS: Record<ClientType, string> = {
  entreprise: 'Entreprise', particulier: 'Particulier', institution: 'Institution',
}

// ── Table columns ─────────────────────────────────────────────────────────────

function buildColumns(navigate: ReturnType<typeof useNavigate>): Column<Client>[] {
  return [
    {
      id: 'nom', header: 'Client', accessor: 'nom',
      render: (v, row) => {
        const Icon = TYPE_ICONS[row.type as ClientType]
        return (
          <div className="flex items-center gap-2.5">
            <div className="flex items-center justify-center w-8 h-8 rounded-full bg-[#ECEFF1] text-[#37474F] shrink-0">
              <Icon className="h-3.5 w-3.5" />
            </div>
            <div>
              <div className="text-sm font-semibold text-[#212121]">{v as string}</div>
              <div className="text-xs text-gray-400">{TYPE_LABELS[row.type as ClientType]}</div>
            </div>
          </div>
        )
      },
    },
    {
      id: 'telephone', header: 'Téléphone', accessor: 'telephone',
      render: (v) => (
        <a href={`tel:${v}`} className="flex items-center gap-1 text-sm text-gray-600 hover:text-[#C62828] transition-colors" onClick={(e) => e.stopPropagation()}>
          <Phone className="h-3 w-3" />{v as string}
        </a>
      ),
    },
    {
      id: 'commandes', header: 'Commandes', accessor: 'commandes_count',
      render: (v) => <span className="text-sm font-semibold">{v as number}</span>,
    },
    {
      id: 'encours', header: 'Encours crédit', accessor: 'encours_credit_xaf',
      render: (v) => {
        const amt = v as number
        return <span className="text-sm font-semibold" style={{ color: amt > 0 ? '#dc2626' : '#15803d' }}>{amt > 0 ? formatXAF(amt) : '—'}</span>
      },
    },
    {
      id: 'ca', header: 'CA Total', accessor: 'total_ca_xaf',
      render: (v) => <span className="text-sm font-semibold">{formatXAF(v as number)}</span>,
    },
    {
      id: 'score', header: 'Fiabilité', accessor: 'score_fiabilite',
      render: (v) => <ScoreFiabilite score={v as number} />,
    },
    {
      id: 'statut', header: 'Statut', accessor: 'statut',
      render: (v) => <StatusBadge status={v as string} />,
    },
    {
      id: 'actions', header: '', accessor: 'id', sortable: false,
      render: (_, row) => (
        <button
          onClick={(e) => { e.stopPropagation(); navigate(`/clients/${row.id}`) }}
          className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-lg
            border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors"
        >
          <Eye className="h-3 w-3" /> Fiche
        </button>
      ),
    },
  ]
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function Clients() {
  const navigate = useNavigate()
  const { data, isLoading } = useClients()

  const clients  = (data?.data ?? []) as Client[]
  const caTotal  = clients.reduce((s, c) => s + (c.total_ca_xaf as number), 0)
  const columns  = buildColumns(navigate)

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3 }}
      className="space-y-6"
    >
      <PageHeader
        title="Clients"
        subtitle={`${data?.total ?? 0} clients · ${formatXAF(caTotal)} de CA cumulé`}
        breadcrumbs={[{ label: 'FORGE', href: '/' }, { label: 'Clients' }]}
        actions={
          <Button size="sm">
            <Plus className="h-3.5 w-3.5" /> Nouveau client
          </Button>
        }
      />

      <DataTable<Client>
        columns={columns}
        data={clients}
        keyField="id"
        onRowClick={(row) => navigate(`/clients/${row.id}`)}
        loading={isLoading}
      />
    </motion.div>
  )
}
