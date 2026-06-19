import React, { createContext, useContext, useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { setApiToken } from '../lib/api'

export type MobileRole = 'admin' | 'superviseur' | 'operateur' | 'apprenant' | 'livreur'

const VALID_ROLES: MobileRole[] = ['admin', 'superviseur', 'operateur', 'apprenant', 'livreur']

const LEGACY_ROLE_MAP: Record<string, MobileRole> = {
  directeur: 'admin',
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
  login: (email: string, password: string) => Promise<boolean>
  logout: () => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

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

  useEffect(() => {
    // Charge la session existante (localStorage) — pas de flash d'écran de login pour les users déjà connectés
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        setApiToken(session.access_token)
        setUser(buildUser(session))
      } else {
        setApiToken(null)
      }
      setLoading(false)
    }).catch(() => setLoading(false))

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) {
        setApiToken(session.access_token)
        setUser(buildUser(session))
      } else {
        setApiToken(null)
        setUser(null)
      }
    })

    return () => subscription.unsubscribe()
  }, [])

  async function login(email: string, password: string): Promise<boolean> {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) {
      console.warn('[AuthContext] login error:', error.message)
      return false
    }
    return true
  }

  function logout() {
    setUser(null)
    setApiToken(null)
    supabase.auth.signOut({ scope: 'local' }).catch(() => {})
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}
