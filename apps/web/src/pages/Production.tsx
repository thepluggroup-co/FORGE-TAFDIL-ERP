import React from 'react'
import { motion } from 'framer-motion'
import { Wrench, Gauge, AlertTriangle, Clock } from 'lucide-react'
import { PageHeader, KpiCard, DataTable, StatusBadge, Button } from '@forge/ui'
import type { Column } from '@forge/ui'
import { formatDate } from '@/lib/utils'

interface Job extends Record<string, unknown> {
  id: string; ref: string; produit: string; machine: string
  technicien: string; debut: string; finPrevue: string
  avancement: number; statut: string
}

const JOBS: Job[] = [
  { id: '1', ref: 'JOB-2026-047', produit: 'Grille métallique 2m×1m', machine: 'Soudure MIG #1', technicien: 'Mvondo Serge', debut: '2026-05-15', finPrevue: '2026-05-18', avancement: 75, statut: 'in_production' },
  { id: '2', ref: 'JOB-2026-046', produit: 'Porte sécurisée 90×210', machine: 'Découpe plasma', technicien: 'Biya Christine', debut: '2026-05-14', finPrevue: '2026-05-17', avancement: 90, statut: 'in_production' },
  { id: '3', ref: 'JOB-2026-045', produit: 'Charpente 10×8 m', machine: 'Pliage hydraulique', technicien: 'Atangana Félix', debut: '2026-05-10', finPrevue: '2026-05-13', avancement: 100, statut: 'delivered' },
  { id: '4', ref: 'JOB-2026-048', produit: 'Profilé alu 6060-T5 ×20', machine: 'CNC Deckel', technicien: 'Mvondo Serge', debut: '2026-05-16', finPrevue: '2026-05-19', avancement: 20, statut: 'confirmed' },
  { id: '5', ref: 'JOB-2026-049', produit: 'Barrière résidentielle 3m', machine: 'Soudure MIG #2', technicien: 'Biya Christine', debut: '2026-05-16', finPrevue: '2026-05-20', avancement: 0, statut: 'confirmed' },
]

const columns: Column<Job>[] = [
  { id: 'ref', header: 'Job', accessor: 'ref', render: (v) => <span className="font-mono text-xs font-semibold text-gray-600">{v as string}</span> },
  { id: 'produit', header: 'Produit', accessor: 'produit', render: (v) => <span className="text-sm font-semibold">{v as string}</span> },
  { id: 'machine', header: 'Machine', accessor: 'machine', render: (v) => <span className="text-sm text-gray-500">{v as string}</span> },
  { id: 'tech', header: 'Technicien', accessor: 'technicien', render: (v) => <span className="text-sm">{v as string}</span> },
  { id: 'fin', header: 'Fin prévue', accessor: 'finPrevue', render: (v) => <span className="text-sm text-gray-500">{formatDate(v as string)}</span> },
  {
    id: 'avancement', header: 'Avancement', accessor: 'avancement',
    render: (v) => {
      const pct = v as number
      const color = pct === 100 ? '#15803d' : pct >= 50 ? '#d97706' : '#C62828'
      return (
        <div className="flex items-center gap-2 w-32">
          <div className="flex-1 h-1.5 rounded-full bg-gray-100 overflow-hidden">
            <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: color }} />
          </div>
          <span className="text-xs font-semibold shrink-0" style={{ color }}>{pct}%</span>
        </div>
      )
    },
  },
  { id: 'statut', header: 'Statut', accessor: 'statut', render: (v) => <StatusBadge status={v as string} /> },
]

export default function Production() {
  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.3 }} className="space-y-6">
      <PageHeader
        title="Production"
        subtitle="Suivi des jobs · Machines · Rendement atelier"
        breadcrumbs={[{ label: 'FORGE', href: '/' }, { label: 'Production' }]}
        actions={<Button size="sm"><Wrench className="h-3.5 w-3.5" /> Nouveau job</Button>}
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard title="Jobs en cours" value={4} icon={<Wrench className="h-5 w-5" />} color="#C62828" trend="up" trendValue="+1 vs hier" delay={0} />
        <KpiCard title="Machines actives" value="3/5" icon={<Gauge className="h-5 w-5" />} color="#1d4ed8" trend="neutral" trendValue="2 en maintenance" delay={0.07} />
        <KpiCard title="Rendement" value="82" unit="%" icon={<Gauge className="h-5 w-5" />} color="#15803d" trend="up" trendValue="+3 % vs sem. dernière" delay={0.14} />
        <KpiCard title="Anomalies actives" value={2} icon={<AlertTriangle className="h-5 w-5" />} color="#dc2626" trend="down" trendValue="-1 résolue" delay={0.21} />
      </div>

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h2 className="font-semibold text-sm text-[#212121]">Jobs en cours — Semaine 20</h2>
          <div className="flex items-center gap-2 text-xs text-gray-400">
            <Clock className="h-3.5 w-3.5" /> Mis à jour il y a 5 min
          </div>
        </div>
        <DataTable<Job> columns={columns} data={JOBS} keyField="id" />
      </div>
    </motion.div>
  )
}
