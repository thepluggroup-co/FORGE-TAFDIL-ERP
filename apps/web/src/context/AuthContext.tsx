import React, { createContext, useContext, useEffect, useState } from 'react'
import type { User, Session } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import { setApiToken, API_BASE } from '@/lib/api-client'

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

// ── Pont session → main process Electron (PROMPT 5) ──────────────────────────
// Le SyncManager (apps/desktop/src/main/ipc/sync-handler.ts) tourne dans le
// process principal et n'a pas accès au localStorage du renderer : il lit son
// propre store chiffré (apps/desktop/src/auth/session.ts) pour obtenir le
// bearer token qui sert à pousser les ventes caisse créées hors-ligne vers
// POST /api/caisse/tickets. Sans cet appel, ce store reste vide indéfiniment
// et TOUTE synchro de ticket hors-ligne échoue avec "Aucune session utilisateur
// locale", pour toujours (la queue épuise ses 3 tentatives puis reste bloquée).
const isElectron = typeof window !== 'undefined' && 'forge' in window

function syncElectronSession(session: Session | null, role: AppRole | null) {
  if (!isElectron) return
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const forge = (window as any).forge
  if (session?.user && session.expires_at) {
    forge.auth.saveSession({
      userId:      session.user.id,
      email:       session.user.email ?? '',
      rbacRole:    role ?? 'operateur',
      accessToken: session.access_token,
      expiresAt:   session.expires_at * 1000,
      isOffline:   false,
    }).catch(() => {})
  } else {
    forge.auth.clearSession().catch(() => {})
  }
}

// Fire a cheap background query to warm up the Supabase database connection pool.
// Supabase free tier pauses the DB after inactivity; the first real query can take
// 5-15s. Doing this at module load means the pool is warm by the time the user
// reaches a data-heavy page.
supabase.from('credits').select('id').limit(1).then(() => {}, () => {})

interface AuthContextValue {
  user: User | null
  session: Session | null
  role: AppRole | null
  displayName: string | null
  loading: boolean
  passwordMustChange: boolean
  pinMustChange: boolean
  signIn: (email: string, password: string) => Promise<{ error: string | null }>
  signInWithPhonePin: (phone: string, pin: string) => Promise<{ error: string | null }>
  signOut: () => Promise<void>
  /** Re-lit role/nom/passwordMustChange en base pour la session courante — à
   *  appeler après une action qui les change côté serveur (ex: SetPassword.tsx
   *  juste après PATCH /api/profile/password-changed) sans attendre le prochain
   *  évènement onAuthStateChange. */
  refreshProfile: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

interface ProfileFlags { role: AppRole | null; nom: string | null; passwordMustChange: boolean; pinMustChange: boolean }

async function fetchProfileFromDB(userId: string): Promise<ProfileFlags> {
  try {
    // rbac_user_profiles(password_must_change) et user_pins(must_change) :
    // jointures PostgREST sur les FK profile_id/user_id → profiles.id.
    // Absentes pour un compte sans profil RBAC / sans PIN activé — pas
    // d'erreur, juste `null`, traité comme "rien à forcer".
    const { data, error } = await supabase
      .from('profiles')
      .select('role, nom, rbac_user_profiles(password_must_change), user_pins(must_change)')
      .eq('id', userId)
      .single()
    if (error) console.warn('[AuthContext] fetchProfileFromDB:', error.message)
    const rbacProfile = data?.rbac_user_profiles as { password_must_change?: boolean } | { password_must_change?: boolean }[] | null
    const pinProfile   = data?.user_pins as { must_change?: boolean } | { must_change?: boolean }[] | null
    const pwdFlag = Array.isArray(rbacProfile) ? rbacProfile[0]?.password_must_change : rbacProfile?.password_must_change
    const pinFlag = Array.isArray(pinProfile)  ? pinProfile[0]?.must_change           : pinProfile?.must_change
    return {
      role: normalizeRole(data?.role),
      nom: (data?.nom as string | null) ?? null,
      passwordMustChange: pwdFlag ?? false,
      pinMustChange: pinFlag ?? false,
    }
  } catch {
    return { role: null, nom: null, passwordMustChange: false, pinMustChange: false }
  }
}

async function resolveProfile(session: Session): Promise<ProfileFlags> {
  const { role, nom, passwordMustChange, pinMustChange } = await fetchProfileFromDB(session.user.id)
  return {
    role: role ?? normalizeRole(session.user.app_metadata?.role as string | undefined),
    nom,
    passwordMustChange,
    pinMustChange,
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  // Start with cached data — no spinner for returning users
  const [user, setUser]       = useState<User | null>(_cached?.user ?? null)
  const [session, setSession] = useState<Session | null>(null)
  const [role, setRole]       = useState<AppRole | null>(_cached?.role ?? null)
  const [nom, setNom]         = useState<string | null>(null)
  // Faux par défaut : un compte legacy sans profil RBAC (donc sans ligne
  // rbac_user_profiles) ne doit jamais être bloqué par la garde de route —
  // seule une invitation/reset explicite positionne ce flag à true en base.
  const [passwordMustChange, setPasswordMustChange] = useState(false)
  const [pinMustChange, setPinMustChange] = useState(false)
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
        syncElectronSession(session, jwtRole)
        // Confirm role + nom from DB in background
        resolveProfile(session)
          .then(({ role: r, nom: n, passwordMustChange: pmc, pinMustChange: pinmc }) => {
            if (r) { setRole(r); syncElectronSession(session, r) }
            if (n) setNom(n)
            setPasswordMustChange(pmc)
            setPinMustChange(pinmc)
          })
          .catch(e => console.error('[AuthContext] fetchProfile error:', e))
      } else {
        // Session expired or invalid — clear everything
        setRole(null)
        setApiToken(null)
        setPasswordMustChange(false)
        setPinMustChange(false)
        syncElectronSession(null, null)
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
        syncElectronSession(session, jwtRole)
        if (event !== 'INITIAL_SESSION') {
          resolveProfile(session)
            .then(({ role: r, nom: n, passwordMustChange: pmc, pinMustChange: pinmc }) => {
              if (r) { setRole(r); syncElectronSession(session, r) }
              if (n) setNom(n)
              setPasswordMustChange(pmc)
              setPinMustChange(pinmc)
            })
            .catch(e => console.error('[AuthContext] onAuthStateChange fetchProfile error:', e))
        }
      } else if (event === 'SIGNED_OUT') {
        setRole(null)
        setApiToken(null)
        setPasswordMustChange(false)
        setPinMustChange(false)
        syncElectronSession(null, null)
      }
      setLoading(false)
    })

    return () => subscription.unsubscribe()
  }, [])

  async function signIn(email: string, password: string) {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    return { error: error?.message ?? null }
  }

  // Le PIN n'est JAMAIS envoyé à Supabase Auth (apps/api/src/services/
  // phone-pin.service.ts) : on demande au serveur de vérifier le PIN et de
  // générer un jeton d'échange (magic link), puis on l'échange nous-mêmes
  // contre une vraie session — verifyOtp déclenche onAuthStateChange('SIGNED_IN')
  // comme n'importe quelle autre connexion, le reste du contexte suit normalement.
  async function signInWithPhonePin(phone: string, pin: string) {
    try {
      const res = await fetch(`${API_BASE}/api/auth/phone-pin/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, pin }),
      })
      const body = await res.json() as { email?: string; hashedToken?: string; error?: string }
      if (!res.ok || !body.hashedToken || !body.email) {
        return { error: body.error ?? 'Numéro ou code PIN incorrect' }
      }

      const { error } = await supabase.auth.verifyOtp({
        email: body.email,
        token_hash: body.hashedToken,
        type: 'magiclink',
      })
      return { error: error?.message ?? null }
    } catch {
      return { error: 'Connexion impossible — vérifiez votre connexion réseau' }
    }
  }

  async function refreshProfile() {
    if (!session) return
    const { role: r, nom: n, passwordMustChange: pmc, pinMustChange: pinmc } = await resolveProfile(session)
    if (r) setRole(r)
    if (n) setNom(n)
    setPasswordMustChange(pmc)
    setPinMustChange(pinmc)
  }

  async function signOut() {
    setUser(null)
    setSession(null)
    setRole(null)
    setNom(null)
    setApiToken(null)
    setPasswordMustChange(false)
    setPinMustChange(false)
    try {
      await supabase.auth.signOut({ scope: 'local' })
    } catch {}
  }

  return (
    <AuthContext.Provider value={{
      user, session, role, displayName: nom, loading, passwordMustChange, pinMustChange,
      signIn, signInWithPhonePin, signOut, refreshProfile,
    }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth doit être utilisé dans AuthProvider')
  return ctx
}
