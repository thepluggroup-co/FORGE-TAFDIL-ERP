import React, { createContext, useContext, useEffect, useRef, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { createOfflineAuth, localOfflineAuthStorage, OFFLINE_AUTH_MESSAGES } from '@forge/shared'
import { setApiToken, setApiUser } from '../lib/api'
import { initPushNotifications, teardownPushNotifications } from '../lib/push'

export type MobileRole = 'admin' | 'manager' | 'operateur' | 'apprenant' | 'livreur' | 'caissier'

const VALID_ROLES: MobileRole[] = ['admin', 'manager', 'operateur', 'apprenant', 'livreur', 'caissier']

const LEGACY_ROLE_MAP: Record<string, MobileRole> = {
  directeur: 'admin',
  superviseur: 'manager', // compatibilité session jusqu'au renouvellement du JWT
  viewer:    'apprenant',
}

function normalizeRole(r: string | null | undefined): MobileRole | null {
  if (!r) return null
  if (VALID_ROLES.includes(r as MobileRole)) return r as MobileRole
  return LEGACY_ROLE_MAP[r] ?? null
}

export interface AuthUser {
  id: string
  name: string
  email: string
  role: MobileRole
}

interface AuthContextValue {
  user: AuthUser | null
  loading: boolean
  /** null = connecté ; sinon le message à afficher. */
  login: (email: string, password: string) => Promise<string | null>
  /** Vrai quand l'utilisateur est entré sans réseau (vérification locale). */
  isOffline: boolean
  logout: () => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

// Connexion hors ligne — packages/shared/src/offline-auth.ts : après une
// connexion en ligne réussie, une empreinte du mot de passe et le profil sont
// gardés sur le téléphone ; sans réseau, login() vérifie contre cette empreinte.
const offlineAuth = createOfflineAuth<AuthUser>(localOfflineAuthStorage())

/** Supabase Auth injoignable (≠ identifiants refusés par le serveur). */
function isAuthNetworkError(error: { name?: string; status?: number; message?: string } | null): boolean {
  if (!error) return false
  return error.name === 'AuthRetryableFetchError' || error.status === 0 || /failed to fetch|network/i.test(error.message ?? '')
}

function buildUser(session: Session): AuthUser | null {
  const rawRole = session.user.app_metadata?.role as string | undefined
  const role    = normalizeRole(rawRole)
  if (!role) return null

  const meta    = session.user.user_metadata as { nom?: string; full_name?: string } | undefined
  const name    = meta?.nom ?? meta?.full_name ?? session.user.email?.split('@')[0] ?? 'Utilisateur'

  return { id: session.user.id, name, email: session.user.email ?? '', role }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser]       = useState<AuthUser | null>(null)
  const [loading, setLoading] = useState(true)
  const [isOffline, setIsOffline] = useState(false)
  // Lu dans le callback onAuthStateChange, créé une seule fois — d'où le ref.
  const offlineUserId = useRef<string | null>(null)

  function leaveOffline() {
    offlineUserId.current = null
    setIsOffline(false)
  }

  /** Session en ligne confirmée : état de l'app + copie locale du profil. */
  function applySession(session: Session) {
    const built = buildUser(session)
    setApiToken(session.access_token)
    setApiUser(session.user.id)
    setUser(built)
    if (built) offlineAuth.touch(session.user.id, built)
    initPushNotifications().catch(e => console.error('[push] init:', e))
  }

  useEffect(() => {
    // Charge la session existante (localStorage) — pas de flash d'écran de login pour les users déjà connectés
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        applySession(session)
      } else if (!offlineUserId.current) {
        setApiToken(null)
        setApiUser(null)
      }
      setLoading(false)
    }).catch(() => setLoading(false))

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (offlineUserId.current) {
        // Hors ligne, seul un vrai retour de session (réseau revenu) ou une
        // déconnexion explicite change quelque chose.
        if (!session && event !== 'SIGNED_OUT') return
        if (session && session.user.id !== offlineUserId.current) {
          // La session restée sur le téléphone est celle d'un AUTRE compte :
          // ne jamais basculer silencieusement d'identité.
          logout()
          return
        }
        leaveOffline()
      }
      if (session) {
        applySession(session)
      } else {
        setApiToken(null)
        setApiUser(null)
        setUser(null)
      }
    })

    return () => subscription.unsubscribe()
  }, [])

  async function login(email: string, password: string): Promise<string | null> {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })

    if (isAuthNetworkError(error)) {
      const result = await offlineAuth.verify('email', email, password)
      if (!result.ok) return OFFLINE_AUTH_MESSAGES[result.reason]
      offlineUserId.current = result.userId
      setIsOffline(true)
      setApiToken(null)
      setApiUser(result.userId)
      setUser(result.profile)
      return null
    }

    if (error) {
      console.warn('[AuthContext] login error:', error.message)
      return 'Email ou mot de passe incorrect.'
    }

    const built = data.session ? buildUser(data.session) : null
    if (built) {
      offlineAuth.remember('email', email, password, built.id, built)
        .catch(e => console.warn('[AuthContext] mémorisation hors ligne impossible:', e))
    }
    return null
  }

  function logout() {
    leaveOffline()
    setUser(null)
    setApiToken(null)
    setApiUser(null)
    teardownPushNotifications().catch(() => {})
    supabase.auth.signOut({ scope: 'local' }).catch(() => {})
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, isOffline }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}
