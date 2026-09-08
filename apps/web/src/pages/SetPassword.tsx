import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { useAuth } from '@/context/AuthContext'
import { supabase } from '@/lib/supabase'
import { apiClient } from '@/lib/api-client'
import { useSecuritySettings } from '@/hooks/useRbac'
import { TafdilLogoHero } from '@/components/ui/Logo'

// ── Règles de mot de passe — dérivées de rbac_security_settings (Admin → Sécurité),
// avec un repli raisonnable tant que ce réglage n'a pas encore chargé. ──────────

function buildRules(settings: ReturnType<typeof useSecuritySettings>['data']) {
  const minLength      = settings?.password_min_length      ?? 8
  const requireUpper   = settings?.password_require_upper   ?? true
  const requireNumber  = settings?.password_require_number  ?? true
  const requireSpecial = settings?.password_require_special ?? false

  return [
    { key: 'length',  label: `Au moins ${minLength} caractères`, test: (v: string) => v.length >= minLength },
    ...(requireUpper   ? [{ key: 'upper',   label: 'Une majuscule',           test: (v: string) => /[A-Z]/.test(v) }] : []),
    ...(requireNumber  ? [{ key: 'number',  label: 'Un chiffre',              test: (v: string) => /[0-9]/.test(v) }] : []),
    ...(requireSpecial ? [{ key: 'special', label: 'Un caractère spécial',    test: (v: string) => /[^A-Za-z0-9]/.test(v) }] : []),
  ]
}

export default function SetPassword() {
  const navigate = useNavigate()
  const { session, loading: authLoading, refreshProfile } = useAuth()
  const { data: securitySettings } = useSecuritySettings()

  const [password, setPassword]   = useState('')
  const [confirm, setConfirm]     = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError]         = useState<string | null>(null)
  const [linkExpired, setLinkExpired] = useState(false)

  // Le lien d'invitation/reset ouvre une session Supabase automatiquement
  // (detectSessionInUrl). Si on arrive ici sans session après le chargement
  // initial, le lien est invalide ou déjà utilisé — pas de formulaire à montrer.
  useEffect(() => {
    if (!authLoading && !session) setLinkExpired(true)
  }, [authLoading, session])

  const rules = useMemo(() => buildRules(securitySettings), [securitySettings])
  const rulesOk = rules.every((r) => r.test(password))
  const matchOk = password.length > 0 && password === confirm

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!rulesOk) { setError('Le mot de passe ne respecte pas encore toutes les règles ci-dessous.'); return }
    if (!matchOk) { setError('Les deux mots de passe ne correspondent pas.'); return }

    setSubmitting(true)
    try {
      const { error: updErr } = await supabase.auth.updateUser({ password })
      if (updErr) throw new Error(updErr.message)

      // Non bloquant côté UX : si cet appel échoue, le compte reste fonctionnel,
      // juste re-présenté à cet écran à la prochaine connexion — pas grave.
      await apiClient.patch('/api/profile/password-changed', {}).catch((e) =>
        console.error('[SetPassword] password-changed flag:', e),
      )
      await refreshProfile()

      navigate('/dashboard', { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur lors de la définition du mot de passe')
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

        {linkExpired ? (
          <div className="text-center space-y-4">
            <p className="text-sm font-medium px-3 py-3 rounded-lg" style={{ backgroundColor: 'rgba(198,40,40,0.2)', color: '#EF9A9A' }}>
              Ce lien n'est plus valide ou a déjà été utilisé. Demandez à un administrateur de vous renvoyer une invitation, ou utilisez "Mot de passe oublié" depuis l'écran de connexion.
            </p>
            <button
              onClick={() => navigate('/login', { replace: true })}
              className="text-sm text-white/60 hover:text-white underline"
            >
              Retour à la connexion
            </button>
          </div>
        ) : (
          <>
            <p className="text-sm text-white/60 mb-6 text-center">
              Bienvenue — choisissez votre mot de passe pour accéder à FORGE.
            </p>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold mb-1.5" style={{ color: 'rgba(255,255,255,0.6)' }}>
                  Nouveau mot de passe
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoFocus
                  autoComplete="new-password"
                  className="w-full px-4 py-3 rounded-xl text-sm text-white placeholder-white/30
                    border border-white/10 bg-white/5 focus:outline-none focus:ring-2
                    focus:ring-[#C62828] focus:border-transparent transition-all"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold mb-1.5" style={{ color: 'rgba(255,255,255,0.6)' }}>
                  Confirmer le mot de passe
                </label>
                <input
                  type="password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  required
                  autoComplete="new-password"
                  className="w-full px-4 py-3 rounded-xl text-sm text-white placeholder-white/30
                    border border-white/10 bg-white/5 focus:outline-none focus:ring-2
                    focus:ring-[#C62828] focus:border-transparent transition-all"
                />
              </div>

              <ul className="space-y-1 px-1">
                {rules.map((r) => (
                  <li key={r.key} className="flex items-center gap-2 text-xs" style={{ color: r.test(password) ? '#81C784' : 'rgba(255,255,255,0.4)' }}>
                    <span>{r.test(password) ? '✓' : '○'}</span>
                    {r.label}
                  </li>
                ))}
                {confirm.length > 0 && (
                  <li className="flex items-center gap-2 text-xs" style={{ color: matchOk ? '#81C784' : '#EF9A9A' }}>
                    <span>{matchOk ? '✓' : '✕'}</span>
                    Les deux mots de passe correspondent
                  </li>
                )}
              </ul>

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
                disabled={submitting || !rulesOk || !matchOk}
                className="w-full py-3 rounded-xl text-sm font-semibold text-white transition-all
                  focus:outline-none focus:ring-2 focus:ring-[#C62828] focus:ring-offset-2
                  focus:ring-offset-black disabled:opacity-40 disabled:cursor-not-allowed"
                style={{ backgroundColor: '#C62828' }}
              >
                {submitting ? 'Enregistrement...' : 'Définir mon mot de passe'}
              </button>
            </form>
          </>
        )}
      </motion.div>
    </div>
  )
}
