import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { useAuth } from '@/context/AuthContext'
import { apiClient } from '@/lib/api-client'
import { TafdilLogoHero } from '@/components/ui/Logo'

// Après une connexion par PIN temporaire (généré par un admin, envoyé par
// SMS/WhatsApp — apps/api/src/services/phone-pin.service.ts) ou une
// activation self-service (Account → Téléphone + PIN) : l'utilisateur choisit
// son propre PIN à 4 chiffres. ProtectedRoute (App.tsx) redirige ici tant que
// pinMustChange est vrai, comme /set-password pour le mot de passe.

export default function SetPin() {
  const navigate = useNavigate()
  const { refreshProfile } = useAuth()

  const [pin, setPin]         = useState('')
  const [confirm, setConfirm] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError]     = useState<string | null>(null)

  const digitsOk = /^\d{4}$/.test(pin)
  const matchOk  = pin.length === 4 && pin === confirm

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!digitsOk) { setError('Le PIN doit contenir exactement 4 chiffres.'); return }
    if (!matchOk)  { setError('Les deux codes ne correspondent pas.'); return }

    setSubmitting(true)
    try {
      await apiClient.post('/api/profile/pin', { pin })
      await refreshProfile()
      navigate('/dashboard', { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur lors de la définition du PIN')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center px-4"
      style={{ background: 'linear-gradient(135deg, #212121 0%, #000000 100%)' }}
    >
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: 'easeOut' }}
        className="w-full max-w-sm"
      >
        <div className="mb-10">
          <TafdilLogoHero variant="white" />
        </div>

        <p className="text-sm text-white/60 mb-6 text-center">
          Choisissez votre code PIN à 4 chiffres pour la connexion par téléphone.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold mb-1.5" style={{ color: 'rgba(255,255,255,0.6)' }}>
              Nouveau PIN
            </label>
            <input
              type="password"
              inputMode="numeric"
              maxLength={4}
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
              required
              autoFocus
              placeholder="••••"
              className="w-full px-4 py-3 rounded-xl text-center text-2xl tracking-[0.5em] text-white placeholder-white/30
                border border-white/10 bg-white/5 focus:outline-none focus:ring-2
                focus:ring-[#C62828] focus:border-transparent transition-all"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold mb-1.5" style={{ color: 'rgba(255,255,255,0.6)' }}>
              Confirmer le PIN
            </label>
            <input
              type="password"
              inputMode="numeric"
              maxLength={4}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value.replace(/\D/g, '').slice(0, 4))}
              required
              placeholder="••••"
              className="w-full px-4 py-3 rounded-xl text-center text-2xl tracking-[0.5em] text-white placeholder-white/30
                border border-white/10 bg-white/5 focus:outline-none focus:ring-2
                focus:ring-[#C62828] focus:border-transparent transition-all"
            />
          </div>

          {error && (
            <motion.p
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              className="text-sm font-medium text-center px-3 py-2 rounded-lg"
              style={{ backgroundColor: 'rgba(198,40,40,0.2)', color: '#EF9A9A' }}
            >
              {error}
            </motion.p>
          )}

          <button
            type="submit"
            disabled={submitting || !digitsOk || !matchOk}
            className="w-full py-3 rounded-xl text-sm font-semibold text-white transition-all
              focus:outline-none focus:ring-2 focus:ring-[#C62828] focus:ring-offset-2
              focus:ring-offset-black disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ backgroundColor: '#C62828' }}
          >
            {submitting ? 'Enregistrement...' : 'Définir mon PIN'}
          </button>
        </form>
      </motion.div>
    </div>
  )
}
