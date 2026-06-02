import React, { useState } from 'react'
import { motion } from 'framer-motion'
import { Plus, Wrench, AlertTriangle, CheckCircle, Settings, Tool } from 'lucide-react'
import { PageHeader, Button, StatusBadge, SlideOver } from '@forge/ui'
import { formatXAF, formatDate } from '@/lib/utils'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/lib/api-client'
import { toast } from 'sonner'
import { useAuth } from '@/context/AuthContext'

// ── Types ──────────────────────────────────────────────────────────────────────

type CategorieFR = 'outil' | 'machine_legere' | 'instrument' | 'epi' | 'vehicule'
type StatutEquip = 'disponible' | 'en_service' | 'maintenance' | 'hors_service' | 'cede'

interface Equipement {
  id:                    string
  code:                  string
  designation:           string
  categorie:             CategorieFR
  statut:                StatutEquip
  emplacement:           string | null
  prochaine_revision:    string | null
  revision_depassee:     boolean
  valeur_achat_xaf:      number
  fournisseur:           string | null
  numero_serie:          string | null
  date_acquisition:      string | null
  notes:                 string | null
  employes:              { nom: string; poste: string } | null
}

interface EquipementsResponse { data: Equipement[]; total: number }

const CATEGORIE_LABELS: Record<CategorieFR, string> = {
  outil:          'Outil', machine_legere: 'Machine légère',
  instrument:     'Instrument', epi: 'EPI', vehicule: 'Véhicule',
}

const STATUT_COLORS: Record<StatutEquip, { bg: string; text: string }> = {
  disponible:   { bg: '#dcfce7', text: '#15803d' },
  en_service:   { bg: '#dbeafe', text: '#1d4ed8' },
  maintenance:  { bg: '#fef3c7', text: '#d97706' },
  hors_service: { bg: '#fee2e2', text: '#dc2626' },
  cede:         { bg: '#f3f4f6', text: '#6b7280' },
}

const STATUT_LABELS: Record<StatutEquip, string> = {
  disponible:   'Disponible', en_service: 'En service',
  maintenance:  'En maintenance', hors_service: 'Hors service', cede: 'Cédé',
}

// ── Hooks ──────────────────────────────────────────────────────────────────────

function useEquipements(params?: { statut?: string; categorie?: string; search?: string }) {
  const qs = new URLSearchParams()
  if (params?.statut)    qs.set('statut',    params.statut)
  if (params?.categorie) qs.set('categorie', params.categorie)
  if (params?.search)    qs.set('search',    params.search)
  const q = qs.toString()
  return useQuery({
    queryKey: ['equipements', params],
    queryFn:  () => apiClient.get<EquipementsResponse>(`/api/equipements${q ? `?${q}` : ''}`),
    staleTime: 30_000,
  })
}

function useEquipementsAlertesRevision() {
  return useQuery({
    queryKey: ['equipements', 'alertes-revision'],
    queryFn:  () => apiClient.get<{ data: (Equipement & { jours_restants: number })[]; total: number }>(
      '/api/equipements/alertes-revision'
    ),
    staleTime: 60_000,
  })
}

function useCreateEquipement() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: Record<string, unknown>) => apiClient.post<Equipement>('/api/equipements', payload),
    onSuccess:  () => { void qc.invalidateQueries({ queryKey: ['equipements'] }); toast.success('Équipement créé') },
    onError:    (err: Error) => toast.error(err.message),
  })
}

function useUpdateStatutEquipement() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, statut }: { id: string; statut: StatutEquip }) =>
      apiClient.patch<Equipement>(`/api/equipements/${id}/statut`, { statut }),
    onSuccess:  () => { void qc.invalidateQueries({ queryKey: ['equipements'] }); toast.success('Statut mis à jour') },
    onError:    (err: Error) => toast.error(err.message),
  })
}

// ── Default form ───────────────────────────────────────────────────────────────

const DEFAULT_FORM = {
  code: '', designation: '', categorie: 'outil' as CategorieFR,
  numero_serie: '', fournisseur: '', date_acquisition: '', valeur_achat_xaf: 0,
  emplacement: '', prochaine_revision: '', intervalle_revision_j: 365, notes: '',
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function Equipements() {
  const { role } = useAuth()
  const canEdit  = role === 'admin' || role === 'superviseur'

  const [search,     setSearch]     = useState('')
  const [filtreStatut, setFiltreStatut] = useState('')
  const [slideOpen,  setSlideOpen]  = useState(false)
  const [form,       setForm]       = useState(DEFAULT_FORM)
  const [formError,  setFormError]  = useState<string | null>(null)
  const [tab,        setTab]        = useState<'all' | 'alertes'>('all')

  const { data, isLoading }    = useEquipements({ search, statut: filtreStatut })
  const { data: alertesData }  = useEquipementsAlertesRevision()
  const createEquipement       = useCreateEquipement()
  const updateStatut           = useUpdateStatutEquipement()

  const equipements = data?.data ?? []
  const alertes     = alertesData?.data ?? []

  const handleCreate = () => {
    if (!form.code.trim())        { setFormError('Le code est obligatoire') ; return }
    if (!form.designation.trim()) { setFormError('La désignation est obligatoire') ; return }
    setFormError(null)
    createEquipement.mutate(
      {
        ...form,
        valeur_achat_xaf:      form.valeur_achat_xaf || 0,
        intervalle_revision_j: form.intervalle_revision_j || 365,
        prochaine_revision:    form.prochaine_revision || undefined,
        date_acquisition:      form.date_acquisition  || undefined,
        numero_serie:          form.numero_serie       || undefined,
        fournisseur:           form.fournisseur        || undefined,
        emplacement:           form.emplacement        || undefined,
        notes:                 form.notes              || undefined,
      },
      { onSuccess: () => { setSlideOpen(false); setForm(DEFAULT_FORM) } },
    )
  }

  const displayed = tab === 'alertes' ? alertes : equipements

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3 }}
      className="space-y-6"
    >
      <PageHeader
        title="Équipements & Outils"
        subtitle={`${data?.total ?? 0} équipements · ${alertes.length > 0 ? `${alertes.length} révision(s) à prévoir` : 'révisions à jour'}`}
        breadcrumbs={[{ label: 'FORGE', href: '/' }, { label: 'Équipements' }]}
        actions={
          canEdit ? (
            <Button size="sm" onClick={() => { setForm(DEFAULT_FORM); setFormError(null); setSlideOpen(true) }}>
              <Plus className="h-3.5 w-3.5" /> Nouvel équipement
            </Button>
          ) : undefined
        }
      />

      {/* Alerte révisions */}
      {alertes.length > 0 && tab === 'all' && (
        <button
          onClick={() => setTab('alertes')}
          className="w-full flex items-center gap-3 px-4 py-3 bg-amber-50 border border-amber-200 rounded-xl text-left hover:bg-amber-100 transition-colors"
        >
          <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-bold text-amber-700">
              {alertes.filter(e => e.revision_depassee).length > 0
                ? `${alertes.filter(e => e.revision_depassee).length} révision(s) en retard !`
                : `${alertes.length} équipement(s) à réviser dans les 30 prochains jours`}
            </p>
            <p className="text-xs text-amber-500 mt-0.5">Cliquez pour voir les détails</p>
          </div>
        </button>
      )}

      {/* Filtres + onglets */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex border border-gray-200 rounded-lg overflow-hidden">
          {(['all', 'alertes'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className="px-3 py-1.5 text-xs font-medium transition-colors"
              style={{
                backgroundColor: tab === t ? '#C62828' : 'transparent',
                color: tab === t ? 'white' : '#6b7280',
              }}
            >
              {t === 'all' ? 'Tous' : `Révisions (${alertes.length})`}
            </button>
          ))}
        </div>
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Rechercher…"
          className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C62828]"
        />
        <select
          value={filtreStatut}
          onChange={(e) => setFiltreStatut(e.target.value)}
          className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C62828]"
        >
          <option value="">Tous statuts</option>
          {Object.entries(STATUT_LABELS).map(([v, l]) => (
            <option key={v} value={v}>{l}</option>
          ))}
        </select>
      </div>

      {/* Grille équipements */}
      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="h-40 bg-gray-100 rounded-xl animate-pulse" />
          ))}
        </div>
      ) : displayed.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-gray-400">
          <Wrench className="h-10 w-10 mb-3 text-gray-200" />
          <p className="text-sm">{tab === 'alertes' ? 'Aucune révision à prévoir' : 'Aucun équipement trouvé'}</p>
          {canEdit && tab === 'all' && (
            <button onClick={() => setSlideOpen(true)} className="mt-3 text-sm text-[#C62828] hover:underline">
              Créer le premier équipement
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {displayed.map((e) => {
            const statut  = STATUT_COLORS[e.statut as StatutEquip] ?? STATUT_COLORS.disponible
            const revision = e.revision_depassee
            return (
              <div
                key={e.id}
                className="bg-white rounded-xl border shadow-sm p-4 space-y-3 hover:shadow-md transition-shadow"
                style={{ borderColor: revision ? '#fca5a5' : '#f3f4f6' }}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono text-gray-400">{e.code}</span>
                      {revision && <AlertTriangle className="h-3.5 w-3.5 text-red-500 shrink-0" />}
                    </div>
                    <p className="text-sm font-semibold text-[#212121] truncate mt-0.5">{e.designation}</p>
                    <p className="text-xs text-gray-400">{CATEGORIE_LABELS[e.categorie as CategorieFR] ?? e.categorie}</p>
                  </div>
                  <span
                    className="text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0"
                    style={{ backgroundColor: statut.bg, color: statut.text }}
                  >
                    {STATUT_LABELS[e.statut as StatutEquip] ?? e.statut}
                  </span>
                </div>

                <div className="text-xs text-gray-500 space-y-0.5">
                  {e.emplacement && <p>📍 {e.emplacement}</p>}
                  {e.employes   && <p>👤 {e.employes.nom}</p>}
                  {e.prochaine_revision && (
                    <p style={{ color: revision ? '#dc2626' : '#6b7280' }}>
                      🔧 Révision : {e.prochaine_revision}
                      {revision ? ' (EN RETARD)' : ''}
                    </p>
                  )}
                  {e.valeur_achat_xaf > 0 && <p>💰 {formatXAF(e.valeur_achat_xaf)}</p>}
                </div>

                {/* Quick status change */}
                {canEdit && (
                  <select
                    value={e.statut}
                    onChange={(ev) => updateStatut.mutate({ id: e.id, statut: ev.target.value as StatutEquip })}
                    className="w-full text-xs px-2 py-1.5 border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-1 focus:ring-[#C62828]"
                  >
                    {Object.entries(STATUT_LABELS).map(([v, l]) => (
                      <option key={v} value={v}>{l}</option>
                    ))}
                  </select>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* SlideOver création */}
      <SlideOver isOpen={slideOpen} onClose={() => setSlideOpen(false)} title="Nouvel équipement" width="md">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">Code *</label>
              <input value={form.code} onChange={e => setForm(f => ({ ...f, code: e.target.value }))}
                placeholder="EQ-001" className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C62828]" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">Catégorie</label>
              <select value={form.categorie} onChange={e => setForm(f => ({ ...f, categorie: e.target.value as CategorieFR }))}
                className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C62828]">
                {Object.entries(CATEGORIE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">Désignation *</label>
            <input value={form.designation} onChange={e => setForm(f => ({ ...f, designation: e.target.value }))}
              placeholder="ex. Perceuse colonne 16mm" className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C62828]" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">N° Série</label>
              <input value={form.numero_serie} onChange={e => setForm(f => ({ ...f, numero_serie: e.target.value }))}
                className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C62828]" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">Emplacement</label>
              <input value={form.emplacement} onChange={e => setForm(f => ({ ...f, emplacement: e.target.value }))}
                placeholder="ex. Atelier A" className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C62828]" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">Date acquisition</label>
              <input type="date" value={form.date_acquisition} onChange={e => setForm(f => ({ ...f, date_acquisition: e.target.value }))}
                className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C62828]" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">Valeur d'achat (XAF)</label>
              <input type="number" min="0" value={form.valeur_achat_xaf || ''} onChange={e => setForm(f => ({ ...f, valeur_achat_xaf: Number(e.target.value) }))}
                className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C62828]" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">Prochaine révision</label>
              <input type="date" value={form.prochaine_revision} onChange={e => setForm(f => ({ ...f, prochaine_revision: e.target.value }))}
                className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C62828]" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">Intervalle révision (j)</label>
              <input type="number" min="1" value={form.intervalle_revision_j} onChange={e => setForm(f => ({ ...f, intervalle_revision_j: Number(e.target.value) }))}
                className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C62828]" />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">Fournisseur</label>
            <input value={form.fournisseur} onChange={e => setForm(f => ({ ...f, fournisseur: e.target.value }))}
              className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C62828]" />
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">Notes</label>
            <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={2} resize-none
              className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C62828] resize-none" />
          </div>

          {formError && (
            <div className="px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">{formError}</div>
          )}

          <div className="flex gap-3 pt-2 border-t border-gray-100">
            <Button variant="ghost" className="flex-1" onClick={() => setSlideOpen(false)}>Annuler</Button>
            <Button className="flex-1" disabled={!form.code.trim() || !form.designation.trim() || createEquipement.isPending} onClick={handleCreate}>
              {createEquipement.isPending ? 'Création…' : 'Créer'}
            </Button>
          </div>
        </div>
      </SlideOver>
    </motion.div>
  )
}
