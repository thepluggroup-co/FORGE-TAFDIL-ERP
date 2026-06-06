import React, { useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Shield, Download, Filter, ChevronLeft, ChevronRight,
  X, Eye, AlertCircle, CheckCircle, LogIn, LogOut,
} from 'lucide-react'
import { Button } from '@forge/ui'
import {
  useAuditLogs,
  useAuditLogDetail,
  type AuditLog,
  type AuditLogsFilter,
  type AuditActionType,
  type RbacModule,
} from '@/hooks/useRbac'

// ── Constants ────────────────────────────────────────────────────────────────

const ACTION_ICONS: Partial<Record<AuditActionType, React.ReactNode>> = {
  ACCESS_DENIED:  <AlertCircle className="w-4 h-4 text-red-500" />,
  LOGIN_SUCCESS:  <LogIn className="w-4 h-4 text-green-500" />,
  LOGIN_FAILED:   <LogIn className="w-4 h-4 text-red-500" />,
  LOGOUT:         <LogOut className="w-4 h-4 text-gray-500" />,
  USER_CREATED:   <CheckCircle className="w-4 h-4 text-blue-500" />,
  USER_DEACTIVATED: <Shield className="w-4 h-4 text-orange-500" />,
  PERMISSION_CHANGED: <Shield className="w-4 h-4 text-purple-500" />,
  SETTINGS_CHANGED:   <Shield className="w-4 h-4 text-yellow-500" />,
  DATA_EXPORT:    <Download className="w-4 h-4 text-indigo-500" />,
}

const ACTION_LABELS: Record<AuditActionType, string> = {
  ACCESS_DENIED:      'Accès refusé',
  USER_CREATED:       'Utilisateur créé',
  USER_UPDATED:       'Utilisateur modifié',
  USER_DEACTIVATED:   'Utilisateur désactivé',
  ROLE_CHANGED:       'Rôle changé',
  PERMISSION_CHANGED: 'Permission modifiée',
  SETTINGS_CHANGED:   'Paramètres modifiés',
  LOGIN_SUCCESS:      'Connexion réussie',
  LOGIN_FAILED:       'Connexion échouée',
  LOGOUT:             'Déconnexion',
  DATA_EXPORT:        'Export de données',
  PASSWORD_RESET:     'Réinitialisation mot de passe',
  PASSWORD_CHANGED:   'Mot de passe changé',
  SESSION_EXPIRED:    'Session expirée',
}

const MODULES: RbacModule[] = [
  'STOCK', 'COMMERCIAL', 'FINANCE', 'HR',
  'PRODUCTION', 'LOGISTICS', 'ADMIN', 'REPORTS', 'RECEIVABLES',
]

// ── JsonDiff ──────────────────────────────────────────────────────────────────

function JsonDiff({ before, after }: { before: unknown; after: unknown }) {
  const fmt = (v: unknown) =>
    v ? JSON.stringify(v, null, 2) : null

  const beforeStr = fmt(before)
  const afterStr  = fmt(after)

  if (!beforeStr && !afterStr) return <p className="text-gray-400 text-xs">Aucune donnée</p>

  return (
    <div className="grid grid-cols-2 gap-3 text-xs font-mono">
      {beforeStr && (
        <div>
          <p className="text-gray-500 mb-1">Avant</p>
          <pre className="bg-red-50 text-red-800 p-3 rounded-lg overflow-auto max-h-48 whitespace-pre-wrap">
            {beforeStr}
          </pre>
        </div>
      )}
      {afterStr && (
        <div className={beforeStr ? '' : 'col-span-2'}>
          <p className="text-gray-500 mb-1">Après</p>
          <pre className="bg-green-50 text-green-800 p-3 rounded-lg overflow-auto max-h-48 whitespace-pre-wrap">
            {afterStr}
          </pre>
        </div>
      )}
    </div>
  )
}

// ── LogDetailModal ────────────────────────────────────────────────────────────

function LogDetailModal({ logId, onClose }: { logId: string; onClose: () => void }) {
  const { data: log, loading } = useAuditLogDetail(logId)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="bg-white rounded-2xl shadow-xl w-full max-w-2xl p-6 space-y-4 max-h-[90vh] overflow-y-auto"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">Détail de l'entrée d'audit</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X className="w-5 h-5" />
          </button>
        </div>

        {loading || !log ? (
          <div className="py-8 text-center text-gray-400">Chargement…</div>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <p className="text-gray-500">Action</p>
                <p className="font-medium">{ACTION_LABELS[log.action_type]}</p>
              </div>
              <div>
                <p className="text-gray-500">Date</p>
                <p className="font-medium">{new Date(log.created_at).toLocaleString('fr-FR')}</p>
              </div>
              <div>
                <p className="text-gray-500">Module</p>
                <p className="font-medium">{log.module ?? '—'}</p>
              </div>
              <div>
                <p className="text-gray-500">Adresse IP</p>
                <p className="font-medium">{log.ip_address ?? '—'}</p>
              </div>
              {log.resource_type && (
                <div>
                  <p className="text-gray-500">Ressource</p>
                  <p className="font-medium">{log.resource_type} / {log.resource_id ?? '—'}</p>
                </div>
              )}
            </div>

            <div>
              <p className="text-sm text-gray-500 mb-2">Diff</p>
              <JsonDiff before={log.payload_before} after={log.payload_after} />
            </div>
          </div>
        )}
      </motion.div>
    </div>
  )
}

// ── AuditLogViewer ────────────────────────────────────────────────────────────

export function AuditLogViewer() {
  const [filter, setFilter] = useState<AuditLogsFilter>({ page: 1, perPage: 50 })
  const [selectedLogId, setSelectedLogId] = useState<string | null>(null)
  const [showFilters, setShowFilters]     = useState(false)

  const { data, loading } = useAuditLogs(filter)

  const setPage = useCallback((page: number) => {
    setFilter(f => ({ ...f, page }))
  }, [])

  function handleExport() {
    const params = new URLSearchParams()
    if (filter.actionType) params.set('actionType', filter.actionType)
    if (filter.module)     params.set('module', filter.module)
    if (filter.from)       params.set('from', filter.from ?? '')
    if (filter.to)         params.set('to', filter.to ?? '')
    window.open(`/api/admin/rbac/audit-logs/export?${params.toString()}`, '_blank')
  }

  return (
    <div className="space-y-4">
      {/* En-tête */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Shield className="w-6 h-6 text-gray-600" />
          <h1 className="text-xl font-bold text-gray-900">Journal d'audit</h1>
          <span className="text-sm text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">
            {data.total.toLocaleString('fr-FR')} entrées
          </span>
        </div>
        <div className="flex gap-2">
          <Button
            variant="secondary"
            className="gap-2"
            onClick={() => setShowFilters(v => !v)}
          >
            <Filter className="w-4 h-4" />
            Filtres
          </Button>
          <Button variant="secondary" className="gap-2" onClick={handleExport}>
            <Download className="w-4 h-4" />
            Export CSV
          </Button>
        </div>
      </div>

      {/* Filtres */}
      <AnimatePresence>
        {showFilters && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="bg-gray-50 rounded-xl border border-gray-200 p-4 grid grid-cols-2 md:grid-cols-4 gap-3"
          >
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Action</label>
              <select
                value={filter.actionType ?? ''}
                onChange={e => setFilter(f => ({ ...f, actionType: e.target.value || undefined, page: 1 }))}
                className="w-full px-2 py-1.5 border border-gray-200 rounded-lg text-sm"
              >
                <option value="">Toutes</option>
                {(Object.keys(ACTION_LABELS) as AuditActionType[]).map(k => (
                  <option key={k} value={k}>{ACTION_LABELS[k]}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Module</label>
              <select
                value={filter.module ?? ''}
                onChange={e => setFilter(f => ({ ...f, module: (e.target.value || undefined) as RbacModule | undefined, page: 1 }))}
                className="w-full px-2 py-1.5 border border-gray-200 rounded-lg text-sm"
              >
                <option value="">Tous</option>
                {MODULES.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Du</label>
              <input
                type="datetime-local"
                value={filter.from ?? ''}
                onChange={e => setFilter(f => ({ ...f, from: e.target.value || undefined, page: 1 }))}
                className="w-full px-2 py-1.5 border border-gray-200 rounded-lg text-sm"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Au</label>
              <input
                type="datetime-local"
                value={filter.to ?? ''}
                onChange={e => setFilter(f => ({ ...f, to: e.target.value || undefined, page: 1 }))}
                className="w-full px-2 py-1.5 border border-gray-200 rounded-lg text-sm"
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Timeline / Table */}
      {loading ? (
        <div className="flex justify-center py-12 text-gray-400">Chargement…</div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Action</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Module</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Ressource</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">IP</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Date</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {data.data.map((log: AuditLog) => (
                <tr key={log.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      {ACTION_ICONS[log.action_type] ?? <Shield className="w-4 h-4 text-gray-400" />}
                      <span className="font-medium text-gray-800">
                        {ACTION_LABELS[log.action_type]}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-gray-500">{log.module ?? '—'}</td>
                  <td className="px-4 py-3 text-gray-500 text-xs">
                    {log.resource_type
                      ? `${log.resource_type}${log.resource_id ? ` #${log.resource_id.slice(0, 8)}` : ''}`
                      : '—'}
                  </td>
                  <td className="px-4 py-3 text-gray-500 text-xs">{log.ip_address ?? '—'}</td>
                  <td className="px-4 py-3 text-gray-500 text-xs">
                    {new Date(log.created_at).toLocaleString('fr-FR')}
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => setSelectedLogId(log.id)}
                      className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg"
                    >
                      <Eye className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {data.data.length === 0 && (
            <div className="py-12 text-center text-gray-400">Aucun log pour ces critères</div>
          )}

          {/* Pagination */}
          {data.totalPages > 1 && (
            <div className="px-4 py-3 border-t border-gray-200 flex items-center justify-between">
              <span className="text-sm text-gray-500">
                Page {data.page} / {data.totalPages}
              </span>
              <div className="flex gap-2">
                <button
                  disabled={data.page <= 1}
                  onClick={() => setPage(data.page - 1)}
                  className="p-1.5 text-gray-600 hover:bg-gray-100 rounded disabled:opacity-30"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <button
                  disabled={data.page >= data.totalPages}
                  onClick={() => setPage(data.page + 1)}
                  className="p-1.5 text-gray-600 hover:bg-gray-100 rounded disabled:opacity-30"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Modal détail */}
      <AnimatePresence>
        {selectedLogId && (
          <LogDetailModal
            logId={selectedLogId}
            onClose={() => setSelectedLogId(null)}
          />
        )}
      </AnimatePresence>
    </div>
  )
}
