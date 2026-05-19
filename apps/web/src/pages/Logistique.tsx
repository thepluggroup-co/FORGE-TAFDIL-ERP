import React, { useState } from 'react'
import { motion } from 'framer-motion'
import { Truck, Package, Clock, TrendingUp, Plus } from 'lucide-react'
import { PageHeader, KpiCard, DataTable, StatusBadge, SlideOver, Button } from '@forge/ui'
import type { Column } from '@forge/ui'
import { formatDate } from '@/lib/utils'
import { useLivraisons, useCreateLivraison } from '@/hooks/useOperations'
import type { Livraison } from '@/hooks/useOperations'

type LivraisonRecord = Livraison & Record<string, unknown>

const TRANSPORTEURS = ['TRANSIT CM', 'CAMTRANS', 'PORT EXPRESS', 'Auto-livraison', 'ELITE TRANSPORT']

const COLUMNS: Column<LivraisonRecord>[] = [
  { id: 'numero',      header: 'Référence',    accessor: 'numero',                render: (v) => <span className="font-mono text-xs font-semibold text-gray-600">{v as string}</span> },
  { id: 'client',      header: 'Client',        accessor: 'client_nom',            render: (v) => <span className="text-sm font-semibold">{v as string}</span> },
  { id: 'destination', header: 'Destination',   accessor: 'destination',           render: (v) => <span className="text-sm text-gray-500">{v as string}</span> },
  { id: 'transport',   header: 'Transporteur',  accessor: 'transporteur',          render: (v) => <span className="text-sm">{(v as string) ?? '—'}</span> },
  { id: 'depart',      header: 'Départ',        accessor: 'date_depart',           render: (v) => <span className="text-sm text-gray-500">{v ? formatDate(v as string) : '—'}</span> },
  { id: 'livraison',   header: 'Livraison',     accessor: 'date_livraison_prevue', render: (v) => <span className="text-sm text-gray-500">{v ? formatDate(v as string) : '—'}</span> },
  { id: 'statut',      header: 'Statut',        accessor: 'statut',                render: (v) => <StatusBadge status={v as string} /> },
]

interface LivraisonForm {
  client: string; destination: string; transporteur: string
  dateDepart: string; dateLivraison: string
}
const DEFAULT_FORM: LivraisonForm = {
  client: '', destination: '', transporteur: '',
  dateDepart: new Date().toISOString().split('T')[0],
  dateLivraison: '',
}

export default function Logistique() {
  const [slideOpen, setSlideOpen] = useState(false)
  const [form, setForm] = useState<LivraisonForm>(DEFAULT_FORM)

  const { data, isLoading } = useLivraisons()
  const createLivraison = useCreateLivraison()

  const livraisons = (data?.data ?? []) as LivraisonRecord[]
  const formValid = form.client.trim() !== '' && form.destination.trim() !== '' && form.transporteur !== '' && form.dateLivraison !== ''

  const handleCreate = () => {
    if (!formValid) return
    createLivraison.mutate(
      {
        client_nom: form.client,
        destination: form.destination,
        transporteur: form.transporteur,
        date_depart: form.dateDepart,
        date_livraison_prevue: form.dateLivraison,
      },
      {
        onSuccess: () => {
          setSlideOpen(false)
          setForm(DEFAULT_FORM)
        },
      },
    )
  }

  const today = new Date().toISOString().split('T')[0]
  const enTransit = livraisons.filter(l => l.statut === 'in_production').length
  const livrées   = livraisons.filter(l => l.statut === 'delivered').length

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.3 }} className="space-y-6">
      <PageHeader
        title="Logistique"
        subtitle="Livraisons · Transporteurs · Suivi de flotte"
        breadcrumbs={[{ label: 'FORGE', href: '/' }, { label: 'Logistique' }]}
        actions={<Button size="sm" onClick={() => { setForm(DEFAULT_FORM); setSlideOpen(true) }}><Plus className="h-3.5 w-3.5" /> Planifier livraison</Button>}
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard title="Livraisons du jour" value={livraisons.filter(l => l.date_depart === today).length} icon={<Truck className="h-5 w-5" />} color="#C62828" trend="neutral" trendValue="Confirmées" delay={0} />
        <KpiCard title="En transit" value={enTransit} icon={<Package className="h-5 w-5" />} color="#d97706" delay={0.07} />
        <KpiCard title="Transporteurs actifs" value={new Set(livraisons.map(l => l.transporteur).filter(Boolean)).size} icon={<Truck className="h-5 w-5" />} color="#1d4ed8" delay={0.14} />
        <KpiCard title="Taux ponctualité" value={livraisons.length > 0 ? Math.round((livrées / livraisons.length) * 100) : 0} unit="%" icon={<TrendingUp className="h-5 w-5" />} color="#15803d" trend="up" trendValue="+2 % vs mois" delay={0.21} />
      </div>

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h2 className="font-semibold text-sm text-[#212121]">Livraisons — {new Date().toLocaleDateString('fr-CM', { month: 'long', year: 'numeric' })}</h2>
          <div className="flex items-center gap-1 text-xs text-gray-400"><Clock className="h-3.5 w-3.5" /> En temps réel</div>
        </div>
        <DataTable<LivraisonRecord> columns={COLUMNS} data={livraisons} keyField="id" loading={isLoading} />
      </div>

      <SlideOver isOpen={slideOpen} onClose={() => setSlideOpen(false)} title="Planifier une livraison" width="md">
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">Client *</label>
            <input value={form.client} onChange={(e) => setForm((f) => ({ ...f, client: e.target.value }))}
              placeholder="ex. CAMRAIL SA" className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C62828]" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">Destination *</label>
            <input value={form.destination} onChange={(e) => setForm((f) => ({ ...f, destination: e.target.value }))}
              placeholder="ex. Douala Akwa" className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C62828]" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">Transporteur *</label>
            <select value={form.transporteur} onChange={(e) => setForm((f) => ({ ...f, transporteur: e.target.value }))}
              className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C62828]">
              <option value="">Sélectionner…</option>
              {TRANSPORTEURS.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">Date de départ</label>
              <input type="date" value={form.dateDepart} onChange={(e) => setForm((f) => ({ ...f, dateDepart: e.target.value }))}
                className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C62828]" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">Date de livraison *</label>
              <input type="date" value={form.dateLivraison} min={form.dateDepart} onChange={(e) => setForm((f) => ({ ...f, dateLivraison: e.target.value }))}
                className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C62828]" />
            </div>
          </div>
          <div className="flex gap-3 pt-2 border-t border-gray-100">
            <Button variant="ghost" className="flex-1" onClick={() => setSlideOpen(false)}>Annuler</Button>
            <Button className="flex-1" disabled={!formValid || createLivraison.isPending} onClick={handleCreate}>
              {createLivraison.isPending ? 'Planification…' : 'Planifier'}
            </Button>
          </div>
        </div>
      </SlideOver>
    </motion.div>
  )
}
