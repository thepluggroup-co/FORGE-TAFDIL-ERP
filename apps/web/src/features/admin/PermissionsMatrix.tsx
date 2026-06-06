import React, { useState, useMemo, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Lock, Save, AlertTriangle, X } from 'lucide-react'
import { Button } from '@forge/ui'
import {
  useRolePermissions,
  useSaveRolePermissions,
  type RbacModule,
  type RbacAction,
  type RbacRoleName,
} from '@/hooks/useRbac'

// ── Constants ────────────────────────────────────────────────────────────────

const MODULES: RbacModule[] = [
  'STOCK', 'COMMERCIAL', 'FINANCE', 'HR',
  'PRODUCTION', 'LOGISTICS', 'ADMIN', 'REPORTS', 'RECEIVABLES',
]

const ACTIONS: RbacAction[] = [
  'READ', 'CREATE', 'UPDATE', 'DELETE', 'VALIDATE', 'CONFIGURE', 'EXPORT',
]

const MODULE_LABELS: Record<RbacModule, string> = {
  STOCK:       'Stock',
  COMMERCIAL:  'Commercial',
  FINANCE:     'Finance',
  HR:          'RH',
  PRODUCTION:  'Production',
  LOGISTICS:   'Logistique',
  ADMIN:       'Admin',
  REPORTS:     'Rapports',
  RECEIVABLES: 'Créances',
}

const ACTION_LABELS: Record<RbacAction, string> = {
  READ:      'Lire',
  CREATE:    'Créer',
  UPDATE:    'Modifier',
  DELETE:    'Supprimer',
  VALIDATE:  'Valider',
  CONFIGURE: 'Configurer',
  EXPORT:    'Exporter',
}

// Règles immutables côté UI
const IMMUTABLE_PAIRS = new Set([
  'ADMIN:CONFIGURE',
  'ADMIN:DELETE',
])

interface PermissionsMatrixProps {
  rbacName: RbacRoleName  // nom RBAC (ex: 'SUPER_ADMIN') — sert aussi d'ID pour l'API
  label:    string        // libellé affiché (ex: 'Admin')
  onClose?: () => void
}

// ── ConfirmDialog ────────────────────────────────────────────────────────────

function ConfirmDialog({ onConfirm, onCancel }: { onConfirm: () => void; onCancel: () => void }) {
  return (
    <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/50">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 space-y-4"
      >
        <div className="flex items-center gap-3 text-yellow-600">
          <AlertTriangle className="w-6 h-6" />
          <h3 className="font-semibold text-gray-900">Confirmer les changements</h3>
        </div>
        <p className="text-sm text-gray-600">
          Modifier les permissions de ce rôle affectera tous les utilisateurs qui en sont porteurs.
          Cette action prend effet immédiatement.
        </p>
        <div className="flex gap-3">
          <Button variant="secondary" className="flex-1" onClick={onCancel}>Annuler</Button>
          <Button className="flex-1" onClick={onConfirm}>Confirmer</Button>
        </div>
      </motion.div>
    </div>
  )
}

// ── PermissionsMatrix ─────────────────────────────────────────────────────────

export function PermissionsMatrix({ rbacName, label, onClose }: PermissionsMatrixProps) {
  const { data: currentPerms, loading, refetch } = useRolePermissions(rbacName)
  const { save, loading: saving }                = useSaveRolePermissions()
  const [showConfirm, setShowConfirm]            = useState(false)

  // Build a set of currently granted permissions
  const initialGranted = useMemo(
    () => new Set(currentPerms.map(p => `${p.module}:${p.action}`)),
    [currentPerms],
  )

  const [granted, setGranted] = useState<Set<string>>(new Set())

  // Sync granted set when currentPerms loads
  React.useEffect(() => {
    setGranted(new Set(initialGranted))
  }, [initialGranted])

  const togglePermission = useCallback((module: RbacModule, action: RbacAction) => {
    const key = `${module}:${action}`

    // Immutable permissions cannot be toggled
    if (IMMUTABLE_PAIRS.has(key)) return
    // SUPER_ADMIN cannot lose ADMIN:CONFIGURE
    if (rbacName === 'SUPER_ADMIN' && key === 'ADMIN:CONFIGURE') return

    setGranted(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [rbacName])

  const hasChanges = useMemo(() => {
    for (const key of granted) if (!initialGranted.has(key)) return true
    for (const key of initialGranted) if (!granted.has(key)) return true
    return false
  }, [granted, initialGranted])

  async function handleSave() {
    const permissions = MODULES.flatMap(module =>
      ACTIONS.map(action => ({
        module,
        action,
        granted: granted.has(`${module}:${action}`),
      })),
    )
    await save(rbacName, permissions)
    await refetch()
    setShowConfirm(false)
  }

  if (loading) {
    return <div className="flex justify-center py-12 text-gray-400">Chargement permissions…</div>
  }

  return (
    <div className="space-y-4">
      {/* En-tête */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-gray-900">Matrice des permissions</h2>
          <p className="text-sm text-gray-500">Rôle : <span className="font-medium">{label}</span></p>
        </div>
        <div className="flex items-center gap-2">
          {hasChanges && (
            <Button onClick={() => setShowConfirm(true)} disabled={saving} className="gap-2">
              <Save className="w-4 h-4" />
              {saving ? 'Sauvegarde…' : 'Enregistrer'}
            </Button>
          )}
          {onClose && (
            <button onClick={onClose} className="p-2 text-gray-400 hover:text-gray-600">
              <X className="w-5 h-5" />
            </button>
          )}
        </div>
      </div>

      {/* Matrice */}
      <div className="overflow-x-auto rounded-xl border border-gray-200">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="text-left px-4 py-3 font-medium text-gray-600 w-36">Module</th>
              {ACTIONS.map(action => (
                <th key={action} className="px-3 py-3 font-medium text-gray-600 text-center min-w-[80px]">
                  {ACTION_LABELS[action]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {MODULES.map(module => (
              <tr key={module} className="hover:bg-gray-50/50 transition-colors">
                <td className="px-4 py-3 font-medium text-gray-700">
                  {MODULE_LABELS[module]}
                </td>
                {ACTIONS.map(action => {
                  const key         = `${module}:${action}`
                  const isGranted   = granted.has(key)
                  const isImmutable = IMMUTABLE_PAIRS.has(key)
                  const isSuperLock = rbacName === 'SUPER_ADMIN' && key === 'ADMIN:CONFIGURE'

                  return (
                    <td key={action} className="px-3 py-3 text-center">
                      <div
                        className="relative inline-flex items-center justify-center"
                        title={
                          isImmutable || isSuperLock
                            ? 'Permission système — non modifiable'
                            : `${MODULE_LABELS[module]}:${ACTION_LABELS[action]}`
                        }
                      >
                        <input
                          type="checkbox"
                          checked={isGranted}
                          disabled={isImmutable || isSuperLock}
                          onChange={() => togglePermission(module, action)}
                          className={`w-4 h-4 rounded border-gray-300 transition-all ${
                            isImmutable || isSuperLock
                              ? 'opacity-40 cursor-not-allowed accent-gray-400'
                              : 'cursor-pointer accent-blue-600'
                          }`}
                        />
                        {(isImmutable || isSuperLock) && (
                          <Lock className="absolute -top-1 -right-1 w-2.5 h-2.5 text-gray-400" />
                        )}
                      </div>
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-gray-400 flex items-center gap-1">
        <Lock className="w-3 h-3" />
        Les permissions avec verrou sont des règles système non modifiables.
      </p>

      {/* Confirmation */}
      <AnimatePresence>
        {showConfirm && (
          <ConfirmDialog
            onConfirm={handleSave}
            onCancel={() => setShowConfirm(false)}
          />
        )}
      </AnimatePresence>
    </div>
  )
}
