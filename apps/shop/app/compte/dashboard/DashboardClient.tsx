'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ShoppingBag, FileText, Receipt, User,
  Package, Clock, CheckCircle2, XCircle, AlertTriangle,
  LogOut, ChevronRight, RefreshCw, Loader2, Phone,
} from 'lucide-react'
import { useCartStore } from '@/lib/cart'
import type { CommandeShop, DevisWeb, Facture, Client } from './page'

// ── Types ──────────────────────────────────────────────────────────────────────

type Tab = 'commandes' | 'devis' | 'factures' | 'profil'

// ── Helpers ────────────────────────────────────────────────────────────────────

function fmt(n: number) {
  return new Intl.NumberFormat('fr-CM', { style: 'currency', currency: 'XAF', maximumFractionDigits: 0 }).format(n)
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' })
}

// ── Badges statut ──────────────────────────────────────────────────────────────

const STATUT_COMMANDE: Record<string, { label: string; cls: string }> = {
  recue:      { label: 'Reçue',      cls: 'bg-gray-100 text-gray-700' },
  confirmee:  { label: 'Confirmée',  cls: 'bg-blue-50 text-blue-700' },
  en_cours:   { label: 'En cours',   cls: 'bg-amber-50 text-amber-700' },
  expediee:   { label: 'Expédiée',   cls: 'bg-purple-50 text-purple-700' },
  livree:     { label: 'Livrée',     cls: 'bg-green-50 text-green-700' },
  annulee:    { label: 'Annulée',    cls: 'bg-red-50 text-red-600' },
}

const STATUT_PAIEMENT: Record<string, { label: string; icon: React.ReactNode }> = {
  en_attente: { label: 'En attente', icon: <Clock size={11} className="text-amber-500" /> },
  paye:       { label: 'Payé',       icon: <CheckCircle2 size={11} className="text-green-500" /> },
  echec:      { label: 'Échoué',     icon: <XCircle size={11} className="text-red-500" /> },
  livraison:  { label: 'À la livraison', icon: <Package size={11} className="text-blue-500" /> },
}

const STATUT_DEVIS: Record<string, { label: string; cls: string }> = {
  nouvelle:  { label: 'Nouvelle',   cls: 'bg-blue-50 text-blue-700' },
  en_cours:  { label: 'En cours',   cls: 'bg-amber-50 text-amber-700' },
  envoyee:   { label: 'Envoyée',    cls: 'bg-purple-50 text-purple-700' },
  acceptee:  { label: 'Acceptée',   cls: 'bg-green-50 text-green-700' },
  refusee:   { label: 'Refusée',    cls: 'bg-red-50 text-red-600' },
}

// ── Tab nav ────────────────────────────────────────────────────────────────────

const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: 'commandes', label: 'Commandes', icon: <ShoppingBag size={16} /> },
  { id: 'devis',     label: 'Devis',     icon: <FileText size={16} /> },
  { id: 'factures',  label: 'Factures',  icon: <Receipt size={16} /> },
  { id: 'profil',    label: 'Profil',    icon: <User size={16} /> },
]

// ── Sous-composants ────────────────────────────────────────────────────────────

function EmptyState({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="flex flex-col items-center gap-3 py-16 text-center text-forge-steel">
      <div className="opacity-30">{icon}</div>
      <p className="text-sm">{text}</p>
    </div>
  )
}

function CommandeCard({ commande }: { commande: CommandeShop }) {
  const [open, setOpen] = useState(false)
  const { addItem }     = useCartStore()

  const statutCmd = STATUT_COMMANDE[commande.statut_commande] ?? { label: commande.statut_commande, cls: 'bg-gray-100 text-gray-700' }
  const statutPay = STATUT_PAIEMENT[commande.statut_paiement] ?? { label: commande.statut_paiement, icon: null }

  const handleRecommander = () => {
    commande.lignes.forEach((ligne) => {
      if (!ligne.product_id) return
      void addItem(
        {
          id:    ligne.product_id,
          ref:   '',
          nom:   ligne.designation,
          prix:  ligne.prix_unitaire,
          image: null,
        },
        ligne.quantite
      )
    })
  }

  return (
    <div className="rounded-2xl border border-gray-100 bg-white overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full px-4 py-3.5 text-left hover:bg-gray-50 transition flex items-center justify-between gap-4"
      >
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex-shrink-0 rounded-xl bg-gray-50 p-2">
            <ShoppingBag size={15} className="text-forge-steel" />
          </div>
          <div className="min-w-0">
            <p className="font-mono text-xs font-bold text-forge-steel">{commande.ref}</p>
            <p className="text-sm font-black text-forge-dark">{fmt(Number(commande.montant_ttc))}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${statutCmd.cls}`}>
            {statutCmd.label}
          </span>
          <ChevronRight
            size={14}
            className={`text-gray-400 transition-transform ${open ? 'rotate-90' : ''}`}
          />
        </div>
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="border-t border-gray-100 px-4 py-3 space-y-3">
              {/* Statut paiement */}
              <div className="flex items-center gap-1.5 text-xs">
                {statutPay.icon}
                <span className="text-forge-steel">Paiement :</span>
                <span className="font-semibold text-forge-dark">{statutPay.label}</span>
              </div>

              {/* Date */}
              <p className="text-[11px] text-gray-400">{fmtDate(commande.created_at)}</p>

              {/* Lignes */}
              <div className="space-y-1">
                {commande.lignes.map((l, i) => (
                  <div key={i} className="flex justify-between text-xs text-forge-dark">
                    <span className="flex-1 truncate">{l.designation}</span>
                    <span className="ml-4 flex-shrink-0 font-semibold">{l.quantite} × {fmt(l.prix_unitaire)}</span>
                  </div>
                ))}
              </div>

              {/* Actions */}
              <div className="flex gap-2 pt-1">
                <Link
                  href={`/suivi/${commande.ref}`}
                  className="flex-1 rounded-lg border border-gray-200 py-2 text-center text-xs font-semibold text-forge-steel hover:border-forge-red hover:text-forge-red transition"
                >
                  Suivre
                </Link>
                {commande.lignes.some(l => l.product_id) && (
                  <button
                    onClick={handleRecommander}
                    className="flex-1 flex items-center justify-center gap-1.5 rounded-lg bg-forge-red py-2 text-xs font-bold text-white hover:bg-red-700 transition"
                  >
                    <RefreshCw size={11} /> Recommander
                  </button>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function DevisCard({ devis }: { devis: DevisWeb }) {
  const statut = STATUT_DEVIS[devis.statut] ?? { label: devis.statut, cls: 'bg-gray-100 text-gray-700' }

  return (
    <div className="rounded-2xl border border-gray-100 bg-white px-4 py-3.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] text-gray-400">{fmtDate(devis.created_at)}</p>
          <p className="mt-0.5 text-sm text-forge-dark line-clamp-2">{devis.description}</p>
        </div>
        <span className={`flex-shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${statut.cls}`}>
          {statut.label}
        </span>
      </div>
    </div>
  )
}

function FactureCard({ facture }: { facture: Facture }) {
  const paid = facture.statut === 'payee' || facture.statut === 'paye'

  return (
    <div className="rounded-2xl border border-gray-100 bg-white px-4 py-3.5 flex items-center gap-4">
      <div className="flex-shrink-0 rounded-xl bg-gray-50 p-2">
        <Receipt size={15} className={paid ? 'text-green-500' : 'text-amber-500'} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="font-mono text-xs font-bold text-forge-steel">{facture.numero}</p>
        <p className="text-sm font-black text-forge-dark">{fmt(Number(facture.montant_ttc_xaf))}</p>
        <p className="text-[11px] text-gray-400">{fmtDate(facture.date_emission)}</p>
      </div>
      <div className="flex-shrink-0 text-right">
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${paid ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700'}`}>
          {paid ? 'Payée' : 'En attente'}
        </span>
        {facture.pdf_url && (
          <a
            href={facture.pdf_url}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-1 block text-[11px] text-forge-red font-semibold hover:underline"
          >
            Télécharger PDF
          </a>
        )}
      </div>
    </div>
  )
}

// ── Composant principal ────────────────────────────────────────────────────────

export function DashboardClient({
  client, commandes, devis, factures,
}: {
  client:    Client
  commandes: CommandeShop[]
  devis:     DevisWeb[]
  factures:  Facture[]
}) {
  const router             = useRouter()
  const [tab, setTab]      = useState<Tab>('commandes')
  const [isPending, start] = useTransition()
  const [nom, setNom]      = useState(client.nom)
  const [saving, setSaving] = useState(false)

  const handleLogout = async () => {
    await fetch('/api/auth/shop/logout', { method: 'POST' })
    router.replace('/compte/login')
  }

  const handleSaveNom = async () => {
    setSaving(true)
    try {
      await fetch('/api/auth/shop/profil', {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ nom }),
      })
      start(() => router.refresh())
    } finally {
      setSaving(false)
    }
  }

  const tabs_count: Record<Tab, number | null> = {
    commandes: commandes.length,
    devis:     devis.length,
    factures:  factures.length,
    profil:    null,
  }

  return (
    <div className="space-y-6">
      {/* En-tête */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-forge-steel">Espace client</p>
          <h1 className="mt-0.5 text-xl font-black text-forge-dark">
            {client.nom ? `Bonjour, ${client.nom.split(' ')[0]} !` : 'Mon espace'}
          </h1>
          <p className="text-xs text-gray-400">{client.telephone}</p>
        </div>
        <button
          onClick={handleLogout}
          className="flex items-center gap-1.5 rounded-xl border border-gray-200 px-3 py-2 text-xs font-semibold text-forge-steel hover:border-forge-red hover:text-forge-red transition"
        >
          <LogOut size={13} /> Déconnexion
        </button>
      </div>

      {/* Onglets */}
      <div className="flex gap-1 rounded-2xl border border-gray-100 bg-gray-50 p-1">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`
              relative flex flex-1 items-center justify-center gap-1.5 rounded-xl py-2.5 text-[11px] font-bold transition
              ${tab === t.id ? 'bg-white text-forge-red shadow-sm' : 'text-forge-steel hover:text-forge-dark'}
            `}
          >
            {t.icon}
            <span className="hidden sm:inline">{t.label}</span>
            {tabs_count[t.id] !== null && tabs_count[t.id]! > 0 && (
              <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-black leading-none ${tab === t.id ? 'bg-red-100 text-forge-red' : 'bg-gray-200 text-gray-600'}`}>
                {tabs_count[t.id]}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Contenu */}
      <AnimatePresence mode="wait">
        <motion.div
          key={tab}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.18 }}
        >
          {/* ── Commandes ── */}
          {tab === 'commandes' && (
            <div className="space-y-3">
              {commandes.length === 0
                ? <EmptyState icon={<ShoppingBag size={48} />} text="Aucune commande pour l'instant." />
                : commandes.map((c) => <CommandeCard key={c.ref} commande={c} />)
              }
            </div>
          )}

          {/* ── Devis ── */}
          {tab === 'devis' && (
            <div className="space-y-3">
              {devis.length === 0
                ? (
                  <div className="space-y-4">
                    <EmptyState icon={<FileText size={48} />} text="Aucune demande de devis." />
                    <Link
                      href="/devis"
                      className="flex w-full items-center justify-center gap-2 rounded-xl border-2 border-forge-red py-3 text-sm font-bold text-forge-red hover:bg-forge-red hover:text-white transition"
                    >
                      Demander un devis →
                    </Link>
                  </div>
                )
                : (
                  <>
                    <div className="space-y-3">
                      {devis.map((d) => <DevisCard key={d.id} devis={d} />)}
                    </div>
                    <Link
                      href="/devis"
                      className="flex w-full items-center justify-center gap-2 rounded-xl border-2 border-forge-red py-3 text-sm font-bold text-forge-red hover:bg-forge-red hover:text-white transition"
                    >
                      Nouvelle demande →
                    </Link>
                  </>
                )
              }
            </div>
          )}

          {/* ── Factures ── */}
          {tab === 'factures' && (
            <div className="space-y-3">
              {factures.length === 0
                ? <EmptyState icon={<Receipt size={48} />} text="Aucune facture disponible." />
                : factures.map((f) => <FactureCard key={f.id} facture={f} />)
              }
            </div>
          )}

          {/* ── Profil ── */}
          {tab === 'profil' && (
            <div className="space-y-4">
              <div className="rounded-2xl border border-gray-100 bg-white p-4 space-y-4">
                <p className="text-[10px] font-black uppercase tracking-widest text-forge-steel">Mes informations</p>

                <div>
                  <label className="mb-1 block text-xs font-semibold text-forge-steel">Nom complet</label>
                  <input
                    type="text"
                    value={nom}
                    onChange={(e) => setNom(e.target.value)}
                    placeholder="Votre nom"
                    className="w-full rounded-xl border-2 border-gray-200 px-3 py-2.5 text-sm font-semibold outline-none transition focus:border-forge-red focus:ring-2 focus:ring-forge-red/20"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-xs font-semibold text-forge-steel">Téléphone</label>
                  <div className="flex items-center gap-2 rounded-xl border-2 border-gray-100 bg-gray-50 px-3 py-2.5">
                    <Phone size={14} className="text-gray-400" />
                    <span className="text-sm font-semibold text-forge-dark">{client.telephone}</span>
                    <span className="ml-auto text-[10px] text-gray-400">Non modifiable</span>
                  </div>
                </div>

                <button
                  onClick={handleSaveNom}
                  disabled={saving || isPending}
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-forge-red py-3 text-sm font-bold text-white transition disabled:opacity-60 hover:bg-red-700"
                >
                  {saving || isPending
                    ? <Loader2 size={15} className="animate-spin" />
                    : 'Enregistrer'
                  }
                </button>
              </div>

              <button
                onClick={handleLogout}
                className="flex w-full items-center justify-center gap-2 rounded-xl border-2 border-red-100 py-3 text-sm font-bold text-red-500 hover:bg-red-50 transition"
              >
                <LogOut size={15} /> Se déconnecter
              </button>
            </div>
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  )
}
