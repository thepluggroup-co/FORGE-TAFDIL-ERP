import React, { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Users, Shield, ShieldOff, KeyRound,
  Plus, Search, ChevronDown, X, Check,
} from 'lucide-react'
import { Button, Badge } from '@forge/ui'
import {
  useRbacUsers,
  useUpdateRbacUser,
  type RbacUserRow,
  type RbacRoleName,
} from '@/hooks/useRbac'

// ── Constants ────────────────────────────────────────────────────────────────

const RBAC_ROLES: { name: RbacRoleName; label: string; color: string }[] = [
  { name: 'SUPER_ADMIN', label: 'Super Admin',    color: 'bg-red-100 text-red-700' },
  { name: 'MANAGER',     label: 'Manager',         color: 'bg-purple-100 text-purple-700' },
  { name: 'COMMERCIAL',  label: 'Commercial',      color: 'bg-blue-100 text-blue-700' },
  { name: 'CAISSIER',    label: 'Caissier',        color: 'bg-green-100 text-green-700' },
  { name: 'MAGASINIER',  label: 'Magasinier',      color: 'bg-yellow-100 text-yellow-700' },
  { name: 'FORMATEUR',   label: 'Formateur',       color: 'bg-indigo-100 text-indigo-700' },
  { name: 'READONLY',    label: 'Lecture seule',   color: 'bg-gray-100 text-gray-600' },
]

function getRoleStyle(name: RbacRoleName | undefined) {
  return RBAC_ROLES.find(r => r.name === name)?.color ?? 'bg-gray-100 text-gray-500'
}

// ── EditModal ────────────────────────────────────────────────────────────────

interface EditModalProps {
  user: RbacUserRow
  onClose: () => void
  onSaved: () => void
}

function EditModal({ user, onClose, onSaved }: EditModalProps) {
  const { update, loading } = useUpdateRbacUser()
  const currentRole = user.rbac_user_profiles?.rbac_roles?.name
  const [selectedRole, setSelectedRole] = useState<RbacRoleName>(currentRole ?? 'READONLY')
  const [isActive, setIsActive] = useState(user.rbac_user_profiles?.is_active ?? user.actif)

  async function handleSave() {
    await update(user.id, {
      rbacRoleName: selectedRole !== currentRole ? selectedRole : undefined,
      isActive,
    })
    onSaved()
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 space-y-5"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">Modifier l'utilisateur</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-1">
          <p className="font-medium text-gray-800">{user.nom || user.email}</p>
          <p className="text-sm text-gray-500">{user.email}</p>
        </div>

        {/* Rôle RBAC */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Rôle RBAC</label>
          <div className="grid grid-cols-2 gap-2">
            {RBAC_ROLES.map(r => (
              <button
                key={r.name}
                onClick={() => setSelectedRole(r.name)}
                className={`px-3 py-2 rounded-lg border text-sm font-medium transition-all ${
                  selectedRole === r.name
                    ? 'border-blue-500 bg-blue-50 text-blue-700'
                    : 'border-gray-200 hover:border-gray-300 text-gray-700'
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>

        {/* Statut */}
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-gray-700">Compte actif</span>
          <button
            onClick={() => setIsActive(v => !v)}
            className={`w-12 h-6 rounded-full transition-colors ${
              isActive ? 'bg-green-500' : 'bg-gray-300'
            }`}
          >
            <span
              className={`block w-5 h-5 rounded-full bg-white shadow transition-transform mx-0.5 ${
                isActive ? 'translate-x-6' : 'translate-x-0'
              }`}
            />
          </button>
        </div>

        <div className="flex gap-3 pt-2">
          <Button variant="secondary" className="flex-1" onClick={onClose}>
            Annuler
          </Button>
          <Button className="flex-1" onClick={handleSave} disabled={loading}>
            {loading ? 'Sauvegarde…' : 'Enregistrer'}
          </Button>
        </div>
      </motion.div>
    </div>
  )
}

// ── UserManagement ────────────────────────────────────────────────────────────

export function UserManagement() {
  const { data: users, loading, refetch } = useRbacUsers()
  const { deactivate, resetPassword, loading: actionLoading } = useUpdateRbacUser()
  const [search, setSearch]       = useState('')
  const [editUser, setEditUser]   = useState<RbacUserRow | null>(null)
  const [roleFilter, setRoleFilter] = useState<RbacRoleName | 'ALL'>('ALL')

  const filtered = users.filter(u => {
    const matchSearch = !search ||
      u.nom?.toLowerCase().includes(search.toLowerCase()) ||
      u.email.toLowerCase().includes(search.toLowerCase())
    const matchRole = roleFilter === 'ALL' ||
      u.rbac_user_profiles?.rbac_roles?.name === roleFilter
    return matchSearch && matchRole
  })

  return (
    <div className="space-y-5">
      {/* En-tête */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Users className="w-6 h-6 text-gray-600" />
          <h1 className="text-xl font-bold text-gray-900">Gestion des utilisateurs</h1>
          <span className="text-sm text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">
            {users.length}
          </span>
        </div>
      </div>

      {/* Filtres */}
      <div className="flex gap-3 flex-wrap">
        <div className="relative flex-1 min-w-52">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Rechercher un utilisateur…"
            className="w-full pl-9 pr-4 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div className="relative">
          <select
            value={roleFilter}
            onChange={e => setRoleFilter(e.target.value as RbacRoleName | 'ALL')}
            className="appearance-none pl-3 pr-8 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="ALL">Tous les rôles</option>
            {RBAC_ROLES.map(r => (
              <option key={r.name} value={r.name}>{r.label}</option>
            ))}
          </select>
          <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
        </div>
      </div>

      {/* Table */}
      {loading ? (
        <div className="flex justify-center py-12 text-gray-400">Chargement…</div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Utilisateur</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Rôle RBAC</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Statut</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Dernière connexion</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map(user => {
                const rbacRole  = user.rbac_user_profiles?.rbac_roles?.name
                const isActive  = user.rbac_user_profiles?.is_active ?? user.actif
                const lastLogin = user.rbac_user_profiles?.last_login_at

                return (
                  <tr key={user.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3">
                      <div className="font-medium text-gray-900">{user.nom || '—'}</div>
                      <div className="text-gray-500 text-xs">{user.email}</div>
                    </td>
                    <td className="px-4 py-3">
                      {rbacRole ? (
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getRoleStyle(rbacRole)}`}>
                          {rbacRole}
                        </span>
                      ) : (
                        <span className="text-gray-400 text-xs">Non configuré</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center gap-1 text-xs font-medium ${
                        isActive ? 'text-green-600' : 'text-red-500'
                      }`}>
                        {isActive ? <Check className="w-3 h-3" /> : <ShieldOff className="w-3 h-3" />}
                        {isActive ? 'Actif' : 'Désactivé'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-500 text-xs">
                      {lastLogin
                        ? new Date(lastLogin).toLocaleString('fr-FR')
                        : 'Jamais connecté'}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1 justify-end">
                        <button
                          onClick={() => setEditUser(user)}
                          className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                          title="Modifier"
                        >
                          <Shield className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => resetPassword(user.id)}
                          disabled={actionLoading}
                          className="p-1.5 text-gray-400 hover:text-yellow-600 hover:bg-yellow-50 rounded-lg transition-colors"
                          title="Réinitialiser le mot de passe"
                        >
                          <KeyRound className="w-4 h-4" />
                        </button>
                        {isActive && (
                          <button
                            onClick={async () => { await deactivate(user.id); refetch() }}
                            disabled={actionLoading}
                            className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                            title="Désactiver"
                          >
                            <ShieldOff className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>

          {filtered.length === 0 && (
            <div className="py-12 text-center text-gray-400">
              Aucun utilisateur trouvé
            </div>
          )}
        </div>
      )}

      {/* Modal édition */}
      <AnimatePresence>
        {editUser && (
          <EditModal
            user={editUser}
            onClose={() => setEditUser(null)}
            onSaved={refetch}
          />
        )}
      </AnimatePresence>
    </div>
  )
}
