import React, { createContext, useContext, useEffect, useState } from 'react'
import type { User, Session } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import { setApiToken } from '@/lib/api-client'

export type AppRole = 'admin' | 'superviseur' | 'operateur' | 'technicien' | 'caissier'

const VALID_ROLES: AppRole[] = ['admin', 'superviseur', 'operateur', 'technicien', 'caissier']

const LEGACY_ROLE_MAP: Record<string, AppRole> = {
  directeur:   'admin',
  superviseur: 'superviseur',
  operateur:   'operateur',
  technicien:  'technicien',
  caissier:    'caissier',
  apprenant:   'technicien',   // legacy
  viewer:      'technicien',   // legacy
}

function normalizeRole(r: string | null | undefined): AppRole | null {
  if (!r) return null
  if (VALID_ROLES.includes(r as AppRole)) return r as AppRole
  return LEGACY_ROLE_MAP[r] ?? null
}

// Read the Supabase session from localStorage synchronously — no network call.
// Supabase stores it under a key matching sb-<project-ref>-auth-token.
function readCachedSession(): { user: User; access_token: string; role: AppRole | null } | null {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (!key?.startsWith('sb-') || !key.endsWith('-auth-token')) continue
      const raw = localStorage.getItem(key)
      if (!raw) continue
      const data = JSON.parse(raw) as { user?: User; access_token?: string; expires_at?: number }
      // Skip expired tokens — the Supabase SDK will refresh automatically,
      // but preloading an expired token causes a 401 on the first API request.
      const expired = data.expires_at && data.expires_at < Math.floor(Date.now() / 1000)
      if (data?.user && data?.access_token && !expired) {
        return {
          user:         data.user,
          access_token: data.access_token,
          role:         normalizeRole(data.user.app_metadata?.role as string | undefined),
        }
      }
    }
  } catch {}
  return null
}

// Initialize synchronously so there is zero loading flash for returning users.
const _cached = readCachedSession()
if (_cached) setApiToken(_cached.access_token)

// Fire a cheap background query to warm up the Supabase database connection pool.
// Supabase free tier pauses the DB after inactivity; the first real query can take
// 5-15s. Doing this at module load means the pool is warm by the time the user
// reaches a data-heavy page.
supabase.from('credits').select('id').limit(1).then(() => {}).catch(() => {})

interface AuthContextValue {
  user: User | null
  session: Session | null
  role: AppRole | null
  displayName: string | null
  loading: boolean
  signIn: (email: string, password: string) => Promise<{ error: string | null }>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

async function fetchProfileFromDB(userId: string): Promise<{ role: AppRole | null; nom: string | null }> {
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('role, nom')
      .eq('id', userId)
      .single()
    if (error) console.warn('[AuthContext] fetchProfileFromDB:', error.message)
    return { role: normalizeRole(data?.role), nom: (data?.nom as string | null) ?? null }
  } catch {
    return { role: null, nom: null }
  }
}

async function resolveProfile(session: Session): Promise<{ role: AppRole | null; nom: string | null }> {
  const { role, nom } = await fetchProfileFromDB(session.user.id)
  return {
    role: role ?? normalizeRole(session.user.app_metadata?.role as string | undefined),
    nom,
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  // Start with cached data — no spinner for returning users
  const [user, setUser]       = useState<User | null>(_cached?.user ?? null)
  const [session, setSession] = useState<Session | null>(null)
  const [role, setRole]       = useState<AppRole | null>(_cached?.role ?? null)
  const [nom, setNom]         = useState<string | null>(null)
  // Only show loading screen when there is genuinely no cached session
  const [loading, setLoading] = useState(_cached === null)

  useEffect(() => {
    // getSession() verifies/refreshes the token in the background.
    // If we already have cached data the page is already visible — this just
    // keeps the session fresh and syncs any role changes.
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      setUser(session?.user ?? null)
      setApiToken(session?.access_token ?? null)
      if (session?.user) {
        const jwtRole = normalizeRole(session.user.app_metadata?.role as string | undefined)
        if (jwtRole) setRole(jwtRole)
        // Confirm role + nom from DB in background
        resolveProfile(session)
          .then(({ role: r, nom: n }) => { if (r) setRole(r); if (n) setNom(n) })
          .catch(e => console.error('[AuthContext] fetchProfile error:', e))
      } else {
        // Session expired or invalid — clear everything
        setRole(null)
        setApiToken(null)
      }
      setLoading(false)
    }).catch(() => setLoading(false))

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      setSession(session)
      setUser(session?.user ?? null)
      setApiToken(session?.access_token ?? null)
      if (session?.user) {
        const jwtRole = normalizeRole(session.user.app_metadata?.role as string | undefined)
        if (jwtRole) setRole(jwtRole)
        if (event !== 'INITIAL_SESSION') {
          resolveProfile(session)
            .then(({ role: r, nom: n }) => { if (r) setRole(r); if (n) setNom(n) })
            .catch(e => console.error('[AuthContext] onAuthStateChange fetchProfile error:', e))
        }
      } else if (event === 'SIGNED_OUT') {
        setRole(null)
        setApiToken(null)
      }
      setLoading(false)
    })

    return () => subscription.unsubscribe()
  }, [])

  async function signIn(email: string, password: string) {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    return { error: error?.message ?? null }
  }

  async function signOut() {
    setUser(null)
    setSession(null)
    setRole(null)
    setNom(null)
    setApiToken(null)
    try {
      await supabase.auth.signOut({ scope: 'local' })
    } catch {}
  }

  return (
    <AuthContext.Provider value={{ user, session, role, displayName: nom, loading, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth doit être utilisé dans AuthProvider')
  return ctx
}
