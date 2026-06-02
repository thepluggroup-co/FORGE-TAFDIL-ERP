'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import { Check, X, RefreshCw, MessageCircle, Clock, AlertTriangle } from 'lucide-react'
import { useCartStore } from '@/lib/cart'

// ── Types ──────────────────────────────────────────────────────────────────────

type State = 'waiting' | 'complete' | 'failed' | 'timeout'
type Canal = 'mtn' | 'orange'

interface PaymentSession {
  commande_ref:        string
  payment_reference:   string
  canal:               Canal
  client_nom:          string
  montant_total:       number
  adresse:             string
  mode_paiement_label: string
}

// ── Constantes ─────────────────────────────────────────────────────────────────

const POLL_MS    = 3_000
const TIMEOUT_MS = 10 * 60 * 1_000 // 10 minutes

const INSTRUCTIONS: Record<Canal, string[]> = {
  mtn: [
    'Vous allez recevoir un prompt de paiement sur votre téléphone',
    'Sans prompt : composez *126# → Payer une facture → Valider',
    'Entrez votre code PIN MTN MoMo pour confirmer',
  ],
  orange: [
    'Vous allez recevoir un prompt de paiement sur votre téléphone',
    'Sans prompt : composez #150*50# puis validez',
    'Entrez votre code PIN Orange Money pour confirmer',
  ],
}

const COMPLETE_STATUSES = new Set(['complete', 'completed', 'success', 'successful'])
const FAILED_STATUSES   = new Set(['failed', 'cancelled', 'canceled', 'expired', 'error'])

// ── Helpers ────────────────────────────────────────────────────────────────────

function fmt(n: number) {
  return new Intl.NumberFormat('fr-CM', { style: 'currency', currency: 'XAF', maximumFractionDigits: 0 }).format(n)
}

function formatCountdown(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

// ── Composant ──────────────────────────────────────────────────────────────────

export function PaymentWaitClient() {
  const params     = useSearchParams()
  const paymentRef = params.get('payment_ref') ?? ''
  const canal      = (params.get('canal') ?? 'mtn') as Canal

  const { clearCart } = useCartStore()

  const [state,     setState]     = useState<State>('waiting')
  const [session,   setSession]   = useState<PaymentSession | null>(null)
  const [timeLeft,  setTimeLeft]  = useState(TIMEOUT_MS)
  const [pollCount, setPollCount] = useState(0)

  const stateRef = useRef(state)
  stateRef.current = state

  // Charger session depuis sessionStorage
  useEffect(() => {
    const raw = sessionStorage.getItem('forge-paiement')
    if (raw) {
      try { setSession(JSON.parse(raw) as PaymentSession) } catch {}
    }
  }, [])

  // Countdown (1s)
  useEffect(() => {
    if (state !== 'waiting') return
    const id = setInterval(() => {
      setTimeLeft(t => {
        if (t <= 1_000) { setState('timeout'); return 0 }
        return t - 1_000
      })
    }, 1_000)
    return () => clearInterval(id)
  }, [state])

  // Polling statut Notchpay (toutes les 3s)
  const poll = useCallback(async () => {
    if (!paymentRef || stateRef.current !== 'waiting') return
    try {
      const res  = await fetch(
        `/api/paiements/${paymentRef}/statut`,
        { cache: 'no-store' }
      )
      if (!res.ok) return
      const json = await res.json() as { statut: string }

      if (COMPLETE_STATUSES.has(json.statut)) {
        clearCart()
        sessionStorage.removeItem('forge-paiement')
        setState('complete')
      } else if (FAILED_STATUSES.has(json.statut)) {
        setState('failed')
      }
    } catch {}
    setPollCount(n => n + 1)
  }, [paymentRef, clearCart])

  useEffect(() => {
    if (state !== 'waiting' || !paymentRef) return
    poll() // poll immédiat au montage
    const id = setInterval(poll, POLL_MS)
    return () => clearInterval(id)
  }, [poll, state, paymentRef])

  const whatsappBase = `https://wa.me/${(process.env.NEXT_PUBLIC_WHATSAPP_NUMBER ?? '').replace(/\D/g, '')}`

  // ── État : SUCCÈS ───────────────────────────────────────────────────────────

  if (state === 'complete') {
    const ref = session?.commande_ref ?? params.get('commande_ref') ?? '—'
    const whatsappUrl = `${whatsappBase}?text=${encodeURIComponent(
      `Bonjour TAFDIL, je viens de payer la commande *${ref}*. Pouvez-vous confirmer ?`
    )}`
    return (
      <div className="space-y-6 text-center">
        <motion.div
          initial={{ scale: 0 }} animate={{ scale: 1 }}
          transition={{ type: 'spring', stiffness: 220, damping: 14 }}
          className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-green-100"
        >
          <Check size={36} className="text-green-600" />
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 }}>
          <p className="font-mono text-xs font-bold uppercase tracking-[.15em] text-forge-steel">{ref}</p>
          <h1 className="mt-1.5 text-2xl font-black text-forge-dark">Paiement confirmé !</h1>
          <p className="mt-2 text-sm text-forge-steel">
            {session ? `Merci ${session.client_nom.split(' ')[0]} !` : 'Merci !'}{' '}
            Notre équipe vous contactera sous 24h.
          </p>
        </motion.div>

        {session && (
          <motion.div
            initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.45 }}
            className="rounded-2xl border border-gray-100 bg-gray-50 p-4 text-left"
          >
            <p className="mb-3 text-[10px] font-black uppercase tracking-widest text-forge-steel">Détails</p>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <p className="text-[10px] font-semibold uppercase text-gray-400">Montant payé</p>
                <p className="font-black text-forge-red">{fmt(session.montant_total)}</p>
              </div>
              <div>
                <p className="text-[10px] font-semibold uppercase text-gray-400">Mode</p>
                <p className="font-semibold text-forge-dark">{session.mode_paiement_label}</p>
              </div>
              <div className="col-span-2">
                <p className="text-[10px] font-semibold uppercase text-gray-400">Livraison</p>
                <p className="text-forge-dark">{session.adresse}</p>
              </div>
            </div>
          </motion.div>
        )}

        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.65 }} className="space-y-3">
          <Link
            href={`/suivi/${ref}`}
            className="flex w-full items-center justify-center gap-2 rounded-xl border-2 border-forge-red px-5 py-3 text-sm font-bold text-forge-red transition hover:bg-forge-red hover:text-white"
          >
            Suivre ma commande →
          </Link>
          <a
            href={whatsappUrl} target="_blank" rel="noopener noreferrer"
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-green-200 bg-green-50 py-3 text-sm font-bold text-green-700 transition hover:bg-green-100"
          >
            <MessageCircle size={15} /> Questions ? WhatsApp
          </a>
          <Link href="/catalogue" className="block py-2 text-sm text-forge-steel transition hover:text-forge-red">
            ← Retourner au catalogue
          </Link>
        </motion.div>
      </div>
    )
  }

  // ── État : ÉCHEC ────────────────────────────────────────────────────────────

  if (state === 'failed') {
    const whatsappUrl = `${whatsappBase}?text=${encodeURIComponent(
      `Bonjour TAFDIL, mon paiement a échoué (réf: ${paymentRef}). Comment puis-je régler ?`
    )}`
    return (
      <div className="space-y-5 text-center">
        <motion.div
          initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 200 }}
          className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-red-100"
        >
          <X size={36} className="text-red-500" />
        </motion.div>
        <div>
          <h1 className="text-xl font-black text-forge-dark">Paiement échoué</h1>
          <p className="mt-2 text-sm text-forge-steel">
            Le paiement n'a pas abouti. Votre commande est conservée — vous pouvez réessayer.
          </p>
        </div>
        <div className="space-y-3">
          <button
            onClick={() => { setState('waiting'); setTimeLeft(TIMEOUT_MS) }}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-forge-red py-3 text-sm font-bold text-white transition hover:bg-forge-red-dark"
          >
            <RefreshCw size={15} /> Réessayer le paiement
          </button>
          <Link
            href="/commander"
            className="flex w-full items-center justify-center rounded-xl border border-gray-200 py-3 text-sm font-semibold text-forge-steel transition hover:border-forge-red hover:text-forge-red"
          >
            Changer de mode de paiement
          </Link>
          <a
            href={whatsappUrl} target="_blank" rel="noopener noreferrer"
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-green-200 bg-green-50 py-3 text-sm font-bold text-green-700 transition hover:bg-green-100"
          >
            <MessageCircle size={15} /> Nous contacter via WhatsApp
          </a>
        </div>
      </div>
    )
  }

  // ── État : TIMEOUT ──────────────────────────────────────────────────────────

  if (state === 'timeout') {
    return (
      <div className="space-y-5 text-center">
        <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-amber-100">
          <AlertTriangle size={36} className="text-amber-500" />
        </div>
        <div>
          <h1 className="text-xl font-black text-forge-dark">Session expirée</h1>
          <p className="mt-2 text-sm text-forge-steel">
            La session de paiement a expiré après 10 minutes. Votre commande est conservée.
          </p>
        </div>
        <div className="space-y-3">
          <button
            onClick={() => { setState('waiting'); setTimeLeft(TIMEOUT_MS) }}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-forge-red py-3 text-sm font-bold text-white transition hover:bg-forge-red-dark"
          >
            <RefreshCw size={15} /> Réessayer
          </button>
          <Link
            href="/commander"
            className="flex w-full items-center justify-center rounded-xl border border-gray-200 py-3 text-sm font-semibold text-forge-steel transition hover:border-forge-red hover:text-forge-red"
          >
            Retourner au tunnel de commande
          </Link>
        </div>
      </div>
    )
  }

  // ── État : EN ATTENTE ───────────────────────────────────────────────────────

  const instructions = INSTRUCTIONS[canal]
  const canalColor   = canal === 'mtn' ? 'bg-yellow-400' : 'bg-orange-500'

  return (
    <div className="space-y-6">
      {/* Spinner + label */}
      <div className="flex flex-col items-center gap-4">
        <div className="relative flex h-20 w-20 items-center justify-center">
          <motion.div
            animate={{ rotate: 360 }}
            transition={{ duration: 1.4, repeat: Infinity, ease: 'linear' }}
            className="absolute inset-0 rounded-full border-4 border-transparent border-t-forge-red"
          />
          <span className="text-2xl leading-none">
            {canal === 'mtn' ? '🟡' : '🟠'}
          </span>
        </div>
        <div className="text-center">
          <h1 className="text-xl font-black text-forge-dark">En attente de paiement</h1>
          <p className="mt-0.5 text-sm text-forge-steel">
            {canal === 'mtn' ? 'MTN Mobile Money' : 'Orange Money'}
          </p>
        </div>
      </div>

      {/* Instructions */}
      <div className="rounded-2xl border border-gray-100 bg-gray-50 p-4 space-y-3">
        <p className="text-[10px] font-black uppercase tracking-widest text-forge-steel">Instructions</p>
        <ol className="space-y-2.5">
          {instructions.map((step, i) => (
            <li key={i} className="flex items-start gap-3">
              <span className={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white ${canalColor}`}>
                {i + 1}
              </span>
              <span className="text-sm leading-snug text-forge-dark">{step}</span>
            </li>
          ))}
        </ol>
      </div>

      {/* Montant */}
      {session && (
        <div className="text-center">
          <p className="text-xs text-forge-steel">Montant à payer</p>
          <p className="text-3xl font-black text-forge-red">{fmt(session.montant_total)}</p>
        </div>
      )}

      {/* Compte à rebours */}
      <div className="flex items-center justify-center gap-2 rounded-xl border border-amber-100 bg-amber-50 px-4 py-3">
        <Clock size={14} className="text-amber-500" />
        <span className="text-sm text-amber-700">
          Session expire dans{' '}
          <span className="font-black tabular-nums">{formatCountdown(timeLeft)}</span>
        </span>
      </div>

      {/* Indicateur poll */}
      <p className="text-center text-[10px] text-gray-400">
        Vérification automatique toutes les 3 s
        {pollCount > 0 && ` · ${pollCount} vérification${pollCount > 1 ? 's' : ''}`}
      </p>
    </div>
  )
}
