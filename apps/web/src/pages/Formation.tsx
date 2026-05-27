import React, { useState } from 'react'
import { motion } from 'framer-motion'
import {
  GraduationCap, Star, Clock, Award, UserPlus,
  CheckCircle, Plus, TrendingUp, BookOpen, Users,
} from 'lucide-react'
import { PageHeader, KpiCard, SlideOver, Button, Modal } from '@forge/ui'
import { toast } from 'sonner'
import {
  useApprenants, useProgressionApprenant, useRecruterApprenant, useCreateApprenant,
} from '@/hooks/useRH'
import type { Apprenant, RecruterPayload } from '@/hooks/useRH'

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
  apprenant, isDirecteur, onNiveauSuivant, onRecruter,
}: {
  apprenant: Apprenant
  isDirecteur: boolean
  onNiveauSuivant: (a: Apprenant) => void
  onRecruter: (a: Apprenant) => void
}) {
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

      <div className="flex gap-2 pt-1 mt-auto">
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

// ── Plans de formation ─────────────────────────────────────────────────────────

const PLANS = [
  { module: 'Sécurité atelier & EPI', duree: '2 semaines', niveau: 1, description: 'Règles de sécurité, équipements obligatoires, premiers secours' },
  { module: 'Lecture de plans & métrologie', duree: '1 mois', niveau: 1, description: 'Lecture de plans techniques, utilisation des instruments de mesure' },
  { module: 'Soudure MIG/MAG — Bases', duree: '2 mois', niveau: 2, description: 'Techniques de soudure, réglages machine, joints basiques' },
  { module: 'Découpe plasma & oxycoupage', duree: '1 mois', niveau: 2, description: 'Opération machine découpe, paramètres, qualité de coupe' },
  { module: 'Pliage hydraulique', duree: '1 mois', niveau: 3, description: 'Programmation pliage, angles, matrices' },
  { module: 'Soudure TIG Inox & Alu', duree: '2 mois', niveau: 3, description: 'Soudure TIG sur aciers inoxydables et aluminium' },
  { module: 'CNC & programmation', duree: '3 mois', niveau: 4, description: 'Programmation G-code, setup machines CNC, usinage de précision' },
  { module: 'Contrôle qualité & finitions', duree: '1 mois', niveau: 4, description: 'Inspection dimensionnelle, traitements de surface, normes qualité' },
  { module: 'Management d\'équipe & projets', duree: '2 mois', niveau: 5, description: 'Gestion de chantier, coordination équipe, relation client' },
]

// ── Page ───────────────────────────────────────────────────────────────────────

type Tab = 'apprenants' | 'plans'

export default function Formation() {
  const [tab, setTab]                 = useState<Tab>('apprenants')
  const [recruterApprenant, setRecruter] = useState<Apprenant | null>(null)
  const [addSlide, setAddSlide]       = useState(false)
  const [newNom, setNewNom]           = useState('')
  const [newSpec, setNewSpec]         = useState('')
  const [newSaving, setNewSaving]     = useState(false)

  const { data: appData, isLoading }  = useApprenants()
  const progressionApprenant          = useProgressionApprenant()
  const createApprenant               = useCreateApprenant()
  const apprenants                    = appData?.data ?? []
  const isDirecteur                   = true

  const enFormation = apprenants.filter(a => a.statut === 'en_formation').length
  const candidats   = apprenants.filter(a => a.niveau === 5 && a.duree_mois >= 6).length
  const certifies   = apprenants.filter(a => a.statut === 'certifie' || a.statut === 'recrute').length
  const dureeAvg    = apprenants.length > 0
    ? Math.round(apprenants.reduce((s, a) => s + a.duree_mois, 0) / apprenants.length)
    : 0

  const handleAddApprenant = () => {
    if (!newNom.trim() || !newSpec.trim()) return
    setNewSaving(true)
    createApprenant.mutate(
      { nom: newNom.trim(), specialite: newSpec.trim(), niveau: 1, duree_mois: 0 },
      {
        onSuccess: () => {
          setAddSlide(false)
          setNewNom('')
          setNewSpec('')
          setNewSaving(false)
        },
        onError: () => setNewSaving(false),
      },
    )
  }

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
        subtitle="Apprenants · Progression · Recrutement"
        breadcrumbs={[{ label: 'FORGE', href: '/' }, { label: 'Formation' }]}
        actions={
          <Button size="sm" onClick={() => { setNewNom(''); setNewSpec(''); setAddSlide(true) }}>
            <Plus className="h-3.5 w-3.5" /> Ajouter apprenant
          </Button>
        }
      />

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard title="En formation" value={enFormation} icon={<GraduationCap className="h-5 w-5" />} color="#C62828" delay={0} />
        <KpiCard title="Candidats recrutement" value={candidats} icon={<Award className="h-5 w-5" />} color="#15803d" trendValue="Niveau 5 + 6 mois" trend="up" delay={0.07} />
        <KpiCard title="Certifiés / Recrutés" value={certifies} icon={<Users className="h-5 w-5" />} color="#1d4ed8" delay={0.14} />
        <KpiCard title="Durée moyenne" value={dureeAvg} unit=" mois" icon={<TrendingUp className="h-5 w-5" />} color="#7c3aed" delay={0.21} />
      </div>

      {/* Tabs */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="flex border-b border-gray-100">
          {[
            { id: 'apprenants' as Tab, label: 'Apprenants', icon: Users },
            { id: 'plans' as Tab,      label: 'Plans de formation', icon: BookOpen },
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

        {tab === 'apprenants' && (
          <div className="p-5">
            {isLoading ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="bg-gray-50 rounded-xl h-44 animate-pulse" />
                ))}
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
                    />
                  </motion.div>
                ))}
              </div>
            )}
          </div>
        )}

        {tab === 'plans' && (
          <div className="p-5">
            <p className="text-xs text-gray-400 mb-4">Programme de formation TAFDIL — 5 niveaux sur 12 à 18 mois</p>
            <div className="space-y-3">
              {PLANS.map((plan, i) => (
                <div key={i} className="flex items-start gap-4 p-3 rounded-xl border border-gray-100 hover:bg-gray-50 transition-colors">
                  <div
                    className="flex items-center justify-center w-8 h-8 rounded-full text-white text-xs font-bold shrink-0 mt-0.5"
                    style={{ backgroundColor: plan.niveau <= 2 ? '#C62828' : plan.niveau <= 3 ? '#d97706' : plan.niveau <= 4 ? '#1d4ed8' : '#15803d' }}
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
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Modal recruter */}
      <RecruterModal isOpen={!!recruterApprenant} onClose={() => setRecruter(null)} apprenant={recruterApprenant} />

      {/* SlideOver ajouter apprenant */}
      <SlideOver isOpen={addSlide} onClose={() => setAddSlide(false)} title="Ajouter un apprenant" width="md">
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">Nom complet *</label>
            <input value={newNom} onChange={(e) => setNewNom(e.target.value)}
              placeholder="ex. Ngono Bertrand" className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C62828]" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">Spécialité *</label>
            <input value={newSpec} onChange={(e) => setNewSpec(e.target.value)}
              placeholder="ex. Soudure & chaudronnerie" className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C62828]" />
          </div>
          <div className="bg-blue-50 rounded-xl px-3 py-2.5 text-xs text-[#1d4ed8]">
            L'apprenant démarrera au <strong>Niveau 1</strong> avec 0 mois de formation. La progression se fait via validation du directeur.
          </div>
          <div className="flex gap-3 pt-2 border-t border-gray-100">
            <Button variant="ghost" className="flex-1" onClick={() => setAddSlide(false)}>Annuler</Button>
            <Button className="flex-1" disabled={!newNom.trim() || !newSpec.trim() || newSaving} onClick={handleAddApprenant}>
              {newSaving ? 'Ajout…' : 'Ajouter'}
            </Button>
          </div>
        </div>
      </SlideOver>
    </motion.div>
  )
}
