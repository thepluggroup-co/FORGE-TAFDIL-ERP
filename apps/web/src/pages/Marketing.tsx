import React, { useState } from 'react'
import { motion } from 'framer-motion'
import { Megaphone, Users, TrendingUp, Target, Plus, ExternalLink, MessageCircle, Share2 } from 'lucide-react'
import { PageHeader, KpiCard, DataTable, SlideOver, Button } from '@forge/ui'
import type { Column } from '@forge/ui'
import { formatXAF, formatDate } from '@/lib/utils'
import { useCampagnes, useCreateCampagne } from '@/hooks/useOperations'
import type { Campagne } from '@/hooks/useOperations'

type CampagneRecord = Campagne & Record<string, unknown>

const CANAUX = ['WhatsApp Business', 'Facebook Ads', 'Instagram', 'Google Ads', 'Démarchage direct', 'Bouche à oreille', 'Autre']

const STATUT_MAP: Record<string, { label: string; color: string; bg: string }> = {
  active:   { label: 'Active',    color: '#15803d', bg: '#dcfce7' },
  planifie: { label: 'Planifiée', color: '#6b7280', bg: '#f3f4f6' },
  termine:  { label: 'Terminée', color: '#1d4ed8', bg: '#dbeafe' },
  pause:    { label: 'En pause',  color: '#d97706', bg: '#fef3c7' },
  annule:   { label: 'Annulée',  color: '#dc2626', bg: '#fee2e2' },
}

const COLUMNS: Column<CampagneRecord>[] = [
  { id: 'nom',    header: 'Campagne',     accessor: 'nom',               render: (v) => <span className="text-sm font-semibold">{v as string}</span> },
  { id: 'canal',  header: 'Canal',        accessor: 'canal',             render: (v) => <span className="text-sm text-gray-500">{v as string}</span> },
  { id: 'budget', header: 'Budget',       accessor: 'budget_xaf',        render: (v) => <span className="text-sm font-semibold">{(v as number) > 0 ? formatXAF(v as number) : 'Gratuit'}</span> },
  { id: 'reach',  header: 'Portée',       accessor: 'reach',             render: (v) => <span className="text-sm font-semibold">{((v as number) ?? 0).toLocaleString('fr-CM')}</span> },
  { id: 'leads',  header: 'Leads',        accessor: 'leads_count',       render: (v) => <span className="text-sm font-semibold text-[#1d4ed8]">{(v as number) ?? 0}</span> },
  { id: 'conv',   header: 'Conversions',  accessor: 'conversions_count', render: (v) => <span className="text-sm font-semibold text-[#15803d]">{(v as number) ?? 0}</span> },
  { id: 'fin',    header: 'Fin',          accessor: 'date_fin',          render: (v) => <span className="text-sm text-gray-400">{formatDate(v as string)}</span> },
  {
    id: 'statut', header: 'Statut', accessor: 'statut',
    render: (v) => {
      const s = STATUT_MAP[v as string] ?? { label: v as string, color: '#6b7280', bg: '#f3f4f6' }
      return <span className="text-xs font-semibold px-2 py-0.5 rounded-full" style={{ color: s.color, backgroundColor: s.bg }}>{s.label}</span>
    },
  },
]

interface CampagneForm {
  nom: string; canal: string; budget: number; dateDebut: string; dateFin: string
}
const DEFAULT_FORM: CampagneForm = {
  nom: '', canal: '', budget: 0,
  dateDebut: new Date().toISOString().split('T')[0], dateFin: '',
}

// ── Générateur rapide de post WhatsApp ────────────────────────────────────────

const TEMPLATES_POST = [
  { label: 'Promotion portails', text: '🔩 OFFRE SPÉCIALE TAFDIL\n\nPortails métalliques sur mesure à partir de 150 000 XAF.\nGaranti 2 ans, installation incluse à Douala.\n\n📞 Contactez-nous : +237 695 884 528\n🏭 TAFDIL SARL — Menuiserie Métallique & Aluminium' },
  { label: 'Formation disponible', text: '🎓 FORMATION MENUISERIE MÉTALLIQUE\n\nTAFDIL SARL ouvre ses portes aux apprenants motivés.\nFormation pratique : soudure, découpe, CNC, aluminium.\n\nInscriptions : +237 695 884 528\n📍 Kotto, Douala' },
  { label: 'Réalisation chantier', text: '✅ TRAVAUX TERMINÉS\n\nNouvelle réalisation TAFDIL : balcons + garde-corps aluminium.\nQualité professionnelle, délai respecté.\n\nDemandez votre devis gratuit !\n📞 +237 695 884 528 — TAFDIL SARL' },
]

function QuickPostWhatsApp() {
  const [text, setText] = useState(TEMPLATES_POST[0].text)

  const share = () => {
    const url = `https://wa.me/?text=${encodeURIComponent(text)}`
    window.open(url, '_blank')
  }

  return (
    <div className="space-y-2">
      <div className="flex gap-2 flex-wrap">
        {TEMPLATES_POST.map((t) => (
          <button key={t.label} onClick={() => setText(t.text)}
            className="px-2.5 py-1 text-xs rounded-full border border-gray-200 hover:border-[#C62828] hover:text-[#C62828] transition-colors">
            {t.label}
          </button>
        ))}
      </div>
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={4}
        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500/30 resize-none" />
      <button onClick={share}
        className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold text-white transition-colors"
        style={{ backgroundColor: '#25D366' }}>
        <MessageCircle className="h-4 w-4" /> Partager sur WhatsApp
      </button>
    </div>
  )
}

export default function Marketing() {
  const [slideOpen, setSlideOpen] = useState(false)
  const [form, setForm] = useState<CampagneForm>(DEFAULT_FORM)

  const { data, isLoading } = useCampagnes()
  const createCampagne = useCreateCampagne()

  const campagnes = (data?.data ?? []) as CampagneRecord[]
  const formValid = form.nom.trim() !== '' && form.canal !== '' && form.dateFin !== ''

  const handleCreate = () => {
    if (!formValid) return
    createCampagne.mutate(
      {
        nom: form.nom,
        canal: form.canal,
        budget_xaf: form.budget,
        date_debut: form.dateDebut,
        date_fin: form.dateFin,
      },
      {
        onSuccess: () => {
          setSlideOpen(false)
          setForm(DEFAULT_FORM)
        },
      },
    )
  }

  const totalLeads = campagnes.reduce((s, c) => s + c.leads_count, 0)
  const totalConv  = campagnes.reduce((s, c) => s + c.conversions_count, 0)
  const txConv     = totalLeads > 0 ? Math.round((totalConv / totalLeads) * 100) : 0
  const totalReach = campagnes.reduce((s, c) => s + c.reach, 0)

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.3 }} className="space-y-6">
      <PageHeader
        title="Marketing"
        subtitle="Campagnes · Leads · Conversions"
        breadcrumbs={[{ label: 'FORGE', href: '/' }, { label: 'Marketing' }]}
        actions={<Button size="sm" onClick={() => { setForm(DEFAULT_FORM); setSlideOpen(true) }}><Plus className="h-3.5 w-3.5" /> Nouvelle campagne</Button>}
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard title="Campagnes actives" value={campagnes.filter(c => c.statut === 'active').length} icon={<Megaphone className="h-5 w-5" />} color="#C62828" delay={0} />
        <KpiCard title="Leads ce mois" value={totalLeads} icon={<Users className="h-5 w-5" />} color="#1d4ed8" trend="up" trendValue="+18 % vs mois" delay={0.07} />
        <KpiCard title="Taux de conversion" value={txConv} unit="%" icon={<Target className="h-5 w-5" />} color="#15803d" delay={0.14} />
        <KpiCard title="Portée totale" value={`${(totalReach / 1000).toFixed(1)}k`} icon={<TrendingUp className="h-5 w-5" />} color="#7c3aed" delay={0.21} />
      </div>

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <DataTable<CampagneRecord> columns={COLUMNS} data={campagnes} keyField="id" loading={isLoading} />
      </div>

      {/* ── Réseaux sociaux TAFDIL (Gap 6 CDC MOD-07) ─────────────────────────── */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
        <div className="flex items-center gap-2 mb-4">
          <Share2 className="h-4 w-4 text-[#C62828]" />
          <h3 className="text-sm font-bold text-[#212121]">Réseaux sociaux TAFDIL</h3>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {/* WhatsApp Business */}
          <a
            href="https://wa.me/237695884528"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-3 p-4 rounded-xl border border-gray-100 hover:border-green-300 hover:bg-green-50 transition-colors group"
          >
            <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ backgroundColor: '#dcfce7' }}>
              <MessageCircle className="h-5 w-5" style={{ color: '#25D366' }} />
            </div>
            <div className="min-w-0">
              <div className="text-sm font-semibold text-gray-800">WhatsApp Business</div>
              <div className="text-xs text-gray-400 truncate">+237 695 884 528</div>
            </div>
            <ExternalLink className="h-3.5 w-3.5 text-gray-300 group-hover:text-green-500 ml-auto shrink-0" />
          </a>

          {/* Facebook */}
          <a
            href="https://www.facebook.com/tafdilsarl"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-3 p-4 rounded-xl border border-gray-100 hover:border-blue-300 hover:bg-blue-50 transition-colors group"
          >
            <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ backgroundColor: '#dbeafe' }}>
              <span className="text-lg font-black" style={{ color: '#1877F2' }}>f</span>
            </div>
            <div className="min-w-0">
              <div className="text-sm font-semibold text-gray-800">Facebook</div>
              <div className="text-xs text-gray-400 truncate">@tafdilsarl</div>
            </div>
            <ExternalLink className="h-3.5 w-3.5 text-gray-300 group-hover:text-blue-500 ml-auto shrink-0" />
          </a>

          {/* Instagram */}
          <a
            href="https://www.instagram.com/tafdilsarl"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-3 p-4 rounded-xl border border-gray-100 hover:border-pink-300 hover:bg-pink-50 transition-colors group"
          >
            <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: 'linear-gradient(135deg, #fde68a, #f472b6, #818cf8)' }}>
              <span className="text-white text-xs font-black">IG</span>
            </div>
            <div className="min-w-0">
              <div className="text-sm font-semibold text-gray-800">Instagram</div>
              <div className="text-xs text-gray-400 truncate">@tafdilsarl</div>
            </div>
            <ExternalLink className="h-3.5 w-3.5 text-gray-300 group-hover:text-pink-500 ml-auto shrink-0" />
          </a>
        </div>

        {/* Générateur de post WhatsApp */}
        <div className="mt-4 pt-4 border-t border-gray-100">
          <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Partager une offre par WhatsApp</p>
          <QuickPostWhatsApp />
        </div>
      </div>

      <SlideOver isOpen={slideOpen} onClose={() => setSlideOpen(false)} title="Nouvelle campagne" width="md">
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">Nom de la campagne *</label>
            <input value={form.nom} onChange={(e) => setForm((f) => ({ ...f, nom: e.target.value }))}
              placeholder="ex. Portails — Saison des pluies" className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C62828]" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">Canal *</label>
            <select value={form.canal} onChange={(e) => setForm((f) => ({ ...f, canal: e.target.value }))}
              className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C62828]">
              <option value="">Sélectionner…</option>
              {CANAUX.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">Budget (FCFA)</label>
            <input type="number" min="0" value={form.budget} onChange={(e) => setForm((f) => ({ ...f, budget: Number(e.target.value) }))}
              placeholder="0 = Gratuit" className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C62828]" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">Date début</label>
              <input type="date" value={form.dateDebut} onChange={(e) => setForm((f) => ({ ...f, dateDebut: e.target.value }))}
                className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C62828]" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">Date fin *</label>
              <input type="date" value={form.dateFin} min={form.dateDebut} onChange={(e) => setForm((f) => ({ ...f, dateFin: e.target.value }))}
                className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C62828]" />
            </div>
          </div>
          <div className="flex gap-3 pt-2 border-t border-gray-100">
            <Button variant="ghost" className="flex-1" onClick={() => setSlideOpen(false)}>Annuler</Button>
            <Button className="flex-1" disabled={!formValid || createCampagne.isPending} onClick={handleCreate}>
              {createCampagne.isPending ? 'Création…' : 'Créer la campagne'}
            </Button>
          </div>
        </div>
      </SlideOver>
    </motion.div>
  )
}
