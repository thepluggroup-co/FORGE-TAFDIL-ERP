import React from 'react'
import { motion } from 'framer-motion'
import { Truck, Package, Clock, TrendingUp, Plus } from 'lucide-react'
import { PageHeader, KpiCard, DataTable, StatusBadge, Button } from '@forge/ui'
import type { Column } from '@forge/ui'
import { formatDate } from '@/lib/utils'

interface Livraison extends Record<string, unknown> {
  id: string; ref: string; client: string; destination: string
  transporteur: string; dateDepart: string; dateLivraison: string
  statut: string
}

const LIVRAISONS: Livraison[] = [
  { id: '1', ref: 'LIV-2026-031', client: 'SODECOTON', destination: 'Garoua, Cameroun', transporteur: 'TRANSIT CM', dateDepart: '2026-05-16', dateLivraison: '2026-05-18', statut: 'in_production' },
  { id: '2', ref: 'LIV-2026-030', client: 'MAETUR', destination: 'Yaoundé, Cameroun', transporteur: 'CAMTRANS', dateDepart: '2026-05-15', dateLivraison: '2026-05-16', statut: 'delivered' },
  { id: '3', ref: 'LIV-2026-029', client: 'CAMRAIL SA', destination: 'Douala Port', transporteur: 'PORT EXPRESS', dateDepart: '2026-05-14', dateLivraison: '2026-05-14', statut: 'delivered' },
  { id: '4', ref: 'LIV-2026-032', client: 'Biyong & Fils', destination: 'Douala Akwa', transporteur: 'Auto-livraison', dateDepart: '2026-05-17', dateLivraison: '2026-05-17', statut: 'confirmed' },
  { id: '5', ref: 'LIV-2026-033', client: 'CDE Cameroun', destination: 'Douala Bonamoussadi', transporteur: 'TRANSIT CM', dateDepart: '2026-05-18', dateLivraison: '2026-05-19', statut: 'confirmed' },
]

const columns: Column<Livraison>[] = [
  { id: 'ref', header: 'Référence', accessor: 'ref', render: (v) => <span className="font-mono text-xs font-semibold text-gray-600">{v as string}</span> },
  { id: 'client', header: 'Client', accessor: 'client', render: (v) => <span className="text-sm font-semibold">{v as string}</span> },
  { id: 'destination', header: 'Destination', accessor: 'destination', render: (v) => <span className="text-sm text-gray-500">{v as string}</span> },
  { id: 'transporteur', header: 'Transporteur', accessor: 'transporteur', render: (v) => <span className="text-sm">{v as string}</span> },
  { id: 'depart', header: 'Départ', accessor: 'dateDepart', render: (v) => <span className="text-sm text-gray-500">{formatDate(v as string)}</span> },
  { id: 'livraison', header: 'Livraison', accessor: 'dateLivraison', render: (v) => <span className="text-sm text-gray-500">{formatDate(v as string)}</span> },
  { id: 'statut', header: 'Statut', accessor: 'statut', render: (v) => <StatusBadge status={v as string} /> },
]

export default function Logistique() {
  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.3 }} className="space-y-6">
      <PageHeader
        title="Logistique"
        subtitle="Livraisons · Transporteurs · Suivi de flotte"
        breadcrumbs={[{ label: 'FORGE', href: '/' }, { label: 'Logistique' }]}
        actions={<Button size="sm"><Plus className="h-3.5 w-3.5" /> Planifier livraison</Button>}
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard title="Livraisons du jour" value={2} icon={<Truck className="h-5 w-5" />} color="#C62828" trend="neutral" trendValue="2 confirmées" delay={0} />
        <KpiCard title="En transit" value={1} icon={<Package className="h-5 w-5" />} color="#d97706" delay={0.07} />
        <KpiCard title="Transporteurs actifs" value={3} icon={<Truck className="h-5 w-5" />} color="#1d4ed8" delay={0.14} />
        <KpiCard title="Taux ponctualité" value="89" unit="%" icon={<TrendingUp className="h-5 w-5" />} color="#15803d" trend="up" trendValue="+2 % vs mois" delay={0.21} />
      </div>

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h2 className="font-semibold text-sm text-[#212121]">Livraisons — Mai 2026</h2>
          <div className="flex items-center gap-1 text-xs text-gray-400"><Clock className="h-3.5 w-3.5" /> En temps réel</div>
        </div>
        <DataTable<Livraison> columns={columns} data={LIVRAISONS} keyField="id" />
      </div>
    </motion.div>
  )
}
