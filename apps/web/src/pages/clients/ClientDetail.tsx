import React, { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, Phone, Mail, MapPin, Building2, User, Landmark, TrendingUp, CreditCard, FileText, Clock, OctagonX, ShieldCheck } from 'lucide-react'
import { PageHeader, StatusBadge, Button, Modal } from '@forge/ui'
import { formatXAF } from '@/lib/utils'
import { useClient, useUpdateClientStatut } from '@/hooks/useClients'
import type { Client } from '@/hooks/useClients'
import { useAuth } from '@/context/AuthContext'
import { ScoreFiabilite } from '../Clients'
import type { ClientType } from '../Clients'

// ── Tabs ───────────────────────────────────────────────────────────────────────

const TABS = ['Infos', 'Commandes', 'Crédits', 'Factures', 'Historique'] as const
type Tab = typeof TABS[number]

const TYPE_ICONS: Record<ClientType, React.ElementType> = {
  entreprise: Building2, particulier: User, institution: Landmark,
}

// ── Statut change segmented control ───────────────────────────────────────────

const STATUT_OPTIONS: { value: Client['statut']; label: string; color: string; bg: string }[] = [
  { value: 'actif',   label: 'Actif',   color: '#15803d', bg: '#dcfce7' },
  { value: 'inactif', label: 'Inactif', color: '#d97706', bg: '#fef3c7' },
  { value: 'bloque',  label: 'Bloqué',  color: '#dc2626', bg: '#fee2e2' },
]

// ── Page ───────────────────────────────────────────────────────────────────────

export default function ClientDetail() {
  const { id }   = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { role } = useAuth()

  const [activeTab, setActiveTab]           = useState<Tab>('Infos')
  const [showBlockConfirm, setShowBlockConfirm] = useState(false)

  const { data: client, isLoading } = useClient(id ?? '')
  const updateStatut = useUpdateClientStatut()

  const canChangeStatut = role === 'admin' || role === 'directeur'

  const handleStatutChange = (newStatut: Client['statut']) => {
    if (!client || client.statut === newStatut) return
    if (newStatut === 'bloque') { setShowBlockConfirm(true); return }
    updateStatut.mutate({ id: client.id, statut: newStatut })
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64 text-sm text-gray-400">Chargement…</div>
    )
  }

  if (!client) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3">
        <p className="text-gray-500">Client introuvable.</p>
        <Button variant="ghost" onClick={() => navigate('/clients')}>
          <ArrowLeft className="h-4 w-4" /> Retour aux clients
        </Button>
      </div>
    )
  }

  const Icon = TYPE_ICONS[client.type as ClientType]
  const scoreColor = client.score_fiabilite >= 80 ? '#15803d' : client.score_fiabilite >= 50 ? '#d97706' : '#dc2626'

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3 }}
      className="space-y-4"
    >
      <PageHeader
        title={client.nom}
        subtitle={`${client.commandes_count} commandes · CA : ${formatXAF(client.total_ca_xaf)}`}
        breadcrumbs={[
          { label: 'FORGE', href: '/' },
          { label: 'Clients', href: '/clients' },
          { label: client.nom },
        ]}
        actions={
          <Button variant="ghost" size="sm" onClick={() => navigate('/clients')}>
            <ArrowLeft className="h-3.5 w-3.5" /> Retour
          </Button>
        }
      />

      {/* ── Alerte blocage ── */}
      {client.statut === 'bloque' && (
        <motion.div
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center gap-3 px-4 py-3.5 bg-red-50 border border-red-300 rounded-xl"
        >
          <OctagonX className="h-5 w-5 text-red-600 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-red-700">Client bloqué</p>
            <p className="text-xs text-red-500 mt-0.5">
              Toute nouvelle commande pour ce client est refusée automatiquement.
            </p>
          </div>
          {canChangeStatut && (
            <button
              onClick={() => updateStatut.mutate({ id: client.id, statut: 'actif' })}
              disabled={updateStatut.isPending}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg
                bg-white border border-red-300 text-red-700 hover:bg-red-100 transition-colors shrink-0"
            >
              <ShieldCheck className="h-3.5 w-3.5" /> Débloquer
            </button>
          )}
        </motion.div>
      )}

      {/* Header card */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
        <div className="flex items-start gap-4">
          <div className="flex items-center justify-center w-14 h-14 rounded-2xl shrink-0" style={{ backgroundColor: '#ECEFF1' }}>
            <Icon className="h-6 w-6 text-[#37474F]" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-2">
                <h2 className="text-lg font-bold text-[#212121]">{client.nom}</h2>
                <StatusBadge status={client.statut} />

                {/* Statut change buttons — admin/directeur only */}
                {canChangeStatut && (
                  <div className="flex items-center gap-1.5 pt-1">
                    <span className="text-xs text-gray-400 mr-1">Modifier :</span>
                    {STATUT_OPTIONS.map((opt) => {
                      const isActive = client.statut === opt.value
                      return (
                        <button
                          key={opt.value}
                          onClick={() => handleStatutChange(opt.value)}
                          disabled={isActive || updateStatut.isPending}
                          className="px-2.5 py-1 text-xs font-semibold rounded-lg border transition-all disabled:cursor-default"
                          style={{
                            borderColor: isActive ? opt.color : '#e5e7eb',
                            backgroundColor: isActive ? opt.bg : 'transparent',
                            color: isActive ? opt.color : '#9ca3af',
                            opacity: isActive ? 1 : 0.7,
                          }}
                          onMouseEnter={(e) => {
                            if (!isActive) {
                              e.currentTarget.style.borderColor = opt.color
                              e.currentTarget.style.color = opt.color
                              e.currentTarget.style.opacity = '1'
                            }
                          }}
                          onMouseLeave={(e) => {
                            if (!isActive) {
                              e.currentTarget.style.borderColor = '#e5e7eb'
                              e.currentTarget.style.color = '#9ca3af'
                              e.currentTarget.style.opacity = '0.7'
                            }
                          }}
                        >
                          {opt.label}
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
              <div className="flex flex-col items-end gap-1">
                <span className="text-xs text-gray-400 font-medium">Score fiabilité</span>
                <div
                  className="flex items-center justify-center w-12 h-12 rounded-full text-lg font-black border-2"
                  style={{ color: scoreColor, borderColor: scoreColor }}
                >
                  {client.score_fiabilite}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-4">
              {client.telephone && (
                <a href={`tel:${client.telephone}`} className="flex items-center gap-2 text-sm text-gray-600 hover:text-[#C62828] transition-colors">
                  <Phone className="h-3.5 w-3.5 shrink-0" />{client.telephone}
                </a>
              )}
              {client.email && (
                <a href={`mailto:${client.email}`} className="flex items-center gap-2 text-sm text-gray-600 hover:text-[#C62828] transition-colors">
                  <Mail className="h-3.5 w-3.5 shrink-0" />{client.email}
                </a>
              )}
              {client.adresse && (
                <div className="flex items-center gap-2 text-sm text-gray-500">
                  <MapPin className="h-3.5 w-3.5 shrink-0" />{client.adresse}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* KPIs */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-5 pt-5 border-t border-gray-100">
          {[
            { label: 'Commandes', value: String(client.commandes_count), color: '#1d4ed8' },
            { label: 'CA total', value: formatXAF(client.total_ca_xaf), color: '#15803d' },
            { label: 'Encours crédit', value: client.encours_credit_xaf > 0 ? formatXAF(client.encours_credit_xaf) : '—', color: client.encours_credit_xaf > 0 ? '#dc2626' : '#6b7280' },
          ].map(({ label, value, color }) => (
            <div key={label} className="text-center">
              <p className="text-xs text-gray-400 mb-1">{label}</p>
              <div className="text-sm font-bold" style={{ color }}>{value}</div>
            </div>
          ))}
          <div className="text-center">
            <p className="text-xs text-gray-400 mb-1">Fiabilité</p>
            <div className="flex justify-center">
              <ScoreFiabilite score={client.score_fiabilite} />
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="flex border-b border-gray-100 overflow-x-auto">
          {TABS.map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className="px-4 py-3 text-sm font-medium whitespace-nowrap transition-colors relative"
              style={{ color: activeTab === tab ? '#C62828' : '#6b7280' }}
            >
              {tab}
              {activeTab === tab && (
                <motion.div
                  layoutId="tab-indicator"
                  className="absolute bottom-0 inset-x-0 h-0.5 rounded-full"
                  style={{ backgroundColor: '#C62828' }}
                />
              )}
            </button>
          ))}
        </div>

        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.2 }}
            className="p-5"
          >
            {activeTab === 'Infos' && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {[
                  { label: 'Type', value: client.type },
                  { label: 'Téléphone', value: client.telephone || '—' },
                  { label: 'Email', value: client.email || '—' },
                  { label: 'Adresse', value: client.adresse || '—' },
                  { label: 'Score fiabilité', value: <ScoreFiabilite score={client.score_fiabilite} /> },
                  { label: 'Statut', value: <StatusBadge status={client.statut} /> },
                ].map(({ label, value }) => (
                  <div key={label} className="flex flex-col gap-0.5">
                    <span className="text-xs text-gray-400 uppercase font-semibold">{label}</span>
                    <span className="text-sm text-[#212121]">{value}</span>
                  </div>
                ))}
              </div>
            )}

            {activeTab !== 'Infos' && (
              <EmptyTabState
                icon={activeTab === 'Commandes' ? <TrendingUp className="h-6 w-6" /> : activeTab === 'Crédits' ? <CreditCard className="h-6 w-6" /> : activeTab === 'Factures' ? <FileText className="h-6 w-6" /> : <Clock className="h-6 w-6" />}
                label={`Données ${activeTab.toLowerCase()} disponibles via l'API`}
              />
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* ── Confirmation blocage ── */}
      <Modal
        isOpen={showBlockConfirm}
        onClose={() => setShowBlockConfirm(false)}
        title="Bloquer ce client ?"
      >
        <div className="space-y-4">
          <div className="flex items-start gap-3 p-3 bg-red-50 rounded-lg border border-red-100">
            <OctagonX className="h-5 w-5 text-red-500 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-red-700">{client.nom}</p>
              <p className="text-xs text-red-500 mt-1">
                Le blocage empêche toute nouvelle commande pour ce client. Les commandes en cours ne sont pas affectées.
              </p>
            </div>
          </div>
          <div className="flex gap-3">
            <Button variant="ghost" className="flex-1" onClick={() => setShowBlockConfirm(false)}>
              Annuler
            </Button>
            <button
              onClick={() => {
                updateStatut.mutate(
                  { id: client.id, statut: 'bloque' },
                  { onSuccess: () => setShowBlockConfirm(false) },
                )
              }}
              disabled={updateStatut.isPending}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2 text-sm font-semibold
                rounded-lg bg-red-600 text-white hover:bg-red-700 transition-colors disabled:opacity-50"
            >
              <OctagonX className="h-4 w-4" />
              {updateStatut.isPending ? 'Blocage…' : 'Confirmer le blocage'}
            </button>
          </div>
        </div>
      </Modal>
    </motion.div>
  )
}

function EmptyTabState({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-10 gap-2 text-gray-400">
      {icon}
      <p className="text-sm">{label}</p>
    </div>
  )
}
