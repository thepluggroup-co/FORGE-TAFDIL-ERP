import React, { createContext, useContext, useEffect, useState } from 'react'
import type { User, Session } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import { setApiToken } from '@/lib/api-client'

export type AppRole = 'admin' | 'superviseur' | 'operateur' | 'apprenant'

const VALID_ROLES: AppRole[] = ['admin', 'superviseur', 'operateur', 'apprenant']

interface AuthContextValue {
  user: User | null
  session: Session | null
  role: AppRole | null
  loading: boolean
  signIn: (email: string, password: string) => Promise<{ error: string | null }>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

// Read role directly from the JWT app_metadata — no network call, always available from localStorage.
function roleFromSession(session: Session | null): AppRole | null {
  const r = session?.user?.app_metadata?.role as string | undefined
  return r && VALID_ROLES.includes(r as AppRole) ? (r as AppRole) : null
}

async function fetchRoleFromDB(userId: string): Promise<AppRole | null> {
  const { data } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', userId)
    .single()
  return (data?.role as AppRole) ?? null
}

async function resolveRole(session: Session): Promise<AppRole | null> {
  // JWT app_metadata is the fastest and most reliable source on page refresh.
  const jwtRole = roleFromSession(session)
  if (jwtRole) return jwtRole

  // Fallback: profiles table (covers older sessions without app_metadata.role).
  return fetchRoleFromDB(session.user.id)
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser]       = useState<User | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [role, setRole]       = useState<AppRole | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const safetyTimer = setTimeout(() => {
      console.warn('[AuthContext] Safety timeout fired — forcing loading=false')
      setLoading(false)
    }, 5000)

    const done = () => {
      clearTimeout(safetyTimer)
      setLoading(false)
    }

    supabase.auth.getSession().then(async ({ data: { session } }) => {
      setSession(session)
      setUser(session?.user ?? null)
      setApiToken(session?.access_token ?? null)
      if (session?.user) {
        try {
          const r = await resolveRole(session)
          setRole(r)
          console.log('[AuthContext] getSession role:', r)
        } catch (e) {
          console.error('[AuthContext] fetchRole error (getSession):', e)
        }
      }
      done()
    }).catch((err) => {
      console.error('[AuthContext] getSession error:', err)
      done()
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      setSession(session)
      setUser(session?.user ?? null)
      setApiToken(session?.access_token ?? null)
      if (session?.user) {
        try {
          const r = await resolveRole(session)
          if (r !== null) setRole(r)
          console.log('[AuthContext] onAuthStateChange role:', r)
        } catch (e) {
          console.error('[AuthContext] fetchRole error (onAuthStateChange):', e)
        }
      } else if (event === 'SIGNED_OUT') {
        setRole(null)
        setApiToken(null)
      }
      done()
    })

    return () => {
      clearTimeout(safetyTimer)
      subscription.unsubscribe()
    }
  }, [])

  async function signIn(email: string, password: string) {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    return { error: error?.message ?? null }
  }

  async function signOut() {
    setApiToken(null)
    await supabase.auth.signOut()
  }

  return (
    <AuthContext.Provider value={{ user, session, role, loading, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth doit être utilisé dans AuthProvider')
  return ctx
}
