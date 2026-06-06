import React, { createContext, useContext, useEffect, useState } from 'react'
import type { User, Session } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import { setApiToken } from '@/lib/api-client'

export type AppRole = 'admin' | 'superviseur' | 'operateur' | 'apprenant'

const VALID_ROLES: AppRole[] = ['admin', 'superviseur', 'operateur', 'apprenant']

// Old role names → new role names (schema rename: directeur→admin, admin→superviseur, viewer→apprenant)
const LEGACY_ROLE_MAP: Record<string, AppRole> = {
  directeur:   'admin',
  superviseur: 'superviseur',
  operateur:   'operateur',
  apprenant:   'apprenant',
  viewer:      'apprenant',
}

function normalizeRole(r: string | null | undefined): AppRole | null {
  if (!r) return null
  if (VALID_ROLES.includes(r as AppRole)) return r as AppRole
  return LEGACY_ROLE_MAP[r] ?? null
}

interface AuthContextValue {
  user: User | null
  session: Session | null
  role: AppRole | null
  loading: boolean
  signIn: (email: string, password: string) => Promise<{ error: string | null }>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

async function fetchRoleFromDB(userId: string): Promise<AppRole | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', userId)
    .single()
  if (error) console.error('[AuthContext] fetchRoleFromDB error:', error.message, '| code:', error.code)
  console.log('[AuthContext] fetchRoleFromDB raw role from DB:', data?.role)
  return normalizeRole(data?.role)
}

async function resolveRole(session: Session): Promise<AppRole | null> {
  // Always check the DB first — it is the source of truth after the role migration.
  const dbRole = await fetchRoleFromDB(session.user.id)
  if (dbRole) return dbRole

  // Fallback: normalize role from JWT app_metadata (covers sessions before DB migration).
  const jwtRaw = session.user.app_metadata?.role as string | undefined
  return normalizeRole(jwtRaw)
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
    }, 12000)

    const done = () => {
      clearTimeout(safetyTimer)
      setLoading(false)
    }

    supabase.auth.getSession().then(async ({ data: { session } }) => {
      setSession(session)
      setUser(session?.user ?? null)
      setApiToken(session?.access_token ?? null)
      if (session?.user) {
        // Set role from JWT immediately (no network) so the UI is usable right away
        const jwtRole = normalizeRole(session.user.app_metadata?.role as string | undefined)
        if (jwtRole) setRole(jwtRole)

        // Then confirm/override with DB role (source of truth)
        try {
          const r = await resolveRole(session)
          if (r) setRole(r)
          console.log('[AuthContext] getSession role:', r, '| jwt fallback was:', jwtRole)
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
        // Immediate JWT role while DB call loads
        const jwtRole = normalizeRole(session.user.app_metadata?.role as string | undefined)
        if (jwtRole) setRole(jwtRole)

        try {
          const r = await resolveRole(session)
          if (r) setRole(r)
          console.log('[AuthContext] onAuthStateChange role:', r, '| event:', event)
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
    // Clear local state immediately so the UI transitions even if the network call fails.
    setUser(null)
    setSession(null)
    setRole(null)
    setApiToken(null)
    // scope:'local' clears the local session without requiring a server round-trip,
    // so logout works correctly even when the app is offline.
    try {
      await supabase.auth.signOut({ scope: 'local' })
    } catch {
      // Local state is already cleared above — ignore network errors.
    }
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
