import React from 'react'
import { motion } from 'framer-motion'
import { Shield, AlertTriangle, CheckCircle, Users, Plus } from 'lucide-react'
import { PageHeader, KpiCard, DataTable, Button } from '@forge/ui'
import type { Column } from '@forge/ui'
import { formatDate } from '@/lib/utils'

interface Incident extends Record<string, unknown> {
  id: string; type: string; description: string
  zone: string; signale: string; statut: string; date: string
}

const INCIDENTS: Incident[] = [
  { id: '1', type: 'Accident bénin', description: 'Coupure main droite opératrice découpe plasma', zone: 'Atelier découpe', signale: 'Biya Christine', statut: 'traite', date: '2026-05-14' },
  { id: '2', type: 'EPI non conforme', description: 'Technicien sans lunettes de protection sur CNC', zone: 'Atelier CNC', signale: 'Chef atelier', statut: 'corrige', date: '2026-05-12' },
  { id: '3', type: 'Incendie mineur', description: 'Projection soudure sur carton voisin — extinction rapide', zone: 'Atelier soudure', signale: 'Mvondo Serge', statut: 'resolu', date: '2026-04-28' },
  { id: '4', type: 'Accès non autorisé', description: 'Visiteur zone stockage sans accompagnement', zone: 'Stock matières', signale: 'Nkolo Pierre', statut: 'traite', date: '2026-04-22' },
  { id: '5', type: 'Défaut équipement', description: 'Masque soudure fissuré — mis hors service', zone: 'Atelier soudure', signale: 'Mvondo Serge', statut: 'resolu', date: '2026-05-10' },
]

const EPI_CONFORMITE = [
  { item: 'Casques de protection', conformes: 8, total: 8 },
  { item: 'Lunettes de sécurité', conformes: 7, total: 8 },
  { item: 'Gants anti-coupure', conformes: 10, total: 10 },
  { item: 'Masques de soudure', conformes: 3, total: 4 },
  { item: 'Chaussures de sécurité', conformes: 6, total: 6 },
  { item: 'Bouchons auditifs', conformes: 8, total: 10 },
]

const STATUT_MAP: Record<string, { label: string; color: string; bg: string }> = {
  traite:  { label: 'Traité',   color: '#d97706', bg: '#fef3c7' },
  corrige: { label: 'Corrigé',  color: '#15803d', bg: '#dcfce7' },
  resolu:  { label: 'Résolu',   color: '#1d4ed8', bg: '#dbeafe' },
  ouvert:  { label: 'Ouvert',   color: '#dc2626', bg: '#fee2e2' },
}

const columns: Column<Incident>[] = [
  {
    id: 'type', header: 'Type', accessor: 'type',
    render: (v, row) => (
      <div>
        <div className="text-sm font-semibold">{v as string}</div>
        <div className="text-xs text-gray-400 mt-0.5">{row.zone as string}</div>
      </div>
    ),
  },
  { id: 'description', header: 'Description', accessor: 'description', render: (v) => <span className="text-sm text-gray-600">{v as string}</span> },
  { id: 'signale', header: 'Signalé par', accessor: 'signale', render: (v) => <span className="text-sm">{v as string}</span> },
  { id: 'date', header: 'Date', accessor: 'date', render: (v) => <span className="text-sm text-gray-500">{formatDate(v as string)}</span> },
  {
    id: 'statut', header: 'Statut', accessor: 'statut',
    render: (v) => {
      const s = STATUT_MAP[v as string] ?? { label: v as string, color: '#6b7280', bg: '#f3f4f6' }
      return <span className="text-xs font-semibold px-2 py-0.5 rounded-full" style={{ color: s.color, backgroundColor: s.bg }}>{s.label}</span>
    },
  },
]

const conformiteGlobale = Math.round(
  (EPI_CONFORMITE.reduce((s, e) => s + e.conformes, 0) / EPI_CONFORMITE.reduce((s, e) => s + e.total, 0)) * 100
)

export default function Securite() {
  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.3 }} className="space-y-6">
      <PageHeader
        title="Sécurité"
        subtitle="Incidents · EPI · Conformité · Accès"
        breadcrumbs={[{ label: 'FORGE', href: '/' }, { label: 'Sécurité' }]}
        actions={<Button size="sm"><Plus className="h-3.5 w-3.5" /> Déclarer incident</Button>}
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard title="Incidents ce mois" value={INCIDENTS.filter(i => i.date >= '2026-05-01').length} icon={<AlertTriangle className="h-5 w-5" />} color="#dc2626" trend="down" trendValue="-2 vs mois préc." delay={0} />
        <KpiCard title="Conformité EPI" value={conformiteGlobale} unit="%" icon={<Shield className="h-5 w-5" />} color="#15803d" trend="up" trendValue="Objectif : 100 %" delay={0.07} />
        <KpiCard title="Accès autorisés" value={12} icon={<Users className="h-5 w-5" />} color="#1d4ed8" delay={0.14} />
        <KpiCard title="Audits à planifier" value={2} icon={<CheckCircle className="h-5 w-5" />} color="#d97706" trendValue="Trim. 2 — juin" trend="neutral" delay={0.21} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Incidents table */}
        <div className="lg:col-span-2 bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100">
            <h2 className="font-semibold text-sm text-[#212121]">Registre des incidents</h2>
          </div>
          <DataTable<Incident> columns={columns} data={INCIDENTS} keyField="id" />
        </div>

        {/* EPI conformité */}
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
          <h2 className="font-semibold text-sm text-[#212121] mb-4">Conformité EPI</h2>
          <div className="space-y-3">
            {EPI_CONFORMITE.map((e) => {
              const pct = Math.round((e.conformes / e.total) * 100)
              const color = pct === 100 ? '#15803d' : pct >= 80 ? '#d97706' : '#dc2626'
              return (
                <div key={e.item}>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-gray-600 font-medium">{e.item}</span>
                    <span className="font-bold" style={{ color }}>{e.conformes}/{e.total}</span>
                  </div>
                  <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${pct}%` }}
                      transition={{ duration: 0.6, ease: 'easeOut' }}
                      className="h-full rounded-full"
                      style={{ backgroundColor: color }}
                    />
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </motion.div>
  )
}
