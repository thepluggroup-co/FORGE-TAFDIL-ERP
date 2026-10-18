/** Registre fonctionnel central des modules ERP. */
export const APP_MODULES = {
  iot: { enabled: false },
  securite: { enabled: false },
  intelligence: { enabled: false },
  projets: { enabled: false },
  marketing: { enabled: false },
} as const satisfies Record<string, { enabled: boolean }>

export type AppModuleId = keyof typeof APP_MODULES
export const isAppModuleEnabled = (id: AppModuleId): boolean => APP_MODULES[id].enabled
export const disabledModuleRedirect = (id: AppModuleId): '/dashboard' | null =>
  isAppModuleEnabled(id) ? null : '/dashboard'
