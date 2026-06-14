import React, { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { AlertTriangle, CheckCircle, Cpu, Hammer, Laptop, Plus, ReceiptText, Settings, Wrench } from 'lucide-react'
import { PageHeader, Button, SlideOver } from '@forge/ui'
import { formatXAF } from '@/lib/utils'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/lib/api-client'
import { toast } from 'sonner'
import { useAuth } from '@/context/AuthContext'

type CategorieEquip =
  | 'machine_production' | 'outillage' | 'informatique' | 'logiciel'
  | 'vehicule' | 'securite' | 'autre' | 'outil' | 'machine_legere' | 'instrument' | 'epi'

type StatutEquip = 'disponible' | 'en_service' | 'maintenance' | 'en_panne' | 'hors_service' | 'remplacement_prevu' | 'cede'
type Criticite = 'faible' | 'moyenne' | 'haute' | 'critique'
type TypeIntervention = 'preventive' | 'corrective' | 'calibrage' | 'remplacement' | 'panne' | 'reparation' | 'installation' | 'audit'
type StatutIntervention = 'planifie' | 'en_cours' | 'fait' | 'annule'

interface Equipement {
  id: string
  code: string
  designation: string
  categorie: CategorieEquip
  statut: StatutEquip
  criticite?: Criticite
  emplacement?: string | null
  prochaine_revision?: string | null
  revision_depassee?: boolean
  date_remplacement_prevue?: string | null
  valeur_achat_xaf?: number
  fournisseur?: string | null
  marque?: string | null
  modele?: string | null
  numero_serie?: string | null
  notes?: string | null
  employes?: { nom: string; poste?: string } | null
}

interface Maintenance {
  id: string
  type: TypeIntervention
  date_maintenance: string
  statut: StatutIntervention
  cout_xaf: number
  description?: string | null
  prochaine_date?: string | null
  employes?: { nom: string } | null
  charges?: { id: string; numero: string; statut: string; montant_ttc_xaf: number; montant_paye_xaf: number } | null
}

interface ChargeLiee {
  id: string
  numero: string
  fournisseur_nom: string
  statut: string
  montant_ttc_xaf: number
  montant_paye_xaf: number
  date_charge: string
  description?: string | null
}

type DetailEquipement = Equipement & {
  maintenances: Maintenance[]
  charges: ChargeLiee[]
  cout_maintenance_total: number
}

interface EquipementsResponse { data: Equipement[]; total: number }
interface DashboardEquipements {
  kpis: {
    total: number
    operationnels: number
    en_panne: number
    maintenance: number
    revisions_a_prevoir: number
    revisions_en_retard: number
    remplacements_a_prevoir: number
    valeur_actifs_xaf: number
    cout_maintenance_annee_xaf: number
    charges_liees_xaf: number
    reste_charges_xaf: number
  }
}

const CATEGORIE_LABELS: Record<CategorieEquip, string> = {
  machine_production: 'Machine de production',
  outillage: 'Outillage',
  informatique: 'Informatique',
  logiciel: 'Logiciel',
  vehicule: 'Véhicule',
  securite: 'Sécurité',
  autre: 'Autre',
  outil: 'Outil',
  machine_legere: 'Machine légère',
  instrument: 'Instrument',
  epi: 'EPI',
}

const STATUT_LABELS: Record<StatutEquip, string> = {
  disponible: 'Disponible',
  en_service: 'En service',
  maintenance: 'Maintenance',
  en_panne: 'En panne',
  hors_service: 'Hors service',
  remplacement_prevu: 'Remplacement prévu',
  cede: 'Cédé',
}

const TYPE_LABELS: Record<TypeIntervention, string> = {
  preventive: 'Préventive',
  corrective: 'Corrective',
  calibrage: 'Calibrage',
  remplacement: 'Remplacement',
  panne: 'Panne',
  reparation: 'Réparation',
  installation: 'Installation',
  audit: 'Audit',
}

const STATUT_COLORS: Record<StatutEquip, { bg: string; text: string }> = {
  disponible: { bg: '#dcfce7', text: '#15803d' },
  en_service: { bg: '#dbeafe', text: '#1d4ed8' },
  maintenance: { bg: '#fef3c7', text: '#d97706' },
  en_panne: { bg: '#fee2e2', text: '#dc2626' },
  hors_service: { bg: '#fee2e2', text: '#991b1b' },
  remplacement_prevu: { bg: '#ede9fe', text: '#6d28d9' },
  cede: { bg: '#f3f4f6', text: '#6b7280' },
}

const CRITICITE_COLORS: Record<Criticite, string> = {
  faible: '#6b7280',
  moyenne: '#1d4ed8',
  haute: '#d97706',
  critique: '#dc2626',
}

const DEFAULT_FORM = {
  code: '',
  designation: '',
  categorie: 'machine_production' as CategorieEquip,
  criticite: 'moyenne' as Criticite,
  marque: '',
  modele: '',
  numero_serie: '',
  fournisseur: '',
  date_acquisition: '',
  date_fin_garantie: '',
  date_remplacement_prevue: '',
  valeur_achat_xaf: 0,
  valeur_residuelle_xaf: 0,
  emplacement: '',
  prochaine_revision: '',
  intervalle_revision_j: 365,
  notes: '',
}

const DEFAULT_INTERVENTION = {
  type: 'preventive' as TypeIntervention,
  date_maintenance: new Date().toISOString().slice(0, 10),
  statut: 'planifie' as StatutIntervention,
  cout_xaf: 0,
  tva_xaf: 0,
  prochaine_date: '',
  description: '',
  creer_charge: false,
  fournisseur_nom: '',
  compte_charge: '624',
  mode_paiement: 'credit_fournisseur',
  compte_tresorerie: '',
  reference_paiement: '',
}

const INPUT_CLASS = 'w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C62828]'

function useEquipements(params?: { statut?: string; categorie?: string; search?: string }) {
  const qs = new URLSearchParams()
  if (params?.statut) qs.set('statut', params.statut)
  if (params?.categorie) qs.set('categorie', params.categorie)
  if (params?.search) qs.set('search', params.search)
  const q = qs.toString()
  return useQuery({
    queryKey: ['equipements', params],
    queryFn: () => apiClient.get<EquipementsResponse>(`/api/equipements${q ? `?${q}` : ''}`),
    staleTime: 30_000,
  })
}

function useEquipementsDashboard() {
  return useQuery({
    queryKey: ['equipements', 'dashboard'],
    queryFn: () => apiClient.get<DashboardEquipements>('/api/equipements/dashboard'),
    staleTime: 30_000,
  })
}

function useEquipementsAlertesRevision() {
  return useQuery({
    queryKey: ['equipements', 'alertes-revision'],
    queryFn: () => apiClient.get<{ data: (Equipement & { jours_restants: number })[]; total: number }>('/api/equipements/alertes-revision'),
    staleTime: 60_000,
  })
}

function useEquipementDetail(id?: string | null) {
  return useQuery({
    queryKey: ['equipements', 'detail', id],
    queryFn: () => apiClient.get<DetailEquipement>(`/api/equipements/${id}`),
    enabled: Boolean(id),
  })
}

function invalidateEquipements(qc: ReturnType<typeof useQueryClient>) {
  void qc.invalidateQueries({ queryKey: ['equipements'] })
  void qc.invalidateQueries({ queryKey: ['charges'] })
  void qc.invalidateQueries({ queryKey: ['charges-dashboard'] })
}

function useCreateEquipement() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: Record<string, unknown>) => apiClient.post<Equipement>('/api/equipements', payload),
    onSuccess: () => { invalidateEquipements(qc); toast.success('Équipement créé') },
    onError: (err: Error) => toast.error(err.message),
  })
}

function useUpdateStatutEquipement() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, statut, notes }: { id: string; statut: StatutEquip; notes?: string }) =>
      apiClient.patch<Equipement>(`/api/equipements/${id}/statut`, { statut, notes }),
    onSuccess: () => { invalidateEquipements(qc); toast.success('Statut mis à jour') },
    onError: (err: Error) => toast.error(err.message),
  })
}

function useCreateMaintenance() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: Record<string, unknown> }) =>
      apiClient.post<Maintenance>(`/api/equipements/${id}/maintenances`, payload),
    onSuccess: (_, vars) => {
      invalidateEquipements(qc)
      void qc.invalidateQueries({ queryKey: ['equipements', 'detail', vars.id] })
      toast.success('Intervention enregistrée')
    },
    onError: (err: Error) => toast.error(err.message),
  })
}

function useUpdateMaintenanceStatut() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ equipId, maintId, statut, prochaine_date }: { equipId: string; maintId: string; statut: StatutIntervention; prochaine_date?: string }) =>
      apiClient.patch<Maintenance>(`/api/equipements/${equipId}/maintenances/${maintId}/statut`, { statut, prochaine_date }),
    onSuccess: (_, vars) => {
      invalidateEquipements(qc)
      void qc.invalidateQueries({ queryKey: ['equipements', 'detail', vars.equipId] })
      toast.success('Intervention mise à jour')
    },
    onError: (err: Error) => toast.error(err.message),
  })
}

function AssetIcon({ categorie }: { categorie: CategorieEquip }) {
  if (categorie === 'informatique' || categorie === 'logiciel') return <Laptop className="h-4 w-4" />
  if (categorie === 'machine_production' || categorie === 'machine_legere') return <Settings className="h-4 w-4" />
  if (categorie === 'outillage' || categorie === 'outil') return <Hammer className="h-4 w-4" />
  return <Cpu className="h-4 w-4" />
}

export default function Equipements() {
  const { role } = useAuth()
  const canEdit = role === 'admin' || role === 'superviseur'

  const [search, setSearch] = useState('')
  const [filtreStatut, setFiltreStatut] = useState('')
  const [filtreCategorie, setFiltreCategorie] = useState('')
  const [tab, setTab] = useState<'all' | 'alertes'>('all')
  const [slideOpen, setSlideOpen] = useState(false)
  const [detailId, setDetailId] = useState<string | null>(null)
  const [interventionOpen, setInterventionOpen] = useState(false)
  const [form, setForm] = useState(DEFAULT_FORM)
  const [intervention, setIntervention] = useState(DEFAULT_INTERVENTION)
  const [formError, setFormError] = useState<string | null>(null)

  const { data, isLoading } = useEquipements({ search, statut: filtreStatut, categorie: filtreCategorie })
  const { data: dashboard } = useEquipementsDashboard()
  const { data: alertesData } = useEquipementsAlertesRevision()
  const { data: detail } = useEquipementDetail(detailId)
  const createEquipement = useCreateEquipement()
  const updateStatut = useUpdateStatutEquipement()
  const createMaintenance = useCreateMaintenance()
  const updateMaintenance = useUpdateMaintenanceStatut()

  const equipements = data?.data ?? []
  const alertes = alertesData?.data ?? []
  const displayed = tab === 'alertes' ? alertes : equipements
  const kpis = dashboard?.kpis

  const coutTtcIntervention = useMemo(
    () => Math.round(Number(intervention.cout_xaf ?? 0) + Number(intervention.tva_xaf ?? 0)),
    [intervention.cout_xaf, intervention.tva_xaf],
  )

  const handleCreate = () => {
    if (!form.code.trim()) { setFormError('Le code est obligatoire'); return }
    if (!form.designation.trim()) { setFormError('La désignation est obligatoire'); return }
    setFormError(null)
    createEquipement.mutate({
      ...form,
      valeur_achat_xaf: form.valeur_achat_xaf || 0,
      valeur_residuelle_xaf: form.valeur_residuelle_xaf || 0,
      intervalle_revision_j: form.intervalle_revision_j || 365,
      prochaine_revision: form.prochaine_revision || undefined,
      date_acquisition: form.date_acquisition || undefined,
      date_fin_garantie: form.date_fin_garantie || undefined,
      date_remplacement_prevue: form.date_remplacement_prevue || undefined,
      numero_serie: form.numero_serie || undefined,
      fournisseur: form.fournisseur || undefined,
      marque: form.marque || undefined,
      modele: form.modele || undefined,
      emplacement: form.emplacement || undefined,
      notes: form.notes || undefined,
    }, { onSuccess: () => { setSlideOpen(false); setForm(DEFAULT_FORM) } })
  }

  const handleCreateIntervention = () => {
    if (!detailId) return
    createMaintenance.mutate({
      id: detailId,
      payload: {
        ...intervention,
        cout_xaf: Number(intervention.cout_xaf ?? 0),
        tva_xaf: Number(intervention.tva_xaf ?? 0),
        prochaine_date: intervention.prochaine_date || undefined,
        description: intervention.description || undefined,
        fournisseur_nom: intervention.fournisseur_nom || undefined,
        compte_charge: intervention.compte_charge || undefined,
        mode_paiement: intervention.creer_charge ? intervention.mode_paiement : undefined,
        compte_tresorerie: intervention.compte_tresorerie || undefined,
        reference_paiement: intervention.reference_paiement || undefined,
      },
    }, { onSuccess: () => { setInterventionOpen(false); setIntervention(DEFAULT_INTERVENTION) } })
  }

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.3 }} className="space-y-6">
      <PageHeader
        title="Équipements"
        subtitle={`${data?.total ?? 0} actif${(data?.total ?? 0) > 1 ? 's' : ''} de production, atelier et informatique`}
        breadcrumbs={[{ label: 'FORGE', href: '/' }, { label: 'Équipements' }]}
        actions={canEdit ? (
          <Button size="sm" onClick={() => { setForm(DEFAULT_FORM); setFormError(null); setSlideOpen(true) }}>
            <Plus className="h-3.5 w-3.5" /> Nouvel équipement
          </Button>
        ) : undefined}
      />

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        {[
          { label: 'Actifs', value: kpis?.total ?? 0, tone: '#212121' },
          { label: 'Opérationnels', value: kpis?.operationnels ?? 0, tone: '#15803d' },
          { label: 'En panne', value: kpis?.en_panne ?? 0, tone: '#dc2626' },
          { label: 'Maintenance', value: kpis?.maintenance ?? 0, tone: '#d97706' },
          { label: 'Coût annuel', value: formatXAF(kpis?.cout_maintenance_annee_xaf ?? 0), tone: '#1d4ed8' },
        ].map((item) => (
          <div key={item.label} className="bg-white border border-gray-100 rounded-lg p-4 shadow-sm">
            <p className="text-xs text-gray-400">{item.label}</p>
            <p className="mt-1 text-lg font-bold" style={{ color: item.tone }}>{item.value}</p>
          </div>
        ))}
      </div>

      {(alertes.length > 0 || (kpis?.remplacements_a_prevoir ?? 0) > 0) && (
        <button onClick={() => setTab('alertes')} className="w-full flex items-center gap-3 px-4 py-3 bg-amber-50 border border-amber-200 rounded-lg text-left hover:bg-amber-100 transition-colors">
          <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-bold text-amber-700">
              {(kpis?.revisions_en_retard ?? 0) > 0
                ? `${kpis?.revisions_en_retard} révision(s) en retard`
                : `${alertes.length} révision(s) à prévoir`}
            </p>
            <p className="text-xs text-amber-600 mt-0.5">
              {(kpis?.remplacements_a_prevoir ?? 0) > 0 ? `${kpis?.remplacements_a_prevoir} remplacement(s) à anticiper` : 'Planning préventif à jour'}
            </p>
          </div>
        </button>
      )}

      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex border border-gray-200 rounded-lg overflow-hidden">
          {(['all', 'alertes'] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)} className="px-3 py-1.5 text-xs font-medium transition-colors" style={{ backgroundColor: tab === t ? '#C62828' : 'transparent', color: tab === t ? 'white' : '#6b7280' }}>
              {t === 'all' ? 'Tous' : `Alertes (${alertes.length})`}
            </button>
          ))}
        </div>
        <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Rechercher..." className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C62828]" />
        <select value={filtreCategorie} onChange={(e) => setFiltreCategorie(e.target.value)} className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C62828]">
          <option value="">Toutes catégories</option>
          {Object.entries(CATEGORIE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <select value={filtreStatut} onChange={(e) => setFiltreStatut(e.target.value)} className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C62828]">
          <option value="">Tous statuts</option>
          {Object.entries(STATUT_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {[...Array(6)].map((_, i) => <div key={i} className="h-48 bg-gray-100 rounded-lg animate-pulse" />)}
        </div>
      ) : displayed.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-gray-400">
          <Wrench className="h-10 w-10 mb-3 text-gray-200" />
          <p className="text-sm">{tab === 'alertes' ? 'Aucune maintenance à prévoir' : 'Aucun équipement trouvé'}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {displayed.map((e) => {
            const statut = STATUT_COLORS[e.statut] ?? STATUT_COLORS.disponible
            const overdue = Boolean(e.revision_depassee)
            const remplacement = e.date_remplacement_prevue && e.date_remplacement_prevue <= new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10)
            return (
              <button key={e.id} onClick={() => setDetailId(e.id)} className="text-left bg-white rounded-lg border shadow-sm p-4 space-y-3 hover:shadow-md transition-shadow" style={{ borderColor: overdue || remplacement ? '#fca5a5' : '#f3f4f6' }}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-gray-400">
                      <AssetIcon categorie={e.categorie} />
                      <span className="text-xs font-mono">{e.code}</span>
                      {(overdue || remplacement) && <AlertTriangle className="h-3.5 w-3.5 text-red-500 shrink-0" />}
                    </div>
                    <p className="text-sm font-semibold text-[#212121] truncate mt-1">{e.designation}</p>
                    <p className="text-xs text-gray-400">{CATEGORIE_LABELS[e.categorie] ?? e.categorie}</p>
                  </div>
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0" style={{ backgroundColor: statut.bg, color: statut.text }}>
                    {STATUT_LABELS[e.statut] ?? e.statut}
                  </span>
                </div>

                <div className="text-xs text-gray-500 space-y-1">
                  {e.emplacement && <p>Emplacement : {e.emplacement}</p>}
                  {e.marque || e.modele ? <p>{[e.marque, e.modele].filter(Boolean).join(' ')}</p> : null}
                  {e.criticite && <p>Criticité : <span style={{ color: CRITICITE_COLORS[e.criticite] }}>{e.criticite}</span></p>}
                  {e.prochaine_revision && <p className={overdue ? 'text-red-600 font-medium' : ''}>Révision : {e.prochaine_revision}{overdue ? ' (en retard)' : ''}</p>}
                  {e.date_remplacement_prevue && <p className={remplacement ? 'text-red-600 font-medium' : ''}>Remplacement prévu : {e.date_remplacement_prevue}</p>}
                </div>

                {canEdit && (
                  <select
                    value={e.statut}
                    onClick={(ev) => ev.stopPropagation()}
                    onChange={(ev) => updateStatut.mutate({ id: e.id, statut: ev.target.value as StatutEquip })}
                    className="w-full text-xs px-2 py-1.5 border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-1 focus:ring-[#C62828]"
                  >
                    {Object.entries(STATUT_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                )}
              </button>
            )
          })}
        </div>
      )}

      <SlideOver isOpen={slideOpen} onClose={() => setSlideOpen(false)} title="Nouvel équipement" width="lg">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Code *"><input value={form.code} onChange={e => setForm(f => ({ ...f, code: e.target.value }))} className={INPUT_CLASS} placeholder="EQ-001" /></Field>
            <Field label="Catégorie"><select value={form.categorie} onChange={e => setForm(f => ({ ...f, categorie: e.target.value as CategorieEquip }))} className={INPUT_CLASS}>{Object.entries(CATEGORIE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
          </div>
          <Field label="Désignation *"><input value={form.designation} onChange={e => setForm(f => ({ ...f, designation: e.target.value }))} className={INPUT_CLASS} placeholder="ex. Presse hydraulique atelier" /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Criticité"><select value={form.criticite} onChange={e => setForm(f => ({ ...f, criticite: e.target.value as Criticite }))} className={INPUT_CLASS}><option value="faible">Faible</option><option value="moyenne">Moyenne</option><option value="haute">Haute</option><option value="critique">Critique</option></select></Field>
            <Field label="Emplacement"><input value={form.emplacement} onChange={e => setForm(f => ({ ...f, emplacement: e.target.value }))} className={INPUT_CLASS} /></Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Marque"><input value={form.marque} onChange={e => setForm(f => ({ ...f, marque: e.target.value }))} className={INPUT_CLASS} /></Field>
            <Field label="Modèle"><input value={form.modele} onChange={e => setForm(f => ({ ...f, modele: e.target.value }))} className={INPUT_CLASS} /></Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="N° série"><input value={form.numero_serie} onChange={e => setForm(f => ({ ...f, numero_serie: e.target.value }))} className={INPUT_CLASS} /></Field>
            <Field label="Fournisseur"><input value={form.fournisseur} onChange={e => setForm(f => ({ ...f, fournisseur: e.target.value }))} className={INPUT_CLASS} /></Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Date acquisition"><input type="date" value={form.date_acquisition} onChange={e => setForm(f => ({ ...f, date_acquisition: e.target.value }))} className={INPUT_CLASS} /></Field>
            <Field label="Fin garantie"><input type="date" value={form.date_fin_garantie} onChange={e => setForm(f => ({ ...f, date_fin_garantie: e.target.value }))} className={INPUT_CLASS} /></Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Prochaine révision"><input type="date" value={form.prochaine_revision} onChange={e => setForm(f => ({ ...f, prochaine_revision: e.target.value }))} className={INPUT_CLASS} /></Field>
            <Field label="Remplacement prévu"><input type="date" value={form.date_remplacement_prevue} onChange={e => setForm(f => ({ ...f, date_remplacement_prevue: e.target.value }))} className={INPUT_CLASS} /></Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Valeur achat XAF"><input type="number" min="0" value={form.valeur_achat_xaf || ''} onChange={e => setForm(f => ({ ...f, valeur_achat_xaf: Number(e.target.value) }))} className={INPUT_CLASS} /></Field>
            <Field label="Intervalle révision (j)"><input type="number" min="1" value={form.intervalle_revision_j} onChange={e => setForm(f => ({ ...f, intervalle_revision_j: Number(e.target.value) }))} className={INPUT_CLASS} /></Field>
          </div>
          <Field label="Notes"><textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={2} className={`${INPUT_CLASS} resize-none`} /></Field>
          {formError && <div className="px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">{formError}</div>}
          <div className="flex gap-3 pt-2 border-t border-gray-100">
            <Button variant="ghost" className="flex-1" onClick={() => setSlideOpen(false)}>Annuler</Button>
            <Button className="flex-1" disabled={!form.code.trim() || !form.designation.trim() || createEquipement.isPending} onClick={handleCreate}>
              {createEquipement.isPending ? 'Création...' : 'Créer'}
            </Button>
          </div>
        </div>
      </SlideOver>

      <SlideOver isOpen={Boolean(detailId)} onClose={() => setDetailId(null)} title={detail ? `${detail.code} - ${detail.designation}` : 'Équipement'} width="lg">
        {detail && (
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <Info label="Statut" value={STATUT_LABELS[detail.statut] ?? detail.statut} />
              <Info label="Catégorie" value={CATEGORIE_LABELS[detail.categorie] ?? detail.categorie} />
              <Info label="Criticité" value={detail.criticite ?? 'moyenne'} />
              <Info label="Emplacement" value={detail.emplacement ?? '-'} />
              <Info label="Fournisseur" value={detail.fournisseur ?? '-'} />
              <Info label="Coût maintenance" value={formatXAF(detail.cout_maintenance_total ?? 0)} />
            </div>

            {canEdit && (
              <div className="flex gap-2">
                <Button size="sm" onClick={() => { setIntervention(DEFAULT_INTERVENTION); setInterventionOpen(true) }}>
                  <Plus className="h-3.5 w-3.5" /> Intervention
                </Button>
                <Button size="sm" variant="secondary" onClick={() => updateStatut.mutate({ id: detail.id, statut: 'en_panne', notes: 'Panne signalée depuis la fiche équipement' })}>
                  <AlertTriangle className="h-3.5 w-3.5" /> Signaler panne
                </Button>
              </div>
            )}

            <SectionTitle icon={<Wrench className="h-4 w-4" />} title="Historique interventions" />
            <div className="space-y-2">
              {detail.maintenances.length === 0 && <Empty text="Aucune intervention enregistrée" />}
              {detail.maintenances.map((m) => (
                <div key={m.id} className="border border-gray-100 rounded-lg p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-[#212121]">{TYPE_LABELS[m.type] ?? m.type} · {m.date_maintenance}</p>
                      <p className="text-xs text-gray-500 mt-0.5">{m.description ?? 'Aucune description'}</p>
                      {m.charges && <p className="text-xs text-[#1d4ed8] mt-1">Charge {m.charges.numero} · {formatXAF(m.charges.montant_ttc_xaf)}</p>}
                    </div>
                    <div className="text-right">
                      <p className="text-xs font-bold text-gray-600">{m.statut}</p>
                      <p className="text-xs text-gray-400">{formatXAF(m.cout_xaf ?? 0)}</p>
                    </div>
                  </div>
                  {canEdit && m.statut !== 'fait' && m.statut !== 'annule' && (
                    <div className="flex gap-2 mt-2">
                      <Button size="sm" variant="ghost" onClick={() => updateMaintenance.mutate({ equipId: detail.id, maintId: m.id, statut: 'en_cours' })}>En cours</Button>
                      <Button size="sm" variant="ghost" onClick={() => updateMaintenance.mutate({ equipId: detail.id, maintId: m.id, statut: 'fait', prochaine_date: m.prochaine_date ?? undefined })}>Terminer</Button>
                    </div>
                  )}
                </div>
              ))}
            </div>

            <SectionTitle icon={<ReceiptText className="h-4 w-4" />} title="Charges liées" />
            <div className="space-y-2">
              {detail.charges.length === 0 && <Empty text="Aucune charge liée à cet équipement" />}
              {detail.charges.map((ch) => (
                <div key={ch.id} className="flex items-center justify-between border border-gray-100 rounded-lg p-3">
                  <div>
                    <p className="text-sm font-semibold text-[#212121]">{ch.numero} · {ch.fournisseur_nom}</p>
                    <p className="text-xs text-gray-500">{ch.date_charge} · {ch.statut}</p>
                  </div>
                  <p className="text-sm font-bold text-[#C62828]">{formatXAF(ch.montant_ttc_xaf)}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </SlideOver>

      <SlideOver isOpen={interventionOpen} onClose={() => setInterventionOpen(false)} title="Nouvelle intervention" width="md">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Type"><select value={intervention.type} onChange={e => setIntervention(f => ({ ...f, type: e.target.value as TypeIntervention }))} className={INPUT_CLASS}>{Object.entries(TYPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
            <Field label="Statut"><select value={intervention.statut} onChange={e => setIntervention(f => ({ ...f, statut: e.target.value as StatutIntervention }))} className={INPUT_CLASS}><option value="planifie">Planifiée</option><option value="en_cours">En cours</option><option value="fait">Faite</option><option value="annule">Annulée</option></select></Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Date"><input type="date" value={intervention.date_maintenance} onChange={e => setIntervention(f => ({ ...f, date_maintenance: e.target.value }))} className={INPUT_CLASS} /></Field>
            <Field label="Prochaine date"><input type="date" value={intervention.prochaine_date} onChange={e => setIntervention(f => ({ ...f, prochaine_date: e.target.value }))} className={INPUT_CLASS} /></Field>
          </div>
          <Field label="Description"><textarea rows={3} value={intervention.description} onChange={e => setIntervention(f => ({ ...f, description: e.target.value }))} className={`${INPUT_CLASS} resize-none`} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Coût HT XAF"><input type="number" min="0" value={intervention.cout_xaf || ''} onChange={e => setIntervention(f => ({ ...f, cout_xaf: Number(e.target.value) }))} className={INPUT_CLASS} /></Field>
            <Field label="TVA XAF"><input type="number" min="0" value={intervention.tva_xaf || ''} onChange={e => setIntervention(f => ({ ...f, tva_xaf: Number(e.target.value) }))} className={INPUT_CLASS} /></Field>
          </div>
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" checked={intervention.creer_charge} onChange={e => setIntervention(f => ({ ...f, creer_charge: e.target.checked }))} />
            Créer une charge liée dans Finance ({formatXAF(coutTtcIntervention)})
          </label>
          {intervention.creer_charge && (
            <div className="space-y-3 border border-gray-100 rounded-lg p-3">
              <Field label="Fournisseur"><input value={intervention.fournisseur_nom} onChange={e => setIntervention(f => ({ ...f, fournisseur_nom: e.target.value }))} className={INPUT_CLASS} /></Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Compte charge"><input value={intervention.compte_charge} onChange={e => setIntervention(f => ({ ...f, compte_charge: e.target.value }))} className={INPUT_CLASS} /></Field>
                <Field label="Modalité prévue"><select value={intervention.mode_paiement} onChange={e => setIntervention(f => ({ ...f, mode_paiement: e.target.value }))} className={INPUT_CLASS}><option value="credit_fournisseur">À payer</option><option value="caisse">Caisse</option><option value="banque">Banque</option><option value="mobile_money">Mobile money</option></select></Field>
              </div>
              {intervention.mode_paiement !== 'credit_fournisseur' && (
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Compte trésorerie"><input value={intervention.compte_tresorerie} onChange={e => setIntervention(f => ({ ...f, compte_tresorerie: e.target.value }))} className={INPUT_CLASS} placeholder="571 ou 521" /></Field>
                  <Field label="Référence"><input value={intervention.reference_paiement} onChange={e => setIntervention(f => ({ ...f, reference_paiement: e.target.value }))} className={INPUT_CLASS} /></Field>
                </div>
              )}
            </div>
          )}
          <div className="flex gap-3 pt-2 border-t border-gray-100">
            <Button variant="ghost" className="flex-1" onClick={() => setInterventionOpen(false)}>Annuler</Button>
            <Button className="flex-1" disabled={createMaintenance.isPending} onClick={handleCreateIntervention}>
              {createMaintenance.isPending ? 'Enregistrement...' : 'Enregistrer'}
            </Button>
          </div>
        </div>
      </SlideOver>
    </motion.div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">{label}</span>
      {children}
    </label>
  )
}

function Info({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="border border-gray-100 rounded-lg p-3">
      <p className="text-xs text-gray-400">{label}</p>
      <p className="mt-1 font-semibold text-[#212121]">{value}</p>
    </div>
  )
}

function SectionTitle({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <div className="flex items-center gap-2 text-sm font-bold text-[#212121] pt-2 border-t border-gray-100">
      {icon} {title}
    </div>
  )
}

function Empty({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-2 text-sm text-gray-400 border border-dashed border-gray-200 rounded-lg p-4">
      <CheckCircle className="h-4 w-4 text-gray-300" /> {text}
    </div>
  )
}
