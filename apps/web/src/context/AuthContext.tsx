import React, { createContext, useContext, useEffect, useState } from 'react'
import type { User, Session } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'

export type AppRole = 'admin' | 'directeur' | 'operateur' | 'viewer'

interface AuthContextValue {
  user: User | null
  session: Session | null
  role: AppRole | null
  loading: boolean
  signIn: (email: string, password: string) => Promise<{ error: string | null }>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

async function fetchRole(userId: string): Promise<AppRole | null> {
  const { data } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', userId)
    .single()
  return (data?.role as AppRole) ?? null
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser]       = useState<User | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [role, setRole]       = useState<AppRole | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // Safety timeout — fires if fetchRole (or any other async step) hangs.
    // IMPORTANT: do NOT clear this timer until setLoading(false) actually runs,
    // otherwise a slow/hanging fetchRole leaves the app stuck on the spinner forever.
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
      if (session?.user) {
        try {
          const r = await fetchRole(session.user.id)
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

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
      setSession(session)
      setUser(session?.user ?? null)
      if (session?.user) {
        try {
          const r = await fetchRole(session.user.id)
          setRole(r)
          console.log('[AuthContext] onAuthStateChange role:', r)
        } catch (e) {
          console.error('[AuthContext] fetchRole error (onAuthStateChange):', e)
        }
      } else {
        setRole(null)
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
