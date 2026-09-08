import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { useAuth } from '@/context/AuthContext'
import { TafdilLogoHero } from '@/components/ui/Logo'

type LoginMode = 'email' | 'phone'

export default function Login() {
  const { signIn, signInWithPhonePin } = useAuth()
  const navigate = useNavigate()
  const [mode, setMode] = useState<LoginMode>('email')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [phone, setPhone] = useState('')
  const [pin, setPin] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)

    const { error } = mode === 'email'
      ? await signIn(email.trim(), password)
      : await signInWithPhonePin(phone.trim(), pin)

    if (error) {
      console.error('[Login] Supabase error:', error)
      setError(mode === 'email' ? 'Email ou mot de passe incorrect' : 'Numéro ou code PIN incorrect')
      setLoading(false)
    } else {
      navigate('/dashboard', { replace: true })
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
        {/* Logo */}
        <div className="mb-10">
          <TafdilLogoHero variant="white" />
        </div>

        {/* Form */}
        {/* Bascule Email / Téléphone */}
        <div className="flex mb-6 rounded-xl overflow-hidden border border-white/10">
          {([
            { key: 'email' as const, label: 'Email' },
            { key: 'phone' as const, label: 'Téléphone' },
          ]).map(({ key, label }) => (
            <button
              key={key}
              type="button"
              onClick={() => { setMode(key); setError(null) }}
              className="flex-1 py-2.5 text-sm font-medium transition-colors"
              style={mode === key
                ? { backgroundColor: '#C62828', color: '#fff' }
                : { backgroundColor: 'transparent', color: 'rgba(255,255,255,0.5)' }}
            >
              {label}
            </button>
          ))}
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {mode === 'email' ? (
            <>
              <div>
                <label className="block text-xs font-semibold mb-1.5" style={{ color: 'rgba(255,255,255,0.6)' }}>
                  Email
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete="email"
                  placeholder="vous@tafdil.cm"
                  className="w-full px-4 py-3 rounded-xl text-sm text-white placeholder-white/30
                    border border-white/10 bg-white/5 focus:outline-none focus:ring-2
                    focus:ring-[#C62828] focus:border-transparent transition-all"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold mb-1.5" style={{ color: 'rgba(255,255,255,0.6)' }}>
                  Mot de passe
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                  placeholder="••••••••"
                  className="w-full px-4 py-3 rounded-xl text-sm text-white placeholder-white/30
                    border border-white/10 bg-white/5 focus:outline-none focus:ring-2
                    focus:ring-[#C62828] focus:border-transparent transition-all"
                />
              </div>
            </>
          ) : (
            <>
              <div>
                <label className="block text-xs font-semibold mb-1.5" style={{ color: 'rgba(255,255,255,0.6)' }}>
                  Numéro de téléphone
                </label>
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  required
                  autoComplete="tel"
                  placeholder="6XX XXX XXX"
                  className="w-full px-4 py-3 rounded-xl text-sm text-white placeholder-white/30
                    border border-white/10 bg-white/5 focus:outline-none focus:ring-2
                    focus:ring-[#C62828] focus:border-transparent transition-all"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold mb-1.5" style={{ color: 'rgba(255,255,255,0.6)' }}>
                  Code PIN
                </label>
                <input
                  type="password"
                  inputMode="numeric"
                  maxLength={4}
                  value={pin}
                  onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
                  required
                  autoComplete="current-password"
                  placeholder="••••"
                  className="w-full px-4 py-3 rounded-xl text-sm text-white placeholder-white/30
                    border border-white/10 bg-white/5 focus:outline-none focus:ring-2
                    focus:ring-[#C62828] focus:border-transparent transition-all"
                />
              </div>
              <p className="text-xs" style={{ color: 'rgba(255,255,255,0.35)' }}>
                La connexion par téléphone doit d'abord être activée depuis votre profil (Mon compte → Téléphone + PIN).
              </p>
            </>
          )}

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
            disabled={loading}
            className="w-full py-3 rounded-xl text-sm font-semibold text-white transition-all
              focus:outline-none focus:ring-2 focus:ring-[#C62828] focus:ring-offset-2
              focus:ring-offset-black disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ backgroundColor: '#C62828' }}
            onMouseEnter={(e) => { if (!loading) e.currentTarget.style.backgroundColor = '#B71C1C' }}
            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = '#C62828' }}
          >
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Connexion...
              </span>
            ) : 'Se connecter'}
          </button>
        </form>

        <p className="mt-8 text-center text-xs" style={{ color: 'rgba(255,255,255,0.2)' }}>
          FORGE ERP v1.0 · © THE PLUG 2026
        </p>
      </motion.div>
    </div>
  )
}
