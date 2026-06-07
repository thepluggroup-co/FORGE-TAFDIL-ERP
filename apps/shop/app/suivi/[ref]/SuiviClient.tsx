'use client'

import { useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import { motion, AnimatePresence } from 'framer-motion'
import {
  CheckCircle2, Circle, Clock, Package, Truck, Star,
  MessageCircle, ChevronLeft, Share2, Copy, Check,
} from 'lucide-react'
import { createClient } from '@/lib/supabase'

// ── Types ──────────────────────────────────────────────────────────────────────

export interface CommandeSuivi {
  ref:              string
  statut_commande:  string
  statut_paiement:  string
  mode_paiement:    string | null
  payment_reference: string | null
  lignes:           Array<{ designation: string; quantite: number; prix_unitaire: number; total_ht?: number }>
  montant_ht?:      number | null
  tva?:             number | null
  montant_ttc:      number
  frais_livraison:  number
  client_ville:     string | null
  created_at:       string
  updated_at:       string
  photos_livraison: string[] | null
}

// ── Constantes ─────────────────────────────────────────────────────────────────

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://shop.tafdil.cm'
const WA_TEL   = (process.env.NEXT_PUBLIC_WHATSAPP_NUMBER ?? '+237 95 88 45 28').replace(/\D/g, '')

// ── Helpers ────────────────────────────────────────────────────────────────────

function fmt(n: number) {
  return new Intl.NumberFormat('fr-CM', { style: 'currency', currency: 'XAF', maximumFractionDigits: 0 }).format(n)
}
function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' })
}
function fmtDateHeure(iso: string) {
  return new Date(iso).toLocaleString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

const MODE_LABEL: Record<string, string> = {
  mtn_momo:    'MTN Mobile Money',
  orange_money: 'Orange Money',
  livraison:   'Paiement à la livraison',
}

// ── Logique timeline ───────────────────────────────────────────────────────────

type StepId = 'recue' | 'paiement' | 'production' | 'prete' | 'livree'
type StepStatus = 'done' | 'active' | 'pending'

interface TimelineStep {
  id:      StepId
  label:   string
  icon:    React.ReactNode
}

const STEPS: TimelineStep[] = [
  { id: 'recue',      label: 'Commande reçue',      icon: <Package size={16} /> },
  { id: 'paiement',   label: 'Paiement confirmé',    icon: <CheckCircle2 size={16} /> },
  { id: 'production', label: 'En production',        icon: <Clock size={16} /> },
  { id: 'prete',      label: 'Prête à livrer',       icon: <Truck size={16} /> },
  { id: 'livree',     label: 'Livrée',               icon: <Star size={16} /> },
]

function getStepStatus(id: StepId, c: CommandeSuivi): StepStatus {
  const sc = c.statut_commande
  const sp = c.statut_paiement
  const doneStatuts = (ids: string[]) => ids.includes(sc)

  switch (id) {
    case 'recue':
      return 'done'
    case 'paiement':
      if (sp === 'paye' || doneStatuts(['en_preparation', 'expediee', 'livree'])) return 'done'
      if (doneStatuts(['confirmee'])) return 'active'
      return 'active' // toujours active si pas encore payé (invite à payer)
    case 'production':
      if (doneStatuts(['en_preparation', 'expediee', 'livree'])) return 'done'
      if (sp === 'paye' || doneStatuts(['confirmee'])) return 'active'
      return 'pending'
    case 'prete':
      if (doneStatuts(['expediee', 'livree'])) return 'done'
      if (doneStatuts(['en_preparation'])) return 'active'
      return 'pending'
    case 'livree':
      if (doneStatuts(['livree'])) return 'done'
      if (doneStatuts(['expediee'])) return 'active'
      return 'pending'
  }
}

// ── Sous-composants ────────────────────────────────────────────────────────────

function StepCircle({ status }: { status: StepStatus }) {
  if (status === 'done') {
    return (
      <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-green-500 shadow-sm">
        <Check size={16} className="text-white" />
      </div>
    )
  }
  if (status === 'active') {
    return (
      <div className="relative flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-forge-red shadow-sm">
        <motion.div
          animate={{ scale: [1, 1.4, 1], opacity: [0.6, 0, 0.6] }}
          transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
          className="absolute inset-0 rounded-full bg-forge-red"
        />
        <Circle size={12} className="relative text-white" fill="white" />
      </div>
    )
  }
  return (
    <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full border-2 border-gray-200 bg-white">
      <Circle size={12} className="text-gray-300" />
    </div>
  )
}

function ConnectorLine({ done }: { done: boolean }) {
  return (
    <div className="ml-4 h-8 w-px flex-shrink-0">
      <motion.div
        className="h-full w-px"
        style={{ background: done ? '#22c55e' : '#e5e7eb' }}
        initial={false}
        animate={{ background: done ? '#22c55e' : '#e5e7eb' }}
        transition={{ duration: 0.6 }}
      />
    </div>
  )
}

function FakeProgressBar({ active }: { active: boolean }) {
  return (
    <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
      <motion.div
        className="h-full rounded-full bg-forge-red"
        initial={{ width: '0%' }}
        animate={{ width: active ? '75%' : '0%' }}
        transition={{ duration: 3, ease: 'easeOut' }}
      />
    </div>
  )
}

function ShareButton({ commandeRef }: { commandeRef: string }) {
  const [copied, setCopied] = useState(false)
  const url = `${SITE_URL}/suivi/${commandeRef}`

  const handleCopy = async () => {
    await navigator.clipboard.writeText(url).catch(() => {})
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleShare = () => {
    if (navigator.share) {
      void navigator.share({ title: `Commande ${commandeRef}`, url })
    } else {
      handleCopy()
    }
  }

  return (
    <button
      onClick={handleShare}
      className="flex items-center gap-1.5 rounded-xl border border-gray-200 px-3 py-2 text-xs font-semibold text-forge-steel transition hover:border-forge-red hover:text-forge-red"
    >
      {copied ? <Check size={13} className="text-green-500" /> : <Share2 size={13} />}
      {copied ? 'Copié !' : 'Partager'}
    </button>
  )
}

// ── Composant principal ────────────────────────────────────────────────────────

export function SuiviClient({ commandeRef, initialCommande }: {
  commandeRef:      string
  initialCommande:  CommandeSuivi
}) {
  const [commande, setCommande] = useState<CommandeSuivi>(initialCommande)
  const [flash,    setFlash]    = useState(false)
  const prevStatut = useRef(initialCommande.statut_commande)

  // ── Realtime subscription ──────────────────────────────────────────────────
  useEffect(() => {
    const sb = createClient()

    const channel = sb
      .channel(`suivi-${commandeRef}`)
      .on(
        'postgres_changes',
        {
          event:  'UPDATE',
          schema: 'public',
          table:  'commandes_shop',
          filter: `ref=eq.${commandeRef}`,
        },
        (payload) => {
          const updated = payload.new as CommandeSuivi
          if (updated.statut_commande !== prevStatut.current) {
            prevStatut.current = updated.statut_commande
            setFlash(true)
            setTimeout(() => setFlash(false), 1800)
          }
          setCommande((prev) => ({ ...prev, ...updated }))
        }
      )
      .subscribe()

    return () => { void sb.removeChannel(channel) }
  }, [commandeRef])

  const lignesHt = commande.lignes.reduce((s, l) => s + (l.total_ht ?? l.quantite * l.prix_unitaire), 0)
  const montant_ht = Math.round(Number(commande.montant_ht ?? lignesHt))
  const tva        = Math.round(Number(commande.tva ?? montant_ht * 0.1925))
  const waUrl      = `https://wa.me/${WA_TEL}?text=${encodeURIComponent(`Bonjour TAFDIL, je souhaite des informations sur ma commande *${commandeRef}*.`)}`

  return (
    <div className="space-y-6">
      {/* ── En-tête ── */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <Link
            href="/suivi"
            className="mb-2 flex items-center gap-1 text-xs text-forge-steel hover:text-forge-red transition"
          >
            <ChevronLeft size={14} /> Autre commande
          </Link>
          <p className="font-mono text-xs font-bold uppercase tracking-[.15em] text-forge-steel">
            Commande
          </p>
          <h1 className="mt-0.5 font-mono text-2xl font-black text-forge-dark">{commandeRef}</h1>
          <p className="mt-1 text-xs text-gray-400">{fmtDateHeure(commande.created_at)}</p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <ShareButton commandeRef={commandeRef} />
          <p className="text-right text-xl font-black text-forge-red">{fmt(commande.montant_ttc)}</p>
        </div>
      </div>

      {/* ── Flash notification changement statut ── */}
      <AnimatePresence>
        {flash && (
          <motion.div
            initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            className="rounded-xl border border-green-200 bg-green-50 px-4 py-2.5 text-sm font-semibold text-green-700"
          >
            ✅ Statut de votre commande mis à jour !
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Timeline ── */}
      <div className="rounded-2xl border border-gray-100 bg-white p-5">
        <p className="mb-4 text-[10px] font-black uppercase tracking-widest text-forge-steel">
          Avancement
        </p>

        {STEPS.map((step, i) => {
          const status  = getStepStatus(step.id, commande)
          const isLast  = i === STEPS.length - 1
          const prevDone = i > 0 ? getStepStatus(STEPS[i - 1].id, commande) === 'done' : true

          return (
            <div key={step.id}>
              <div className="flex items-start gap-3">
                <StepCircle status={status} />
                <div className="flex-1 pb-1 pt-1.5">
                  <p className={`text-sm font-bold leading-tight ${
                    status === 'done'   ? 'text-green-700' :
                    status === 'active' ? 'text-forge-red' :
                    'text-gray-400'
                  }`}>
                    {step.label}
                  </p>

                  {/* Contenu par étape */}
                  <AnimatePresence initial={false}>
                    {status !== 'pending' && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        transition={{ duration: 0.25 }}
                        className="overflow-hidden"
                      >
                        {step.id === 'recue' && (
                          <p className="mt-1 text-xs text-gray-500">
                            {fmtDateHeure(commande.created_at)} — Votre commande a été enregistrée et sera prise en charge rapidement.
                          </p>
                        )}

                        {step.id === 'paiement' && status === 'done' && (
                          <div className="mt-1 space-y-0.5 text-xs text-gray-500">
                            {commande.mode_paiement && (
                              <p>Mode : <span className="font-semibold text-forge-dark">{MODE_LABEL[commande.mode_paiement] ?? commande.mode_paiement}</span></p>
                            )}
                            {commande.payment_reference && (
                              <p className="font-mono text-[10px] text-gray-400">Réf. Notchpay : {commande.payment_reference}</p>
                            )}
                          </div>
                        )}
                        {step.id === 'paiement' && status === 'active' && (
                          <p className="mt-1 text-xs text-forge-red">En attente de confirmation du paiement…</p>
                        )}

                        {step.id === 'production' && status === 'active' && (
                          <div className="mt-1">
                            <p className="text-xs text-gray-500">Délai estimé : <span className="font-semibold text-forge-dark">2–5 jours ouvrables</span></p>
                            <FakeProgressBar active />
                          </div>
                        )}
                        {step.id === 'production' && status === 'done' && (
                          <p className="mt-1 text-xs text-gray-500">Fabrication terminée.</p>
                        )}

                        {step.id === 'prete' && status === 'active' && (
                          <p className="mt-1 text-xs text-gray-500">Votre commande est prête ! La livraison est en cours de planification.</p>
                        )}
                        {step.id === 'prete' && status === 'done' && (
                          <p className="mt-1 text-xs text-gray-500">Commande expédiée.</p>
                        )}

                        {step.id === 'livree' && status === 'done' && (
                          <div className="mt-1 space-y-2">
                            <p className="text-xs text-gray-500">
                              Livrée le <span className="font-semibold text-forge-dark">{fmtDate(commande.updated_at)}</span> — Merci pour votre confiance !
                            </p>
                            {commande.photos_livraison && commande.photos_livraison.length > 0 && (
                              <div className="flex gap-2 overflow-x-auto pb-1">
                                {commande.photos_livraison.map((url, j) => (
                                  <img
                                    key={j}
                                    src={url}
                                    alt={`Photo livraison ${j + 1}`}
                                    className="h-24 w-24 flex-shrink-0 rounded-xl object-cover"
                                  />
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </div>

              {!isLast && <ConnectorLine done={status === 'done' && prevDone} />}
            </div>
          )
        })}
      </div>

      {/* ── Détail commande ── */}
      <div className="rounded-2xl border border-gray-100 bg-white p-5">
        <p className="mb-3 text-[10px] font-black uppercase tracking-widest text-forge-steel">
          Produits commandés
        </p>
        <div className="space-y-2">
          {commande.lignes.map((l, i) => (
            <div key={i} className="flex items-center justify-between gap-3 text-sm">
              <div className="min-w-0">
                <p className="truncate font-semibold text-forge-dark">{l.designation}</p>
                <p className="text-[11px] text-gray-400">{l.quantite} × {fmt(l.prix_unitaire)}</p>
              </div>
              <p className="flex-shrink-0 font-bold text-forge-dark">
                {fmt(l.quantite * l.prix_unitaire)}
              </p>
            </div>
          ))}
        </div>

        <div className="mt-4 space-y-1.5 border-t border-gray-100 pt-4">
          <div className="flex justify-between text-xs text-gray-500">
            <span>Sous-total HT</span>
            <span>{fmt(montant_ht)}</span>
          </div>
          <div className="flex justify-between text-xs text-gray-500">
            <span>TVA 19,25 %</span>
            <span>{fmt(tva)}</span>
          </div>
          {commande.frais_livraison > 0 && (
            <div className="flex justify-between text-xs text-gray-500">
              <span>Livraison {commande.client_ville ? `(${commande.client_ville})` : ''}</span>
              <span>{fmt(commande.frais_livraison)}</span>
            </div>
          )}
          <div className="flex justify-between pt-1 text-sm font-black text-forge-dark">
            <span>Total TTC</span>
            <span className="text-forge-red">{fmt(commande.montant_ttc)}</span>
          </div>
        </div>
      </div>

      {/* ── Indicateur temps réel ── */}
      <div className="flex items-center justify-center gap-2 text-[11px] text-gray-400">
        <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-green-400" />
        Mise à jour en temps réel
      </div>

      {/* ── Contact ── */}
      <div className="space-y-3">
        <a
          href={waUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex w-full items-center justify-center gap-2 rounded-2xl border border-green-200 bg-green-50 py-3.5 text-sm font-bold text-green-700 transition hover:bg-green-100"
        >
          <MessageCircle size={16} /> Questions sur ma commande — WhatsApp
        </a>
        <Link
          href="/catalogue"
          className="block text-center text-sm text-forge-steel transition hover:text-forge-red"
        >
          ← Retourner au catalogue
        </Link>
      </div>
    </div>
  )
}
