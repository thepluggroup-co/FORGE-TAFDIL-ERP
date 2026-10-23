import React, { useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { Icon } from '../components/ui'
import { COMPANY_NAME } from '@forge/shared'

export function LoginPage() {
  const { login } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    const message = await login(email, password)
    setLoading(false)
    if (message) setError(message)
  }

  const field = 'w-full flex items-center gap-3 border border-gray-200 rounded-xl px-4 py-3.5 bg-white focus-within:ring-2 focus-within:ring-[#C62828] focus-within:border-transparent'

  return (
    <div className="min-h-screen bg-white flex flex-col px-6 safe-top safe-bottom">
      <div className="pt-10 pb-8 flex items-center gap-3">
        <div className="w-12 h-12 rounded-xl bg-[#C62828] flex items-center justify-center shadow-md">
          <span className="text-white text-2xl font-extrabold">F</span>
        </div>
        <div className="leading-tight">
          <p className="text-2xl font-extrabold tracking-wide text-gray-900">FORGE</p>
          <p className="text-[11px] font-semibold tracking-[0.2em] text-gray-500">TAFDIL ERP</p>
        </div>
      </div>

      <h1 className="text-3xl font-extrabold text-gray-900">Bon retour !</h1>
      <p className="mt-2 text-sm text-gray-500">Connectez-vous à votre compte pour accéder à votre espace.</p>

      <form onSubmit={handleSubmit} className="mt-8 space-y-4">
        <label className={field}>
          <Icon name="user" size={19} className="text-gray-400" />
          <input
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email"
            required
            className="flex-1 bg-transparent text-sm outline-none placeholder-gray-400"
          />
        </label>

        <label className={field}>
          <Icon name="lock" size={19} className="text-gray-400" />
          <input
            type={showPassword ? 'text' : 'password'}
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Mot de passe"
            required
            className="flex-1 bg-transparent text-sm outline-none placeholder-gray-400"
          />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            aria-label={showPassword ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
            className="text-gray-400 active:text-gray-600"
          >
            <Icon name={showPassword ? 'eyeOff' : 'eye'} size={19} />
          </button>
        </label>

        {error && <p className="text-sm text-red-600 bg-red-50 px-4 py-2.5 rounded-xl">{error}</p>}

        <button
          type="submit"
          disabled={loading}
          className="w-full flex items-center justify-center gap-2 bg-[#C62828] active:bg-[#7f0000] text-white font-semibold py-3.5 rounded-xl shadow-md transition-colors disabled:opacity-50"
        >
          {loading ? 'Connexion…' : <>Se connecter <Icon name="arrowRight" size={18} /></>}
        </button>
      </form>

      <div className="mt-auto pt-10 pb-4 text-center">
        <p className="text-xs text-gray-400">Vous n'avez pas de compte ?</p>
        <p className="text-xs font-semibold text-[#C62828]">Contactez l'administrateur</p>
        <p className="mt-3 text-[10px] text-gray-300">{COMPANY_NAME}</p>
      </div>
    </div>
  )
}
