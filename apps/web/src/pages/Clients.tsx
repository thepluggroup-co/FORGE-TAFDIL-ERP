import React, { useState } from 'react'
import { motion } from 'framer-motion'
import { useNavigate } from 'react-router-dom'
import { Plus, Eye, Phone, Building2, User, Landmark } from 'lucide-react'
import { PageHeader, DataTable, StatusBadge, Button, SlideOver } from '@forge/ui'
import type { Column } from '@forge/ui'
import { formatXAF } from '@/lib/utils'
import { useClients, useCreateClient } from '@/hooks/useClients'
import type { Client as ClientApi, CreateClientPayload } from '@/hooks/useClients'

// ── Types ──────────────────────────────────────────────────────────────────────

export type ClientType = 'entreprise' | 'particulier' | 'institution'
export type Client = ClientApi & Record<string, unknown>

// ── Score component ────────────────────────────────────────────────────────────

export function ScoreFiabilite({ score }: { score: number }) {
  const color = score >= 80 ? '#15803d' : score >= 50 ? '#d97706' : '#dc2626'
  const bg    = score >= 80 ? '#dcfce7' : score >= 50 ? '#fef3c7' : '#fee2e2'

  return (
    <div className="flex items-center gap-2 min-w-[80px]">
      <div className="flex-1 h-1.5 rounded-full bg-gray-100 overflow-hidden">
        <div className="h-full rounded-full transition-all" style={{ width: `${score}%`, backgroundColor: color }} />
      </div>
      <span className="text-xs font-bold px-1.5 py-0.5 rounded-full shrink-0" style={{ color, backgroundColor: bg }}>
        {score}
      </span>
    </div>
  )
}

// ── Type icons / labels ───────────────────────────────────────────────────────

const TYPE_ICONS: Record<ClientType, React.ElementType> = {
  entreprise: Building2, particulier: User, institution: Landmark,
}

const TYPE_LABELS: Record<ClientType, string> = {
  entreprise: 'Entreprise', particulier: 'Particulier', institution: 'Institution',
}

// ── Default form ───────────────────────────────────────────────────────────────

interface NouveauClientForm {
  nom: string
  type: ClientType
  telephone: string
  email: string
  adresse: string
  ville: string
  notes: string
  statut: 'actif' | 'inactif' | 'bloque'
}

const DEFAULT_FORM: NouveauClientForm = {
  nom: '', type: 'entreprise', telephone: '', email: '',
  adresse: '', ville: 'Douala', notes: '', statut: 'actif',
}

// ── Table columns ─────────────────────────────────────────────────────────────

function buildColumns(navigate: ReturnType<typeof useNavigate>): Column<Client>[] {
  return [
    {
      id: 'nom', header: 'Client', accessor: 'nom',
      csvValue: (row) => `${row.nom} (${TYPE_LABELS[row.type as ClientType] ?? row.type})`,
      render: (v, row) => {
        const Icon = TYPE_ICONS[row.type as ClientType] ?? User
        return (
          <div className="flex items-center gap-2.5">
            <div className="flex items-center justify-center w-8 h-8 rounded-full bg-[#ECEFF1] text-[#37474F] shrink-0">
              <Icon className="h-3.5 w-3.5" />
            </div>
            <div>
              <div className="text-sm font-semibold text-[#212121]">{v as string}</div>
              <div className="text-xs text-gray-400">{TYPE_LABELS[row.type as ClientType]}</div>
            </div>
          </div>
        )
      },
    },
    {
      id: 'telephone', header: 'Téléphone', accessor: 'telephone',
      render: (v) => (
        <a href={`tel:${v}`} className="flex items-center gap-1 text-sm text-gray-600 hover:text-[#C62828] transition-colors" onClick={(e) => e.stopPropagation()}>
          <Phone className="h-3 w-3" />{v as string}
        </a>
      ),
    },
    {
      id: 'commandes', header: 'Commandes', accessor: 'commandes_count',
      render: (v) => <span className="text-sm font-semibold">{v as number}</span>,
    },
    {
      id: 'encours', header: 'Encours crédit', accessor: 'encours_credit_xaf',
      csvValue: (row) => String(row.encours_credit_xaf ?? 0),
      render: (v) => {
        const amt = v as number
        return <span className="text-sm font-semibold" style={{ color: amt > 0 ? '#dc2626' : '#15803d' }}>{amt > 0 ? formatXAF(amt) : '—'}</span>
      },
    },
    {
      id: 'ca', header: 'CA Total', accessor: 'total_ca_xaf',
      csvValue: (row) => String(row.total_ca_xaf ?? 0),
      render: (v) => <span className="text-sm font-semibold">{formatXAF(v as number)}</span>,
    },
    {
      id: 'score', header: 'Fiabilité', accessor: 'score_fiabilite',
      render: (v) => <ScoreFiabilite score={v as number} />,
    },
    {
      id: 'statut', header: 'Statut', accessor: 'statut',
      render: (v) => <StatusBadge status={v as string} />,
    },
    {
      id: 'actions', header: '', accessor: 'id',
      sortable: false,
      csvSkip: true,   // ← never include action buttons in CSV exports
      render: (_, row) => (
        <button
          onClick={(e) => { e.stopPropagation(); navigate(`/clients/${row.id}`) }}
          className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-lg
            border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors"
        >
          <Eye className="h-3 w-3" /> Fiche
        </button>
      ),
    },
  ]
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function Clients() {
  const navigate = useNavigate()
  const { data, isLoading }  = useClients()
  const createClient         = useCreateClient()

  const [slideOpen, setSlideOpen] = useState(false)
  const [form, setForm]           = useState<NouveauClientForm>(DEFAULT_FORM)
  const [formError, setFormError] = useState<string | null>(null)

  const clients = (data?.data ?? []) as Client[]
  const caTotal = clients.reduce((s, c) => s + (c.total_ca_xaf as number), 0)
  const columns = buildColumns(navigate)

  const handleCreate = () => {
    if (!form.nom.trim()) { setFormError('Le nom est obligatoire'); return }
    setFormError(null)
    const payload: CreateClientPayload = {
      nom:       form.nom.trim(),
      type:      form.type,
      telephone: form.telephone || undefined,
      email:     form.email     || undefined,
      adresse:   form.adresse   || undefined,
      ville:     form.ville     || undefined,
      statut:    form.statut,
      notes:     form.notes     || undefined,
    }
    createClient.mutate(
      payload,
      {
        onSuccess: () => {
          setSlideOpen(false)
          setForm(DEFAULT_FORM)
        },
        onError: (err: Error) => setFormError(err.message),
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
        title="Clients"
        subtitle={`${data?.total ?? 0} clients · ${formatXAF(caTotal)} de CA cumulé`}
        breadcrumbs={[{ label: 'FORGE', href: '/' }, { label: 'Clients' }]}
        actions={
          <Button size="sm" onClick={() => { setForm(DEFAULT_FORM); setFormError(null); setSlideOpen(true) }}>
            <Plus className="h-3.5 w-3.5" /> Nouveau client
          </Button>
        }
      />

      <DataTable<Client>
        columns={columns}
        data={clients}
        keyField="id"
        onRowClick={(row) => navigate(`/clients/${row.id}`)}
        loading={isLoading}
      />

      {/* ── Nouveau client slide-over ── */}
      <SlideOver isOpen={slideOpen} onClose={() => setSlideOpen(false)} title="Nouveau client" width="md">
        <div className="space-y-4">
          {/* Type selector */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase mb-2">Type de client</label>
            <div className="grid grid-cols-3 gap-2">
              {(['entreprise', 'particulier', 'institution'] as ClientType[]).map((t) => {
                const Icon = TYPE_ICONS[t]
                return (
                  <button
                    key={t}
                    onClick={() => setForm((f) => ({ ...f, type: t }))}
                    className="flex flex-col items-center gap-1.5 py-3 rounded-xl border-2 text-xs font-medium transition-all"
                    style={{
                      borderColor: form.type === t ? '#C62828' : '#e5e7eb',
                      backgroundColor: form.type === t ? '#FFEBEE' : 'transparent',
                      color: form.type === t ? '#C62828' : '#6b7280',
                    }}
                  >
                    <Icon className="h-4 w-4" />
                    {TYPE_LABELS[t]}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Nom */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">
              {form.type === 'particulier' ? 'Nom complet *' : 'Raison sociale *'}
            </label>
            <input
              value={form.nom}
              onChange={(e) => setForm((f) => ({ ...f, nom: e.target.value }))}
              placeholder={form.type === 'entreprise' ? 'ex. CAMRAIL SA' : form.type === 'institution' ? 'ex. Ministère des Finances' : 'ex. Ngono Jean-Pierre'}
              className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C62828]"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            {/* Téléphone */}
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">Téléphone</label>
              <input
                value={form.telephone}
                onChange={(e) => setForm((f) => ({ ...f, telephone: e.target.value }))}
                placeholder="+237 6XX XXX XXX"
                className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C62828]"
              />
            </div>

            {/* Email */}
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">Email</label>
              <input
                type="email"
                value={form.email}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                placeholder="contact@exemple.cm"
                className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C62828]"
              />
            </div>
          </div>

          {/* Adresse */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">Adresse</label>
            <input
              value={form.adresse}
              onChange={(e) => setForm((f) => ({ ...f, adresse: e.target.value }))}
              placeholder="ex. Rue de la Joie, Akwa"
              className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C62828]"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            {/* Ville */}
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">Ville</label>
              <select
                value={form.ville}
                onChange={(e) => setForm((f) => ({ ...f, ville: e.target.value }))}
                className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C62828]"
              >
                {['Douala', 'Yaoundé', 'Bafoussam', 'Garoua', 'Maroua', 'Bamenda', 'Ngaoundéré', 'Bertoua', 'Ebolowa', 'Kribi'].map((v) => (
                  <option key={v} value={v}>{v}</option>
                ))}
              </select>
            </div>

            {/* Statut */}
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">Statut</label>
              <select
                value={form.statut}
                onChange={(e) => setForm((f) => ({ ...f, statut: e.target.value as NouveauClientForm['statut'] }))}
                className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C62828]"
              >
                <option value="actif">Actif</option>
                <option value="inactif">Inactif</option>
                <option value="bloque">Bloqué</option>
              </select>
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">
              Notes <span className="text-gray-300 normal-case font-normal">(optionnel)</span>
            </label>
            <textarea
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              rows={3}
              placeholder="Informations complémentaires, historique, préférences…"
              className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C62828] resize-none"
            />
          </div>

          {/* Error */}
          {formError && (
            <div className="flex items-center gap-2 px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">
              <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              {formError}
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-3 pt-2 border-t border-gray-100">
            <Button variant="ghost" className="flex-1" onClick={() => setSlideOpen(false)}>Annuler</Button>
            <Button
              className="flex-1"
              disabled={!form.nom.trim() || createClient.isPending}
              onClick={handleCreate}
            >
              {createClient.isPending ? 'Enregistrement…' : 'Créer le client'}
            </Button>
          </div>
        </div>
      </SlideOver>
    </motion.div>
  )
}
