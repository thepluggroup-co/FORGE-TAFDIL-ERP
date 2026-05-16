import React from 'react'
import { motion } from 'framer-motion'
import { Kanban, DollarSign, AlertTriangle, TrendingUp, Plus } from 'lucide-react'
import { PageHeader, KpiCard, DataTable, Button } from '@forge/ui'
import type { Column } from '@forge/ui'
import { formatXAF, formatDate } from '@/lib/utils'

interface Projet extends Record<string, unknown> {
  id: string; nom: string; client: string; chefProjet: string
  budget: number; depense: number; avancement: number
  deadline: string; statut: string
}

const PROJETS: Projet[] = [
  { id: '1', nom: 'Hangar industriel Bassa', client: 'CAMRAIL SA', chefProjet: 'Mvondo Serge', budget: 4500000, depense: 2100000, avancement: 48, deadline: '2026-07-30', statut: 'en_cours' },
  { id: '2', nom: 'Clôture périmétrique MAETUR', client: 'MAETUR', chefProjet: 'Atangana Félix', budget: 1800000, depense: 1650000, avancement: 92, deadline: '2026-05-25', statut: 'en_cours' },
  { id: '3', nom: 'Portails automatisés CDE', client: 'CDE Cameroun', chefProjet: 'Mvondo Serge', budget: 2200000, depense: 2200000, avancement: 100, deadline: '2026-04-30', statut: 'livre' },
  { id: '4', nom: 'Racks stockage SODECOTON', client: 'SODECOTON', chefProjet: 'Biya Christine', budget: 950000, depense: 0, avancement: 0, deadline: '2026-08-15', statut: 'planifie' },
  { id: '5', nom: 'Escalier métal bureaux Ngousso', client: 'Biyong & Fils', chefProjet: 'Atangana Félix', budget: 680000, depense: 120000, avancement: 18, deadline: '2026-06-10', statut: 'en_cours' },
  { id: '6', nom: 'Maintenance industrielle SOFAME', client: 'SOFAME', chefProjet: 'Nkolo Pierre', budget: 350000, depense: 80000, avancement: 22, deadline: '2026-06-01', statut: 'en_cours' },
]

const STATUT_MAP: Record<string, { label: string; color: string; bg: string }> = {
  planifie: { label: 'Planifié', color: '#6b7280', bg: '#f3f4f6' },
  en_cours: { label: 'En cours', color: '#d97706', bg: '#fef3c7' },
  livre:    { label: 'Livré',    color: '#15803d', bg: '#dcfce7' },
  annule:   { label: 'Annulé',   color: '#dc2626', bg: '#fee2e2' },
}

const columns: Column<Projet>[] = [
  { id: 'nom', header: 'Projet', accessor: 'nom', render: (v) => <span className="text-sm font-semibold">{v as string}</span> },
  { id: 'client', header: 'Client', accessor: 'client', render: (v) => <span className="text-sm text-gray-500">{v as string}</span> },
  { id: 'chef', header: 'Chef de projet', accessor: 'chefProjet', render: (v) => <span className="text-sm">{v as string}</span> },
  { id: 'budget', header: 'Budget', accessor: 'budget', render: (v) => <span className="text-sm font-semibold">{formatXAF(v as number)}</span> },
  {
    id: 'avancement', header: 'Avancement', accessor: 'avancement',
    render: (v) => {
      const pct = v as number
      const color = pct === 100 ? '#15803d' : pct >= 50 ? '#d97706' : '#C62828'
      return (
        <div className="flex items-center gap-2 w-28">
          <div className="flex-1 h-1.5 rounded-full bg-gray-100 overflow-hidden">
            <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: color }} />
          </div>
          <span className="text-xs font-semibold shrink-0" style={{ color }}>{pct}%</span>
        </div>
      )
    },
  },
  { id: 'deadline', header: 'Échéance', accessor: 'deadline', render: (v) => <span className="text-sm text-gray-500">{formatDate(v as string)}</span> },
  {
    id: 'statut', header: 'Statut', accessor: 'statut',
    render: (v) => {
      const s = STATUT_MAP[v as string] ?? { label: v as string, color: '#6b7280', bg: '#f3f4f6' }
      return <span className="text-xs font-semibold px-2 py-0.5 rounded-full" style={{ color: s.color, backgroundColor: s.bg }}>{s.label}</span>
    },
  },
]

export default function Projets() {
  const budgetTotal = PROJETS.reduce((s, p) => s + p.budget, 0)
  const enRetard = PROJETS.filter(p => p.statut === 'en_cours' && p.avancement < 50).length

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.3 }} className="space-y-6">
      <PageHeader
        title="Projets"
        subtitle={`${PROJETS.length} projets · Budget total : ${formatXAF(budgetTotal)}`}
        breadcrumbs={[{ label: 'FORGE', href: '/' }, { label: 'Projets' }]}
        actions={<Button size="sm"><Plus className="h-3.5 w-3.5" /> Nouveau projet</Button>}
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard title="Projets actifs" value={PROJETS.filter(p => p.statut === 'en_cours').length} icon={<Kanban className="h-5 w-5" />} color="#C62828" delay={0} />
        <KpiCard title="Budget total" value={formatXAF(budgetTotal)} icon={<DollarSign className="h-5 w-5" />} color="#15803d" delay={0.07} />
        <KpiCard title="En retard" value={enRetard} icon={<AlertTriangle className="h-5 w-5" />} color="#dc2626" trendValue={enRetard > 0 ? 'Attention requise' : 'RAS'} trend={enRetard > 0 ? 'down' : 'neutral'} delay={0.14} />
        <KpiCard title="Avancement moyen" value="55" unit="%" icon={<TrendingUp className="h-5 w-5" />} color="#1d4ed8" delay={0.21} />
      </div>

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <DataTable<Projet> columns={columns} data={PROJETS} keyField="id" />
      </div>
    </motion.div>
  )
}
