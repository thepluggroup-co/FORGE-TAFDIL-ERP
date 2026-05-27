import React, { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Users, Calendar, DollarSign,
  Plus, Briefcase, FileText,
} from 'lucide-react'
import { PageHeader, DataTable, StatusBadge, Button, SlideOver } from '@forge/ui'
import type { Column } from '@forge/ui'
import { formatXAF, formatDate } from '@/lib/utils'
import {
  useEmployes, usePresences, useBulletinsPaie, useGenererPaie,
  useCreateEmploye,
} from '@/hooks/useRH'
import type { Employe as EmployeApi, Presence as PresenceApi, BulletinPaie } from '@/hooks/useRH'

// ── Types ──────────────────────────────────────────────────────────────────────

type EmployeRecord  = EmployeApi  & Record<string, unknown>
type PresenceRecord = PresenceApi & Record<string, unknown>
type BulletinRecord = BulletinPaie & Record<string, unknown>

// ── Tabs — Formation is a dedicated module, not a RH sub-tab ──────────────────

const TABS = ['Employés', 'Présences', 'Paie'] as const
type Tab = typeof TABS[number]

// ── Status helpers ─────────────────────────────────────────────────────────────


const PRES_MAP: Record<string, { label: string; color: string; bg: string }> = {
  present: { label: 'Présent', color: '#15803d', bg: '#dcfce7' },
  absent:  { label: 'Absent',  color: '#dc2626', bg: '#fee2e2' },
  conge:   { label: 'Congé',   color: '#d97706', bg: '#fef3c7' },
  retard:  { label: 'Retard',  color: '#7c3aed', bg: '#ede9fe' },
}

const PAIE_MAP: Record<string, { label: string; color: string; bg: string }> = {
  brouillon: { label: 'Brouillon', color: '#d97706', bg: '#fef3c7' },
  valide:    { label: 'Validé',    color: '#15803d', bg: '#dcfce7' },
  paye:      { label: 'Payé',      color: '#1d4ed8', bg: '#dbeafe' },
}

function SmallBadge({ statut, map }: { statut: string; map: Record<string, { label: string; color: string; bg: string }> }) {
  const s = map[statut] ?? { label: statut, color: '#6b7280', bg: '#f3f4f6' }
  return <span className="text-xs font-semibold px-2 py-0.5 rounded-full" style={{ color: s.color, backgroundColor: s.bg }}>{s.label}</span>
}

// ── Ancienneté ────────────────────────────────────────────────────────────────

function anciennete(dateEntree: string): string {
  const start  = new Date(dateEntree)
  const now    = new Date()
  const months = (now.getFullYear() - start.getFullYear()) * 12 + now.getMonth() - start.getMonth()
  if (months >= 12) return `${Math.floor(months / 12)} an${Math.floor(months / 12) > 1 ? 's' : ''}`
  return `${months} mois`
}

// ── Page ───────────────────────────────────────────────────────────────────────

interface NouvelEmployeForm {
  nom: string; poste: string; departement: string
  type_contrat: 'CDI' | 'CDD'; date_entree: string; salaire_base_xaf: number
}
const DEFAULT_EMP: NouvelEmployeForm = {
  nom: '', poste: '', departement: 'Atelier soudure',
  type_contrat: 'CDI', date_entree: new Date().toISOString().split('T')[0], salaire_base_xaf: 0,
}
const DEPARTEMENTS = ['Atelier soudure', 'Atelier découpe', 'Atelier CNC', 'Pliage', 'Logistique', 'Administration']

export default function RH() {
  const [activeTab, setActiveTab]  = useState<Tab>('Employés')
  const [presenceDate, setPresenceDate] = useState(new Date().toISOString().split('T')[0])
  const [moisPaie, setMoisPaie]    = useState(new Date().toISOString().slice(0, 7))
  const [empSlide, setEmpSlide]    = useState(false)
  const [empForm, setEmpForm]      = useState<NouvelEmployeForm>(DEFAULT_EMP)

  const { data: empData,       isLoading: empLoading }       = useEmployes()
  const { data: presData,      isLoading: presLoading }      = usePresences({ date: presenceDate })
  const { data: bulletinsData, isLoading: bulletinsLoading } = useBulletinsPaie({ mois: moisPaie })

  const genererPaie   = useGenererPaie()
  const createEmploye = useCreateEmploye()

  const employes  = (empData?.data ?? [])       as EmployeRecord[]
  const presences = (presData?.data ?? [])      as PresenceRecord[]
  const bulletins = (bulletinsData?.data ?? []) as BulletinRecord[]

  const totalMasseSalariale = bulletins.reduce((s, b) => s + (b.salaire_net_xaf as number), 0)

  const employeColumns: Column<EmployeRecord>[] = [
    {
      id: 'nom', header: 'Employé', accessor: 'nom',
      render: (v, row) => (
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-full bg-[#ECEFF1] flex items-center justify-center text-[#37474F] font-bold text-xs shrink-0">
            {(v as string).charAt(0)}
          </div>
          <div>
            <div className="text-sm font-semibold text-[#212121]">{v as string}</div>
            <div className="text-xs text-gray-400">{row.poste as string}</div>
          </div>
        </div>
      ),
    },
    { id: 'dept', header: 'Département', accessor: 'departement', render: (v) => <span className="text-sm">{v as string}</span> },
    {
      id: 'contrat', header: 'Contrat', accessor: 'type_contrat',
      render: (v) => (
        <span className="text-xs font-semibold px-2 py-0.5 rounded-full"
          style={{ backgroundColor: v === 'CDI' ? '#dbeafe' : '#fef3c7', color: v === 'CDI' ? '#1d4ed8' : '#d97706' }}>
          {v as string}
        </span>
      ),
    },
    { id: 'entree', header: 'Ancienneté', accessor: 'date_entree', render: (v) => <span className="text-sm text-gray-500">{anciennete(v as string)}</span> },
    { id: 'salaire', header: 'Salaire', accessor: 'salaire_base_xaf', render: (v) => <span className="text-sm font-semibold">{formatXAF(v as number)}</span> },
    { id: 'statut', header: 'Statut', accessor: 'statut', render: (v) => <StatusBadge status={v as string} /> },
    {
      id: 'actions', header: '', accessor: 'id', sortable: false,
      render: () => (
        <button className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors">
          <FileText className="h-3 w-3" /> Dossier
        </button>
      ),
    },
  ]

  const presenceColumns: Column<PresenceRecord>[] = [
    { id: 'employe', header: 'Employé', accessor: 'employe_nom', render: (v) => <span className="text-sm font-semibold">{v as string}</span> },
    { id: 'date', header: 'Date', accessor: 'date', render: (v) => <span className="text-sm text-gray-500 font-mono">{formatDate(v as string)}</span> },
    { id: 'arrivee', header: 'Arrivée', accessor: 'heure_arrivee', render: (v) => <span className="text-sm font-mono">{v as string}</span> },
    { id: 'depart', header: 'Départ', accessor: 'heure_depart', render: (v) => <span className="text-sm font-mono">{v as string}</span> },
    { id: 'heures', header: 'Heures', accessor: 'heures_travaillees', render: (v) => <span className="text-sm font-semibold">{(v as number) > 0 ? `${v}h` : '—'}</span> },
    { id: 'statut', header: 'Statut', accessor: 'statut', render: (v) => <SmallBadge statut={v as string} map={PRES_MAP} /> },
  ]

  const paieColumns: Column<BulletinRecord>[] = [
    { id: 'employe', header: 'Employé', accessor: 'employe_nom', render: (v) => <span className="text-sm font-semibold">{v as string}</span> },
    { id: 'brut', header: 'Salaire brut', accessor: 'salaire_brut_xaf', render: (v) => <span className="text-sm">{formatXAF(v as number)}</span> },
    { id: 'cnps', header: 'CNPS', accessor: 'cnps_salarie_xaf', render: (v) => <span className="text-sm text-[#dc2626]">−{formatXAF(v as number)}</span> },
    { id: 'irpp', header: 'IRPP', accessor: 'irpp_xaf', render: (v) => <span className="text-sm text-[#dc2626]">−{formatXAF(v as number)}</span> },
    { id: 'net', header: 'Net à payer', accessor: 'salaire_net_xaf', render: (v) => <span className="text-sm font-bold text-[#15803d]">{formatXAF(v as number)}</span> },
    { id: 'statut', header: 'Statut', accessor: 'statut', render: (v) => <SmallBadge statut={v as string} map={PAIE_MAP} /> },
  ]

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.3 }} className="space-y-6">
      <PageHeader
        title="Ressources Humaines"
        subtitle={`${empData?.total ?? 0} employés · Masse salariale : ${formatXAF(totalMasseSalariale)}`}
        breadcrumbs={[{ label: 'FORGE', href: '/' }, { label: 'RH' }]}
        actions={
          activeTab === 'Employés' ? (
            <Button size="sm" onClick={() => { setEmpForm(DEFAULT_EMP); setEmpSlide(true) }}><Plus className="h-3.5 w-3.5" /> Nouvel employé</Button>
          ) : activeTab === 'Paie' ? (
            <Button size="sm" disabled={genererPaie.isPending} onClick={() => genererPaie.mutate(moisPaie)}>
              <FileText className="h-3.5 w-3.5" /> {genererPaie.isPending ? 'Génération…' : 'Générer les bulletins'}
            </Button>
          ) : undefined
        }
      />

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="flex border-b border-gray-100 overflow-x-auto">
          {TABS.map((tab) => (
            <button key={tab} onClick={() => setActiveTab(tab)}
              className="px-4 py-3 text-sm font-medium whitespace-nowrap transition-colors relative flex items-center gap-2"
              style={{ color: activeTab === tab ? '#C62828' : '#6b7280' }}>
              {tab === 'Employés' && <Users className="h-3.5 w-3.5" />}
              {tab === 'Présences' && <Calendar className="h-3.5 w-3.5" />}
              {tab === 'Paie' && <DollarSign className="h-3.5 w-3.5" />}
              {tab}
              {activeTab === tab && (
                <motion.div layoutId="rh-tab" className="absolute bottom-0 inset-x-0 h-0.5 rounded-full" style={{ backgroundColor: '#C62828' }} />
              )}
            </button>
          ))}
        </div>

        <AnimatePresence mode="wait">
          <motion.div key={activeTab} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.2 }}>

            {/* ── Employés ── */}
            {activeTab === 'Employés' && (
              <DataTable<EmployeRecord> columns={employeColumns} data={employes} keyField="id" loading={empLoading} />
            )}

            {/* ── Présences ── */}
            {activeTab === 'Présences' && (
              <div>
                <div className="flex items-center gap-3 px-5 pt-5">
                  <input type="date" value={presenceDate} onChange={(e) => setPresenceDate(e.target.value)}
                    className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#C62828]/30" />
                  <div className="flex gap-3 text-sm">
                    <span className="text-[#15803d] font-semibold">{presences.filter(p => p.statut === 'present').length} présents</span>
                    <span className="text-[#dc2626] font-semibold">{presences.filter(p => p.statut === 'absent').length} absent</span>
                    <span className="text-[#d97706] font-semibold">{presences.filter(p => p.statut === 'conge').length} congé</span>
                  </div>
                </div>
                <DataTable<PresenceRecord> columns={presenceColumns} data={presences} keyField="id" loading={presLoading} />
              </div>
            )}

            {/* ── Paie ── */}
            {activeTab === 'Paie' && (
              <div>
                <div className="flex items-center justify-between px-5 pt-5">
                  <div className="flex items-center gap-3">
                    <input type="month" value={moisPaie} onChange={(e) => setMoisPaie(e.target.value)}
                      className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#C62828]/30" />
                    <span className="text-sm text-gray-500">
                      Total net : <span className="font-bold text-[#212121]">{formatXAF(totalMasseSalariale)}</span>
                    </span>
                  </div>
                  <Button variant="secondary" size="sm">
                    <Briefcase className="h-3.5 w-3.5" /> Virer les salaires
                  </Button>
                </div>
                <DataTable<BulletinRecord> columns={paieColumns} data={bulletins} keyField="id" loading={bulletinsLoading} />
              </div>
            )}

          </motion.div>
        </AnimatePresence>
      </div>

      <SlideOver isOpen={empSlide} onClose={() => setEmpSlide(false)} title="Nouvel employé" width="md">
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">Nom complet *</label>
            <input value={empForm.nom} onChange={(e) => setEmpForm((f) => ({ ...f, nom: e.target.value }))}
              placeholder="ex. Kamga Jean-Pierre" className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C62828]" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">Poste *</label>
            <input value={empForm.poste} onChange={(e) => setEmpForm((f) => ({ ...f, poste: e.target.value }))}
              placeholder="ex. Technicien soudeur" className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C62828]" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">Département</label>
            <select value={empForm.departement} onChange={(e) => setEmpForm((f) => ({ ...f, departement: e.target.value }))}
              className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C62828]">
              {DEPARTEMENTS.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">Type de contrat</label>
              <select value={empForm.type_contrat} onChange={(e) => setEmpForm((f) => ({ ...f, type_contrat: e.target.value as 'CDI' | 'CDD' }))}
                className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C62828]">
                <option value="CDI">CDI</option>
                <option value="CDD">CDD</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">Date d'entrée</label>
              <input type="date" value={empForm.date_entree} onChange={(e) => setEmpForm((f) => ({ ...f, date_entree: e.target.value }))}
                className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C62828]" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">Salaire mensuel brut (FCFA) *</label>
            <input type="number" min="0" value={empForm.salaire_base_xaf} onChange={(e) => setEmpForm((f) => ({ ...f, salaire_base_xaf: Number(e.target.value) }))}
              placeholder="ex. 185 000" className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C62828]" />
          </div>
          <div className="flex gap-3 pt-2 border-t border-gray-100">
            <Button variant="ghost" className="flex-1" onClick={() => setEmpSlide(false)}>Annuler</Button>
            <Button
              className="flex-1"
              disabled={!empForm.nom || !empForm.poste || empForm.salaire_base_xaf <= 0 || createEmploye.isPending}
              onClick={() => {
                createEmploye.mutate(
                  {
                    nom: empForm.nom,
                    poste: empForm.poste,
                    departement: empForm.departement,
                    type_contrat: empForm.type_contrat,
                    date_entree: empForm.date_entree,
                    salaire_base_xaf: empForm.salaire_base_xaf,
                  },
                  {
                    onSuccess: () => {
                      setEmpSlide(false)
                      setEmpForm(DEFAULT_EMP)
                    },
                  },
                )
              }}
            >
              {createEmploye.isPending ? 'Enregistrement…' : 'Créer le dossier'}
            </Button>
          </div>
        </div>
      </SlideOver>
    </motion.div>
  )
}
