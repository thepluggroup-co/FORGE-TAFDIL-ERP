import React, { useState } from 'react'
import { motion } from 'framer-motion'
import { Wrench, Gauge, AlertTriangle, Clock, Plus, Play, CheckCircle2, Package } from 'lucide-react'
import { PageHeader, KpiCard, DataTable, StatusBadge, SlideOver, Button } from '@forge/ui'
import type { Column } from '@forge/ui'
import { formatDate } from '@/lib/utils'
import { useJobs, useCreateJob, useUpdateJobStatut } from '@/hooks/useOperations'
import type { Job } from '@/hooks/useOperations'
import { useStocks } from '@/hooks/useStocks'

type JobRecord = Job & Record<string, unknown>

const MACHINES = ['Soudure MIG #1', 'Soudure MIG #2', 'Découpe plasma', 'Pliage hydraulique', 'CNC Deckel', 'Meuleuse d\'angle']
const TECHNICIENS = ['Mvondo Serge', 'Biya Christine', 'Atangana Félix', 'Nkolo Pierre']

interface JobForm {
  typeJob: 'commande' | 'stock'
  produitId: string
  ref: string
  produit: string; machine: string; technicien: string
  categorie: string; unite: string
  quantitePrevue: string
  prixUnitaire: string
  prixPublic: string
  publierShop: boolean
  description: string
  debut: string; finPrevue: string
}

const DEFAULT_FORM: JobForm = {
  typeJob: 'commande',
  produitId: '',
  ref: '',
  produit: '', machine: '', technicien: '',
  categorie: '',
  unite: 'unite',
  quantitePrevue: '',
  prixUnitaire: '',
  prixPublic: '',
  publierShop: false,
  description: '',
  debut: new Date().toISOString().split('T')[0],
  finPrevue: '',
}

const BASE_COLUMNS: Column<JobRecord>[] = [
  { id: 'numero', header: 'Job', accessor: 'numero', render: (v) => <span className="font-mono text-xs font-semibold text-gray-600">{v as string}</span> },
  { id: 'produit', header: 'Produit', accessor: 'produit_designation', render: (v) => <span className="text-sm font-semibold">{v as string}</span> },
  {
    id: 'type', header: 'Flux', accessor: 'type_job',
    render: (v) => (
      <span className="inline-flex items-center gap-1 rounded-md bg-gray-50 px-2 py-1 text-xs font-semibold text-gray-600">
        {(v as string) === 'stock' ? <Package className="h-3 w-3" /> : null}
        {(v as string) === 'stock' ? 'Stock' : 'Commande'}
      </span>
    ),
  },
  {
    id: 'quantite', header: 'Qte', accessor: 'quantite_prevue',
    render: (_, row) => {
      const qte = row.quantite_produite ?? row.quantite_prevue
      return <span className="text-sm text-gray-500">{qte ? `${qte} ${row.unite ?? ''}` : '-'}</span>
    },
  },
  { id: 'machine', header: 'Machine', accessor: 'machine_nom', render: (v) => <span className="text-sm text-gray-500">{(v as string) ?? '—'}</span> },
  { id: 'tech', header: 'Technicien', accessor: 'technicien_nom', render: (v) => <span className="text-sm">{(v as string) ?? '—'}</span> },
  { id: 'fin', header: 'Fin prévue', accessor: 'date_fin_prevue', render: (v) => <span className="text-sm text-gray-500">{v ? formatDate(v as string) : '—'}</span> },
  {
    id: 'avancement', header: 'Avancement', accessor: 'avancement_pct',
    render: (v) => {
      const pct = (v as number) ?? 0
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
  const [slideOpen, setSlideOpen] = useState(false)
  const [form, setForm] = useState<JobForm>(DEFAULT_FORM)

  const { data, isLoading } = useJobs()
  const { data: stocksData } = useStocks()
  const createJob = useCreateJob()
  const updateJobStatut = useUpdateJobStatut()

  const jobs = (data?.data ?? []) as JobRecord[]
  const stocks = stocksData?.data ?? []
  const formValid =
    form.produit.trim() !== '' &&
    form.machine !== '' &&
    form.technicien !== '' &&
    form.finPrevue !== '' &&
    (form.typeJob === 'commande' || Number(form.quantitePrevue) > 0)

  const columns: Column<JobRecord>[] = [
    ...BASE_COLUMNS,
    {
      id: 'actions',
      header: '',
      accessor: 'id',
      render: (_, row) => (
        <div className="flex items-center justify-end gap-2">
          {row.statut === 'confirmed' ? (
            <Button size="sm" variant="ghost" onClick={() => updateJobStatut.mutate({ id: row.id, statut: 'in_production', avancement_pct: 25 })}>
              <Play className="h-3.5 w-3.5" /> Lancer
            </Button>
          ) : null}
          {row.statut === 'in_production' ? (
            <Button
              size="sm"
              onClick={() => updateJobStatut.mutate({
                id: row.id,
                statut: 'pret',
                quantite_produite: row.type_job === 'stock'
                  ? Number(row.quantite_prevue ?? 0)
                  : undefined,
              })}
            >
              <CheckCircle2 className="h-3.5 w-3.5" /> Terminer
            </Button>
          ) : null}
        </div>
      ),
    },
  ]

  const handleCreate = () => {
    if (!formValid) return
    createJob.mutate(
      {
        produit_designation: form.produit,
        type_job: form.typeJob,
        produit_id: form.produitId || undefined,
        produit_ref: form.ref || undefined,
        categorie: form.categorie || undefined,
        unite: form.unite || undefined,
        quantite_prevue: form.typeJob === 'stock' ? Number(form.quantitePrevue) : undefined,
        prix_unitaire_xaf: form.prixUnitaire ? Number(form.prixUnitaire) : undefined,
        prix_public_xaf: form.prixPublic ? Number(form.prixPublic) : undefined,
        publier_shop: form.publierShop,
        description_produit: form.description || undefined,
        machine_nom: form.machine,
        technicien_nom: form.technicien,
        date_debut: form.debut,
        date_fin_prevue: form.finPrevue,
      },
      {
        onSuccess: () => {
          setSlideOpen(false)
          setForm(DEFAULT_FORM)
        },
      },
    )
  }

  const enCours = jobs.filter((j) => j.statut === 'in_production').length

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.3 }} className="space-y-6">
      <PageHeader
        title="Production"
        subtitle="Suivi des jobs · Machines · Rendement atelier"
        breadcrumbs={[{ label: 'FORGE', href: '/' }, { label: 'Production' }]}
        actions={
          <Button size="sm" onClick={() => { setForm(DEFAULT_FORM); setSlideOpen(true) }}>
            <Plus className="h-3.5 w-3.5" /> Nouveau job
          </Button>
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard title="Jobs en cours" value={enCours} icon={<Wrench className="h-5 w-5" />} color="#C62828" trend="up" trendValue="+1 vs hier" delay={0} />
        <KpiCard title="Machines actives" value="3/5" icon={<Gauge className="h-5 w-5" />} color="#1d4ed8" trend="neutral" trendValue="2 en maintenance" delay={0.07} />
        <KpiCard title="Rendement" value="82" unit="%" icon={<Gauge className="h-5 w-5" />} color="#15803d" trend="up" trendValue="+3 % vs sem. dernière" delay={0.14} />
        <KpiCard title="Anomalies actives" value={2} icon={<AlertTriangle className="h-5 w-5" />} color="#dc2626" trend="down" trendValue="-1 résolue" delay={0.21} />
      </div>

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h2 className="font-semibold text-sm text-[#212121]">Jobs — {new Date().toLocaleDateString('fr-CM', { month: 'long', year: 'numeric' })}</h2>
          <div className="flex items-center gap-2 text-xs text-gray-400">
            <Clock className="h-3.5 w-3.5" /> {jobs.length} job{jobs.length > 1 ? 's' : ''}
          </div>
        </div>
        <DataTable<JobRecord> columns={columns} data={jobs} keyField="id" loading={isLoading} />
      </div>

      <SlideOver isOpen={slideOpen} onClose={() => setSlideOpen(false)} title="Nouveau job de production" width="md">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2 rounded-lg bg-gray-50 p-1">
            <button
              type="button"
              onClick={() => setForm((f) => ({ ...f, typeJob: 'commande', publierShop: false }))}
              className={`rounded-md px-3 py-2 text-sm font-semibold ${form.typeJob === 'commande' ? 'bg-white text-[#C62828] shadow-sm' : 'text-gray-500'}`}
            >
              Commande client
            </button>
            <button
              type="button"
              onClick={() => setForm((f) => ({ ...f, typeJob: 'stock' }))}
              className={`rounded-md px-3 py-2 text-sm font-semibold ${form.typeJob === 'stock' ? 'bg-white text-[#C62828] shadow-sm' : 'text-gray-500'}`}
            >
              Produit stock
            </button>
          </div>
          {form.typeJob === 'stock' ? (
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">Produit stock existant</label>
              <select
                value={form.produitId}
                onChange={(e) => {
                  const produit = stocks.find((p) => p.id === e.target.value)
                  setForm((f) => ({
                    ...f,
                    produitId: e.target.value,
                    produit: produit?.designation ?? f.produit,
                    ref: produit?.ref ?? f.ref,
                    categorie: produit?.categorie ?? f.categorie,
                    unite: produit?.unite ?? f.unite,
                    prixUnitaire: produit?.prix_unitaire_xaf ? String(produit.prix_unitaire_xaf) : f.prixUnitaire,
                  }))
                }}
                className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C62828]"
              >
                <option value="">Nouveau produit après production</option>
                {stocks.map((p) => <option key={p.id} value={p.id}>{p.ref} - {p.designation}</option>)}
              </select>
            </div>
          ) : null}
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">Produit / Description *</label>
            <input
              value={form.produit}
              onChange={(e) => setForm((f) => ({ ...f, produit: e.target.value }))}
              placeholder="ex. Grille métallique 2m×1m"
              className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C62828]"
            />
          </div>
          {form.typeJob === 'stock' ? (
            <>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">Ref</label>
                  <input
                    value={form.ref}
                    onChange={(e) => setForm((f) => ({ ...f, ref: e.target.value }))}
                    placeholder="PRD-..."
                    className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C62828]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">Catégorie</label>
                  <input
                    value={form.categorie}
                    onChange={(e) => setForm((f) => ({ ...f, categorie: e.target.value }))}
                    placeholder="Production"
                    className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C62828]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">Unité</label>
                  <input
                    value={form.unite}
                    onChange={(e) => setForm((f) => ({ ...f, unite: e.target.value }))}
                    className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C62828]"
                  />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">Qté prévue *</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={form.quantitePrevue}
                    onChange={(e) => setForm((f) => ({ ...f, quantitePrevue: e.target.value }))}
                    className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C62828]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">Coût unit.</label>
                  <input
                    type="number"
                    min="0"
                    value={form.prixUnitaire}
                    onChange={(e) => setForm((f) => ({ ...f, prixUnitaire: e.target.value }))}
                    className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C62828]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">Prix shop</label>
                  <input
                    type="number"
                    min="0"
                    value={form.prixPublic}
                    onChange={(e) => setForm((f) => ({ ...f, prixPublic: e.target.value }))}
                    className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C62828]"
                  />
                </div>
              </div>
              <label className="flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2.5 text-sm">
                <input
                  type="checkbox"
                  checked={form.publierShop}
                  onChange={(e) => setForm((f) => ({ ...f, publierShop: e.target.checked }))}
                  className="h-4 w-4 rounded border-gray-300 text-[#C62828] focus:ring-[#C62828]"
                />
                Publier sur la boutique après production
              </label>
            </>
          ) : null}
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">Machine *</label>
            <select
              value={form.machine}
              onChange={(e) => setForm((f) => ({ ...f, machine: e.target.value }))}
              className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C62828]"
            >
              <option value="">Sélectionner…</option>
              {MACHINES.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">Technicien *</label>
            <select
              value={form.technicien}
              onChange={(e) => setForm((f) => ({ ...f, technicien: e.target.value }))}
              className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C62828]"
            >
              <option value="">Sélectionner…</option>
              {TECHNICIENS.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">Date début</label>
              <input
                type="date"
                value={form.debut}
                onChange={(e) => setForm((f) => ({ ...f, debut: e.target.value }))}
                className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C62828]"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">Fin prévue *</label>
              <input
                type="date"
                value={form.finPrevue}
                min={form.debut}
                onChange={(e) => setForm((f) => ({ ...f, finPrevue: e.target.value }))}
                className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C62828]"
              />
            </div>
          </div>
          <div className="flex gap-3 pt-2 border-t border-gray-100">
            <Button variant="ghost" className="flex-1" onClick={() => setSlideOpen(false)}>Annuler</Button>
            <Button className="flex-1" disabled={!formValid || createJob.isPending} onClick={handleCreate}>
              {createJob.isPending ? 'Création…' : 'Créer le job'}
            </Button>
          </div>
        </div>
      </SlideOver>
    </motion.div>
  )
}
