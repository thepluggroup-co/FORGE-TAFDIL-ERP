import React, { useState, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  GraduationCap, Star, Clock, Award, UserPlus,
  CheckCircle, Plus, TrendingUp, BookOpen, Users, Search, X,
  Calendar, MapPin, UserCheck, ChevronDown, ChevronUp, Trash2,
  ClipboardList, BarChart2, AlertCircle, Download,
} from 'lucide-react'
import { PageHeader, KpiCard, SlideOver, Button, Modal } from '@forge/ui'
import { toast } from 'sonner'
import { apiClient } from '@/lib/api-client'
import {
  useApprenants, useProgressionApprenant, useRecruterApprenant, useCreateApprenant,
  useEmployes, useFormationSessions, useCreateFormationSession, useDeleteFormationSession,
  useInscrireApprenant, useApprenantHistorique,
} from '@/hooks/useRH'
import type {
  Apprenant, RecruterPayload, FormationSession,
  CreateFormationSessionPayload,
} from '@/hooks/useRH'

// ── Constantes ─────────────────────────────────────────────────────────────────

const HORAIRES_DISPO = [
  'Lundi 08h-12h', 'Lundi 13h-17h',
  'Mardi 08h-12h', 'Mardi 13h-17h',
  'Mercredi 08h-12h', 'Mercredi 13h-17h',
  'Jeudi 08h-12h', 'Jeudi 13h-17h',
  'Vendredi 08h-12h', 'Vendredi 13h-17h',
  'Samedi 08h-12h',
]

const PLANS = [
  { module: 'Sécurité atelier & EPI',          duree: '2 semaines', niveau: 1, description: 'Règles de sécurité, équipements obligatoires, premiers secours' },
  { module: 'Lecture de plans & métrologie',    duree: '1 mois',     niveau: 1, description: 'Lecture de plans techniques, utilisation des instruments de mesure' },
  { module: 'Soudure MIG/MAG — Bases',          duree: '2 mois',     niveau: 2, description: 'Techniques de soudure, réglages machine, joints basiques' },
  { module: 'Découpe plasma & oxycoupage',      duree: '1 mois',     niveau: 2, description: 'Opération machine découpe, paramètres, qualité de coupe' },
  { module: 'Pliage hydraulique',               duree: '1 mois',     niveau: 3, description: 'Programmation pliage, angles, matrices' },
  { module: 'Soudure TIG Inox & Alu',           duree: '2 mois',     niveau: 3, description: 'Soudure TIG sur aciers inoxydables et aluminium' },
  { module: 'CNC & programmation',              duree: '3 mois',     niveau: 4, description: 'Programmation G-code, setup machines CNC, usinage de précision' },
  { module: 'Contrôle qualité & finitions',     duree: '1 mois',     niveau: 4, description: 'Inspection dimensionnelle, traitements de surface, normes qualité' },
  { module: "Management d'équipe & projets",    duree: '2 mois',     niveau: 5, description: "Gestion de chantier, coordination équipe, relation client" },
]

const NIVEAU_COLORS: Record<number, string> = { 1: '#C62828', 2: '#d97706', 3: '#0891b2', 4: '#1d4ed8', 5: '#15803d' }

const STATUS_SESSION: Record<FormationSession['statut'], { label: string; color: string; bg: string }> = {
  planifiee: { label: 'Planifiée',  color: '#1d4ed8', bg: '#dbeafe' },
  en_cours:  { label: 'En cours',  color: '#15803d', bg: '#dcfce7' },
  terminee:  { label: 'Terminée',  color: '#6b7280', bg: '#f3f4f6' },
  annulee:   { label: 'Annulée',   color: '#dc2626', bg: '#fee2e2' },
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

// ── ApprenantCard ──────────────────────────────────────────────────────────────

function ApprenantCard({
  apprenant, isDirecteur, onNiveauSuivant, onRecruter, onHistorique,
}: {
  apprenant: Apprenant
  isDirecteur: boolean
  onNiveauSuivant: (a: Apprenant) => void
  onRecruter: (a: Apprenant) => void
  onHistorique: (a: Apprenant) => void
}) {
  const handleAttestation = () => {
    window.open(`/api/rh/apprenants/${apprenant.id}/attestation`, '_blank')
  }
  const progress              = (apprenant.niveau / 5) * 100
  const isCandidatRecrutement = apprenant.niveau === 5 && apprenant.duree_mois >= 6
  const progressColor         = progress >= 80 ? '#15803d' : progress >= 60 ? '#d97706' : '#C62828'

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-white border border-gray-100 rounded-xl p-5 shadow-sm space-y-4 flex flex-col"
    >
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
            CANDIDAT
          </span>
        )}
      </div>

      <div className="flex items-center justify-between">
        <StarRating level={apprenant.niveau} />
        <div className="flex items-center gap-1 text-xs text-gray-400">
          <Clock className="h-3 w-3" />
          {apprenant.duree_mois} mois
        </div>
      </div>

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

      <div className="flex gap-2 pt-1 mt-auto flex-wrap">
        <Button variant="secondary" size="sm" onClick={() => onHistorique(apprenant)}>
          <BarChart2 className="h-3.5 w-3.5" /> Historique
        </Button>
        <Button variant="secondary" size="sm" onClick={handleAttestation} title="Télécharger l'attestation PDF">
          <Download className="h-3.5 w-3.5" /> Attestation
        </Button>
        {isDirecteur && apprenant.niveau < 5 && (
          <Button variant="secondary" size="sm" onClick={() => onNiveauSuivant(apprenant)}>
            <CheckCircle className="h-3.5 w-3.5" /> Niveau {apprenant.niveau + 1}
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

// ── HistoriqueDrawer ───────────────────────────────────────────────────────────

function HistoriqueDrawer({ apprenant, onClose }: { apprenant: Apprenant | null; onClose: () => void }) {
  const { data, isLoading } = useApprenantHistorique(apprenant?.id ?? null)

  if (!apprenant) return null

  const validations  = data?.validations  ?? []
  const inscriptions = data?.inscriptions ?? []

  // Frise chronologique fusionnée et triée
  type TimelineItem =
    | { type: 'niveau'; date: string | null; niveau: number; commentaire: string | null }
    | { type: 'session'; date: string | null; module: string; statut: string; evaluation: number | null; nb_seances: number; formateur?: string | null; lieu?: string | null }

  const timeline: TimelineItem[] = [
    ...validations.map(v => ({
      type:        'niveau' as const,
      date:        v.date_validation,
      niveau:      v.niveau,
      commentaire: v.commentaire,
    })),
    ...inscriptions.map(i => ({
      type:       'session' as const,
      date:       i.date_inscription,
      module:     i.formation_sessions?.module ?? '—',
      statut:     i.statut,
      evaluation: i.evaluation,
      nb_seances: i.nb_seances,
      formateur:  i.formation_sessions?.formateur ?? null,
      lieu:       i.formation_sessions?.lieu ?? null,
    })),
  ].sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''))

  return (
    <SlideOver isOpen={!!apprenant} onClose={onClose} title={`Évolution — ${apprenant.nom}`} width="md">
      {isLoading ? (
        <div className="space-y-3 mt-2">
          {[0,1,2].map(i => <div key={i} className="h-16 bg-gray-100 rounded-xl animate-pulse" />)}
        </div>
      ) : (
        <div className="space-y-5">
          {/* Résumé */}
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: 'Niveau actuel', value: `${apprenant.niveau}/5`, color: NIVEAU_COLORS[apprenant.niveau] },
              { label: 'Durée totale',  value: `${apprenant.duree_mois} mois`, color: '#1d4ed8' },
              { label: 'Sessions',      value: String(inscriptions.length), color: '#7c3aed' },
            ].map(k => (
              <div key={k.label} className="bg-gray-50 rounded-xl p-3 text-center">
                <div className="text-lg font-bold" style={{ color: k.color }}>{k.value}</div>
                <div className="text-[11px] text-gray-400 mt-0.5">{k.label}</div>
              </div>
            ))}
          </div>

          {/* Frise */}
          {timeline.length === 0 ? (
            <div className="text-center py-8 text-gray-400 text-sm">
              <ClipboardList className="h-8 w-8 mx-auto mb-2 text-gray-200" />
              Aucune activité enregistrée
            </div>
          ) : (
            <div className="relative pl-6">
              {/* Ligne verticale */}
              <div className="absolute left-2.5 top-0 bottom-0 w-0.5 bg-gray-200" />

              <div className="space-y-4">
                {timeline.map((item, i) => (
                  <div key={i} className="relative">
                    {/* Point */}
                    <div className="absolute -left-6 top-1.5 w-3.5 h-3.5 rounded-full border-2 border-white shadow-sm flex items-center justify-center"
                      style={{ backgroundColor: item.type === 'niveau' ? (NIVEAU_COLORS[item.niveau] ?? '#C62828') : '#7c3aed' }} />

                    <div className="bg-gray-50 rounded-xl p-3 space-y-1 border border-gray-100">
                      {item.type === 'niveau' ? (
                        <>
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-bold px-2 py-0.5 rounded-full text-white"
                              style={{ backgroundColor: NIVEAU_COLORS[item.niveau] ?? '#C62828' }}>
                              Niveau {item.niveau} validé
                            </span>
                            {item.date && <span className="text-[11px] text-gray-400">{item.date}</span>}
                          </div>
                          {item.commentaire && (
                            <p className="text-xs text-gray-500 italic">« {item.commentaire} »</p>
                          )}
                        </>
                      ) : (
                        <>
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-semibold text-[#212121]">{item.module}</span>
                            <span className="text-[10px] px-2 py-0.5 rounded-full font-medium"
                              style={{ color: STATUS_SESSION[item.statut as FormationSession['statut']]?.color ?? '#6b7280', backgroundColor: STATUS_SESSION[item.statut as FormationSession['statut']]?.bg ?? '#f3f4f6' }}>
                              {STATUS_SESSION[item.statut as FormationSession['statut']]?.label ?? item.statut}
                            </span>
                          </div>
                          <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-gray-400">
                            {item.date       && <span>📅 {item.date}</span>}
                            {item.formateur  && <span>👨‍🏫 {item.formateur}</span>}
                            {item.lieu       && <span>📍 {item.lieu}</span>}
                            {item.nb_seances > 0 && <span>✅ {item.nb_seances} séances suivies</span>}
                            {item.evaluation != null && <span>⭐ {item.evaluation}/20</span>}
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="pt-2 border-t border-gray-100">
            <Button variant="ghost" className="w-full" onClick={onClose}>Fermer</Button>
          </div>
        </div>
      )}
    </SlideOver>
  )
}

// ── SessionCard ───────────────────────────────────────────────────────────────

function SessionCard({ session, onDelete }: { session: FormationSession; onDelete: (id: string) => void }) {
  const [expanded, setExpanded] = useState(false)
  const cfg   = STATUS_SESSION[session.statut]
  const color = NIVEAU_COLORS[session.niveau] ?? '#C62828'
  const pct   = session.capacite_max > 0 ? (session.nb_inscrits / session.capacite_max) * 100 : 0
  const full  = session.nb_inscrits >= session.capacite_max

  return (
    <div className="bg-white border border-gray-100 rounded-xl p-4 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-bold px-2 py-0.5 rounded-full text-white shrink-0"
              style={{ backgroundColor: color }}>
              N{session.niveau}
            </span>
            <span className="text-sm font-semibold text-[#212121] truncate">{session.module}</span>
          </div>
          <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1 text-xs text-gray-400">
            {session.formateur  && <span className="flex items-center gap-1"><UserCheck className="h-3 w-3" />{session.formateur}</span>}
            {session.lieu       && <span className="flex items-center gap-1"><MapPin className="h-3 w-3" />{session.lieu}</span>}
            {session.date_debut && <span className="flex items-center gap-1"><Calendar className="h-3 w-3" />{session.date_debut}{session.date_fin ? ` → ${session.date_fin}` : ''}</span>}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-xs font-medium px-2 py-0.5 rounded-full"
            style={{ color: cfg.color, backgroundColor: cfg.bg }}>
            {cfg.label}
          </span>
          <button type="button" onClick={() => onDelete(session.id)}
            className="text-gray-300 hover:text-red-500 transition-colors">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Jauge capacité */}
      <div>
        <div className="flex justify-between text-xs mb-1" style={{ color: full ? '#dc2626' : '#6b7280' }}>
          <span>{session.nb_inscrits} inscrits</span>
          <span>{session.capacite_max} places max{full ? ' — Complet' : ''}</span>
        </div>
        <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
          <div className="h-full rounded-full transition-all"
            style={{ width: `${Math.min(100, pct)}%`, backgroundColor: pct >= 100 ? '#dc2626' : pct >= 80 ? '#d97706' : '#15803d' }} />
        </div>
      </div>

      {/* Horaires (expandable) */}
      {session.horaires.length > 0 && (
        <div>
          <button type="button" onClick={() => setExpanded(v => !v)}
            className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700">
            {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            {session.horaires.length} créneau{session.horaires.length > 1 ? 'x' : ''}
          </button>
          <AnimatePresence>
            {expanded && (
              <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
                className="overflow-hidden">
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {session.horaires.map(h => (
                    <span key={h} className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">{h}</span>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}
    </div>
  )
}

// ── RecruterModal ──────────────────────────────────────────────────────────────

const DEPARTEMENTS_FORMATION = ['Atelier soudure', 'Atelier découpe', 'Atelier CNC', 'Pliage', 'Production', 'Commercial', 'Administration']

function RecruterModal({ isOpen, onClose, apprenant }: { isOpen: boolean; onClose: () => void; apprenant: Apprenant | null }) {
  const [form, setForm] = useState<Omit<RecruterPayload, 'id'>>({
    poste: '', departement: '', type_contrat: 'CDI',
    date_entree: new Date().toISOString().split('T')[0],
    salaire_base_xaf: 0,
  })
  const recruter = useRecruterApprenant()

  if (!apprenant) return null

  const formValid = form.poste.trim() !== '' && form.departement !== '' && form.salaire_base_xaf > 0

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Recruter comme employé" size="md">
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
          <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">Poste *</label>
          <input value={form.poste} onChange={(e) => setForm((f) => ({ ...f, poste: e.target.value }))} placeholder="ex. Technicien soudeur"
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#C62828]/30" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">Département *</label>
            <select value={form.departement} onChange={(e) => setForm((f) => ({ ...f, departement: e.target.value }))}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#C62828]/30">
              <option value="">Sélectionner…</option>
              {DEPARTEMENTS_FORMATION.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">Contrat *</label>
            <select value={form.type_contrat} onChange={(e) => setForm((f) => ({ ...f, type_contrat: e.target.value as RecruterPayload['type_contrat'] }))}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#C62828]/30">
              <option value="CDI">CDI</option>
              <option value="CDD">CDD</option>
              <option value="stage">Stage</option>
              <option value="freelance">Freelance</option>
            </select>
          </div>
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">Date d'entrée</label>
          <input type="date" value={form.date_entree} onChange={(e) => setForm((f) => ({ ...f, date_entree: e.target.value }))}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#C62828]/30" />
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">Salaire mensuel brut (FCFA) *</label>
          <input type="number" min="0" value={form.salaire_base_xaf} onChange={(e) => setForm((f) => ({ ...f, salaire_base_xaf: Number(e.target.value) }))}
            placeholder="ex. 185 000"
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#C62828]/30" />
        </div>
        <div className="flex gap-2 justify-end pt-2">
          <Button variant="ghost" onClick={onClose}>Annuler</Button>
          <Button onClick={() => recruter.mutate({ id: apprenant.id, ...form }, { onSuccess: onClose })}
            disabled={!formValid || recruter.isPending}>
            <UserPlus className="h-3.5 w-3.5" /> {recruter.isPending ? 'Recrutement…' : 'Recruter'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

// ── Page principale ────────────────────────────────────────────────────────────

type Tab = 'apprenants' | 'sessions' | 'plans'

const SESSION_FORM_DEFAULT: CreateFormationSessionPayload = {
  module:       '',
  niveau:       1,
  statut:       'planifiee',
  date_debut:   '',
  date_fin:     '',
  formateur:    '',
  lieu:         '',
  capacite_max: 10,
  horaires:     [],
  description:  '',
}

export default function Formation() {
  const [tab, setTab]                     = useState<Tab>('apprenants')
  const [recruterApprenant, setRecruter]  = useState<Apprenant | null>(null)
  const [historiqueApprenant, setHistorique] = useState<Apprenant | null>(null)

  // ── État SlideOver apprenant ──────────────────────────────────────────────
  const [addSlide, setAddSlide]           = useState(false)
  const [newNom, setNewNom]               = useState('')
  const [newSpec, setNewSpec]             = useState('')
  const [newSaving, setNewSaving]         = useState(false)
  const [empSearch, setEmpSearch]         = useState('')
  const [selectedEmpId, setSelectedEmpId] = useState<string>('')
  const [modeManuel, setModeManuel]       = useState(false)
  const [selectedSessionId, setSelectedSessionId] = useState<string>('')
  const [disponibilites, setDisponibilites]        = useState<string[]>([])

  // ── État SlideOver session ────────────────────────────────────────────────
  const [sessionSlide, setSessionSlide]   = useState(false)
  const [sessionForm, setSessionForm]     = useState<CreateFormationSessionPayload>(SESSION_FORM_DEFAULT)

  // ── Hooks données ─────────────────────────────────────────────────────────
  const { data: appData, isLoading: loadingApprenants } = useApprenants()
  const { data: empData }                               = useEmployes()
  const { data: sessionsData, isLoading: loadingSessions } = useFormationSessions()

  const progressionApprenant   = useProgressionApprenant()
  const createApprenant        = useCreateApprenant()
  const inscrireApprenant      = useInscrireApprenant()
  const createSession          = useCreateFormationSession()
  const deleteSession          = useDeleteFormationSession()

  const apprenants = appData?.data ?? []
  const employes   = empData?.data ?? []
  const sessions   = sessionsData?.data ?? []
  const isDirecteur = true

  // ── Mémos ─────────────────────────────────────────────────────────────────
  const apprenantNoms = useMemo(() => new Set(apprenants.map(a => a.nom)), [apprenants])

  const employesFiltres = useMemo(
    () => employes.filter(e =>
      e.statut === 'actif' &&
      !apprenantNoms.has(e.nom) &&
      (empSearch.trim() === '' ||
        e.nom.toLowerCase().includes(empSearch.toLowerCase()) ||
        e.poste.toLowerCase().includes(empSearch.toLowerCase()) ||
        e.departement.toLowerCase().includes(empSearch.toLowerCase()))
    ),
    [employes, apprenantNoms, empSearch],
  )

  const sessionsActives = useMemo(
    () => sessions.filter(s => s.statut === 'planifiee' || s.statut === 'en_cours'),
    [sessions],
  )

  const selectedSession = useMemo(
    () => sessions.find(s => s.id === selectedSessionId) ?? null,
    [sessions, selectedSessionId],
  )

  // ── KPIs ──────────────────────────────────────────────────────────────────
  const enFormation = apprenants.filter(a => a.statut === 'actif' || a.statut === 'suspendu').length
  const candidats   = apprenants.filter(a => a.niveau === 5 && a.duree_mois >= 6).length
  const certifies   = apprenants.filter(a => a.statut === 'diplome' || a.statut === 'recrute').length
  const dureeAvg    = apprenants.length > 0
    ? Math.round(apprenants.reduce((s, a) => s + a.duree_mois, 0) / apprenants.length)
    : 0

  // ── Helpers ───────────────────────────────────────────────────────────────
  const resetAddForm = () => {
    setNewNom(''); setNewSpec(''); setEmpSearch(''); setSelectedEmpId('')
    setModeManuel(false); setSelectedSessionId(''); setDisponibilites([])
    setNewSaving(false)
  }

  const handleSelectEmploye = (empId: string) => {
    setSelectedEmpId(empId)
    const emp = employes.find(e => e.id === empId)
    if (emp) { setNewNom(emp.nom); setNewSpec(emp.poste); setEmpSearch(emp.nom) }
  }

  const handleClearEmploye = () => {
    setSelectedEmpId(''); setNewNom(''); setNewSpec(''); setEmpSearch('')
  }

  const handleAddApprenant = () => {
    if (!newNom.trim() || !newSpec.trim()) return
    if (selectedSessionId && selectedSession && disponibilites.length === 0) {
      toast.error('Sélectionnez au moins un créneau de disponibilité')
      return
    }
    setNewSaving(true)
    createApprenant.mutate(
      { nom: newNom.trim(), specialite: newSpec.trim(), niveau: 1, duree_mois: 0 },
      {
        onSuccess: (newApp) => {
          if (selectedSessionId) {
            inscrireApprenant.mutate(
              { id: newApp.id, session_id: selectedSessionId, disponibilites },
              {
                onSuccess: () => { setAddSlide(false); resetAddForm() },
                onError:   () => setNewSaving(false),
              },
            )
          } else {
            setAddSlide(false)
            resetAddForm()
          }
        },
        onError: () => setNewSaving(false),
      },
    )
  }

  const handleCreateSession = () => {
    if (!sessionForm.module || !sessionForm.niveau) return
    createSession.mutate(
      { ...sessionForm, horaires: sessionForm.horaires ?? [] },
      {
        onSuccess: () => { setSessionSlide(false); setSessionForm(SESSION_FORM_DEFAULT) },
      },
    )
  }

  const handleSessionModuleChange = (module: string) => {
    const plan = PLANS.find(p => p.module === module)
    setSessionForm(f => ({ ...f, module, niveau: plan?.niveau ?? f.niveau, description: plan?.description ?? f.description ?? '' }))
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3 }}
      className="space-y-6"
    >
      <PageHeader
        title="Formation"
        subtitle="Apprenants · Sessions · Progression"
        breadcrumbs={[{ label: 'FORGE', href: '/' }, { label: 'Formation' }]}
        actions={
          <div className="flex gap-2">
            {tab === 'sessions' && (
              <Button variant="secondary" size="sm" onClick={() => { setSessionForm(SESSION_FORM_DEFAULT); setSessionSlide(true) }}>
                <Plus className="h-3.5 w-3.5" /> Nouvelle session
              </Button>
            )}
            <Button size="sm" onClick={() => { resetAddForm(); setAddSlide(true) }}>
              <Plus className="h-3.5 w-3.5" /> Ajouter apprenant
            </Button>
          </div>
        }
      />

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard title="En formation"         value={enFormation} icon={<GraduationCap className="h-5 w-5" />} color="#C62828" delay={0} />
        <KpiCard title="Candidats recrutement" value={candidats}   icon={<Award className="h-5 w-5" />} color="#15803d" trendValue="Niveau 5 + 6 mois" trend="up" delay={0.07} />
        <KpiCard title="Certifiés / Recrutés"  value={certifies}   icon={<Users className="h-5 w-5" />} color="#1d4ed8" delay={0.14} />
        <KpiCard title="Durée moyenne"         value={dureeAvg} unit=" mois" icon={<TrendingUp className="h-5 w-5" />} color="#7c3aed" delay={0.21} />
      </div>

      {/* Tabs */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="flex border-b border-gray-100">
          {[
            { id: 'apprenants' as Tab, label: 'Apprenants',        icon: Users },
            { id: 'sessions'  as Tab, label: 'Sessions',           icon: ClipboardList },
            { id: 'plans'     as Tab, label: 'Programme',          icon: BookOpen },
          ].map(({ id, label, icon: Icon }) => (
            <button key={id} onClick={() => setTab(id)}
              className="relative flex items-center gap-2 px-4 py-3 text-sm font-medium transition-colors"
              style={{ color: tab === id ? '#C62828' : '#6b7280' }}>
              <Icon className="h-3.5 w-3.5" />
              {label}
              {tab === id && (
                <motion.div layoutId="formation-tab" className="absolute bottom-0 inset-x-0 h-0.5 rounded-full" style={{ backgroundColor: '#C62828' }} />
              )}
            </button>
          ))}
        </div>

        {/* ── Tab Apprenants ── */}
        {tab === 'apprenants' && (
          <div className="p-5">
            {loadingApprenants ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {[0, 1, 2].map((i) => <div key={i} className="bg-gray-50 rounded-xl h-44 animate-pulse" />)}
              </div>
            ) : apprenants.length === 0 ? (
              <div className="text-center py-12 text-gray-400 text-sm">
                <GraduationCap className="h-10 w-10 mx-auto mb-3 text-gray-200" />
                Aucun apprenant — cliquez sur « Ajouter apprenant »
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {apprenants.map((a, i) => (
                  <motion.div key={a.id} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.06 }}>
                    <ApprenantCard
                      apprenant={a}
                      isDirecteur={isDirecteur}
                      onNiveauSuivant={(ap) => progressionApprenant.mutate({ id: ap.id, observations: '' })}
                      onRecruter={setRecruter}
                      onHistorique={setHistorique}
                    />
                  </motion.div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Tab Sessions ── */}
        {tab === 'sessions' && (
          <div className="p-5">
            {loadingSessions ? (
              <div className="space-y-3">
                {[0, 1, 2].map(i => <div key={i} className="bg-gray-50 rounded-xl h-24 animate-pulse" />)}
              </div>
            ) : sessions.length === 0 ? (
              <div className="text-center py-12 text-gray-400 text-sm">
                <ClipboardList className="h-10 w-10 mx-auto mb-3 text-gray-200" />
                Aucune session — cliquez sur « Nouvelle session »
              </div>
            ) : (
              <div className="space-y-3">
                {sessions.map(s => (
                  <SessionCard
                    key={s.id}
                    session={s}
                    onDelete={(id) => {
                      if (window.confirm('Supprimer cette session et toutes ses inscriptions ?'))
                        deleteSession.mutate(id)
                    }}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Tab Plans / Programme ── */}
        {tab === 'plans' && (
          <div className="p-5">
            <p className="text-xs text-gray-400 mb-4">Programme de formation TAFDIL — 5 niveaux sur 12 à 18 mois</p>
            <div className="space-y-3">
              {PLANS.map((plan, i) => (
                <div key={i} className="flex items-start gap-4 p-3 rounded-xl border border-gray-100 hover:bg-gray-50 transition-colors">
                  <div
                    className="flex items-center justify-center w-8 h-8 rounded-full text-white text-xs font-bold shrink-0 mt-0.5"
                    style={{ backgroundColor: NIVEAU_COLORS[plan.niveau] ?? '#C62828' }}
                  >
                    N{plan.niveau}
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-semibold text-[#212121]">{plan.module}</span>
                      <span className="text-xs text-gray-400 ml-4 shrink-0">{plan.duree}</span>
                    </div>
                    <p className="text-xs text-gray-500 mt-0.5">{plan.description}</p>
                  </div>
                  <Button variant="secondary" size="sm" className="shrink-0"
                    onClick={() => {
                      setSessionForm({ ...SESSION_FORM_DEFAULT, module: plan.module, niveau: plan.niveau, description: plan.description })
                      setSessionSlide(true)
                      setTab('sessions')
                    }}>
                    <Plus className="h-3 w-3" /> Session
                  </Button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ══ Modal recruter ═════════════════════════════════════════════════════ */}
      <RecruterModal isOpen={!!recruterApprenant} onClose={() => setRecruter(null)} apprenant={recruterApprenant} />

      {/* ══ Drawer historique ══════════════════════════════════════════════════ */}
      <HistoriqueDrawer apprenant={historiqueApprenant} onClose={() => setHistorique(null)} />

      {/* ══ SlideOver nouvelle session ══════════════════════════════════════════ */}
      <SlideOver isOpen={sessionSlide} onClose={() => setSessionSlide(false)} title="Nouvelle session de formation" width="md">
        <div className="space-y-4">
          {/* Module */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">Module *</label>
            <select value={sessionForm.module} onChange={(e) => handleSessionModuleChange(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#C62828]">
              <option value="">Choisir un module…</option>
              {PLANS.map(p => (
                <option key={p.module} value={p.module}>N{p.niveau} — {p.module}</option>
              ))}
            </select>
          </div>

          {/* Statut + Niveau */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">Niveau</label>
              <div className="flex items-center h-10 px-3 text-sm border border-gray-200 rounded-lg bg-gray-50 font-bold"
                style={{ color: NIVEAU_COLORS[sessionForm.niveau] ?? '#C62828' }}>
                Niveau {sessionForm.niveau}
              </div>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">Statut</label>
              <select value={sessionForm.statut} onChange={(e) => setSessionForm(f => ({ ...f, statut: e.target.value as CreateFormationSessionPayload['statut'] }))}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#C62828]">
                <option value="planifiee">Planifiée</option>
                <option value="en_cours">En cours</option>
              </select>
            </div>
          </div>

          {/* Dates */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">Date début</label>
              <input type="date" value={sessionForm.date_debut ?? ''} onChange={(e) => setSessionForm(f => ({ ...f, date_debut: e.target.value }))}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#C62828]" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">Date fin</label>
              <input type="date" value={sessionForm.date_fin ?? ''} onChange={(e) => setSessionForm(f => ({ ...f, date_fin: e.target.value }))}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#C62828]" />
            </div>
          </div>

          {/* Formateur + Lieu */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">Formateur</label>
              <input value={sessionForm.formateur ?? ''} onChange={(e) => setSessionForm(f => ({ ...f, formateur: e.target.value }))}
                placeholder="Nom du formateur"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#C62828]" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">Lieu</label>
              <input value={sessionForm.lieu ?? ''} onChange={(e) => setSessionForm(f => ({ ...f, lieu: e.target.value }))}
                placeholder="ex. Atelier soudure"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#C62828]" />
            </div>
          </div>

          {/* Capacité */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">Capacité max</label>
            <input type="number" min="1" value={sessionForm.capacite_max ?? 10} onChange={(e) => setSessionForm(f => ({ ...f, capacite_max: Number(e.target.value) }))}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#C62828]" />
          </div>

          {/* Créneaux horaires */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase mb-2">Créneaux horaires</label>
            <div className="grid grid-cols-2 gap-1.5 max-h-52 overflow-y-auto pr-1">
              {HORAIRES_DISPO.map(h => {
                const checked = (sessionForm.horaires ?? []).includes(h)
                return (
                  <button key={h} type="button"
                    onClick={() => setSessionForm(f => ({
                      ...f,
                      horaires: checked ? (f.horaires ?? []).filter(x => x !== h) : [...(f.horaires ?? []), h],
                    }))}
                    className={`text-xs px-3 py-1.5 rounded-lg border text-left transition-colors ${checked ? 'bg-[#C62828] text-white border-[#C62828]' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}>
                    {h}
                  </button>
                )
              })}
            </div>
          </div>

          <div className="flex gap-3 pt-2 border-t border-gray-100">
            <Button variant="ghost" className="flex-1" onClick={() => setSessionSlide(false)}>Annuler</Button>
            <Button className="flex-1"
              disabled={!sessionForm.module || !sessionForm.niveau || createSession.isPending}
              onClick={handleCreateSession}>
              {createSession.isPending ? 'Création…' : 'Créer la session'}
            </Button>
          </div>
        </div>
      </SlideOver>

      {/* ══ SlideOver ajouter apprenant ════════════════════════════════════════ */}
      <SlideOver isOpen={addSlide} onClose={() => setAddSlide(false)} title="Ajouter un apprenant" width="md">
        <div className="space-y-4">

          {/* ── Sélecteur employé / saisie manuelle ── */}
          {!modeManuel ? (
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">
                Choisir depuis les employés *
              </label>

              {!selectedEmpId ? (
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400 pointer-events-none" />
                  <input
                    value={empSearch}
                    onChange={(e) => { setEmpSearch(e.target.value); setSelectedEmpId('') }}
                    placeholder="Rechercher un employé…"
                    className="w-full pl-8 pr-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C62828]"
                  />
                  {empSearch.trim() !== '' && (
                    <div className="absolute z-20 left-0 right-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-lg max-h-52 overflow-y-auto">
                      {employesFiltres.length === 0 ? (
                        <div className="px-3 py-3 text-xs text-gray-400 text-center">Aucun employé trouvé</div>
                      ) : (
                        employesFiltres.map((emp) => (
                          <button key={emp.id} type="button" onClick={() => handleSelectEmploye(emp.id)}
                            className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-gray-50 transition-colors">
                            <div className="w-8 h-8 rounded-full bg-[#ECEFF1] flex items-center justify-center text-[#37474F] font-bold text-xs shrink-0">
                              {emp.nom.charAt(0)}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="text-sm font-medium text-[#212121] truncate">{emp.nom}</div>
                              <div className="text-xs text-gray-400 truncate">{emp.poste} · {emp.departement}</div>
                            </div>
                          </button>
                        ))
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex items-center gap-3 px-3 py-2.5 bg-[#ECEFF1] rounded-lg border border-gray-200">
                  <div className="w-8 h-8 rounded-full bg-[#37474F] flex items-center justify-center text-white font-bold text-xs shrink-0">
                    {newNom.charAt(0)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-[#212121] truncate">{newNom}</div>
                    <div className="text-xs text-gray-500 truncate">{newSpec}</div>
                  </div>
                  <button type="button" onClick={handleClearEmploye} className="text-gray-400 hover:text-gray-600">
                    <X className="h-4 w-4" />
                  </button>
                </div>
              )}

              {selectedEmpId && (
                <div className="mt-3">
                  <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">Spécialité de formation *</label>
                  <input value={newSpec} onChange={(e) => setNewSpec(e.target.value)}
                    placeholder="ex. Soudure & chaudronnerie"
                    className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C62828]" />
                  <p className="text-[11px] text-gray-400 mt-1">Pré-rempli depuis le poste — modifiez si besoin.</p>
                </div>
              )}

              <button type="button" onClick={() => { setModeManuel(true); handleClearEmploye() }}
                className="mt-2 text-xs text-[#1d4ed8] hover:underline">
                Saisir manuellement (apprenant externe)
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-gray-500 uppercase">Saisie manuelle</span>
                <button type="button" onClick={() => setModeManuel(false)}
                  className="text-xs text-[#1d4ed8] hover:underline flex items-center gap-1">
                  <Users className="h-3 w-3" /> Depuis les employés
                </button>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">Nom complet *</label>
                <input value={newNom} onChange={(e) => setNewNom(e.target.value)}
                  placeholder="ex. Ngono Bertrand"
                  className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C62828]" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">Spécialité *</label>
                <input value={newSpec} onChange={(e) => setNewSpec(e.target.value)}
                  placeholder="ex. Soudure & chaudronnerie"
                  className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C62828]" />
              </div>
            </div>
          )}

          {/* ── Assigner une session ── */}
          {newNom.trim() !== '' && newSpec.trim() !== '' && (
            <div className="space-y-3 border-t border-gray-100 pt-4">
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">
                  Assigner à une session
                  <span className="ml-1 font-normal normal-case text-gray-400">(optionnel)</span>
                </label>

                {sessionsActives.length === 0 ? (
                  <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2.5 text-xs text-amber-700">
                    <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                    Aucune session planifiée — créez-en une depuis l'onglet Sessions.
                  </div>
                ) : (
                  <select value={selectedSessionId}
                    onChange={(e) => { setSelectedSessionId(e.target.value); setDisponibilites([]) }}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#C62828]">
                    <option value="">— Aucune session pour l'instant —</option>
                    {sessionsActives.map((s) => (
                      <option key={s.id} value={s.id} disabled={s.nb_inscrits >= s.capacite_max}>
                        N{s.niveau} · {s.module} · {s.nb_inscrits}/{s.capacite_max} inscrits
                        {s.nb_inscrits >= s.capacite_max ? ' (complet)' : ''}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              {/* Disponibilités */}
              {selectedSession && selectedSession.horaires.length > 0 && (
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase mb-2">
                    Créneaux disponibles *
                  </label>
                  <div className="grid grid-cols-2 gap-1.5">
                    {selectedSession.horaires.map((h) => {
                      const checked = disponibilites.includes(h)
                      return (
                        <button key={h} type="button"
                          onClick={() => setDisponibilites(d => checked ? d.filter(x => x !== h) : [...d, h])}
                          className={`text-xs px-3 py-1.5 rounded-lg border text-left transition-colors ${checked ? 'bg-[#C62828] text-white border-[#C62828]' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}>
                          {h}
                        </button>
                      )
                    })}
                  </div>
                  {disponibilites.length === 0 && (
                    <p className="text-[11px] text-amber-600 mt-1.5 flex items-center gap-1">
                      <AlertCircle className="h-3 w-3" /> Sélectionnez au moins un créneau disponible.
                    </p>
                  )}
                </div>
              )}

              {selectedSession && selectedSession.horaires.length === 0 && (
                <p className="text-[11px] text-gray-400 italic">Cette session n'a pas de créneaux définis.</p>
              )}
            </div>
          )}

          <div className="bg-blue-50 rounded-xl px-3 py-2.5 text-xs text-[#1d4ed8]">
            L'apprenant démarrera au <strong>Niveau 1</strong>. La progression se fait via validation du directeur.
          </div>
          <div className="flex gap-3 pt-2 border-t border-gray-100">
            <Button variant="ghost" className="flex-1" onClick={() => setAddSlide(false)}>Annuler</Button>
            <Button className="flex-1"
              disabled={!newNom.trim() || !newSpec.trim() || newSaving ||
                (!!selectedSessionId && selectedSession !== null && selectedSession.horaires.length > 0 && disponibilites.length === 0)}
              onClick={handleAddApprenant}>
              {newSaving ? 'Ajout…' : selectedSessionId ? 'Ajouter & inscrire' : 'Ajouter'}
            </Button>
          </div>
        </div>
      </SlideOver>
    </motion.div>
  )
}
