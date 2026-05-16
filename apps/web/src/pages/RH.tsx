import React, { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Users, Calendar, DollarSign, GraduationCap,
  Star, Award, UserPlus, CheckCircle, Plus,
  Clock, Briefcase, FileText,
} from 'lucide-react'
import { PageHeader, DataTable, StatusBadge, Button, Modal } from '@forge/ui'
import type { Column } from '@forge/ui'
import { formatXAF, formatDate } from '@/lib/utils'

// ── Types ──────────────────────────────────────────────────────────────────────

interface Employe extends Record<string, unknown> {
  id: string; nom: string; poste: string; departement: string
  typeContrat: string; dateEntree: string
  salaire: number; statut: string
}

interface Presence extends Record<string, unknown> {
  id: string; employe: string; date: string
  arrivee: string; depart: string; heures: number; statut: string
}

interface Paie extends Record<string, unknown> {
  id: string; employe: string; salaire: number
  heuresSup: number; deductions: number; net: number; statut: string
}

interface Apprenant {
  id: string; nom: string; specialite: string
  niveau: number; dureeMois: number; statut: string
}

// ── Mock data ──────────────────────────────────────────────────────────────────

const EMPLOYES: Employe[] = [
  { id: '1', nom: 'Mvondo Serge', poste: 'Chef soudeur', departement: 'Production', typeContrat: 'CDI', dateEntree: '2022-03-01', salaire: 185000, statut: 'actif' },
  { id: '2', nom: 'Biya Christine', poste: 'Opératrice découpe', departement: 'Production', typeContrat: 'CDI', dateEntree: '2023-06-15', salaire: 145000, statut: 'actif' },
  { id: '3', nom: 'Atangana Félix', poste: 'Technicien CNC', departement: 'Production', typeContrat: 'CDD', dateEntree: '2025-01-10', salaire: 160000, statut: 'actif' },
  { id: '4', nom: 'Owona Julie', poste: 'Assistante admin', departement: 'Administration', typeContrat: 'CDI', dateEntree: '2021-09-01', salaire: 130000, statut: 'actif' },
  { id: '5', nom: 'Nkolo Pierre', poste: 'Magasinier', departement: 'Logistique', typeContrat: 'CDI', dateEntree: '2023-01-02', salaire: 120000, statut: 'actif' },
  { id: '6', nom: 'Essama Rachel', poste: 'Comptable', departement: 'Finance', typeContrat: 'CDI', dateEntree: '2020-11-15', salaire: 220000, statut: 'conge' },
]

const PRESENCES: Presence[] = [
  { id: '1', employe: 'Mvondo Serge', date: '2026-05-16', arrivee: '07:45', depart: '17:30', heures: 9.75, statut: 'present' },
  { id: '2', employe: 'Biya Christine', date: '2026-05-16', arrivee: '08:00', depart: '17:00', heures: 9.0, statut: 'present' },
  { id: '3', employe: 'Atangana Félix', date: '2026-05-16', arrivee: '08:15', depart: '17:00', heures: 8.75, statut: 'present' },
  { id: '4', employe: 'Owona Julie', date: '2026-05-16', arrivee: '08:00', depart: '17:00', heures: 9.0, statut: 'present' },
  { id: '5', employe: 'Nkolo Pierre', date: '2026-05-16', arrivee: '—', depart: '—', heures: 0, statut: 'absent' },
  { id: '6', employe: 'Essama Rachel', date: '2026-05-16', arrivee: '—', depart: '—', heures: 0, statut: 'conge' },
]

const PAIE: Paie[] = [
  { id: '1', employe: 'Mvondo Serge', salaire: 185000, heuresSup: 15000, deductions: 18500, net: 181500, statut: 'en_attente' },
  { id: '2', employe: 'Biya Christine', salaire: 145000, heuresSup: 0, deductions: 14500, net: 130500, statut: 'en_attente' },
  { id: '3', employe: 'Atangana Félix', salaire: 160000, heuresSup: 8000, deductions: 16000, net: 152000, statut: 'en_attente' },
  { id: '4', employe: 'Owona Julie', salaire: 130000, heuresSup: 0, deductions: 13000, net: 117000, statut: 'valide' },
  { id: '5', employe: 'Nkolo Pierre', salaire: 120000, heuresSup: 0, deductions: 12000, net: 108000, statut: 'en_attente' },
  { id: '6', employe: 'Essama Rachel', salaire: 220000, heuresSup: 0, deductions: 22000, net: 198000, statut: 'valide' },
]

const APPRENANTS: Apprenant[] = [
  { id: '1', nom: 'Mbarga Jean-Pierre', specialite: 'Soudure TIG/MIG', niveau: 5, dureeMois: 9, statut: 'actif' },
  { id: '2', nom: 'Ondoa Sylvie', specialite: 'Découpe plasma', niveau: 3, dureeMois: 5, statut: 'actif' },
  { id: '3', nom: 'Nguele Boris', specialite: 'Pliage hydraulique', niveau: 4, dureeMois: 7, statut: 'actif' },
  { id: '4', nom: 'Abena Laure', specialite: 'Usinage CNC', niveau: 2, dureeMois: 3, statut: 'actif' },
  { id: '5', nom: 'Fouda Emmanuel', specialite: 'Soudure TIG/MIG', niveau: 5, dureeMois: 12, statut: 'actif' },
  { id: '6', nom: 'Messi Brice', specialite: 'Contrôle qualité', niveau: 1, dureeMois: 1, statut: 'actif' },
]

// ── Tabs ───────────────────────────────────────────────────────────────────────

const TABS = ['Employés', 'Présences', 'Paie', 'Formation'] as const
type Tab = typeof TABS[number]

// ── Presence & Paie status helpers ────────────────────────────────────────────

const PRES_MAP: Record<string, { label: string; color: string; bg: string }> = {
  present: { label: 'Présent', color: '#15803d', bg: '#dcfce7' },
  absent:  { label: 'Absent',  color: '#dc2626', bg: '#fee2e2' },
  conge:   { label: 'Congé',   color: '#d97706', bg: '#fef3c7' },
  retard:  { label: 'Retard',  color: '#7c3aed', bg: '#ede9fe' },
}

const PAIE_MAP: Record<string, { label: string; color: string; bg: string }> = {
  en_attente: { label: 'En attente', color: '#d97706', bg: '#fef3c7' },
  valide:     { label: 'Validé',     color: '#15803d', bg: '#dcfce7' },
  vire:       { label: 'Viré',       color: '#1d4ed8', bg: '#dbeafe' },
}

function SmallBadge({ statut, map }: { statut: string; map: Record<string, { label: string; color: string; bg: string }> }) {
  const s = map[statut] ?? { label: statut, color: '#6b7280', bg: '#f3f4f6' }
  return <span className="text-xs font-semibold px-2 py-0.5 rounded-full" style={{ color: s.color, backgroundColor: s.bg }}>{s.label}</span>
}

// ── Ancienneté helper ──────────────────────────────────────────────────────────

function anciennete(dateEntree: string): string {
  const start = new Date(dateEntree)
  const now = new Date('2026-05-16')
  const months = (now.getFullYear() - start.getFullYear()) * 12 + now.getMonth() - start.getMonth()
  if (months >= 12) return `${Math.floor(months / 12)} an${Math.floor(months / 12) > 1 ? 's' : ''}`
  return `${months} mois`
}

// ── Star rating ────────────────────────────────────────────────────────────────

function StarRating({ level }: { level: number }) {
  return (
    <div className="flex gap-0.5">
      {Array.from({ length: 5 }).map((_, i) => (
        <Star key={i} className="h-4 w-4" style={{ fill: i < level ? '#f59e0b' : 'none', color: i < level ? '#f59e0b' : '#d1d5db' }} />
      ))}
    </div>
  )
}

// ── Recruit Modal ──────────────────────────────────────────────────────────────

function RecruterModal({ isOpen, onClose, apprenant }: { isOpen: boolean; onClose: () => void; apprenant: Apprenant | null }) {
  const [typeContrat, setTypeContrat] = useState<'CDI' | 'CDD'>('CDI')
  const [salaire, setSalaire] = useState('')
  const [dateDebut, setDateDebut] = useState(new Date().toISOString().split('T')[0])
  const [duree, setDuree] = useState('12')

  if (!apprenant) return null

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Créer un contrat employé" size="md">
      <div className="space-y-4">
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3">
          <div className="flex items-center gap-2">
            <Award className="h-4 w-4 text-emerald-600" />
            <div>
              <div className="text-sm font-bold text-emerald-800">{apprenant.nom}</div>
              <div className="text-xs text-emerald-600">{apprenant.specialite} — Niveau {apprenant.niveau}/5</div>
            </div>
          </div>
        </div>

        <div>
          <label className="block text-xs font-semibold text-gray-500 uppercase mb-2">Type de contrat</label>
          <div className="flex gap-4">
            {(['CDI', 'CDD'] as const).map((t) => (
              <label key={t} className="flex items-center gap-2 cursor-pointer">
                <input type="radio" checked={typeContrat === t} onChange={() => setTypeContrat(t)} className="accent-[#C62828]" />
                <span className="text-sm font-medium">{t}</span>
              </label>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">Date de début</label>
            <input type="date" value={dateDebut} onChange={(e) => setDateDebut(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#C62828]/30" />
          </div>
          {typeContrat === 'CDD' && (
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">Durée (mois)</label>
              <input type="number" value={duree} onChange={(e) => setDuree(e.target.value)} min={1} max={24}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#C62828]/30" />
            </div>
          )}
        </div>

        <div>
          <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">Salaire mensuel (FCFA)</label>
          <input type="number" value={salaire} onChange={(e) => setSalaire(e.target.value)} placeholder="Ex : 185 000"
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#C62828]/30" />
        </div>

        <div className="flex gap-2 justify-end pt-2">
          <Button variant="ghost" onClick={onClose}>Annuler</Button>
          <Button onClick={onClose}><UserPlus className="h-3.5 w-3.5" /> Recruter</Button>
        </div>
      </div>
    </Modal>
  )
}

// ── Apprenant Card ─────────────────────────────────────────────────────────────

function ApprenantCard({
  apprenant, isDirecteur, onNiveauSuivant, onRecruter,
}: {
  apprenant: Apprenant
  isDirecteur: boolean
  onNiveauSuivant: (a: Apprenant) => void
  onRecruter: (a: Apprenant) => void
}) {
  const progress = (apprenant.niveau / 5) * 100
  const isCandidatRecrutement = apprenant.niveau === 5 && apprenant.dureeMois >= 6
  const progressColor = progress >= 80 ? '#15803d' : progress >= 60 ? '#d97706' : '#C62828'

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-white border border-gray-100 rounded-xl p-5 shadow-sm space-y-4 flex flex-col"
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-[#ECEFF1] flex items-center justify-center text-[#37474F] font-bold text-sm shrink-0">
            {apprenant.nom.charAt(0)}
          </div>
          <div>
            <div className="font-semibold text-sm text-[#212121]">{apprenant.nom}</div>
            <div className="text-xs text-gray-400 mt-0.5">{apprenant.specialite}</div>
          </div>
        </div>
        {isCandidatRecrutement && (
          <span className="text-[10px] font-black px-2 py-1 rounded-full whitespace-nowrap shrink-0 border"
            style={{ color: '#15803d', backgroundColor: '#dcfce7', borderColor: '#bbf7d0' }}>
            CANDIDAT RECRUTEMENT
          </span>
        )}
      </div>

      {/* Stars & duration */}
      <div className="flex items-center justify-between">
        <StarRating level={apprenant.niveau} />
        <div className="flex items-center gap-1 text-xs text-gray-400">
          <Clock className="h-3 w-3" />
          {apprenant.dureeMois} mois de formation
        </div>
      </div>

      {/* Animated progress bar */}
      <div>
        <div className="flex justify-between text-xs text-gray-400 mb-1.5">
          <span>Niveau {apprenant.niveau}/5</span>
          <span>{Math.round(progress)}%</span>
        </div>
        <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: `${progress}%` }}
            transition={{ duration: 0.8, ease: 'easeOut', delay: 0.1 }}
            className="h-full rounded-full"
            style={{ backgroundColor: progressColor }}
          />
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-2 pt-1 mt-auto">
        {isDirecteur && apprenant.niveau < 5 && (
          <Button variant="secondary" size="sm" onClick={() => onNiveauSuivant(apprenant)}>
            <CheckCircle className="h-3.5 w-3.5" /> Valider Niveau {apprenant.niveau + 1}
          </Button>
        )}
        {isCandidatRecrutement && (
          <Button size="sm" onClick={() => onRecruter(apprenant)}>
            <UserPlus className="h-3.5 w-3.5" /> Recruter
          </Button>
        )}
      </div>
    </motion.div>
  )
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function RH() {
  const [activeTab, setActiveTab] = useState<Tab>('Employés')
  const [recruterApprenant, setRecruter] = useState<Apprenant | null>(null)
  const [moisPaie] = useState('2026-05')

  // Simulated: director sees validation button
  const isDirecteur = true

  const totalMasseSalariale = PAIE.reduce((s, p) => s + p.net, 0)

  const employeColumns: Column<Employe>[] = [
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
      id: 'contrat', header: 'Contrat', accessor: 'typeContrat',
      render: (v) => (
        <span className="text-xs font-semibold px-2 py-0.5 rounded-full"
          style={{ backgroundColor: v === 'CDI' ? '#dbeafe' : '#fef3c7', color: v === 'CDI' ? '#1d4ed8' : '#d97706' }}>
          {v as string}
        </span>
      ),
    },
    { id: 'entree', header: 'Ancienneté', accessor: 'dateEntree', render: (v) => <span className="text-sm text-gray-500">{anciennete(v as string)}</span> },
    { id: 'salaire', header: 'Salaire', accessor: 'salaire', render: (v) => <span className="text-sm font-semibold">{formatXAF(v as number)}</span> },
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

  const presenceColumns: Column<Presence>[] = [
    { id: 'employe', header: 'Employé', accessor: 'employe', render: (v) => <span className="text-sm font-semibold">{v as string}</span> },
    { id: 'date', header: 'Date', accessor: 'date', render: (v) => <span className="text-sm text-gray-500 font-mono">{formatDate(v as string)}</span> },
    { id: 'arrivee', header: 'Arrivée', accessor: 'arrivee', render: (v) => <span className="text-sm font-mono">{v as string}</span> },
    { id: 'depart', header: 'Départ', accessor: 'depart', render: (v) => <span className="text-sm font-mono">{v as string}</span> },
    { id: 'heures', header: 'Heures', accessor: 'heures', render: (v) => <span className="text-sm font-semibold">{(v as number) > 0 ? `${v}h` : '—'}</span> },
    { id: 'statut', header: 'Statut', accessor: 'statut', render: (v) => <SmallBadge statut={v as string} map={PRES_MAP} /> },
  ]

  const paieColumns: Column<Paie>[] = [
    { id: 'employe', header: 'Employé', accessor: 'employe', render: (v) => <span className="text-sm font-semibold">{v as string}</span> },
    { id: 'salaire', header: 'Salaire de base', accessor: 'salaire', render: (v) => <span className="text-sm">{formatXAF(v as number)}</span> },
    { id: 'sup', header: 'Heures sup.', accessor: 'heuresSup', render: (v) => <span className="text-sm text-[#1d4ed8]">{(v as number) > 0 ? `+${formatXAF(v as number)}` : '—'}</span> },
    { id: 'ded', header: 'Déductions', accessor: 'deductions', render: (v) => <span className="text-sm text-[#dc2626]">−{formatXAF(v as number)}</span> },
    { id: 'net', header: 'Net à payer', accessor: 'net', render: (v) => <span className="text-sm font-bold text-[#15803d]">{formatXAF(v as number)}</span> },
    { id: 'statut', header: 'Statut', accessor: 'statut', render: (v) => <SmallBadge statut={v as string} map={PAIE_MAP} /> },
  ]

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.3 }} className="space-y-6">
      <PageHeader
        title="Ressources Humaines"
        subtitle={`${EMPLOYES.length} employés · Masse salariale mai : ${formatXAF(totalMasseSalariale)}`}
        breadcrumbs={[{ label: 'FORGE', href: '/' }, { label: 'RH' }]}
        actions={
          activeTab === 'Employés' ? (
            <Button size="sm"><Plus className="h-3.5 w-3.5" /> Nouvel employé</Button>
          ) : activeTab === 'Paie' ? (
            <Button size="sm"><FileText className="h-3.5 w-3.5" /> Générer les bulletins</Button>
          ) : undefined
        }
      />

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        {/* Tab bar */}
        <div className="flex border-b border-gray-100 overflow-x-auto">
          {TABS.map((tab) => (
            <button key={tab} onClick={() => setActiveTab(tab)}
              className="px-4 py-3 text-sm font-medium whitespace-nowrap transition-colors relative flex items-center gap-2"
              style={{ color: activeTab === tab ? '#C62828' : '#6b7280' }}>
              {tab === 'Employés' && <Users className="h-3.5 w-3.5" />}
              {tab === 'Présences' && <Calendar className="h-3.5 w-3.5" />}
              {tab === 'Paie' && <DollarSign className="h-3.5 w-3.5" />}
              {tab === 'Formation' && <GraduationCap className="h-3.5 w-3.5" />}
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
              <DataTable<Employe> columns={employeColumns} data={EMPLOYES} keyField="id" />
            )}

            {/* ── Présences ── */}
            {activeTab === 'Présences' && (
              <div>
                <div className="flex items-center gap-3 px-5 pt-5">
                  <input type="date" defaultValue="2026-05-16"
                    className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#C62828]/30" />
                  <div className="flex gap-3 text-sm">
                    <span className="text-[#15803d] font-semibold">{PRESENCES.filter(p => p.statut === 'present').length} présents</span>
                    <span className="text-[#dc2626] font-semibold">{PRESENCES.filter(p => p.statut === 'absent').length} absent</span>
                    <span className="text-[#d97706] font-semibold">{PRESENCES.filter(p => p.statut === 'conge').length} congé</span>
                  </div>
                </div>
                <DataTable<Presence> columns={presenceColumns} data={PRESENCES} keyField="id" />
              </div>
            )}

            {/* ── Paie ── */}
            {activeTab === 'Paie' && (
              <div>
                <div className="flex items-center justify-between px-5 pt-5">
                  <div className="flex items-center gap-3">
                    <input type="month" value={moisPaie} readOnly
                      className="border border-gray-200 rounded-lg px-3 py-2 text-sm bg-gray-50 text-gray-500" />
                    <span className="text-sm text-gray-500">
                      Total net : <span className="font-bold text-[#212121]">{formatXAF(totalMasseSalariale)}</span>
                    </span>
                  </div>
                  <Button variant="secondary" size="sm">
                    <Briefcase className="h-3.5 w-3.5" /> Virer les salaires
                  </Button>
                </div>
                <DataTable<Paie> columns={paieColumns} data={PAIE} keyField="id" />
              </div>
            )}

            {/* ── Formation ── */}
            {activeTab === 'Formation' && (
              <div className="p-5">
                <div className="flex items-center justify-between mb-5">
                  <div>
                    <h3 className="font-semibold text-[#212121]">Apprenants en formation</h3>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {APPRENANTS.filter(a => a.niveau === 5 && a.dureeMois >= 6).length} candidat(s) au recrutement
                    </p>
                  </div>
                  <Button size="sm"><Plus className="h-3.5 w-3.5" /> Ajouter apprenant</Button>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {APPRENANTS.map((a, i) => (
                    <motion.div key={a.id} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.06 }}>
                      <ApprenantCard
                        apprenant={a}
                        isDirecteur={isDirecteur}
                        onNiveauSuivant={() => {}}
                        onRecruter={setRecruter}
                      />
                    </motion.div>
                  ))}
                </div>
              </div>
            )}

          </motion.div>
        </AnimatePresence>
      </div>

      <RecruterModal isOpen={!!recruterApprenant} onClose={() => setRecruter(null)} apprenant={recruterApprenant} />
    </motion.div>
  )
}
