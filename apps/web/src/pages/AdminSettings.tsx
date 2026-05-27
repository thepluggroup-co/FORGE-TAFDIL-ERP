import React, { useState } from 'react'
import { motion } from 'framer-motion'
import {
  Users, UserPlus, Shield, CheckCircle, XCircle,
  Mail, Crown, ChevronDown, Loader2, Search,
} from 'lucide-react'
import { PageHeader, Button, SlideOver } from '@forge/ui'
import { useAuth } from '@/context/AuthContext'
import { useAdminUsers, useUpdateUser, useInviteUser } from '@/hooks/useAdmin'
import type { ForgeRole, UserProfile } from '@/hooks/useAdmin'
import { toast } from 'sonner'
import { Navigate } from 'react-router-dom'

// ── Role config ────────────────────────────────────────────────────────────────

const ROLES: { value: ForgeRole; label: string; color: string; bg: string; desc: string }[] = [
  { value: 'admin',     label: 'Administrateur', color: '#C62828', bg: '#FFEBEE', desc: 'Accès complet + gestion utilisateurs' },
  { value: 'directeur', label: 'Directeur',      color: '#1d4ed8', bg: '#dbeafe', desc: 'Finance, RH, rapports, validation' },
  { value: 'operateur', label: 'Opérateur',      color: '#15803d', bg: '#dcfce7', desc: 'Stocks, commandes, production' },
  { value: 'viewer',    label: 'Lecteur',         color: '#6b7280', bg: '#f3f4f6', desc: 'Lecture seule sur tous les modules' },
]

function RoleBadge({ role }: { role: ForgeRole }) {
  const cfg = ROLES.find((r) => r.value === role) ?? ROLES[3]
  return (
    <span
      className="inline-flex items-center gap-1 text-xs font-bold px-2 py-0.5 rounded-full"
      style={{ color: cfg.color, backgroundColor: cfg.bg }}
    >
      {role === 'admin' && <Crown className="h-3 w-3" />}
      {cfg.label}
    </span>
  )
}

// ── Role select dropdown ───────────────────────────────────────────────────────

function RoleSelect({
  value, onChange, disabled,
}: { value: ForgeRole; onChange: (r: ForgeRole) => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false)
  const current = ROLES.find((r) => r.value === value) ?? ROLES[2]

  return (
    <div className="relative">
      <button
        onClick={() => !disabled && setOpen((v) => !v)}
        disabled={disabled}
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-gray-200
          text-xs font-medium transition-colors hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
        style={{ color: current.color }}
      >
        {current.label}
        {!disabled && <ChevronDown className="h-3 w-3 text-gray-400" />}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-full mt-1 w-52 bg-white rounded-xl shadow-xl border border-gray-100 z-20 overflow-hidden">
            {ROLES.map((r) => (
              <button
                key={r.value}
                onClick={() => { onChange(r.value); setOpen(false) }}
                className="flex items-start gap-2.5 w-full px-3 py-2.5 hover:bg-gray-50 transition-colors text-left"
              >
                <span
                  className="inline-flex items-center gap-1 text-xs font-bold px-2 py-0.5 rounded-full shrink-0 mt-0.5"
                  style={{ color: r.color, backgroundColor: r.bg }}
                >
                  {r.value === 'admin' && <Crown className="h-3 w-3" />}
                  {r.label}
                </span>
                <span className="text-xs text-gray-400 leading-snug">{r.desc}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

// ── User row ───────────────────────────────────────────────────────────────────

function UserRow({ user, isSelf }: { user: UserProfile; isSelf: boolean }) {
  const updateUser = useUpdateUser()
  const initial = (user.nom || user.email).charAt(0).toUpperCase()

  const handleRoleChange = (newRole: ForgeRole) => {
    if (newRole === user.role) return
    updateUser.mutate(
      { id: user.id, role: newRole },
      {
        onSuccess: () => toast.success(`Rôle de ${user.email} mis à jour → ${newRole}`),
        onError:   (e: Error) => toast.error(e.message),
      },
    )
  }

  const handleToggleActive = () => {
    updateUser.mutate(
      { id: user.id, actif: !user.actif },
      {
        onSuccess: () => toast.success(user.actif ? `${user.email} désactivé` : `${user.email} réactivé`),
        onError:   (e: Error) => toast.error(e.message),
      },
    )
  }

  const isPending = updateUser.isPending

  return (
    <tr className="border-b border-gray-50 hover:bg-gray-50/50 transition-colors">
      {/* Avatar + email */}
      <td className="px-4 py-3">
        <div className="flex items-center gap-3">
          <div
            className="flex items-center justify-center w-8 h-8 rounded-full text-white text-sm font-semibold shrink-0"
            style={{ backgroundColor: user.actif ? '#C62828' : '#9ca3af' }}
          >
            {initial}
          </div>
          <div className="min-w-0">
            {user.nom && (
              <div className="text-sm font-semibold text-[#212121] truncate">{user.nom}</div>
            )}
            <div className="text-xs text-gray-400 truncate">{user.email}</div>
          </div>
          {isSelf && (
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-[#FFEBEE] text-[#C62828] shrink-0">
              Vous
            </span>
          )}
        </div>
      </td>

      {/* Role */}
      <td className="px-4 py-3">
        <RoleSelect
          value={user.role}
          onChange={handleRoleChange}
          disabled={isSelf || isPending}
        />
      </td>

      {/* Status */}
      <td className="px-4 py-3">
        {user.actif
          ? <span className="inline-flex items-center gap-1 text-xs text-green-700 font-medium"><CheckCircle className="h-3.5 w-3.5" /> Actif</span>
          : <span className="inline-flex items-center gap-1 text-xs text-gray-400 font-medium"><XCircle   className="h-3.5 w-3.5" /> Inactif</span>
        }
      </td>

      {/* Joined */}
      <td className="px-4 py-3 text-xs text-gray-400">
        {new Date(user.created_at).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' })}
      </td>

      {/* Actions */}
      <td className="px-4 py-3">
        {!isSelf && (
          <button
            onClick={handleToggleActive}
            disabled={isPending}
            className="text-xs px-2.5 py-1.5 rounded-lg border border-gray-200 text-gray-600
              hover:bg-gray-100 transition-colors disabled:opacity-40"
          >
            {isPending
              ? <Loader2 className="h-3 w-3 animate-spin" />
              : user.actif ? 'Désactiver' : 'Réactiver'}
          </button>
        )}
      </td>
    </tr>
  )
}

// ── Invite slide-over ──────────────────────────────────────────────────────────

const DEFAULT_INVITE = { email: '', role: 'operateur' as ForgeRole, nom: '' }

function InviteSlideOver({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [form, setForm]   = useState(DEFAULT_INVITE)
  const [err, setErr]     = useState<string | null>(null)
  const inviteUser        = useInviteUser()

  const handleSubmit = () => {
    if (!form.email.trim()) { setErr('Email requis'); return }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) { setErr('Email invalide'); return }
    setErr(null)

    inviteUser.mutate(form, {
      onSuccess: () => {
        toast.success(`Invitation envoyée à ${form.email}`)
        setForm(DEFAULT_INVITE)
        onClose()
      },
      onError: (e: Error) => setErr(e.message),
    })
  }

  return (
    <SlideOver isOpen={open} onClose={onClose} title="Inviter un utilisateur" width="md">
      <div className="space-y-5">
        <p className="text-sm text-gray-500">
          L'utilisateur recevra un email d'invitation avec un lien pour définir son mot de passe.
        </p>

        {/* Email */}
        <div>
          <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">
            Email *
          </label>
          <div className="relative">
            <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <input
              type="email"
              value={form.email}
              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
              placeholder="prenom.nom@tafdil.cm"
              className="w-full pl-9 pr-3 py-2.5 text-sm border border-gray-200 rounded-lg
                focus:outline-none focus:ring-2 focus:ring-[#C62828]"
            />
          </div>
        </div>

        {/* Nom */}
        <div>
          <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">
            Nom complet
          </label>
          <input
            value={form.nom}
            onChange={(e) => setForm((f) => ({ ...f, nom: e.target.value }))}
            placeholder="ex. Jean-Pierre Kamga"
            className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg
              focus:outline-none focus:ring-2 focus:ring-[#C62828]"
          />
        </div>

        {/* Role */}
        <div>
          <label className="block text-xs font-semibold text-gray-500 uppercase mb-2">
            Rôle
          </label>
          <div className="grid grid-cols-2 gap-2">
            {ROLES.map((r) => (
              <button
                key={r.value}
                onClick={() => setForm((f) => ({ ...f, role: r.value }))}
                className="flex flex-col items-start gap-1 p-3 rounded-xl border-2 text-left transition-all"
                style={{
                  borderColor:     form.role === r.value ? r.color : '#e5e7eb',
                  backgroundColor: form.role === r.value ? r.bg   : 'transparent',
                }}
              >
                <span className="text-xs font-bold" style={{ color: r.color }}>
                  {r.value === 'admin' && '👑 '}{r.label}
                </span>
                <span className="text-[11px] text-gray-400 leading-snug">{r.desc}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Error */}
        {err && (
          <div className="flex items-center gap-2 px-3 py-2 bg-red-50 border border-red-200
            rounded-lg text-xs text-red-700">
            <XCircle className="h-4 w-4 shrink-0" />
            {err}
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-3 pt-2 border-t border-gray-100">
          <Button variant="ghost" className="flex-1" onClick={onClose}>Annuler</Button>
          <Button
            className="flex-1"
            disabled={!form.email.trim() || inviteUser.isPending}
            onClick={handleSubmit}
          >
            {inviteUser.isPending
              ? <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> Envoi…</>
              : <><Mail className="h-3.5 w-3.5 mr-1" /> Envoyer l'invitation</>}
          </Button>
        </div>
      </div>
    </SlideOver>
  )
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function AdminSettings() {
  const { user, role: appRole } = useAuth()
  const { data, isLoading }     = useAdminUsers()
  const [search, setSearch]     = useState('')
  const [inviteOpen, setInvite] = useState(false)

  // Guard — non-admins get redirected
  if (appRole !== null && appRole !== 'admin') {
    return <Navigate to="/dashboard" replace />
  }

  const users: UserProfile[] = data?.data ?? []

  const filtered = search.trim()
    ? users.filter((u) =>
        u.email.toLowerCase().includes(search.toLowerCase()) ||
        u.nom?.toLowerCase().includes(search.toLowerCase()),
      )
    : users

  const counts = {
    total:     users.length,
    admin:     users.filter((u) => u.role === 'admin').length,
    directeur: users.filter((u) => u.role === 'directeur').length,
    operateur: users.filter((u) => u.role === 'operateur').length,
    viewer:    users.filter((u) => u.role === 'viewer').length,
    inactif:   users.filter((u) => !u.actif).length,
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3 }}
      className="space-y-6"
    >
      <PageHeader
        title="Administration"
        subtitle="Gestion des utilisateurs et des rôles"
        breadcrumbs={[
          { label: 'FORGE', href: '/' },
          { label: 'Administration' },
        ]}
        actions={
          <Button size="sm" onClick={() => setInvite(true)}>
            <UserPlus className="h-3.5 w-3.5" /> Inviter un utilisateur
          </Button>
        }
      />

      {/* ── Stats ── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {[
          { label: 'Total',        value: counts.total,     color: '#212121', bg: '#f5f5f5' },
          { label: 'Admins',       value: counts.admin,     color: '#C62828', bg: '#FFEBEE' },
          { label: 'Directeurs',   value: counts.directeur, color: '#1d4ed8', bg: '#dbeafe' },
          { label: 'Opérateurs',   value: counts.operateur, color: '#15803d', bg: '#dcfce7' },
          { label: 'Lecteurs',     value: counts.viewer,    color: '#6b7280', bg: '#f3f4f6' },
          { label: 'Inactifs',     value: counts.inactif,   color: '#9ca3af', bg: '#f9fafb' },
        ].map(({ label, value, color, bg }) => (
          <div
            key={label}
            className="rounded-xl border border-gray-100 p-4 text-center"
            style={{ backgroundColor: bg }}
          >
            <div className="text-2xl font-bold" style={{ color }}>{value}</div>
            <div className="text-xs text-gray-500 mt-0.5">{label}</div>
          </div>
        ))}
      </div>

      {/* ── User table ── */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 gap-3">
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4 text-[#C62828]" />
            <h2 className="font-semibold text-sm text-[#212121]">Utilisateurs</h2>
            <span className="text-xs text-gray-400 font-normal">({filtered.length})</span>
          </div>

          {/* Search */}
          <div className="relative w-56">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Rechercher…"
              className="w-full pl-8 pr-3 py-1.5 text-sm border border-gray-200 rounded-lg
                focus:outline-none focus:ring-2 focus:ring-[#C62828] bg-gray-50"
            />
          </div>
        </div>

        {/* Table */}
        {isLoading ? (
          <div className="flex items-center justify-center py-16 gap-2 text-gray-400 text-sm">
            <Loader2 className="h-5 w-5 animate-spin text-[#C62828]" />
            Chargement des utilisateurs…
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-gray-400">
            <Users className="h-8 w-8 mb-2 text-gray-200" />
            <p className="text-sm">{search ? 'Aucun résultat' : 'Aucun utilisateur'}</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50/50">
                  <th className="px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">Utilisateur</th>
                  <th className="px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">Rôle</th>
                  <th className="px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">Statut</th>
                  <th className="px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">Créé le</th>
                  <th className="px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((u) => (
                  <UserRow key={u.id} user={u} isSelf={u.id === user?.id} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Permission matrix ── */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="flex items-center gap-2 px-5 py-4 border-b border-gray-100">
          <Shield className="h-4 w-4 text-[#C62828]" />
          <h2 className="font-semibold text-sm text-[#212121]">Matrice des permissions</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/50">
                <th className="px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase">Module</th>
                {ROLES.map((r) => (
                  <th
                    key={r.value}
                    className="px-4 py-2.5 text-xs font-semibold uppercase text-center"
                    style={{ color: r.color }}
                  >
                    {r.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[
                { module: 'Dashboard',          admin: true,  directeur: true,  operateur: true,  viewer: true  },
                { module: 'Stocks & Production', admin: true,  directeur: true,  operateur: true,  viewer: true  },
                { module: 'Commandes & Devis',   admin: true,  directeur: true,  operateur: true,  viewer: true  },
                { module: 'Clients',             admin: true,  directeur: true,  operateur: true,  viewer: true  },
                { module: 'Finance',             admin: true,  directeur: true,  operateur: false, viewer: false },
                { module: 'RH',                  admin: true,  directeur: true,  operateur: false, viewer: false },
                { module: 'Intelligence IA',     admin: true,  directeur: true,  operateur: false, viewer: false },
                { module: 'Formation',           admin: true,  directeur: true,  operateur: true,  viewer: true  },
                { module: 'Projets',             admin: true,  directeur: true,  operateur: true,  viewer: true  },
                { module: 'Rapports & Exports',  admin: true,  directeur: true,  operateur: true,  viewer: false },
                { module: 'Paramètres système',  admin: true,  directeur: false, operateur: false, viewer: false },
                { module: 'Gestion utilisateurs',admin: true,  directeur: false, operateur: false, viewer: false },
              ].map((row) => (
                <tr key={row.module} className="border-b border-gray-50 hover:bg-gray-50/50">
                  <td className="px-4 py-2.5 text-sm text-[#212121] font-medium">{row.module}</td>
                  {(['admin', 'directeur', 'operateur', 'viewer'] as const).map((role) => (
                    <td key={role} className="px-4 py-2.5 text-center">
                      {row[role]
                        ? <CheckCircle className="h-4 w-4 text-green-500 mx-auto" />
                        : <XCircle    className="h-4 w-4 text-gray-200 mx-auto"  />}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Invite slide-over */}
      <InviteSlideOver open={inviteOpen} onClose={() => setInvite(false)} />
    </motion.div>
  )
}
