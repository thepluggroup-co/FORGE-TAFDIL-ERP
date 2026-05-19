import React, { useState } from 'react'
import { motion } from 'framer-motion'
import { Kanban, DollarSign, AlertTriangle, TrendingUp, Plus } from 'lucide-react'
import { PageHeader, KpiCard, DataTable, SlideOver, Button } from '@forge/ui'
import type { Column } from '@forge/ui'
import { formatXAF, formatDate } from '@/lib/utils'
import { useProjets, useCreateProjet } from '@/hooks/useOperations'
import type { Projet } from '@/hooks/useOperations'

type ProjetRecord = Projet & Record<string, unknown>

const CHEFS = ['Mvondo Serge', 'Atangana Félix', 'Biya Christine', 'Nkolo Pierre']

const STATUT_MAP: Record<string, { label: string; color: string; bg: string }> = {
  planifie:  { label: 'Planifié',  color: '#6b7280', bg: '#f3f4f6' },
  en_cours:  { label: 'En cours',  color: '#d97706', bg: '#fef3c7' },
  suspendu:  { label: 'Suspendu',  color: '#dc2626', bg: '#fee2e2' },
  livre:     { label: 'Livré',     color: '#15803d', bg: '#dcfce7' },
  annule:    { label: 'Annulé',    color: '#dc2626', bg: '#fee2e2' },
}

const COLUMNS: Column<ProjetRecord>[] = [
  { id: 'nom',        header: 'Projet',          accessor: 'nom',             render: (v) => <span className="text-sm font-semibold">{v as string}</span> },
  { id: 'client',     header: 'Client',           accessor: 'client_nom',      render: (v) => <span className="text-sm text-gray-500">{(v as string) ?? '—'}</span> },
  { id: 'chef',       header: 'Chef de projet',   accessor: 'chef_projet_nom', render: (v) => <span className="text-sm">{(v as string) ?? '—'}</span> },
  { id: 'budget',     header: 'Budget',           accessor: 'budget_xaf',      render: (v) => <span className="text-sm font-semibold">{formatXAF(v as number)}</span> },
  {
    id: 'avancement', header: 'Avancement', accessor: 'avancement_pct',
    render: (v) => {
      const pct = (v as number) ?? 0
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
  { id: 'deadline', header: 'Échéance', accessor: 'deadline', render: (v) => <span className="text-sm text-gray-500">{v ? formatDate(v as string) : '—'}</span> },
  {
    id: 'statut', header: 'Statut', accessor: 'statut',
    render: (v) => {
      const s = STATUT_MAP[v as string] ?? { label: v as string, color: '#6b7280', bg: '#f3f4f6' }
      return <span className="text-xs font-semibold px-2 py-0.5 rounded-full" style={{ color: s.color, backgroundColor: s.bg }}>{s.label}</span>
    },
  },
]

interface ProjetForm {
  nom: string; client: string; chefProjet: string; budget: number; deadline: string
}
const DEFAULT_FORM: ProjetForm = { nom: '', client: '', chefProjet: '', budget: 0, deadline: '' }

export default function Projets() {
  const [slideOpen, setSlideOpen] = useState(false)
  const [form, setForm] = useState<ProjetForm>(DEFAULT_FORM)

  const { data, isLoading } = useProjets()
  const createProjet = useCreateProjet()

  const projets = (data?.data ?? []) as ProjetRecord[]
  const formValid = form.nom.trim() !== '' && form.client.trim() !== '' && form.chefProjet !== '' && form.deadline !== ''

  const handleCreate = () => {
    if (!formValid) return
    createProjet.mutate(
      {
        nom: form.nom,
        client_nom: form.client,
        chef_projet_nom: form.chefProjet,
        budget_xaf: form.budget,
        deadline: form.deadline,
      },
      {
        onSuccess: () => {
          setSlideOpen(false)
          setForm(DEFAULT_FORM)
        },
      },
    )
  }

  const budgetTotal = projets.reduce((s, p) => s + p.budget_xaf, 0)
  const enRetard    = projets.filter(p => p.statut === 'en_cours' && p.avancement_pct < 50).length
  const avgPct      = projets.length > 0 ? Math.round(projets.reduce((s, p) => s + p.avancement_pct, 0) / projets.length) : 0

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.3 }} className="space-y-6">
      <PageHeader
        title="Projets"
        subtitle={`${projets.length} projets · Budget total : ${formatXAF(budgetTotal)}`}
        breadcrumbs={[{ label: 'FORGE', href: '/' }, { label: 'Projets' }]}
        actions={<Button size="sm" onClick={() => { setForm(DEFAULT_FORM); setSlideOpen(true) }}><Plus className="h-3.5 w-3.5" /> Nouveau projet</Button>}
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard title="Projets actifs" value={projets.filter(p => p.statut === 'en_cours').length} icon={<Kanban className="h-5 w-5" />} color="#C62828" delay={0} />
        <KpiCard title="Budget total" value={formatXAF(budgetTotal)} icon={<DollarSign className="h-5 w-5" />} color="#15803d" delay={0.07} />
        <KpiCard title="En retard" value={enRetard} icon={<AlertTriangle className="h-5 w-5" />} color="#dc2626" trendValue={enRetard > 0 ? 'Attention requise' : 'RAS'} trend={enRetard > 0 ? 'down' : 'neutral'} delay={0.14} />
        <KpiCard title="Avancement moyen" value={avgPct} unit="%" icon={<TrendingUp className="h-5 w-5" />} color="#1d4ed8" delay={0.21} />
      </div>

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <DataTable<ProjetRecord> columns={COLUMNS} data={projets} keyField="id" loading={isLoading} />
      </div>

      <SlideOver isOpen={slideOpen} onClose={() => setSlideOpen(false)} title="Nouveau projet" width="md">
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">Nom du projet *</label>
            <input value={form.nom} onChange={(e) => setForm((f) => ({ ...f, nom: e.target.value }))}
              placeholder="ex. Hangar industriel Bassa" className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C62828]" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">Client *</label>
            <input value={form.client} onChange={(e) => setForm((f) => ({ ...f, client: e.target.value }))}
              placeholder="ex. CAMRAIL SA" className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C62828]" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">Chef de projet *</label>
            <select value={form.chefProjet} onChange={(e) => setForm((f) => ({ ...f, chefProjet: e.target.value }))}
              className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C62828]">
              <option value="">Sélectionner…</option>
              {CHEFS.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">Budget (FCFA)</label>
              <input type="number" min="0" value={form.budget} onChange={(e) => setForm((f) => ({ ...f, budget: Number(e.target.value) }))}
                placeholder="0" className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C62828]" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">Échéance *</label>
              <input type="date" value={form.deadline} onChange={(e) => setForm((f) => ({ ...f, deadline: e.target.value }))}
                className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C62828]" />
            </div>
          </div>
          <div className="flex gap-3 pt-2 border-t border-gray-100">
            <Button variant="ghost" className="flex-1" onClick={() => setSlideOpen(false)}>Annuler</Button>
            <Button className="flex-1" disabled={!formValid || createProjet.isPending} onClick={handleCreate}>
              {createProjet.isPending ? 'Création…' : 'Créer le projet'}
            </Button>
          </div>
        </div>
      </SlideOver>
    </motion.div>
  )
}
