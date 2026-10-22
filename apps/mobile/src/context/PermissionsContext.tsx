import React, { createContext, useContext, useEffect, useMemo, useState } from 'react'
import {
  canAccessMobileScreen, hasMobilePermission, legacyPermissionsForRole,
  type MobileAction, type MobileModule, type MobilePermission, type MobileScreen,
} from '@forge/shared'
import { useAuth } from './AuthContext'
import { fetchMyPermissions } from '../lib/api'

/**
 * 'loading'  : permissions pas encore connues — rien de privilégié ne s'affiche.
 * 'database' : permissions RBAC réelles (serveur ou dernière copie de l'appareil).
 * 'legacy'   : repli sur les anciennes règles par rôle, uniquement si les
 *              permissions sont introuvables (première connexion sans réseau).
 */
export type PermissionsSource = 'loading' | 'database' | 'legacy'

interface PermissionsContextValue {
  source: PermissionsSource
  permissions: MobilePermission[]
  can: (module: MobileModule, action?: MobileAction) => boolean
  canScreen: (screen: MobileScreen) => boolean
}

const PermissionsContext = createContext<PermissionsContextValue | null>(null)

export function PermissionsProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth()
  const userId = user?.id ?? null
  const role = user?.role ?? null
  const [permissions, setPermissions] = useState<MobilePermission[]>([])
  const [source, setSource] = useState<PermissionsSource>('loading')

  useEffect(() => {
    if (!userId) {
      setPermissions([])
      setSource('loading')
      return
    }
    let cancelled = false
    setSource('loading')
    fetchMyPermissions()
      .then((res) => {
        if (cancelled) return
        setPermissions(res.permissions as MobilePermission[])
        setSource('database')
      })
      .catch(() => {
        if (cancelled) return
        setPermissions(legacyPermissionsForRole(role))
        setSource('legacy')
      })
    return () => { cancelled = true }
  }, [userId, role])

  const value = useMemo<PermissionsContextValue>(() => ({
    source,
    permissions,
    can: (module, action = 'READ') => source !== 'loading' && hasMobilePermission(permissions, module, action),
    canScreen: (screen) => source !== 'loading' && canAccessMobileScreen(permissions, screen),
  }), [source, permissions])

  return <PermissionsContext.Provider value={value}>{children}</PermissionsContext.Provider>
}

export function usePermissions(): PermissionsContextValue {
  const ctx = useContext(PermissionsContext)
  if (!ctx) throw new Error('usePermissions doit être utilisé dans <PermissionsProvider>')
  return ctx
}
