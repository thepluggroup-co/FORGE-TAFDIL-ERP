import React, { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Users, Calendar, DollarSign, Plus, Briefcase, FileText,
  Check, X, Clock, Download, AlertCircle, ChevronDown, ChevronUp,
  Eye, Loader2,
} from 'lucide-react'
import { PageHeader, DataTable, StatusBadge, Button, SlideOver } from '@forge/ui'
import type { Column } from '@forge/ui'
import { formatXAF, formatDate } from '@/lib/utils'
import {
  useEmployes, usePresences, useBulletinsPaie, useGenererPaie,
  useCreateEmploye, usePresenceBatch,
  useConges, useCreateConge, useApprouverConge, useSoldesConges,
  useUpdateStatutBulletin, useBulletinPdf,
  useAvancesSalaire, useCreateAvanceSalaire, useAnnulerAvanceSalaire,
  useRetenuesSalaire, useCreateRetenueSalaire, useAnnulerRetenueSalaire,
  useCotisationsSociales, useGenererCotisationsSociales, useUpdateStatutCotisationsSociales,
  usePaiePeriode, useValiderPaieMois, useVirerPaieMois,
  useControlePaie, useExportPaie,
} from '@/hooks/useRH'
import type {
  Employe as EmployeApi, Presence as PresenceApi, BulletinPaie,
  Conge, SoldeConge, AvanceSalaire, RetenueSalaire,
} from '@/hooks/useRH'
import { useAuth } from '@/context/AuthContext'

// ── Types ──────────────────────────────────────────────────────────────────────

type EmployeRecord  = EmployeApi  & Record<string, unknown>
type PresenceRecord = PresenceApi & Record<string, unknown>
type BulletinRecord = BulletinPaie & Record<string, unknown>
type CongeRecord    = Conge & Record<string, unknown>
type AvanceRecord   = AvanceSalaire & Record<string, unknown>
type RetenueRecord  = RetenueSalaire & Record<string, unknown>

// ── Tabs ───────────────────────────────────────────────────────────────────────

const TABS = ['Employés', 'Pointage', 'Congés', 'Paie'] as const
type Tab = typeof TABS[number]

// ── Status maps ────────────────────────────────────────────────────────────────

const PRES_MAP: Record<string, { label: string; color: string; bg: string }> = {
  present: { label: 'Présent',  color: '#15803d', bg: '#dcfce7' },
  absent:  { label: 'Absent',   color: '#dc2626', bg: '#fee2e2' },
  conge:   { label: 'Congé',    color: '#d97706', bg: '#fef3c7' },
  retard:  { label: 'Retard',   color: '#7c3aed', bg: '#ede9fe' },
  maladie: { label: 'Maladie',  color: '#0369a1', bg: '#e0f2fe' },
}

const CONGE_TYPE_MAP: Record<string, string> = {
  conge_paye:         'Congé payé',
  sans_solde:         'Sans solde',
  maladie:            'Maladie',
  maternite:          'Maternité',
  paternite:          'Paternité',
  evenement_familial: 'Événement familial',
}

const CONGE_STATUT_MAP: Record<string, { label: string; color: string; bg: string }> = {
  en_attente: { label: 'En attente', color: '#d97706', bg: '#fef3c7' },
  approuve:   { label: 'Approuvé',   color: '#15803d', bg: '#dcfce7' },
  refuse:     { label: 'Refusé',     color: '#dc2626', bg: '#fee2e2' },
  annule:     { label: 'Annulé',     color: '#6b7280', bg: '#f3f4f6' },
}

const PAIE_MAP: Record<string, { label: string; color: string; bg: string }> = {
  en_attente: { label: 'En attente', color: '#d97706', bg: '#fef3c7' },
  brouillon:  { label: 'Brouillon',  color: '#d97706', bg: '#fef3c7' },
  valide:     { label: 'Validé',     color: '#15803d', bg: '#dcfce7' },
  vire:       { label: 'Viré',       color: '#1d4ed8', bg: '#dbeafe' },
  paye:       { label: 'Payé',       color: '#1d4ed8', bg: '#dbeafe' },
}

const AVANCE_MAP: Record<string, { label: string; color: string; bg: string }> = {
  payee:   { label: 'Payée',   color: '#1d4ed8', bg: '#dbeafe' },
  deduite: { label: 'Déduite', color: '#15803d', bg: '#dcfce7' },
  annulee: { label: 'Annulée', color: '#6b7280', bg: '#f3f4f6' },
}

const RETENUE_MAP: Record<string, { label: string; color: string; bg: string }> = {
  active:  { label: 'Active',  color: '#d97706', bg: '#fef3c7' },
  deduite: { label: 'Déduite', color: '#15803d', bg: '#dcfce7' },
  annulee: { label: 'Annulée', color: '#6b7280', bg: '#f3f4f6' },
}

const COTISATION_MAP: Record<string, { label: string; color: string; bg: string }> = {
  calculee: { label: 'Calculée', color: '#d97706', bg: '#fef3c7' },
  validee:  { label: 'Validée',  color: '#15803d', bg: '#dcfce7' },
  payee:    { label: 'Payée',    color: '#1d4ed8', bg: '#dbeafe' },
}

const PAIE_PERIODE_MAP: Record<string, { label: string; color: string; bg: string }> = {
  calculee: { label: 'Calculée', color: '#d97706', bg: '#fef3c7' },
  validee:  { label: 'Validée',  color: '#15803d', bg: '#dcfce7' },
  viree:    { label: 'Virée',    color: '#1d4ed8', bg: '#dbeafe' },
}

const CONTROLE_PAIE_MAP: Record<string, { label: string; color: string; bg: string }> = {
  ok:      { label: 'OK',        color: '#15803d', bg: '#dcfce7' },
  warning: { label: 'Attention', color: '#d97706', bg: '#fef3c7' },
  error:   { label: 'Erreur',    color: '#dc2626', bg: '#fee2e2' },
}

function SmallBadge({ statut, map }: { statut: string; map: Record<string, { label: string; color: string; bg: string }> }) {
  const s = map[statut] ?? { label: statut, color: '#6b7280', bg: '#f3f4f6' }
  return (
    <span className="text-xs font-semibold px-2 py-0.5 rounded-full" style={{ color: s.color, backgroundColor: s.bg }}>
      {s.label}
    </span>
  )
}

function anciennete(dateEntree: string): string {
  const start  = new Date(dateEntree)
  const now    = new Date()
  const months = (now.getFullYear() - start.getFullYear()) * 12 + now.getMonth() - start.getMonth()
  if (months >= 12) return `${Math.floor(months / 12)} an${Math.floor(months / 12) > 1 ? 's' : ''}`
  return `${months} mois`
}

// ── Formulaire employé ─────────────────────────────────────────────────────────

interface NouvelEmployeForm {
  nom: string; poste: string; departement: string
  type_contrat: 'CDI' | 'CDD'; date_entree: string; salaire_base_xaf: number
  telephone: string; cnps: string
}
const DEFAULT_EMP: NouvelEmployeForm = {
  nom: '', poste: '', departement: 'Atelier soudure',
  type_contrat: 'CDI', date_entree: new Date().toISOString().split('T')[0],
  salaire_base_xaf: 0, telephone: '', cnps: '',
}
const DEPARTEMENTS = ['Atelier soudure', 'Atelier découpe', 'Atelier CNC', 'Pliage', 'Logistique', 'Administration']

interface AvanceSalaireForm {
  employe_id: string; date_avance: string; mois_deduction: string; montant_xaf: number
  mode_paiement: 'caisse' | 'banque' | 'mobile_money'
  reference_paiement: string; motif: string; notes: string
}
interface RetenueSalaireForm {
  employe_id: string; mois_deduction: string
  type: 'absence' | 'materiel' | 'pret_interne' | 'discipline' | 'autre'
  libelle: string; montant_xaf: number; notes: string
}

const createDefaultAvance = (mois: string): AvanceSalaireForm => ({
  employe_id: '',
  date_avance: new Date().toISOString().split('T')[0],
  mois_deduction: mois,
  montant_xaf: 0,
  mode_paiement: 'caisse',
  reference_paiement: '',
  motif: '',
  notes: '',
})

const createDefaultRetenue = (mois: string): RetenueSalaireForm => ({
  employe_id: '',
  mois_deduction: mois,
  type: 'autre',
  libelle: '',
  montant_xaf: 0,
  notes: '',
})

// ── Composant Pointage rapide ───────────────────────────────────────────────────

interface LignePointage {
  employe_id: string; nom: string; poste: string
  statut: PresenceApi['statut']; arrivee: string; depart: string; notes: string
  deja_enregistre: boolean
}

// ── Modal aperçu bulletin PDF ──────────────────────────────────────────────────

interface PdfModalProps {
  url: string | null
  filename: string
  onClose: () => void
}

function BulletinPdfModal({ url, filename, onClose }: PdfModalProps) {
  const [loaded, setLoaded] = useState(false)

  // libérer le blob URL à la fermeture
  useEffect(() => {
    return () => {
      if (url) URL.revokeObjectURL(url)
    }
  }, [url])

  if (!url) return null

  const handleDownload = () => {
    const a    = document.createElement('a')
    a.href     = url
    a.download = filename
    a.click()
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl flex flex-col w-full max-w-4xl" style={{ height: '90vh' }}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100 shrink-0">
          <div className="flex items-center gap-2.5">
            <FileText className="h-5 w-5 text-[#C62828]" />
            <span className="text-sm font-semibold text-gray-800 truncate max-w-xs">{filename}</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleDownload}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-[#C62828] text-white hover:bg-[#b71c1c] transition-colors"
            >
              <Download className="h-3.5 w-3.5" /> Télécharger
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Corps : iframe PDF */}
        <div className="relative flex-1 min-h-0 bg-gray-100">
          {!loaded && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-gray-400">
              <Loader2 className="h-8 w-8 animate-spin" />
              <span className="text-sm">Génération du PDF…</span>
            </div>
          )}
          <iframe
            src={url}
            title={filename}
            className="w-full h-full border-0 rounded-b-2xl"
            onLoad={() => setLoaded(true)}
          />
        </div>
      </div>
    </div>
  )
}

// ── Composant Pointage rapide ───────────────────────────────────────────────────

function PointageRapide({ employes, date, presencesExistantes }: {
  employes: EmployeApi[]
  date: string
  presencesExistantes: PresenceApi[]
}) {
  const presenceBatch = usePresenceBatch()

  const [lignes, setLignes] = useState<LignePointage[]>(() =>
    employes.map(e => {
      const existing = presencesExistantes.find(p => p.employe_id === e.id)
      return {
        employe_id:       e.id,
        nom:              e.nom,
        poste:            e.poste,
        statut:           existing?.statut ?? 'present',
        arrivee:          existing?.heure_arrivee ?? '08:00',
        depart:           existing?.heure_depart  ?? '17:00',
        notes:            existing?.notes ?? '',
        deja_enregistre:  !!existing,
      }
    }),
  )

  // Re-sync si la liste d'employés ou les présences changent
  React.useEffect(() => {
    setLignes(
      employes.map(e => {
        const existing = presencesExistantes.find(p => p.employe_id === e.id)
        return {
          employe_id:       e.id,
          nom:              e.nom,
          poste:            e.poste,
          statut:           existing?.statut ?? 'present',
          arrivee:          existing?.heure_arrivee ?? '08:00',
          depart:           existing?.heure_depart  ?? '17:00',
          notes:            existing?.notes ?? '',
          deja_enregistre:  !!existing,
        }
      }),
    )
  }, [employes.length, presencesExistantes.length, date])

  const maj = (idx: number, champ: Partial<LignePointage>) =>
    setLignes(prev => prev.map((l, i) => i === idx ? { ...l, ...champ } : l))

  const toutPresent = () =>
    setLignes(prev => prev.map(l => ({ ...l, statut: 'present' as const })))

  const nbPresents = lignes.filter(l => l.statut === 'present').length
  const nbAbsents  = lignes.filter(l => l.statut === 'absent').length
  const nbConge    = lignes.filter(l => l.statut === 'conge').length

  const enregistrer = () => {
    presenceBatch.mutate(
      lignes.map(l => ({
        employe_id: l.employe_id,
        date,
        arrivee:    ['present', 'retard'].includes(l.statut) ? l.arrivee : undefined,
        depart:     ['present', 'retard'].includes(l.statut) ? l.depart  : undefined,
        statut:     l.statut,
        notes:      l.notes || undefined,
      })),
    )
  }

  if (employes.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-gray-400">
        <Users className="h-12 w-12 mb-3 opacity-30" />
        <p className="text-sm">Aucun employé actif trouvé</p>
      </div>
    )
  }

  return (
    <div className="px-5 pb-5 space-y-4">
      {/* Compteurs */}
      <div className="flex items-center gap-4 py-3">
        <span className="text-sm font-semibold text-[#15803d]">{nbPresents} présent(s)</span>
        <span className="text-sm font-semibold text-[#dc2626]">{nbAbsents} absent(s)</span>
        <span className="text-sm font-semibold text-[#d97706]">{nbConge} congé(s)</span>
        <div className="flex-1" />
        <button onClick={toutPresent} className="text-xs text-[#C62828] font-semibold hover:underline">
          Tout présent
        </button>
        <Button
          size="sm"
          disabled={presenceBatch.isPending}
          onClick={enregistrer}
        >
          <Check className="h-3.5 w-3.5" />
          {presenceBatch.isPending ? 'Enregistrement…' : 'Enregistrer le pointage'}
        </Button>
      </div>

      {/* Grille de pointage */}
      <div className="grid gap-2">
        {lignes.map((l, idx) => {
          const cfg = PRES_MAP[l.statut]
          const showHeures = l.statut === 'present' || l.statut === 'retard'
          return (
            <div
              key={l.employe_id}
              className="flex items-center gap-3 p-3 rounded-xl border transition-colors"
              style={{ borderColor: cfg?.color + '40', backgroundColor: cfg?.bg }}
            >
              {/* Avatar */}
              <div
                className="w-9 h-9 rounded-full flex items-center justify-center text-white font-bold text-sm shrink-0"
                style={{ backgroundColor: cfg?.color ?? '#6b7280' }}
              >
                {l.nom.charAt(0).toUpperCase()}
              </div>

              {/* Nom + poste */}
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-[#212121] truncate">{l.nom}</div>
                <div className="text-xs text-gray-500 truncate">{l.poste}</div>
              </div>

              {/* Heures si présent/retard */}
              {showHeures && (
                <div className="flex items-center gap-1.5 text-xs">
                  <input
                    type="time" value={l.arrivee}
                    onChange={e => maj(idx, { arrivee: e.target.value })}
                    className="border border-gray-200 rounded px-1.5 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-[#C62828]/50 bg-white"
                  />
                  <span className="text-gray-400">→</span>
                  <input
                    type="time" value={l.depart}
                    onChange={e => maj(idx, { depart: e.target.value })}
                    className="border border-gray-200 rounded px-1.5 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-[#C62828]/50 bg-white"
                  />
                </div>
              )}

              {/* Statut */}
              <select
                value={l.statut}
                onChange={e => maj(idx, { statut: e.target.value as PresenceApi['statut'] })}
                className="text-xs font-semibold border-0 bg-transparent focus:outline-none cursor-pointer"
                style={{ color: cfg?.color }}
              >
                {Object.entries(PRES_MAP).map(([k, v]) => (
                  <option key={k} value={k}>{v.label}</option>
                ))}
              </select>

              {/* Déjà enregistré */}
              {l.deja_enregistre && (
                <span className="text-[10px] text-gray-400 font-medium">✓ Sauvé</span>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Composant Congés ───────────────────────────────────────────────────────────

interface CongeForm {
  employe_id: string; type: string
  date_debut: string; date_fin: string; jours_ouvres: number; motif: string
}
const DEFAULT_CONGE: CongeForm = {
  employe_id: '', type: 'conge_paye',
  date_debut: new Date().toISOString().split('T')[0],
  date_fin:   new Date().toISOString().split('T')[0],
  jours_ouvres: 1, motif: '',
}

function CongesTab({ employes }: { employes: EmployeApi[] }) {
  const [filtreStatut, setFiltreStatut] = useState<string>('en_attente')
  const [showForm, setShowForm]         = useState(false)
  const [showSoldes, setShowSoldes]     = useState(false)
  const [form, setForm]                 = useState<CongeForm>(DEFAULT_CONGE)
  const { role } = useAuth()
  const isAdmin = role === 'admin'

  const { data: congesData, isLoading } = useConges({ statut: filtreStatut || undefined })
  const { data: soldesData }            = useSoldesConges()
  const createConge    = useCreateConge()
  const approuverConge = useApprouverConge()

  const conges  = (congesData?.data ?? []) as CongeRecord[]
  const soldes  = (soldesData?.data ?? []) as SoldeConge[]

  const congeColumns: Column<CongeRecord>[] = [
    {
      id: 'employe', header: 'Employé', accessor: 'employes', sortable: false,
      render: (v, row) => {
        const emp = v as { nom: string; poste: string } | null
        return (
          <div>
            <div className="text-sm font-semibold">{emp?.nom ?? (row.employe_id as string).slice(0, 8)}</div>
            <div className="text-xs text-gray-400">{emp?.poste ?? ''}</div>
          </div>
        )
      },
    },
    {
      id: 'type', header: 'Type', accessor: 'type',
      render: v => <span className="text-sm">{CONGE_TYPE_MAP[v as string] ?? v as string}</span>,
    },
    {
      id: 'dates', header: 'Période', accessor: 'date_debut', sortable: false,
      render: (v, row) => (
        <span className="text-sm font-mono text-gray-600">
          {formatDate(v as string)} → {formatDate(row.date_fin as string)}
        </span>
      ),
    },
    {
      id: 'jours', header: 'Jours', accessor: 'jours_ouvres',
      render: v => <span className="text-sm font-bold">{v as number}j</span>,
    },
    {
      id: 'statut', header: 'Statut', accessor: 'statut',
      render: v => <SmallBadge statut={v as string} map={CONGE_STATUT_MAP} />,
    },
    {
      id: 'actions', header: '', accessor: 'id', sortable: false,
      render: (v, row) => row.statut !== 'en_attente' ? null : (
        <div className="flex items-center gap-1.5">
          {isAdmin && (
            <>
              <button
                onClick={() => approuverConge.mutate({ id: v as string, statut: 'approuve' })}
                disabled={approuverConge.isPending}
                className="flex items-center gap-1 px-2 py-1 text-xs font-medium rounded bg-green-50 text-green-700 hover:bg-green-100 transition-colors"
              >
                <Check className="h-3 w-3" /> Approuver
              </button>
              <button
                onClick={() => approuverConge.mutate({ id: v as string, statut: 'refuse' })}
                disabled={approuverConge.isPending}
                className="flex items-center gap-1 px-2 py-1 text-xs font-medium rounded bg-red-50 text-red-700 hover:bg-red-100 transition-colors"
              >
                <X className="h-3 w-3" /> Refuser
              </button>
            </>
          )}
        </div>
      ),
    },
  ]

  const submitConge = () => {
    if (!form.employe_id || !form.date_debut || !form.date_fin || form.jours_ouvres < 1) return
    createConge.mutate(
      { ...form, motif: form.motif || undefined },
      { onSuccess: () => { setShowForm(false); setForm(DEFAULT_CONGE) } },
    )
  }

  return (
    <div>
      {/* Filtres + actions */}
      <div className="flex items-center gap-3 px-5 pt-5 pb-3">
        <select
          value={filtreStatut}
          onChange={e => setFiltreStatut(e.target.value)}
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#C62828]/30"
        >
          <option value="">Tous</option>
          <option value="en_attente">En attente</option>
          <option value="approuve">Approuvés</option>
          <option value="refuse">Refusés</option>
        </select>
        <button
          onClick={() => setShowSoldes(s => !s)}
          className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors"
        >
          <Briefcase className="h-3.5 w-3.5" />
          Soldes de congés
          {showSoldes ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        </button>
        <div className="flex-1" />
        <Button size="sm" onClick={() => setShowForm(true)}>
          <Plus className="h-3.5 w-3.5" /> Demander un congé
        </Button>
      </div>

      {/* Soldes de congés */}
      {showSoldes && (
        <div className="mx-5 mb-4 rounded-xl border border-gray-100 bg-gray-50 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="text-left px-4 py-2 text-xs font-semibold text-gray-500 uppercase">Employé</th>
                <th className="text-right px-4 py-2 text-xs font-semibold text-gray-500 uppercase">Acquis</th>
                <th className="text-right px-4 py-2 text-xs font-semibold text-gray-500 uppercase">Pris</th>
                <th className="text-right px-4 py-2 text-xs font-semibold text-[#C62828] uppercase">Restants</th>
              </tr>
            </thead>
            <tbody>
              {soldes.map(s => (
                <tr key={s.employe_id} className="border-b border-gray-100 last:border-0 hover:bg-white transition-colors">
                  <td className="px-4 py-2 font-medium">{s.employe_nom}</td>
                  <td className="px-4 py-2 text-right text-gray-600">{s.jours_acquis}j</td>
                  <td className="px-4 py-2 text-right text-gray-600">{s.jours_pris}j</td>
                  <td className="px-4 py-2 text-right font-bold" style={{ color: s.jours_restants > 0 ? '#15803d' : '#dc2626' }}>
                    {s.jours_restants}j
                  </td>
                </tr>
              ))}
              {soldes.length === 0 && (
                <tr><td colSpan={4} className="text-center py-4 text-gray-400 text-xs">Aucune donnée</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Table des demandes */}
      <DataTable<CongeRecord> columns={congeColumns} data={conges} keyField="id" loading={isLoading} />

      {/* Formulaire demande */}
      <SlideOver isOpen={showForm} onClose={() => { setShowForm(false); setForm(DEFAULT_CONGE) }} title="Nouvelle demande de congé" width="md">
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">Employé *</label>
            <select value={form.employe_id} onChange={e => setForm(f => ({ ...f, employe_id: e.target.value }))}
              className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C62828]">
              <option value="">Sélectionner…</option>
              {employes.map(e => <option key={e.id} value={e.id}>{e.nom} — {e.poste}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">Type de congé *</label>
            <select value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))}
              className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C62828]">
              {Object.entries(CONGE_TYPE_MAP).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">Date début *</label>
              <input type="date" value={form.date_debut} onChange={e => setForm(f => ({ ...f, date_debut: e.target.value }))}
                className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C62828]" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">Date fin *</label>
              <input type="date" value={form.date_fin} onChange={e => setForm(f => ({ ...f, date_fin: e.target.value }))}
                className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C62828]" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">Nombre de jours ouvrés *</label>
            <input type="number" min="1" value={form.jours_ouvres} onChange={e => setForm(f => ({ ...f, jours_ouvres: Number(e.target.value) }))}
              className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C62828]" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">Motif</label>
            <textarea rows={2} value={form.motif} onChange={e => setForm(f => ({ ...f, motif: e.target.value }))}
              placeholder="Raison de l'absence…"
              className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C62828] resize-none" />
          </div>
          <div className="flex gap-3 pt-2 border-t border-gray-100">
            <Button variant="ghost" className="flex-1" onClick={() => { setShowForm(false); setForm(DEFAULT_CONGE) }}>Annuler</Button>
            <Button
              className="flex-1"
              disabled={!form.employe_id || !form.date_debut || !form.date_fin || createConge.isPending}
              onClick={submitConge}
            >
              {createConge.isPending ? 'Enregistrement…' : 'Soumettre la demande'}
            </Button>
          </div>
        </div>
      </SlideOver>
    </div>
  )
}

// ── Page principale ─────────────────────────────────────────────────────────────

export default function RH() {
  const [activeTab, setActiveTab]      = useState<Tab>('Employés')
  const [presenceDate, setPresenceDate] = useState(new Date().toISOString().split('T')[0])
  const [moisPaie, setMoisPaie]        = useState(new Date().toISOString().slice(0, 7))
  const [empSlide, setEmpSlide]        = useState(false)
  const [empForm, setEmpForm]          = useState<NouvelEmployeForm>(DEFAULT_EMP)
  const [avanceSlide, setAvanceSlide]  = useState(false)
  const [avanceForm, setAvanceForm]    = useState<AvanceSalaireForm>(() => createDefaultAvance(new Date().toISOString().slice(0, 7)))
  const [retenueSlide, setRetenueSlide] = useState(false)
  const [retenueForm, setRetenueForm]   = useState<RetenueSalaireForm>(() => createDefaultRetenue(new Date().toISOString().slice(0, 7)))
  const [paieReference, setPaieReference] = useState('')
  const [pdfModal, setPdfModal]        = useState<{ url: string; filename: string } | null>(null)

  const { data: empData,       isLoading: empLoading }       = useEmployes({ statut: 'actif' })
  const { data: presData,      isLoading: presLoading }      = usePresences({ date: presenceDate })
  const { data: bulletinsData, isLoading: bulletinsLoading } = useBulletinsPaie({ mois: moisPaie })
  const { data: avancesData,   isLoading: avancesLoading }   = useAvancesSalaire({ mois: moisPaie })
  const { data: retenuesData,  isLoading: retenuesLoading }  = useRetenuesSalaire({ mois: moisPaie })
  const { data: cotisations }                                = useCotisationsSociales(moisPaie)
  const { data: paiePeriode }                                = usePaiePeriode(moisPaie)
  const { data: controlePaie }                               = useControlePaie(moisPaie)

  const genererPaie      = useGenererPaie()
  const createEmploye    = useCreateEmploye()
  const updateStatut     = useUpdateStatutBulletin()
  const bulletinPdf      = useBulletinPdf()
  const createAvance     = useCreateAvanceSalaire()
  const annulerAvance    = useAnnulerAvanceSalaire()
  const createRetenue    = useCreateRetenueSalaire()
  const annulerRetenue   = useAnnulerRetenueSalaire()
  const genererCotisations = useGenererCotisationsSociales()
  const updateCotisations  = useUpdateStatutCotisationsSociales()
  const validerPaieMois    = useValiderPaieMois()
  const virerPaieMois      = useVirerPaieMois()
  const exportPaie         = useExportPaie()

  const employes  = (empData?.data ?? []) as EmployeApi[]
  const presences = (presData?.data ?? []) as PresenceRecord[]
  const bulletins = (bulletinsData?.data ?? []) as BulletinRecord[]
  const avances   = (avancesData?.data ?? []) as AvanceRecord[]
  const retenues  = (retenuesData?.data ?? []) as RetenueRecord[]

  const totalMasseSalariale = bulletins.reduce((s, b) => s + (b.salaire_net_xaf as number), 0)
  const totalBrut           = bulletins.reduce((s, b) => s + (b.salaire_brut_xaf as number), 0)
  const totalCNPS           = bulletins.reduce((s, b) => s + (b.cnps_salarie_xaf as number), 0)
  const totalIRPP           = bulletins.reduce((s, b) => s + (b.irpp_xaf as number), 0)
  const totalAvances        = bulletins.reduce((s, b) => s + ((b.avance_deduite_xaf as number) || 0), 0)
  const totalRetenues       = bulletins.reduce((s, b) => s + ((b.retenue_deduite_xaf as number) || 0), 0)
  const totalCoutEmployeur  = bulletins.reduce((s, b) => s + ((b.cout_employeur_xaf as number) || 0), 0)
  const bulletinsEnAttente  = bulletins.filter(b => b.statut === 'en_attente').length
  const bulletinsValides    = bulletins.filter(b => b.statut === 'valide').length
  const bulletinsVires      = bulletins.filter(b => b.statut === 'vire').length
  const avancesEnAttente    = avances.filter(a => a.statut === 'payee').length
  const retenuesEnAttente   = retenues.filter(r => r.statut === 'active').length
  const controlesErreur     = controlePaie?.controles.filter(c => c.niveau === 'error').length ?? 0
  const controlesAttention  = controlePaie?.controles.filter(c => c.niveau === 'warning').length ?? 0
  const tauxNetSurBrut      = totalBrut > 0 ? Math.round((totalMasseSalariale / totalBrut) * 100) : 0
  const paieVerrouillee     = bulletins.some(b => ['valide', 'vire'].includes(b.statut)) || ['validee', 'viree'].includes(paiePeriode?.statut ?? '')
  const paieRecalculable    = bulletins.length > 0 && !paieVerrouillee
  const paieADeductionsEnAttente = paieRecalculable && (avancesEnAttente > 0 || retenuesEnAttente > 0)

  // Colonnes employés
  const employeColumns: Column<EmployeRecord>[] = [
    {
      id: 'nom', header: 'Employé', accessor: 'nom',
      render: (v, row) => {
        const nom = (v as string) ?? ''
        return (
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-full bg-[#ECEFF1] flex items-center justify-center text-[#37474F] font-bold text-xs shrink-0">
              {nom ? nom.charAt(0).toUpperCase() : '?'}
            </div>
            <div>
              <div className="text-sm font-semibold text-[#212121]">{nom}</div>
              <div className="text-xs text-gray-400">{row.poste as string}</div>
            </div>
          </div>
        )
      },
    },
    { id: 'dept', header: 'Département', accessor: 'departement', render: v => <span className="text-sm">{v as string}</span> },
    {
      id: 'contrat', header: 'Contrat', accessor: 'type_contrat',
      render: v => (
        <span className="text-xs font-semibold px-2 py-0.5 rounded-full"
          style={{ backgroundColor: v === 'CDI' ? '#dbeafe' : '#fef3c7', color: v === 'CDI' ? '#1d4ed8' : '#d97706' }}>
          {v as string}
        </span>
      ),
    },
    { id: 'entree', header: 'Ancienneté', accessor: 'date_entree', render: v => <span className="text-sm text-gray-500">{anciennete(v as string)}</span> },
    { id: 'salaire', header: 'Salaire brut', accessor: 'salaire_base_xaf', render: v => <span className="text-sm font-semibold">{formatXAF(v as number)}</span> },
    { id: 'statut', header: 'Statut', accessor: 'statut', render: v => <StatusBadge status={v as string} /> },
  ]

  // Colonnes bulletins
  const paieColumns: Column<BulletinRecord>[] = [
    { id: 'employe', header: 'Employé', accessor: 'employe_nom', render: v => <span className="text-sm font-semibold">{v as string}</span> },
    { id: 'poste',   header: 'Poste',   accessor: 'poste',       render: v => <span className="text-xs text-gray-500">{v as string}</span> },
    { id: 'brut',    header: 'Brut',    accessor: 'salaire_brut_xaf',  render: v => <span className="text-sm">{formatXAF(v as number)}</span> },
    { id: 'cnps',    header: 'CNPS salarié', accessor: 'cnps_salarie_xaf', render: v => <span className="text-sm text-[#dc2626]">−{formatXAF(v as number)}</span> },
    { id: 'irpp',    header: 'IRPP',    accessor: 'irpp_xaf',    render: v => <span className="text-sm text-[#dc2626]">−{formatXAF(v as number)}</span> },
    { id: 'avance',  header: 'Avance',  accessor: 'avance_deduite_xaf', render: v => Number(v ?? 0) > 0 ? <span className="text-sm text-[#dc2626]">−{formatXAF(v as number)}</span> : <span className="text-xs text-gray-400">-</span> },
    { id: 'retenue', header: 'Retenue', accessor: 'retenue_deduite_xaf', render: v => Number(v ?? 0) > 0 ? <span className="text-sm text-[#dc2626]">−{formatXAF(v as number)}</span> : <span className="text-xs text-gray-400">-</span> },
    { id: 'net',     header: 'Net à payer', accessor: 'salaire_net_xaf', render: v => <span className="text-sm font-bold text-[#15803d]">{formatXAF(v as number)}</span> },
    {
      id: 'statut', header: 'Statut', accessor: 'statut',
      render: (v, row) => (
        <div className="flex items-center gap-2">
          <SmallBadge statut={v as string} map={PAIE_MAP} />
          {(v === 'en_attente' || v === 'brouillon') && (
            <button
              onClick={() => updateStatut.mutate({ id: row.id as string, statut: 'valide' })}
              className="text-xs text-[#15803d] font-medium hover:underline"
            >
              Valider
            </button>
          )}
          {v === 'valide' && (
            <button
              onClick={() => updateStatut.mutate({ id: row.id as string, statut: 'vire' })}
              className="text-xs text-[#1d4ed8] font-medium hover:underline"
            >
              Virer
            </button>
          )}
        </div>
      ),
    },
    {
      id: 'pdf', header: '', accessor: 'id', sortable: false,
      render: (v, row) => {
        const id  = v as string
        const nom = row.employe_nom as string
        const mois = row.mois as string
        const filename = `Bulletin-${nom.replace(/\s+/g, '-')}-${mois}.pdf`
        const isLoading = bulletinPdf.isPending && bulletinPdf.variables?.id === id
        return (
          <button
            onClick={() =>
              bulletinPdf.mutate(
                { id, nom, mois },
                { onSuccess: (url) => setPdfModal({ url, filename }) },
              )
            }
            disabled={bulletinPdf.isPending}
            className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-lg border border-[#C62828]/30 text-[#C62828] hover:bg-[#C62828]/5 transition-colors disabled:opacity-50"
          >
            {isLoading
              ? <Loader2 className="h-3 w-3 animate-spin" />
              : <Eye className="h-3 w-3" />
            }
            {isLoading ? 'Chargement…' : 'Voir PDF'}
          </button>
        )
      },
    },
  ]

  const avanceColumns: Column<AvanceRecord>[] = [
    { id: 'employe', header: 'Employé', accessor: 'employe_nom', render: v => <span className="text-sm font-semibold">{v as string}</span> },
    { id: 'date', header: 'Date', accessor: 'date_avance', render: v => <span className="text-sm text-gray-500">{formatDate(v as string)}</span> },
    { id: 'montant', header: 'Montant', accessor: 'montant_xaf', render: v => <span className="text-sm font-semibold">{formatXAF(v as number)}</span> },
    { id: 'mois', header: 'Déduction', accessor: 'mois_deduction', render: v => <span className="text-sm font-mono text-gray-500">{v as string}</span> },
    { id: 'mode', header: 'Paiement', accessor: 'mode_paiement', render: v => <span className="text-xs uppercase text-gray-500">{(v as string).replace('_', ' ')}</span> },
    { id: 'statut', header: 'Statut', accessor: 'statut', render: v => <SmallBadge statut={v as string} map={AVANCE_MAP} /> },
    {
      id: 'actions', header: '', accessor: 'id', sortable: false,
      render: (v, row) => row.statut !== 'payee' ? null : (
        <button
          onClick={() => annulerAvance.mutate(v as string)}
          disabled={annulerAvance.isPending}
          className="text-xs text-[#dc2626] font-medium hover:underline disabled:opacity-50"
        >
          Annuler
        </button>
      ),
    },
  ]

  const retenueColumns: Column<RetenueRecord>[] = [
    { id: 'employe', header: 'Employé', accessor: 'employe_nom', render: v => <span className="text-sm font-semibold">{v as string}</span> },
    { id: 'libelle', header: 'Libellé', accessor: 'libelle', render: (v, row) => (
      <div>
        <div className="text-sm font-medium text-[#212121]">{v as string}</div>
        <div className="text-xs text-gray-400">{row.type as string}</div>
      </div>
    ) },
    { id: 'montant', header: 'Montant', accessor: 'montant_xaf', render: v => <span className="text-sm font-semibold">{formatXAF(v as number)}</span> },
    { id: 'mois', header: 'Déduction', accessor: 'mois_deduction', render: v => <span className="text-sm font-mono text-gray-500">{v as string}</span> },
    { id: 'statut', header: 'Statut', accessor: 'statut', render: v => <SmallBadge statut={v as string} map={RETENUE_MAP} /> },
    {
      id: 'actions', header: '', accessor: 'id', sortable: false,
      render: (v, row) => row.statut !== 'active' ? null : (
        <button
          onClick={() => annulerRetenue.mutate(v as string)}
          disabled={annulerRetenue.isPending}
          className="text-xs text-[#dc2626] font-medium hover:underline disabled:opacity-50"
        >
          Annuler
        </button>
      ),
    },
  ]

  const submitAvance = () => {
    createAvance.mutate(
      {
        employe_id: avanceForm.employe_id,
        date_avance: avanceForm.date_avance,
        mois_deduction: avanceForm.mois_deduction,
        montant_xaf: avanceForm.montant_xaf,
        mode_paiement: avanceForm.mode_paiement,
        reference_paiement: avanceForm.reference_paiement || undefined,
        motif: avanceForm.motif || undefined,
        notes: avanceForm.notes || undefined,
      },
      {
        onSuccess: () => {
          setAvanceSlide(false)
          setAvanceForm(createDefaultAvance(moisPaie))
        },
      },
    )
  }

  const submitRetenue = () => {
    createRetenue.mutate(
      {
        employe_id: retenueForm.employe_id,
        mois_deduction: retenueForm.mois_deduction,
        type: retenueForm.type,
        libelle: retenueForm.libelle,
        montant_xaf: retenueForm.montant_xaf,
        notes: retenueForm.notes || undefined,
      },
      {
        onSuccess: () => {
          setRetenueSlide(false)
          setRetenueForm(createDefaultRetenue(moisPaie))
        },
      },
    )
  }

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.3 }} className="space-y-6">
      <PageHeader
        title="Ressources Humaines"
        subtitle={`${empData?.total ?? 0} employés actifs · Masse salariale : ${formatXAF(totalMasseSalariale)}`}
        breadcrumbs={[{ label: 'FORGE', href: '/' }, { label: 'RH' }]}
        actions={
          activeTab === 'Employés' ? (
            <Button size="sm" onClick={() => { setEmpForm(DEFAULT_EMP); setEmpSlide(true) }}>
              <Plus className="h-3.5 w-3.5" /> Nouvel employé
            </Button>
          ) : activeTab === 'Paie' ? (
            <div className="flex items-center gap-2">
              <Button size="sm" variant="secondary" onClick={() => { setAvanceForm(createDefaultAvance(moisPaie)); setAvanceSlide(true) }}>
                <Plus className="h-3.5 w-3.5" /> Nouvelle avance
              </Button>
              <Button size="sm" variant="ghost" onClick={() => { setRetenueForm(createDefaultRetenue(moisPaie)); setRetenueSlide(true) }}>
                <Plus className="h-3.5 w-3.5" /> Nouvelle retenue
              </Button>
              <Button size="sm" variant="ghost" disabled={exportPaie.isPending || bulletins.length === 0} onClick={() => exportPaie.mutate(moisPaie)}>
                <Download className="h-3.5 w-3.5" /> Export
              </Button>
              <Button
                size="sm"
                disabled={genererPaie.isPending || (bulletins.length > 0 && paieVerrouillee)}
                onClick={() => genererPaie.mutate({ mois: moisPaie, forcer: bulletins.length > 0 })}
              >
                <FileText className="h-3.5 w-3.5" />
                {genererPaie.isPending ? 'Calcul...' : bulletins.length > 0 ? 'Recalculer la paie' : 'Generer les bulletins'}
              </Button>
            </div>
          ) : undefined
        }
      />

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        {/* Tabs */}
        <div className="flex border-b border-gray-100 overflow-x-auto">
          {TABS.map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className="px-4 py-3 text-sm font-medium whitespace-nowrap transition-colors relative flex items-center gap-2"
              style={{ color: activeTab === tab ? '#C62828' : '#6b7280' }}
            >
              {tab === 'Employés' && <Users className="h-3.5 w-3.5" />}
              {tab === 'Pointage' && <Clock className="h-3.5 w-3.5" />}
              {tab === 'Congés'   && <Calendar className="h-3.5 w-3.5" />}
              {tab === 'Paie'     && <DollarSign className="h-3.5 w-3.5" />}
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
              <DataTable<EmployeRecord> columns={employeColumns} data={employes as EmployeRecord[]} keyField="id" loading={empLoading} />
            )}

            {/* ── Pointage rapide ── */}
            {activeTab === 'Pointage' && (
              <div>
                <div className="flex items-center gap-3 px-5 pt-5 pb-3">
                  <label className="text-sm font-medium text-gray-600">Date :</label>
                  <input
                    type="date" value={presenceDate}
                    onChange={e => setPresenceDate(e.target.value)}
                    className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#C62828]/30"
                  />
                  {presLoading && <span className="text-xs text-gray-400">Chargement…</span>}
                </div>
                {empLoading ? (
                  <div className="py-10 text-center text-gray-400 text-sm">Chargement des employés…</div>
                ) : (
                  <PointageRapide
                    employes={employes}
                    date={presenceDate}
                    presencesExistantes={presences as PresenceApi[]}
                  />
                )}
              </div>
            )}

            {/* ── Congés ── */}
            {activeTab === 'Congés' && (
              <CongesTab employes={employes} />
            )}

            {/* ── Paie ── */}
            {activeTab === 'Paie' && (
              <div>
                {/* Sélecteur mois + récapitulatif */}
                <div className="px-5 pt-5 space-y-4">
                  <div className="flex items-center gap-3 flex-wrap">
                    <input
                      type="month" value={moisPaie}
                      onChange={e => {
                        setMoisPaie(e.target.value)
                        setAvanceForm(f => ({ ...f, mois_deduction: e.target.value }))
                        setRetenueForm(f => ({ ...f, mois_deduction: e.target.value }))
                      }}
                      className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#C62828]/30"
                    />
                    <span className="text-sm text-gray-500">
                      Net total : <span className="font-bold text-[#212121]">{formatXAF(totalMasseSalariale)}</span>
                    </span>
                    <span className="text-sm text-gray-400">|</span>
                    <span className="text-sm text-gray-500">
                      Brut : <span className="font-semibold">{formatXAF(totalBrut)}</span>
                    </span>
                    <span className="text-sm text-gray-400">|</span>
                    <span className="text-sm text-gray-500">
                      CNPS : <span className="font-semibold text-[#dc2626]">{formatXAF(totalCNPS)}</span>
                    </span>
                    <span className="text-sm text-gray-400">|</span>
                    <span className="text-sm text-gray-500">
                      IRPP : <span className="font-semibold text-[#dc2626]">{formatXAF(totalIRPP)}</span>
                    </span>
                    <span className="text-sm text-gray-400">|</span>
                    <span className="text-sm text-gray-500">
                      Avances : <span className="font-semibold text-[#dc2626]">{formatXAF(totalAvances)}</span>
                    </span>
                    <span className="text-sm text-gray-400">|</span>
                    <span className="text-sm text-gray-500">
                      Retenues : <span className="font-semibold text-[#dc2626]">{formatXAF(totalRetenues)}</span>
                    </span>
                  </div>

                  <div className="border border-gray-100 rounded-lg overflow-hidden">
                    <div className="flex items-center justify-between gap-3 px-4 py-3 bg-gray-50 border-b border-gray-100">
                      <div>
                        <h3 className="text-sm font-semibold text-[#212121]">Dashboard Paie</h3>
                        <p className="text-xs text-gray-500">Vue mensuelle de la masse salariale, des statuts et des contrôles.</p>
                      </div>
                      <div className="flex items-center gap-2">
                        {paiePeriode && <SmallBadge statut={paiePeriode.statut} map={PAIE_PERIODE_MAP} />}
                        {controlePaie && <SmallBadge statut={controlePaie.statut_global} map={CONTROLE_PAIE_MAP} />}
                      </div>
                    </div>
                    <div className="grid grid-cols-2 lg:grid-cols-4">
                      <div className="p-4 border-r border-b border-gray-100 min-h-[96px]">
                        <div className="flex items-center gap-2 text-xs font-semibold text-gray-500 uppercase">
                          <DollarSign className="h-3.5 w-3.5 text-[#15803d]" /> Net à payer
                        </div>
                        <div className="mt-2 text-lg font-bold text-[#212121]">{formatXAF(paiePeriode?.net_a_payer_xaf ?? totalMasseSalariale)}</div>
                        <div className="mt-1 text-xs text-gray-400">{tauxNetSurBrut}% du brut calculé</div>
                      </div>
                      <div className="p-4 border-r border-b border-gray-100 min-h-[96px]">
                        <div className="flex items-center gap-2 text-xs font-semibold text-gray-500 uppercase">
                          <Briefcase className="h-3.5 w-3.5 text-[#37474F]" /> Coût employeur
                        </div>
                        <div className="mt-2 text-lg font-bold text-[#212121]">{formatXAF(paiePeriode?.cout_total_employeur_xaf ?? totalCoutEmployeur)}</div>
                        <div className="mt-1 text-xs text-gray-400">Brut + charges patronales</div>
                      </div>
                      <div className="p-4 border-r border-b border-gray-100 min-h-[96px]">
                        <div className="flex items-center gap-2 text-xs font-semibold text-gray-500 uppercase">
                          <FileText className="h-3.5 w-3.5 text-[#C62828]" /> Bulletins
                        </div>
                        <div className="mt-2 text-lg font-bold text-[#212121]">{bulletins.length}</div>
                        <div className="mt-1 text-xs text-gray-400">{bulletinsEnAttente} attente · {bulletinsValides} validés · {bulletinsVires} virés</div>
                      </div>
                      <div className="p-4 border-b border-gray-100 min-h-[96px]">
                        <div className="flex items-center gap-2 text-xs font-semibold text-gray-500 uppercase">
                          <AlertCircle className="h-3.5 w-3.5 text-[#d97706]" /> Contrôles
                        </div>
                        <div className="mt-2 text-lg font-bold text-[#212121]">{controlesErreur + controlesAttention}</div>
                        <div className="mt-1 text-xs text-gray-400">{controlesErreur} erreur(s) · {controlesAttention} attention(s)</div>
                      </div>
                      <div className="p-4 border-r border-gray-100 min-h-[96px]">
                        <div className="text-xs font-semibold text-gray-500 uppercase">Cotisations</div>
                        <div className="mt-2 text-sm font-bold text-[#212121]">{formatXAF((cotisations?.total_cnps_xaf ?? totalCNPS) + (cotisations?.irpp_xaf ?? totalIRPP))}</div>
                        <div className="mt-1 text-xs text-gray-400">CNPS + IRPP</div>
                      </div>
                      <div className="p-4 border-r border-gray-100 min-h-[96px]">
                        <div className="text-xs font-semibold text-gray-500 uppercase">Avances à traiter</div>
                        <div className="mt-2 text-sm font-bold text-[#212121]">{avancesEnAttente}</div>
                        <div className="mt-1 text-xs text-gray-400">{formatXAF(avancesData?.total_xaf ?? 0)} sur le mois</div>
                      </div>
                      <div className="p-4 border-r border-gray-100 min-h-[96px]">
                        <div className="text-xs font-semibold text-gray-500 uppercase">Retenues actives</div>
                        <div className="mt-2 text-sm font-bold text-[#212121]">{retenuesEnAttente}</div>
                        <div className="mt-1 text-xs text-gray-400">{formatXAF(retenuesData?.total_xaf ?? 0)} sur le mois</div>
                      </div>
                      <div className="p-4 min-h-[96px]">
                        <div className="text-xs font-semibold text-gray-500 uppercase">Statut période</div>
                        <div className="mt-2">{paiePeriode ? <SmallBadge statut={paiePeriode.statut} map={PAIE_PERIODE_MAP} /> : <SmallBadge statut="calculee" map={PAIE_PERIODE_MAP} />}</div>
                        <div className="mt-1 text-xs text-gray-400">{paiePeriode?.reference_paiement ? `Réf. ${paiePeriode.reference_paiement}` : 'Aucune référence paiement'}</div>
                      </div>
                    </div>
                  </div>

                  {bulletins.length === 0 && !bulletinsLoading && (
                    <div className="flex items-center gap-2 p-3 rounded-lg bg-amber-50 border border-amber-100 text-amber-700 text-sm">
                      <AlertCircle className="h-4 w-4 shrink-0" />
                      Aucun bulletin pour ce mois. Cliquez sur "Générer les bulletins" pour calculer.
                    </div>
                  )}
                </div>

                {paieADeductionsEnAttente && (
                  <div className="mx-5 mb-4 flex items-center justify-between gap-3 p-3 rounded-lg bg-amber-50 border border-amber-100 text-amber-700 text-sm">
                    <div className="flex items-center gap-2">
                      <AlertCircle className="h-4 w-4 shrink-0" />
                      <span>Avances ou retenues en attente de deduction. Recalculez la paie du mois.</span>
                    </div>
                    <Button size="sm" variant="ghost" disabled={genererPaie.isPending} onClick={() => genererPaie.mutate({ mois: moisPaie, forcer: true })}>
                      Recalculer
                    </Button>
                  </div>
                )}

                <DataTable<BulletinRecord> columns={paieColumns} data={bulletins} keyField="id" loading={bulletinsLoading} />

                <div className="border-t border-gray-100 px-5 py-4">
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div>
                      <h3 className="text-sm font-semibold text-[#212121]">Validation paie mensuelle</h3>
                      <p className="text-xs text-gray-500">La validation verrouille les bulletins et génère les écritures comptables de paie.</p>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      {paiePeriode && <SmallBadge statut={paiePeriode.statut} map={PAIE_PERIODE_MAP} />}
                      {(!paiePeriode || paiePeriode.statut === 'calculee') && (
                        <Button size="sm" disabled={validerPaieMois.isPending || bulletins.length === 0} onClick={() => validerPaieMois.mutate(moisPaie)}>
                          {validerPaieMois.isPending ? 'Validation…' : 'Valider le mois'}
                        </Button>
                      )}
                      {paiePeriode?.statut === 'validee' && (
                        <>
                          <input
                            value={paieReference}
                            onChange={e => setPaieReference(e.target.value)}
                            placeholder="Réf. paiement"
                            className="w-36 px-2.5 py-1.5 text-xs border border-gray-200 rounded-md focus:outline-none focus:ring-2 focus:ring-[#C62828]/30"
                          />
                          <Button
                            size="sm"
                            disabled={virerPaieMois.isPending}
                            onClick={() => virerPaieMois.mutate({ mois: moisPaie, mode_paiement: 'banque', reference_paiement: paieReference || undefined })}
                          >
                            {virerPaieMois.isPending ? 'Paiement…' : 'Virer la paie'}
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4">
                    <div><div className="text-xs text-gray-400">Net à payer</div><div className="text-sm font-semibold">{formatXAF(paiePeriode?.net_a_payer_xaf ?? totalMasseSalariale)}</div></div>
                    <div><div className="text-xs text-gray-400">Brut</div><div className="text-sm font-semibold">{formatXAF(paiePeriode?.total_brut_xaf ?? totalBrut)}</div></div>
                    <div><div className="text-xs text-gray-400">Avances + retenues</div><div className="text-sm font-semibold">{formatXAF((paiePeriode?.total_avances_deduites_xaf ?? totalAvances) + (paiePeriode?.total_retenues_deduites_xaf ?? totalRetenues))}</div></div>
                    <div><div className="text-xs text-gray-400">Coût employeur</div><div className="text-sm font-semibold">{formatXAF(paiePeriode?.cout_total_employeur_xaf ?? bulletins.reduce((s, b) => s + ((b.cout_employeur_xaf as number) || 0), 0))}</div></div>
                  </div>
                  {controlePaie && (
                    <div className="mt-4 rounded-lg border border-gray-100 overflow-hidden">
                      <div className="flex items-center justify-between gap-3 px-3 py-2 bg-gray-50">
                        <div className="text-xs font-semibold text-gray-600">Contrôles de cohérence</div>
                        <SmallBadge statut={controlePaie.statut_global} map={CONTROLE_PAIE_MAP} />
                      </div>
                      <div className="divide-y divide-gray-100">
                        {controlePaie.controles.slice(0, 6).map(ctrl => (
                          <div key={ctrl.code} className="flex items-center justify-between gap-3 px-3 py-2">
                            <span className="text-xs text-gray-600">{ctrl.message}</span>
                            <SmallBadge statut={ctrl.niveau} map={CONTROLE_PAIE_MAP} />
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                <div className="border-t border-gray-100 px-5 py-4">
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div>
                      <h3 className="text-sm font-semibold text-[#212121]">Cotisations sociales</h3>
                      <p className="text-xs text-gray-500">Synthèse mensuelle calculée depuis les bulletins du mois.</p>
                    </div>
                    <div className="flex items-center gap-2">
                      {cotisations && <SmallBadge statut={cotisations.statut} map={COTISATION_MAP} />}
                      <Button size="sm" variant="ghost" disabled={genererCotisations.isPending} onClick={() => genererCotisations.mutate(moisPaie)}>
                        {genererCotisations.isPending ? 'Calcul…' : 'Calculer'}
                      </Button>
                      {cotisations?.id && cotisations.statut === 'calculee' && (
                        <Button size="sm" disabled={updateCotisations.isPending} onClick={() => updateCotisations.mutate({ id: cotisations.id!, statut: 'validee' })}>
                          Valider
                        </Button>
                      )}
                      {cotisations?.id && cotisations.statut === 'validee' && (
                        <Button size="sm" disabled={updateCotisations.isPending} onClick={() => updateCotisations.mutate({ id: cotisations.id!, statut: 'payee' })}>
                          Marquer payé
                        </Button>
                      )}
                    </div>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mt-4">
                    <div><div className="text-xs text-gray-400">Bulletins</div><div className="text-sm font-semibold">{cotisations?.nb_bulletins ?? 0}</div></div>
                    <div><div className="text-xs text-gray-400">CNPS salarié</div><div className="text-sm font-semibold">{formatXAF(cotisations?.cnps_salarie_xaf ?? 0)}</div></div>
                    <div><div className="text-xs text-gray-400">CNPS employeur</div><div className="text-sm font-semibold">{formatXAF(cotisations?.cnps_employeur_xaf ?? 0)}</div></div>
                    <div><div className="text-xs text-gray-400">IRPP</div><div className="text-sm font-semibold">{formatXAF(cotisations?.irpp_xaf ?? 0)}</div></div>
                    <div><div className="text-xs text-gray-400">Coût employeur</div><div className="text-sm font-semibold">{formatXAF(cotisations?.cout_total_employeur_xaf ?? 0)}</div></div>
                  </div>
                </div>

                <div className="border-t border-gray-100">
                  <div className="px-5 pt-5 pb-3 flex items-center justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-semibold text-[#212121]">Avances sur salaire</h3>
                      <p className="text-xs text-gray-500">Les avances payées sont déduites lors de la génération de la paie du mois.</p>
                    </div>
                    <span className="text-sm font-semibold text-[#212121]">{formatXAF(avancesData?.total_xaf ?? 0)}</span>
                  </div>
                  <DataTable<AvanceRecord> columns={avanceColumns} data={avances} keyField="id" loading={avancesLoading} />
                </div>

                <div className="border-t border-gray-100">
                  <div className="px-5 pt-5 pb-3 flex items-center justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-semibold text-[#212121]">Retenues salariales</h3>
                      <p className="text-xs text-gray-500">Les retenues actives seront déduites lors de la génération de la paie.</p>
                    </div>
                    <span className="text-sm font-semibold text-[#212121]">{formatXAF(retenuesData?.total_xaf ?? 0)}</span>
                  </div>
                  <DataTable<RetenueRecord> columns={retenueColumns} data={retenues} keyField="id" loading={retenuesLoading} />
                </div>
              </div>
            )}

          </motion.div>
        </AnimatePresence>
      </div>

      {/* SlideOver nouvel employé */}
      <SlideOver isOpen={empSlide} onClose={() => setEmpSlide(false)} title="Nouvel employé" width="md">
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">Nom complet *</label>
            <input value={empForm.nom} onChange={e => setEmpForm(f => ({ ...f, nom: e.target.value }))}
              placeholder="ex. Kamga Jean-Pierre"
              className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C62828]" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">Poste *</label>
            <input value={empForm.poste} onChange={e => setEmpForm(f => ({ ...f, poste: e.target.value }))}
              placeholder="ex. Technicien soudeur"
              className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C62828]" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">Département</label>
            <select value={empForm.departement} onChange={e => setEmpForm(f => ({ ...f, departement: e.target.value }))}
              className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C62828]">
              {DEPARTEMENTS.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">Contrat</label>
              <select value={empForm.type_contrat} onChange={e => setEmpForm(f => ({ ...f, type_contrat: e.target.value as 'CDI' | 'CDD' }))}
                className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C62828]">
                <option value="CDI">CDI</option>
                <option value="CDD">CDD</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">Date d'entrée</label>
              <input type="date" value={empForm.date_entree} onChange={e => setEmpForm(f => ({ ...f, date_entree: e.target.value }))}
                className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C62828]" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">Salaire mensuel brut (XAF) *</label>
            <input type="number" min="0" value={empForm.salaire_base_xaf} onChange={e => setEmpForm(f => ({ ...f, salaire_base_xaf: Number(e.target.value) }))}
              placeholder="ex. 185 000"
              className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C62828]" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">Téléphone</label>
              <input value={empForm.telephone} onChange={e => setEmpForm(f => ({ ...f, telephone: e.target.value }))}
                placeholder="+237 6XX XXX XXX"
                className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C62828]" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">N° CNPS</label>
              <input value={empForm.cnps} onChange={e => setEmpForm(f => ({ ...f, cnps: e.target.value }))}
                placeholder="0000000000"
                className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C62828]" />
            </div>
          </div>
          <div className="flex gap-3 pt-2 border-t border-gray-100">
            <Button variant="ghost" className="flex-1" onClick={() => setEmpSlide(false)}>Annuler</Button>
            <Button
              className="flex-1"
              disabled={!empForm.nom || !empForm.poste || empForm.salaire_base_xaf <= 0 || createEmploye.isPending}
              onClick={() => {
                createEmploye.mutate(
                  {
                    nom:              empForm.nom,
                    poste:            empForm.poste,
                    departement:      empForm.departement,
                    type_contrat:     empForm.type_contrat,
                    date_entree:      empForm.date_entree,
                    salaire_base_xaf: empForm.salaire_base_xaf,
                    telephone:        empForm.telephone || undefined,
                    cnps:             empForm.cnps || undefined,
                  },
                  { onSuccess: () => { setEmpSlide(false); setEmpForm(DEFAULT_EMP) } },
                )
              }}
            >
              {createEmploye.isPending ? 'Enregistrement…' : 'Créer le dossier'}
            </Button>
          </div>
        </div>
      </SlideOver>

      <SlideOver isOpen={avanceSlide} onClose={() => setAvanceSlide(false)} title="Nouvelle avance sur salaire" width="md">
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">Employé *</label>
            <select
              value={avanceForm.employe_id}
              onChange={e => setAvanceForm(f => ({ ...f, employe_id: e.target.value }))}
              className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C62828]"
            >
              <option value="">Sélectionner un employé</option>
              {employes.map(e => <option key={e.id} value={e.id}>{e.nom} - {e.poste}</option>)}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">Date avance *</label>
              <input
                type="date"
                value={avanceForm.date_avance}
                onChange={e => setAvanceForm(f => ({ ...f, date_avance: e.target.value }))}
                className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C62828]"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">Mois déduction *</label>
              <input
                type="month"
                value={avanceForm.mois_deduction}
                onChange={e => setAvanceForm(f => ({ ...f, mois_deduction: e.target.value }))}
                className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C62828]"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">Montant (XAF) *</label>
            <input
              type="number"
              min="1"
              value={avanceForm.montant_xaf}
              onChange={e => setAvanceForm(f => ({ ...f, montant_xaf: Number(e.target.value) }))}
              className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C62828]"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">Mode paiement</label>
              <select
                value={avanceForm.mode_paiement}
                onChange={e => setAvanceForm(f => ({ ...f, mode_paiement: e.target.value as AvanceSalaireForm['mode_paiement'] }))}
                className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C62828]"
              >
                <option value="caisse">Caisse</option>
                <option value="banque">Banque</option>
                <option value="mobile_money">Mobile money</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">Référence</label>
              <input
                value={avanceForm.reference_paiement}
                onChange={e => setAvanceForm(f => ({ ...f, reference_paiement: e.target.value }))}
                placeholder="Reçu, transaction..."
                className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C62828]"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">Motif</label>
            <input
              value={avanceForm.motif}
              onChange={e => setAvanceForm(f => ({ ...f, motif: e.target.value }))}
              placeholder="Avance exceptionnelle, urgence..."
              className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C62828]"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">Notes</label>
            <textarea
              rows={2}
              value={avanceForm.notes}
              onChange={e => setAvanceForm(f => ({ ...f, notes: e.target.value }))}
              className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C62828] resize-none"
            />
          </div>

          <div className="flex gap-3 pt-2 border-t border-gray-100">
            <Button variant="ghost" className="flex-1" onClick={() => setAvanceSlide(false)}>Annuler</Button>
            <Button
              className="flex-1"
              disabled={!avanceForm.employe_id || !avanceForm.date_avance || !avanceForm.mois_deduction || avanceForm.montant_xaf <= 0 || createAvance.isPending}
              onClick={submitAvance}
            >
              {createAvance.isPending ? 'Enregistrement…' : 'Enregistrer'}
            </Button>
          </div>
        </div>
      </SlideOver>

      <SlideOver isOpen={retenueSlide} onClose={() => setRetenueSlide(false)} title="Nouvelle retenue salariale" width="md">
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">Employé *</label>
            <select
              value={retenueForm.employe_id}
              onChange={e => setRetenueForm(f => ({ ...f, employe_id: e.target.value }))}
              className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C62828]"
            >
              <option value="">Sélectionner un employé</option>
              {employes.map(e => <option key={e.id} value={e.id}>{e.nom} - {e.poste}</option>)}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">Mois déduction *</label>
              <input
                type="month"
                value={retenueForm.mois_deduction}
                onChange={e => setRetenueForm(f => ({ ...f, mois_deduction: e.target.value }))}
                className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C62828]"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">Type</label>
              <select
                value={retenueForm.type}
                onChange={e => setRetenueForm(f => ({ ...f, type: e.target.value as RetenueSalaireForm['type'] }))}
                className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C62828]"
              >
                <option value="absence">Absence</option>
                <option value="materiel">Matériel</option>
                <option value="pret_interne">Prêt interne</option>
                <option value="discipline">Discipline</option>
                <option value="autre">Autre</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">Libellé *</label>
            <input
              value={retenueForm.libelle}
              onChange={e => setRetenueForm(f => ({ ...f, libelle: e.target.value }))}
              placeholder="ex. Retenue matériel endommagé"
              className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C62828]"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">Montant (XAF) *</label>
            <input
              type="number"
              min="1"
              value={retenueForm.montant_xaf}
              onChange={e => setRetenueForm(f => ({ ...f, montant_xaf: Number(e.target.value) }))}
              className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C62828]"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">Notes</label>
            <textarea
              rows={2}
              value={retenueForm.notes}
              onChange={e => setRetenueForm(f => ({ ...f, notes: e.target.value }))}
              className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C62828] resize-none"
            />
          </div>

          <div className="flex gap-3 pt-2 border-t border-gray-100">
            <Button variant="ghost" className="flex-1" onClick={() => setRetenueSlide(false)}>Annuler</Button>
            <Button
              className="flex-1"
              disabled={!retenueForm.employe_id || !retenueForm.mois_deduction || !retenueForm.libelle || retenueForm.montant_xaf <= 0 || createRetenue.isPending}
              onClick={submitRetenue}
            >
              {createRetenue.isPending ? 'Enregistrement…' : 'Enregistrer'}
            </Button>
          </div>
        </div>
      </SlideOver>

      {/* Modal aperçu bulletin PDF */}
      {pdfModal && (
        <BulletinPdfModal
          url={pdfModal.url}
          filename={pdfModal.filename}
          onClose={() => setPdfModal(null)}
        />
      )}
    </motion.div>
  )
}
