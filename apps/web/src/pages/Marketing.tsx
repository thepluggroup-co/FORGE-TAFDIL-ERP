import React from 'react'
import { motion } from 'framer-motion'
import { Megaphone, Users, TrendingUp, Target, Plus } from 'lucide-react'
import { PageHeader, KpiCard, DataTable, Button } from '@forge/ui'
import type { Column } from '@forge/ui'
import { formatXAF, formatDate } from '@/lib/utils'

interface Campagne extends Record<string, unknown> {
  id: string; nom: string; canal: string; budget: number
  reach: number; leads: number; conversions: number; statut: string
  dateDebut: string; dateFin: string
}

const CAMPAGNES: Campagne[] = [
  { id: '1', nom: 'Portes & Portails — Saison des pluies', canal: 'WhatsApp Business', budget: 50000, reach: 1240, leads: 38, conversions: 6, statut: 'active', dateDebut: '2026-05-01', dateFin: '2026-05-31' },
  { id: '2', nom: 'Grilles de sécurité résidentielles', canal: 'Facebook Ads', budget: 120000, reach: 8700, leads: 95, conversions: 11, statut: 'active', dateDebut: '2026-04-15', dateFin: '2026-05-15' },
  { id: '3', nom: 'BTP Industriel — Charpentes', canal: 'Démarchage direct', budget: 0, reach: 45, leads: 12, conversions: 4, statut: 'termine', dateDebut: '2026-03-01', dateFin: '2026-04-30' },
  { id: '4', nom: 'Lancement portail automatique', canal: 'Instagram', budget: 80000, reach: 0, leads: 0, conversions: 0, statut: 'planifie', dateDebut: '2026-06-01', dateFin: '2026-06-30' },
]

const STATUT_MAP: Record<string, { label: string; color: string; bg: string }> = {
  active:   { label: 'Active',    color: '#15803d', bg: '#dcfce7' },
  planifie: { label: 'Planifiée', color: '#6b7280', bg: '#f3f4f6' },
  termine:  { label: 'Terminée', color: '#1d4ed8', bg: '#dbeafe' },
  pause:    { label: 'En pause',  color: '#d97706', bg: '#fef3c7' },
}

const columns: Column<Campagne>[] = [
  { id: 'nom', header: 'Campagne', accessor: 'nom', render: (v) => <span className="text-sm font-semibold">{v as string}</span> },
  { id: 'canal', header: 'Canal', accessor: 'canal', render: (v) => <span className="text-sm text-gray-500">{v as string}</span> },
  { id: 'budget', header: 'Budget', accessor: 'budget', render: (v) => <span className="text-sm font-semibold">{(v as number) > 0 ? formatXAF(v as number) : 'Gratuit'}</span> },
  { id: 'reach', header: 'Portée', accessor: 'reach', render: (v) => <span className="text-sm font-semibold">{(v as number).toLocaleString('fr-CM')}</span> },
  { id: 'leads', header: 'Leads', accessor: 'leads', render: (v) => <span className="text-sm font-semibold text-[#1d4ed8]">{v as number}</span> },
  { id: 'conv', header: 'Conversions', accessor: 'conversions', render: (v) => <span className="text-sm font-semibold text-[#15803d]">{v as number}</span> },
  { id: 'fin', header: 'Fin', accessor: 'dateFin', render: (v) => <span className="text-sm text-gray-400">{formatDate(v as string)}</span> },
  {
    id: 'statut', header: 'Statut', accessor: 'statut',
    render: (v) => {
      const s = STATUT_MAP[v as string] ?? { label: v as string, color: '#6b7280', bg: '#f3f4f6' }
      return <span className="text-xs font-semibold px-2 py-0.5 rounded-full" style={{ color: s.color, backgroundColor: s.bg }}>{s.label}</span>
    },
  },
]

export default function Marketing() {
  const totalLeads = CAMPAGNES.reduce((s, c) => s + c.leads, 0)
  const totalConv = CAMPAGNES.reduce((s, c) => s + c.conversions, 0)
  const txConv = totalLeads > 0 ? Math.round((totalConv / totalLeads) * 100) : 0
  const totalReach = CAMPAGNES.reduce((s, c) => s + c.reach, 0)

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.3 }} className="space-y-6">
      <PageHeader
        title="Marketing"
        subtitle="Campagnes · Leads · Conversions"
        breadcrumbs={[{ label: 'FORGE', href: '/' }, { label: 'Marketing' }]}
        actions={<Button size="sm"><Plus className="h-3.5 w-3.5" /> Nouvelle campagne</Button>}
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard title="Campagnes actives" value={CAMPAGNES.filter(c => c.statut === 'active').length} icon={<Megaphone className="h-5 w-5" />} color="#C62828" delay={0} />
        <KpiCard title="Leads ce mois" value={totalLeads} icon={<Users className="h-5 w-5" />} color="#1d4ed8" trend="up" trendValue="+18 % vs mois" delay={0.07} />
        <KpiCard title="Taux de conversion" value={txConv} unit="%" icon={<Target className="h-5 w-5" />} color="#15803d" delay={0.14} />
        <KpiCard title="Portée totale" value={`${(totalReach / 1000).toFixed(1)}k`} icon={<TrendingUp className="h-5 w-5" />} color="#7c3aed" delay={0.21} />
      </div>

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <DataTable<Campagne> columns={columns} data={CAMPAGNES} keyField="id" />
      </div>
    </motion.div>
  )
}
