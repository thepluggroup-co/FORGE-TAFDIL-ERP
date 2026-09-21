import React, { useState } from 'react'
import { motion } from 'framer-motion'
import { Shield, AlertTriangle, CheckCircle, Plus } from 'lucide-react'
import { PageHeader, KpiCard, DataTable, SlideOver, Button } from '@forge/ui'
import type { Column } from '@forge/ui'
import { formatDate } from '@/lib/utils'
import { useIncidents, useCreateIncident } from '@/hooks/useOperations'
import type { Incident } from '@/hooks/useOperations'

type IncidentRecord = Incident & Record<string, unknown>

const TYPES_INCIDENT = ['Accident bénin', 'Accident grave', 'EPI non conforme', 'Incendie mineur', 'Accès non autorisé', 'Défaut équipement', 'Risque détecté', 'Autre']
const ZONES = ['Atelier soudure', 'Atelier découpe', 'Atelier CNC', 'Pliage hydraulique', 'Stock matières', 'Zone administrative', 'Cour extérieure']
const SIGNALANTS = ['Mvondo Serge', 'Biya Christine', 'Atangana Félix', 'Nkolo Pierre', 'Chef atelier', 'Direction']

const EPI_CONFORMITE = [
  { item: 'Casques de protection', conformes: 8, total: 8 },
  { item: 'Lunettes de sécurité', conformes: 7, total: 8 },
  { item: 'Gants anti-coupure', conformes: 10, total: 10 },
  { item: 'Masques de soudure', conformes: 3, total: 4 },
  { item: 'Chaussures de sécurité', conformes: 6, total: 6 },
  { item: 'Bouchons auditifs', conformes: 8, total: 10 },
]

const STATUT_MAP: Record<string, { label: string; color: string; bg: string }> = {
  ouvert:  { label: 'Ouvert',   color: '#dc2626', bg: '#fee2e2' },
  traite:  { label: 'Traité',   color: '#d97706', bg: '#fef3c7' },
  corrige: { label: 'Corrigé',  color: '#15803d', bg: '#dcfce7' },
  resolu:  { label: 'Résolu',   color: '#1d4ed8', bg: '#dbeafe' },
}

const COLUMNS: Column<IncidentRecord>[] = [
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
  { id: 'signale',     header: 'Signalé par',  accessor: 'signale_par',    render: (v) => <span className="text-sm">{v as string}</span> },
  { id: 'date',        header: 'Date',          accessor: 'date_incident',  render: (v) => <span className="text-sm text-gray-500">{formatDate(v as string)}</span> },
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

interface IncidentForm { type: string; description: string; zone: string; signale: string }
const DEFAULT_FORM: IncidentForm = { type: '', description: '', zone: '', signale: '' }

export default function Securite() {
  const [slideOpen, setSlideOpen] = useState(false)
  const [form, setForm] = useState<IncidentForm>(DEFAULT_FORM)

  const { data, isLoading } = useIncidents()
  const createIncident = useCreateIncident()

  const incidents = (data?.data ?? []) as IncidentRecord[]
  const formValid = form.type !== '' && form.description.trim().length >= 5 && form.zone !== '' && form.signale !== ''

  const handleCreate = () => {
    if (!formValid) return
    createIncident.mutate(
      {
        type: form.type,
        description: form.description,
        zone: form.zone,
        signale_par: form.signale,
        date_incident: new Date().toISOString().split('T')[0],
      },
      {
        onSuccess: () => {
          setSlideOpen(false)
          setForm(DEFAULT_FORM)
        },
      },
    )
  }

  const ce_mois = new Date().toISOString().slice(0, 7)

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.3 }} className="space-y-6">
      <PageHeader
        title="Sécurité"
        subtitle="Incidents · EPI · Conformité · Accès"
        breadcrumbs={[{ label: 'FORGE', href: '/' }, { label: 'Sécurité' }]}
        actions={<Button size="sm" onClick={() => { setForm(DEFAULT_FORM); setSlideOpen(true) }}><Plus className="h-3.5 w-3.5" /> Déclarer incident</Button>}
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard title="Incidents ce mois" value={incidents.filter(i => i.date_incident.startsWith(ce_mois)).length} icon={<AlertTriangle className="h-5 w-5" />} color="#dc2626" trend="down" trendValue="-2 vs mois préc." delay={0} />
        <KpiCard title="Conformité EPI" value={conformiteGlobale} unit="%" icon={<Shield className="h-5 w-5" />} color="#15803d" trend="up" trendValue="Objectif : 100 %" delay={0.07} />
        <KpiCard title="Incidents ouverts" value={incidents.filter(i => i.statut === 'ouvert').length} icon={<AlertTriangle className="h-5 w-5" />} color="#d97706" delay={0.14} />
        <KpiCard title="Audits à planifier" value={2} icon={<CheckCircle className="h-5 w-5" />} color="#d97706" trendValue="Trim. 2 — juin" trend="neutral" delay={0.21} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2 bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100">
            <h2 className="font-semibold text-sm text-[#212121]">Registre des incidents</h2>
          </div>
          <DataTable<IncidentRecord> columns={COLUMNS} data={incidents} keyField="id" loading={isLoading} />
        </div>

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

      <SlideOver isOpen={slideOpen} onClose={() => setSlideOpen(false)} title="Déclarer un incident" width="md">
        <div className="space-y-4">
          <div className="bg-red-50 border border-red-100 rounded-xl px-3 py-2.5 text-xs text-[#C62828] font-medium">
            Tout incident doit être déclaré dans les 24h. En cas d'urgence, appelez immédiatement le chef d'atelier.
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">Type d'incident *</label>
            <select value={form.type} onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}
              className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C62828]">
              <option value="">Sélectionner…</option>
              {TYPES_INCIDENT.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">Zone concernée *</label>
            <select value={form.zone} onChange={(e) => setForm((f) => ({ ...f, zone: e.target.value }))}
              className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C62828]">
              <option value="">Sélectionner…</option>
              {ZONES.map((z) => <option key={z} value={z}>{z}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">Description *</label>
            <textarea
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              rows={3}
              placeholder="Décrivez l'incident avec précision (circonstances, blessés, dommages…)"
              className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C62828] resize-none"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">Signalé par *</label>
            <select value={form.signale} onChange={(e) => setForm((f) => ({ ...f, signale: e.target.value }))}
              className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C62828]">
              <option value="">Sélectionner…</option>
              {SIGNALANTS.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div className="flex gap-3 pt-2 border-t border-gray-100">
            <Button variant="ghost" className="flex-1" onClick={() => setSlideOpen(false)}>Annuler</Button>
            <Button className="flex-1" disabled={!formValid || createIncident.isPending} onClick={handleCreate}>
              {createIncident.isPending ? 'Déclaration…' : 'Déclarer l\'incident'}
            </Button>
          </div>
        </div>
      </SlideOver>
    </motion.div>
  )
}
