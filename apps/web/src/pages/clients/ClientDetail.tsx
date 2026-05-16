import React, { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, Phone, Mail, MapPin, Building2, User, Landmark, TrendingUp, CreditCard, FileText, Clock } from 'lucide-react'
import { PageHeader, StatusBadge, Button } from '@forge/ui'
import { formatXAF, formatDate } from '@/lib/utils'
import { CLIENTS, ScoreFiabilite } from '../Clients'
import type { ClientType } from '../Clients'

// ── Mock detail data ───────────────────────────────────────────────────────────

const CLIENT_ORDERS: Record<string, Array<{ ref: string; montant: number; statut: string; date: string }>> = {
  '1': [
    { ref: 'CMD-2026-047', montant: 537225, statut: 'in_production', date: '2026-05-15' },
    { ref: 'CMD-2026-032', montant: 1192050, statut: 'delivered', date: '2026-04-20' },
  ],
  '3': [
    { ref: 'CMD-2026-046', montant: 101406, statut: 'confirmed', date: '2026-05-14' },
  ],
}

const CLIENT_CREDITS: Record<string, Array<{ ref: string; montant: number; statut: string; echeance: string }>> = {
  '3': [
    { ref: 'CRED-2026-003', montant: 180000, statut: 'echu', echeance: '2026-05-01' },
  ],
  '5': [
    { ref: 'CRED-2026-007', montant: 75000, statut: 'en_cours', echeance: '2026-06-01' },
  ],
}

const CLIENT_FACTURES: Record<string, Array<{ ref: string; montant: number; statut: string; date: string }>> = {
  '1': [
    { ref: 'FACT-2026-047', montant: 537225, statut: 'valide', date: '2026-05-15' },
  ],
}

const CLIENT_HISTORIQUE: Record<string, Array<{ action: string; date: string; user: string }>> = {
  '1': [
    { action: 'Commande CMD-2026-047 passée', date: '2026-05-15', user: 'Admin' },
    { action: 'Paiement facture FACT-2026-032 reçu', date: '2026-04-25', user: 'Admin' },
  ],
}

// ── Tabs ───────────────────────────────────────────────────────────────────────

const TABS = ['Infos', 'Commandes', 'Crédits', 'Factures', 'Historique'] as const
type Tab = typeof TABS[number]

const TYPE_ICONS: Record<ClientType, React.ElementType> = {
  entreprise: Building2, particulier: User, institution: Landmark,
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function ClientDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [activeTab, setActiveTab] = useState<Tab>('Infos')

  const client = CLIENTS.find((c) => c.id === id)

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
  const orders = CLIENT_ORDERS[id!] ?? []
  const credits = CLIENT_CREDITS[id!] ?? []
  const factures = CLIENT_FACTURES[id!] ?? []
  const historique = CLIENT_HISTORIQUE[id!] ?? []

  const scoreColor = client.scoreFiabilite >= 80 ? '#15803d' : client.scoreFiabilite >= 50 ? '#d97706' : '#dc2626'

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3 }}
      className="space-y-6"
    >
      <PageHeader
        title={client.nom}
        subtitle={`${client.commandesCount} commandes · CA : ${formatXAF(client.totalCAXAF)}`}
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

      {/* Header card */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
        <div className="flex items-start gap-4">
          <div
            className="flex items-center justify-center w-14 h-14 rounded-2xl shrink-0"
            style={{ backgroundColor: '#ECEFF1' }}
          >
            <Icon className="h-6 w-6 text-[#37474F]" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-bold text-[#212121]">{client.nom}</h2>
                <StatusBadge status={client.statut} />
              </div>
              {/* Score */}
              <div className="flex flex-col items-end gap-1">
                <span className="text-xs text-gray-400 font-medium">Score fiabilité</span>
                <div
                  className="flex items-center justify-center w-12 h-12 rounded-full text-lg font-black border-2"
                  style={{ color: scoreColor, borderColor: scoreColor }}
                >
                  {client.scoreFiabilite}
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
                  <MapPin className="h-3.5 w-3.5 shrink-0" />{client.adresse as string}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* KPIs */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-5 pt-5 border-t border-gray-100">
          {[
            { label: 'Commandes', value: client.commandesCount, icon: TrendingUp, color: '#1d4ed8' },
            { label: 'CA total', value: formatXAF(client.totalCAXAF), icon: TrendingUp, color: '#15803d' },
            { label: 'Encours crédit', value: client.encoursCreditXAF > 0 ? formatXAF(client.encoursCreditXAF) : '—', icon: CreditCard, color: client.encoursCreditXAF > 0 ? '#dc2626' : '#6b7280' },
            { label: 'Fiabilité', value: <ScoreFiabilite score={client.scoreFiabilite} />, icon: TrendingUp, color: scoreColor },
          ].map(({ label, value, color }) => (
            <div key={label} className="text-center">
              <p className="text-xs text-gray-400 mb-1">{label}</p>
              <div className="text-sm font-bold flex items-center justify-center" style={{ color }}>
                {typeof value === 'string' || typeof value === 'number' ? value : value}
              </div>
            </div>
          ))}
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
                  { label: 'Statut', value: <StatusBadge status={client.statut} /> },
                  { label: 'Téléphone', value: client.telephone || '—' },
                  { label: 'Email', value: client.email || '—' },
                  { label: 'Adresse', value: client.adresse as string || '—' },
                  { label: 'Score fiabilité', value: <ScoreFiabilite score={client.scoreFiabilite} /> },
                ].map(({ label, value }) => (
                  <div key={label} className="flex flex-col gap-0.5">
                    <span className="text-xs text-gray-400 uppercase font-semibold">{label}</span>
                    <span className="text-sm text-[#212121]">{value}</span>
                  </div>
                ))}
              </div>
            )}

            {activeTab === 'Commandes' && (
              orders.length > 0 ? (
                <div className="divide-y divide-gray-50">
                  {orders.map((o) => (
                    <div key={o.ref} className="flex items-center justify-between py-3">
                      <div>
                        <span className="font-mono text-xs text-gray-400">{o.ref}</span>
                        <div className="flex items-center gap-2 mt-0.5">
                          <StatusBadge status={o.statut} />
                          <span className="text-xs text-gray-400">{formatDate(o.date)}</span>
                        </div>
                      </div>
                      <span className="font-semibold text-sm">{formatXAF(o.montant)}</span>
                    </div>
                  ))}
                </div>
              ) : <EmptyTabState icon={<TrendingUp className="h-6 w-6" />} label="Aucune commande" />
            )}

            {activeTab === 'Crédits' && (
              credits.length > 0 ? (
                <div className="divide-y divide-gray-50">
                  {credits.map((c) => (
                    <div key={c.ref} className="flex items-center justify-between py-3">
                      <div>
                        <span className="font-mono text-xs text-gray-400">{c.ref}</span>
                        <div className="flex items-center gap-2 mt-0.5">
                          <StatusBadge status={c.statut} />
                          <span className="text-xs text-gray-400">Échéance : {formatDate(c.echeance)}</span>
                        </div>
                      </div>
                      <span className="font-semibold text-sm text-[#dc2626]">{formatXAF(c.montant)}</span>
                    </div>
                  ))}
                </div>
              ) : <EmptyTabState icon={<CreditCard className="h-6 w-6" />} label="Aucun crédit en cours" />
            )}

            {activeTab === 'Factures' && (
              factures.length > 0 ? (
                <div className="divide-y divide-gray-50">
                  {factures.map((f) => (
                    <div key={f.ref} className="flex items-center justify-between py-3">
                      <div>
                        <span className="font-mono text-xs text-gray-400">{f.ref}</span>
                        <div className="flex items-center gap-2 mt-0.5">
                          <StatusBadge status={f.statut} />
                          <span className="text-xs text-gray-400">{formatDate(f.date)}</span>
                        </div>
                      </div>
                      <span className="font-semibold text-sm">{formatXAF(f.montant)}</span>
                    </div>
                  ))}
                </div>
              ) : <EmptyTabState icon={<FileText className="h-6 w-6" />} label="Aucune facture" />
            )}

            {activeTab === 'Historique' && (
              historique.length > 0 ? (
                <div className="space-y-3">
                  {historique.map((h, i) => (
                    <div key={i} className="flex items-start gap-3">
                      <div className="flex flex-col items-center">
                        <div className="w-2 h-2 rounded-full bg-[#C62828] mt-1" />
                        {i < historique.length - 1 && <div className="w-px flex-1 bg-gray-200 mt-1" style={{ minHeight: 20 }} />}
                      </div>
                      <div className="pb-2">
                        <p className="text-sm text-[#212121]">{h.action}</p>
                        <p className="text-xs text-gray-400 mt-0.5">{h.user} · {formatDate(h.date)}</p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : <EmptyTabState icon={<Clock className="h-6 w-6" />} label="Aucun historique" />
            )}
          </motion.div>
        </AnimatePresence>
      </div>
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
