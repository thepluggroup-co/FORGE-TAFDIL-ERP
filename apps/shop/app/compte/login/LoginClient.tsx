'use client'

import { useState, useRef, useEffect, useCallback, KeyboardEvent, ClipboardEvent } from 'react'
import { useRouter } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import { Phone, Mail, ArrowRight, Loader2, ChevronLeft, ShieldCheck } from 'lucide-react'
import { MetalForgeLogo } from '@/components/ui/BrandLogo'

// ── Types ──────────────────────────────────────────────────────────────────────

type Step = 'phone' | 'otp'
type Canal = 'telephone' | 'email'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// Messages des retours Google / Facebook (?erreur=… posé par la route de callback)
const ERREURS_OAUTH: Record<string, string> = {
  annule:         'Connexion annulée.',
  session:        'La connexion a expiré, réessayez.',
  compte:         'Impossible de créer votre compte pour le moment.',
  fournisseur:    'Le service de connexion a refusé la demande, réessayez.',
  'non-configure': 'Ce mode de connexion n\'est pas encore disponible.',
}

// ── Helpers ────────────────────────────────────────────────────────────────────

const PHONE_RE = /^(\+?237\s?)?6\d{8}$/
const DIGITS   = 6

function formatPhone(raw: string): string {
  const digits = raw.replace(/\D/g, '')
  if (digits.length <= 9) return digits
  return digits.replace(/(\d{3})(\d{2})(\d{2})(\d{2})(\d{2})/, '$1 $2 $3 $4 $5').trim()
}

// ── OTP Input Group ────────────────────────────────────────────────────────────

function OtpInput({ value, onChange }: {
  value:    string[]
  onChange: (v: string[]) => void
}) {
  const refs = Array.from({ length: DIGITS }, () => useRef<HTMLInputElement>(null)) // eslint-disable-line react-hooks/rules-of-hooks

  const focus = useCallback((i: number) => refs[i]?.current?.focus(), [refs])

  const handleKey = useCallback((i: number, e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace') {
      if (value[i]) {
        const next = [...value]; next[i] = ''; onChange(next)
      } else if (i > 0) {
        focus(i - 1)
      }
      e.preventDefault()
    } else if (e.key === 'ArrowLeft' && i > 0) {
      focus(i - 1)
    } else if (e.key === 'ArrowRight' && i < DIGITS - 1) {
      focus(i + 1)
    }
  }, [value, onChange, focus])

  const handleChange = useCallback((i: number, raw: string) => {
    const digit = raw.replace(/\D/g, '').slice(-1)
    const next = [...value]; next[i] = digit; onChange(next)
    if (digit && i < DIGITS - 1) focus(i + 1)
  }, [value, onChange, focus])

  const handlePaste = useCallback((e: ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault()
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, DIGITS)
    const next = Array.from({ length: DIGITS }, (_, i) => pasted[i] ?? '')
    onChange(next)
    focus(Math.min(pasted.length, DIGITS - 1))
  }, [onChange, focus])

  return (
    <div className="flex justify-center gap-3">
      {Array.from({ length: DIGITS }, (_, i) => (
        <input
          key={i}
          ref={refs[i]}
          type="text"
          inputMode="numeric"
          maxLength={1}
          value={value[i] ?? ''}
          onChange={(e) => handleChange(i, e.target.value)}
          onKeyDown={(e) => handleKey(i, e)}
          onPaste={handlePaste}
          onFocus={(e) => e.target.select()}
          className={`
            h-14 w-11 rounded-xl border-2 text-center text-xl font-black tabular-nums
            transition-all duration-150 outline-none
            ${value[i]
              ? 'border-forge-red bg-red-50 text-forge-red'
              : 'border-gray-200 bg-white text-forge-dark focus:border-forge-red focus:ring-2 focus:ring-forge-red/20'
            }
          `}
        />
      ))}
    </div>
  )
}

// ── Composant principal ────────────────────────────────────────────────────────

export function LoginClient() {
  const router = useRouter()

  const [step,      setStep]      = useState<Step>('phone')
  const [canal,     setCanal]     = useState<Canal>('telephone')
  const [telephone, setTelephone] = useState('')
  const [email,     setEmail]     = useState('')
  const [otp,       setOtp]       = useState<string[]>(Array(DIGITS).fill(''))
  const [loading,   setLoading]   = useState(false)
  const [error,     setError]     = useState('')
  const [expiresAt, setExpiresAt] = useState<Date | null>(null)
  const [countdown, setCountdown] = useState(0)

  const phoneRef = useRef<HTMLInputElement>(null)

  useEffect(() => { phoneRef.current?.focus() }, [canal])

  useEffect(() => {
    const motif = new URLSearchParams(window.location.search).get('erreur')
    if (motif) setError(ERREURS_OAUTH[motif] ?? 'Connexion impossible, réessayez.')
  }, [])

  // Compte à rebours pour renvoyer le code
  useEffect(() => {
    if (!expiresAt) return
    const tick = () => setCountdown(Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1000)))
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [expiresAt])

  const handleSendOtp = async () => {
    if (canal === 'telephone' && !PHONE_RE.test(telephone.trim())) {
      setError('Numéro invalide — format : 6XX XX XX XX (Cameroun)')
      return
    }
    if (canal === 'email' && !EMAIL_RE.test(email.trim())) {
      setError('Adresse email invalide')
      return
    }
    setLoading(true); setError('')

    try {
      const res = canal === 'telephone'
        ? await fetch('/api/auth/shop/demander-otp', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ telephone: telephone.trim() }),
          })
        : await fetch('/api/auth/shop/email/code', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ email: email.trim() }),
          })
      const json = await res.json()
      if (!res.ok) { setError(json.error ?? 'Erreur réseau'); return }

      // Code SMS : 5 min (renvoyé par le serveur) ; code email : 10 min
      setExpiresAt(json.expires_at ? new Date(json.expires_at) : new Date(Date.now() + 10 * 60_000))
      setOtp(Array(DIGITS).fill(''))
      setStep('otp')
    } catch {
      setError('Impossible de contacter le serveur')
    } finally {
      setLoading(false)
    }
  }

  const handleVerifyOtp = async () => {
    const code = otp.join('')
    if (code.length < DIGITS) { setError('Entrez les 6 chiffres du code'); return }
    setLoading(true); setError('')

    try {
      const res = await fetch(canal === 'telephone' ? '/api/auth/shop/verifier-otp' : '/api/auth/shop/email/verifier', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(canal === 'telephone' ? { telephone: telephone.trim(), code } : { email: email.trim(), code }),
      })
      const json = await res.json()
      if (!res.ok) { setError(json.error ?? 'Code incorrect'); return }

      router.replace('/compte/dashboard')
    } catch {
      setError('Impossible de contacter le serveur')
    } finally {
      setLoading(false)
    }
  }

  const slideVariants = {
    enter:  (dir: number) => ({ x: dir > 0 ? 40 : -40, opacity: 0 }),
    center: { x: 0, opacity: 1 },
    exit:   (dir: number) => ({ x: dir > 0 ? -40 : 40, opacity: 0 }),
  }

  return (
    <div className="w-full max-w-sm mx-auto px-4">
      {/* Logo / En-tête */}
      <div className="mb-8 flex flex-col items-center text-center">
        <MetalForgeLogo size={44} variant="color" />
        <h1 className="mt-4 text-2xl font-black text-forge-dark">Mon espace client</h1>
        <p className="mt-1 text-sm text-forge-steel">Sans mot de passe : code par SMS ou email, Google ou Facebook</p>
      </div>

      <AnimatePresence mode="wait" custom={step === 'otp' ? 1 : -1}>
        {step === 'phone' ? (
          <motion.div
            key="phone"
            custom={1}
            variants={slideVariants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ duration: 0.22, ease: 'easeOut' }}
            className="space-y-5"
          >
            {/* Choix du canal de réception du code */}
            <div className="grid grid-cols-2 gap-1 rounded-xl bg-gray-100 p-1">
              {([['telephone', 'Téléphone'], ['email', 'Email']] as const).map(([valeur, libelle]) => (
                <button
                  key={valeur}
                  type="button"
                  onClick={() => { setCanal(valeur); setError('') }}
                  className={`rounded-lg py-2 text-sm font-bold transition ${canal === valeur ? 'bg-white text-forge-red shadow-sm' : 'text-forge-steel hover:text-forge-dark'}`}
                >
                  {libelle}
                </button>
              ))}
            </div>

            {canal === 'email' ? (
            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-forge-steel">
                Adresse email
              </label>
              <div className="relative">
                <Mail size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  ref={phoneRef}
                  type="email"
                  autoComplete="email"
                  placeholder="vous@exemple.com"
                  value={email}
                  onChange={(e) => { setEmail(e.target.value); setError('') }}
                  onKeyDown={(e) => e.key === 'Enter' && handleSendOtp()}
                  className="w-full rounded-xl border-2 border-gray-200 py-3 pl-10 pr-4 text-base font-semibold outline-none transition focus:border-forge-red focus:ring-2 focus:ring-forge-red/20"
                />
              </div>
            </div>
            ) : (
            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-forge-steel">
                Numéro de téléphone
              </label>
              <div className="relative">
                <Phone size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  ref={phoneRef}
                  type="tel"
                  inputMode="numeric"
                  placeholder="6 XX XX XX XX"
                  value={telephone}
                  onChange={(e) => {
                    setTelephone(e.target.value)
                    setError('')
                  }}
                  onKeyDown={(e) => e.key === 'Enter' && handleSendOtp()}
                  className="w-full rounded-xl border-2 border-gray-200 py-3 pl-10 pr-4 text-base font-semibold outline-none transition focus:border-forge-red focus:ring-2 focus:ring-forge-red/20"
                />
              </div>
              <p className="mt-1.5 text-[11px] text-gray-400">Format : 6XX XX XX XX ou +237 6XX XX XX XX</p>
            </div>
            )}

            {error && (
              <motion.p
                initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }}
                className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600"
              >
                {error}
              </motion.p>
            )}

            <button
              type="button"
              onClick={handleSendOtp}
              disabled={loading}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-forge-red py-3.5 text-sm font-bold text-white transition disabled:opacity-60 hover:bg-red-700"
            >
              {loading
                ? <Loader2 size={17} className="animate-spin" />
                : <><span>{canal === 'telephone' ? 'Recevoir le code par SMS' : 'Recevoir le code par email'}</span><ArrowRight size={16} /></>
              }
            </button>

            {/* Connexion via Google / Facebook */}
            <div className="flex items-center gap-3 text-[11px] font-semibold uppercase tracking-wider text-gray-400">
              <span className="h-px flex-1 bg-gray-200" /> ou <span className="h-px flex-1 bg-gray-200" />
            </div>
            <div className="space-y-2">
              <a
                href="/api/auth/shop/oauth/google"
                className="flex w-full items-center justify-center gap-2 rounded-xl border-2 border-gray-200 bg-white py-3 text-sm font-bold text-forge-dark transition hover:border-gray-300"
              >
                <span aria-hidden className="text-base font-black text-[#4285F4]">G</span> Continuer avec Google
              </a>
              <a
                href="/api/auth/shop/oauth/facebook"
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#1877F2] py-3 text-sm font-bold text-white transition hover:bg-[#166FE5]"
              >
                <span aria-hidden className="text-base font-black">f</span> Continuer avec Facebook
              </a>
            </div>
          </motion.div>
        ) : (
          <motion.div
            key="otp"
            custom={1}
            variants={slideVariants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ duration: 0.22, ease: 'easeOut' }}
            className="space-y-6"
          >
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => { setStep('phone'); setError('') }}
                className="flex items-center gap-1 text-sm text-forge-steel hover:text-forge-red transition"
              >
                <ChevronLeft size={16} /> {canal === 'telephone' ? 'Changer de numéro' : 'Changer d\'email'}
              </button>
            </div>

            <div className="rounded-2xl border border-gray-100 bg-gray-50 p-4">
              <div className="flex items-center gap-2 mb-1">
                <ShieldCheck size={15} className="text-forge-red" />
                <p className="text-xs font-semibold text-forge-steel">{canal === 'telephone' ? 'Code envoyé par SMS' : 'Code envoyé par email'}</p>
              </div>
              <p className="text-sm font-bold text-forge-dark">{canal === 'telephone' ? telephone : email}</p>
              {countdown > 0 && (
                <p className="mt-1 text-[11px] text-gray-400">
                  Expire dans <span className="font-semibold tabular-nums">{Math.floor(countdown / 60)}:{String(countdown % 60).padStart(2, '0')}</span>
                </p>
              )}
            </div>

            <OtpInput value={otp} onChange={setOtp} />

            {error && (
              <motion.p
                initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }}
                className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 text-center"
              >
                {error}
              </motion.p>
            )}

            <button
              type="button"
              onClick={handleVerifyOtp}
              disabled={loading || otp.join('').length < DIGITS}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-forge-red py-3.5 text-sm font-bold text-white transition disabled:opacity-50 hover:bg-red-700"
            >
              {loading
                ? <Loader2 size={17} className="animate-spin" />
                : <><span>Connexion</span><ArrowRight size={16} /></>
              }
            </button>

            <div className="text-center">
              {countdown === 0 ? (
                <button
                  type="button"
                  onClick={() => { setStep('phone'); setError('') }}
                  className="text-sm text-forge-red font-semibold hover:underline"
                >
                  Renvoyer un code
                </button>
              ) : (
                <p className="text-xs text-gray-400">{canal === 'telephone'
                  ? 'Pas reçu le code ? Vérifiez vos SMS ou attendez l\'expiration pour renvoyer.'
                  : 'Pas reçu le code ? Vérifiez vos courriers indésirables ou attendez l\'expiration pour renvoyer.'}</p>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
