import React from 'react'
import { motion } from 'framer-motion'
import { useNavigate } from 'react-router-dom'
import { Plus, Eye, Phone, Building2, User, Landmark } from 'lucide-react'
import { PageHeader, DataTable, StatusBadge, Button } from '@forge/ui'
import type { Column } from '@forge/ui'
import { formatXAF } from '@/lib/utils'

// ── Types ──────────────────────────────────────────────────────────────────────

export type ClientType = 'entreprise' | 'particulier' | 'institution'

export interface Client extends Record<string, unknown> {
  id: string
  nom: string
  type: ClientType
  telephone: string
  email: string
  adresse: string
  commandesCount: number
  encoursCreditXAF: number
  totalCAXAF: number
  scoreFiabilite: number
  statut: 'actif' | 'inactif' | 'bloque'
}

// ── Mock data ──────────────────────────────────────────────────────────────────

export const CLIENTS: Client[] = [
  { id: '1', nom: 'SODECOTON', type: 'entreprise', telephone: '+237 699 001 001', email: 'achat@sodecoton.cm', adresse: 'Garoua, Cameroun', commandesCount: 12, encoursCreditXAF: 0, totalCAXAF: 4250000, scoreFiabilite: 95, statut: 'actif' },
  { id: '2', nom: 'CAMRAIL SA', type: 'entreprise', telephone: '+237 222 300 000', email: 'logistique@camrail.net', adresse: 'Douala, Cameroun', commandesCount: 8, encoursCreditXAF: 0, totalCAXAF: 6800000, scoreFiabilite: 98, statut: 'actif' },
  { id: '3', nom: 'Fouda Jean', type: 'particulier', telephone: '+237 677 234 567', email: 'fouda.jean@gmail.com', adresse: 'Yaoundé, Cameroun', commandesCount: 3, encoursCreditXAF: 180000, totalCAXAF: 520000, scoreFiabilite: 42, statut: 'actif' },
  { id: '4', nom: 'MAETUR', type: 'institution', telephone: '+237 222 200 400', email: 'daf@maetur.cm', adresse: 'Yaoundé, Cameroun', commandesCount: 5, encoursCreditXAF: 0, totalCAXAF: 3100000, scoreFiabilite: 88, statut: 'actif' },
  { id: '5', nom: 'Biyong & Fils', type: 'entreprise', telephone: '+237 655 876 543', email: 'biyong.fils@yahoo.fr', adresse: 'Douala, Cameroun', commandesCount: 6, encoursCreditXAF: 75000, totalCAXAF: 1850000, scoreFiabilite: 71, statut: 'actif' },
  { id: '6', nom: 'CDE Cameroun', type: 'institution', telephone: '+237 222 222 222', email: 'dg@cde.cm', adresse: 'Douala, Cameroun', commandesCount: 4, encoursCreditXAF: 0, totalCAXAF: 8200000, scoreFiabilite: 100, statut: 'actif' },
  { id: '7', nom: 'Nguema Paul', type: 'particulier', telephone: '+237 691 234 000', email: '', adresse: 'Douala, Cameroun', commandesCount: 2, encoursCreditXAF: 0, totalCAXAF: 285000, scoreFiabilite: 65, statut: 'actif' },
  { id: '8', nom: 'Essomba Marie', type: 'particulier', telephone: '+237 677 000 111', email: 'm.essomba@gmail.com', adresse: 'Douala, Cameroun', commandesCount: 1, encoursCreditXAF: 0, totalCAXAF: 50000, scoreFiabilite: 55, statut: 'inactif' },
]

// ── Score component ────────────────────────────────────────────────────────────

export function ScoreFiabilite({ score }: { score: number }) {
  const color = score >= 80 ? '#15803d' : score >= 50 ? '#d97706' : '#dc2626'
  const bg = score >= 80 ? '#dcfce7' : score >= 50 ? '#fef3c7' : '#fee2e2'

  return (
    <div className="flex items-center gap-2 min-w-[80px]">
      <div className="flex-1 h-1.5 rounded-full bg-gray-100 overflow-hidden">
        <div className="h-full rounded-full transition-all" style={{ width: `${score}%`, backgroundColor: color }} />
      </div>
      <span
        className="text-xs font-bold px-1.5 py-0.5 rounded-full shrink-0"
        style={{ color, backgroundColor: bg }}
      >
        {score}
      </span>
    </div>
  )
}

// ── Type icon ─────────────────────────────────────────────────────────────────

const TYPE_ICONS: Record<ClientType, React.ElementType> = {
  entreprise: Building2,
  particulier: User,
  institution: Landmark,
}

const TYPE_LABELS: Record<ClientType, string> = {
  entreprise: 'Entreprise',
  particulier: 'Particulier',
  institution: 'Institution',
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
    { id: 'commandes', header: 'Commandes', accessor: 'commandesCount', render: (v) => <span className="text-sm font-semibold">{v as number}</span> },
    {
      id: 'encours', header: 'Encours crédit', accessor: 'encoursCreditXAF',
      render: (v) => {
        const amt = v as number
        return <span className="text-sm font-semibold" style={{ color: amt > 0 ? '#dc2626' : '#15803d' }}>{amt > 0 ? formatXAF(amt) : '—'}</span>
      },
    },
    { id: 'ca', header: 'CA Total', accessor: 'totalCAXAF', render: (v) => <span className="text-sm font-semibold">{formatXAF(v as number)}</span> },
    { id: 'score', header: 'Fiabilité', accessor: 'scoreFiabilite', render: (v) => <ScoreFiabilite score={v as number} /> },
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
  const columns = buildColumns(navigate)

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
        subtitle={`${CLIENTS.length} clients · ${formatXAF(CLIENTS.reduce((s, c) => s + c.totalCAXAF, 0))} de CA cumulé`}
        breadcrumbs={[{ label: 'FORGE', href: '/' }, { label: 'Clients' }]}
        actions={
          <Button size="sm">
            <Plus className="h-3.5 w-3.5" /> Nouveau client
          </Button>
        }
      />

      <DataTable<Client>
        columns={columns}
        data={CLIENTS}
        keyField="id"
        onRowClick={(row) => navigate(`/clients/${row.id}`)}
      />
    </motion.div>
  )
}
