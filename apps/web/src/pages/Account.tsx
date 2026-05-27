import React, { useState } from 'react'
import { motion } from 'framer-motion'
import {
  User, Mail, Shield, Key, Bell, LogOut,
  CheckCircle, ChevronRight, Lock, Smartphone, Crown,
} from 'lucide-react'
import { PageHeader, Button } from '@forge/ui'
import { useAuth } from '@/context/AuthContext'
import { supabase } from '@/lib/supabase'
import { toast } from 'sonner'
import { useNavigate } from 'react-router-dom'

// ── Role display config ────────────────────────────────────────────────────────
const ROLE_CONFIG: Record<string, { label: string; color: string; bg: string; description: string }> = {
  admin: {
    label:       'Administrateur',
    color:       '#C62828',
    bg:          '#FFEBEE',
    description: 'Accès complet à tous les modules et paramètres du système.',
  },
  directeur: {
    label:       'Directeur',
    color:       '#1d4ed8',
    bg:          '#dbeafe',
    description: 'Accès aux rapports, RH, finance et validation des opérations.',
  },
  operateur: {
    label:       'Opérateur',
    color:       '#15803d',
    bg:          '#dcfce7',
    description: 'Gestion des stocks, commandes et production.',
  },
  viewer: {
    label:       'Lecteur',
    color:       '#6b7280',
    bg:          '#f3f4f6',
    description: 'Accès en lecture seule à tous les modules.',
  },
}

// ── Section card ───────────────────────────────────────────────────────────────
function Section({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
      <div className="flex items-center gap-2 px-5 py-4 border-b border-gray-100">
        <span className="text-[#C62828]">{icon}</span>
        <h2 className="font-semibold text-sm text-[#212121]">{title}</h2>
      </div>
      <div className="p-5">{children}</div>
    </div>
  )
}

// ── Password change form ───────────────────────────────────────────────────────
function PasswordSection() {
  const [currentPwd, setCurrentPwd] = useState('')
  const [newPwd, setNewPwd]         = useState('')
  const [confirmPwd, setConfirmPwd] = useState('')
  const [saving, setSaving]         = useState(false)

  const handleChange = async () => {
    if (newPwd.length < 8) { toast.error('Le nouveau mot de passe doit contenir au moins 8 caractères'); return }
    if (newPwd !== confirmPwd) { toast.error('Les mots de passe ne correspondent pas'); return }
    setSaving(true)
    const { error } = await supabase.auth.updateUser({ password: newPwd })
    setSaving(false)
    if (error) { toast.error(error.message); return }
    toast.success('Mot de passe mis à jour')
    setCurrentPwd('')
    setNewPwd('')
    setConfirmPwd('')
  }

  return (
    <Section title="Sécurité du compte" icon={<Key className="h-4 w-4" />}>
      <div className="space-y-4 max-w-md">
        <div>
          <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">Mot de passe actuel</label>
          <input
            type="password"
            value={currentPwd}
            onChange={(e) => setCurrentPwd(e.target.value)}
            placeholder="••••••••"
            className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C62828]"
          />
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">Nouveau mot de passe</label>
          <input
            type="password"
            value={newPwd}
            onChange={(e) => setNewPwd(e.target.value)}
            placeholder="••••••••"
            className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C62828]"
          />
          {newPwd && newPwd.length < 8 && (
            <p className="text-xs text-amber-600 mt-1">Au moins 8 caractères requis</p>
          )}
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">Confirmer le nouveau mot de passe</label>
          <input
            type="password"
            value={confirmPwd}
            onChange={(e) => setConfirmPwd(e.target.value)}
            placeholder="••••••••"
            className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C62828]"
          />
          {confirmPwd && newPwd !== confirmPwd && (
            <p className="text-xs text-red-600 mt-1">Les mots de passe ne correspondent pas</p>
          )}
        </div>
        <Button
          disabled={!currentPwd || !newPwd || newPwd !== confirmPwd || newPwd.length < 8 || saving}
          onClick={handleChange}
        >
          {saving ? 'Mise à jour…' : 'Changer le mot de passe'}
        </Button>
      </div>
    </Section>
  )
}

// ── Notification prefs (local state only) ──────────────────────────────────────
function NotificationSection() {
  const [prefs, setPrefs] = useState({
    stocks_critiques: true,
    nouvelles_commandes: true,
    alertes_ia: true,
    resume_quotidien: false,
  })

  const items = [
    { key: 'stocks_critiques'   as const, label: 'Alertes stocks critiques',  desc: 'Notifie quand un produit atteint son seuil critique' },
    { key: 'nouvelles_commandes' as const, label: 'Nouvelles commandes',       desc: 'Notifie à chaque nouvelle commande ERP ou web' },
    { key: 'alertes_ia'          as const, label: 'Alertes Intelligence IA',   desc: 'Alertes proactives générées par FORGE AI' },
    { key: 'resume_quotidien'    as const, label: 'Résumé quotidien',           desc: 'Rapport journalier envoyé chaque matin' },
  ]

  return (
    <Section title="Préférences de notifications" icon={<Bell className="h-4 w-4" />}>
      <div className="space-y-3">
        {items.map(({ key, label, desc }) => (
          <label key={key} className="flex items-center justify-between gap-4 cursor-pointer group">
            <div>
              <p className="text-sm font-medium text-[#212121] group-hover:text-[#C62828] transition-colors">{label}</p>
              <p className="text-xs text-gray-400">{desc}</p>
            </div>
            <button
              role="switch"
              aria-checked={prefs[key]}
              onClick={() => setPrefs((p) => ({ ...p, [key]: !p[key] }))}
              className="relative inline-flex h-5 w-9 shrink-0 rounded-full border-2 border-transparent transition-colors"
              style={{ backgroundColor: prefs[key] ? '#C62828' : '#e5e7eb' }}
            >
              <span
                className="block h-4 w-4 rounded-full bg-white shadow transition-transform"
                style={{ transform: prefs[key] ? 'translateX(16px)' : 'translateX(0)' }}
              />
            </button>
          </label>
        ))}
      </div>
      <p className="text-xs text-gray-400 mt-4">
        Les préférences de notification sont sauvegardées localement.
      </p>
    </Section>
  )
}

// ── Quick links ────────────────────────────────────────────────────────────────
function QuickLink({ icon, label, href }: { icon: React.ReactNode; label: string; href: string }) {
  const navigate = useNavigate()
  return (
    <button
      onClick={() => navigate(href)}
      className="flex items-center justify-between w-full px-4 py-3 rounded-xl
        border border-gray-100 hover:bg-gray-50 transition-colors text-left group"
    >
      <div className="flex items-center gap-3">
        <span className="text-[#C62828]">{icon}</span>
        <span className="text-sm font-medium text-[#212121]">{label}</span>
      </div>
      <ChevronRight className="h-4 w-4 text-gray-300 group-hover:text-[#C62828] transition-colors" />
    </button>
  )
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function Account() {
  const { user, role: appRole, signOut } = useAuth()
  const navigate = useNavigate()

  const email   = user?.email ?? ''
  const initial = email.charAt(0).toUpperCase()

  const roleConfig = ROLE_CONFIG[appRole ?? ''] ?? ROLE_CONFIG['viewer']

  const handleSignOut = async () => {
    await signOut()
    navigate('/login')
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3 }}
      className="space-y-6 max-w-3xl"
    >
      <PageHeader
        title="Mon compte"
        subtitle="Profil · Sécurité · Préférences"
        breadcrumbs={[{ label: 'FORGE', href: '/' }, { label: 'Mon compte' }]}
      />

      {/* ── Profile card ── */}
      <Section title="Profil utilisateur" icon={<User className="h-4 w-4" />}>
        <div className="flex items-center gap-5">
          {/* Avatar */}
          <div
            className="flex items-center justify-center w-16 h-16 rounded-full text-white text-2xl font-bold shrink-0"
            style={{ backgroundColor: '#C62828' }}
          >
            {initial}
          </div>

          <div className="flex-1 min-w-0">
            {/* Email */}
            <div className="flex items-center gap-2 mb-2">
              <Mail className="h-4 w-4 text-gray-400 shrink-0" />
              <span className="text-sm font-semibold text-[#212121] truncate">{email}</span>
              <span
                className="flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded-full shrink-0"
                style={{ color: '#15803d', backgroundColor: '#dcfce7' }}
              >
                <CheckCircle className="h-3 w-3" /> Vérifié
              </span>
            </div>

            {/* Role badge */}
            <div className="flex items-center gap-2">
              <Shield className="h-4 w-4 text-gray-400 shrink-0" />
              <span
                className="text-xs font-bold px-2.5 py-1 rounded-full"
                style={{ color: roleConfig.color, backgroundColor: roleConfig.bg }}
              >
                {roleConfig.label}
              </span>
            </div>
            <p className="text-xs text-gray-400 mt-1.5 ml-6">{roleConfig.description}</p>
          </div>
        </div>
      </Section>

      {/* ── Permissions summary (role-based) ── */}
      <Section title="Permissions" icon={<Lock className="h-4 w-4" />}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
          {[
            { label: 'Stocks & Inventaire',   ok: ['admin', 'directeur', 'operateur'].includes(appRole ?? '') },
            { label: 'Commandes & Devis',      ok: ['admin', 'directeur', 'operateur'].includes(appRole ?? '') },
            { label: 'Finance & Comptabilité', ok: ['admin', 'directeur'].includes(appRole ?? '') },
            { label: 'Ressources Humaines',    ok: ['admin', 'directeur'].includes(appRole ?? '') },
            { label: 'Intelligence IA',        ok: ['admin', 'directeur'].includes(appRole ?? '') },
            { label: 'Rapports & Exports',     ok: ['admin', 'directeur', 'operateur'].includes(appRole ?? '') },
            { label: 'Paramètres système',     ok: appRole === 'admin' },
            { label: 'Gestion utilisateurs',   ok: appRole === 'admin' },
          ].map(({ label, ok }) => (
            <div key={label} className={`flex items-center gap-2 px-3 py-2 rounded-lg border ${ok ? 'border-green-100 bg-green-50' : 'border-gray-100 bg-gray-50'}`}>
              <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${ok ? 'bg-green-500' : 'bg-gray-300'}`} />
              <span className={ok ? 'text-[#212121] font-medium' : 'text-gray-400'}>{label}</span>
              {ok && <CheckCircle className="h-3 w-3 text-green-500 ml-auto shrink-0" />}
            </div>
          ))}
        </div>
        {appRole === 'admin' && (
          <div className="mt-4 p-3 bg-[#FFEBEE] border border-[#FFCDD2] rounded-xl text-xs text-[#C62828] flex items-center justify-between gap-3">
            <span><strong>Accès administrateur</strong> — Vous pouvez inviter des utilisateurs et modifier leurs rôles.</span>
            <button
              onClick={() => navigate('/admin')}
              className="shrink-0 flex items-center gap-1 font-semibold underline hover:no-underline"
            >
              <Crown className="h-3 w-3" /> Gérer
            </button>
          </div>
        )}
      </Section>

      {/* ── Password ── */}
      <PasswordSection />

      {/* ── Notifications ── */}
      <NotificationSection />

      {/* ── Quick navigation ── */}
      <Section title="Navigation rapide" icon={<Smartphone className="h-4 w-4" />}>
        <div className="space-y-2">
          <QuickLink icon={<Shield className="h-4 w-4" />} label="Sécurité & accès"       href="/securite" />
          <QuickLink icon={<Bell   className="h-4 w-4" />} label="Intelligence & alertes"  href="/intelligence" />
          {appRole === 'admin' && (
            <QuickLink icon={<Crown className="h-4 w-4" />} label="Administration — Gérer les utilisateurs" href="/admin" />
          )}
        </div>
      </Section>

      {/* ── Sign out ── */}
      <div className="pb-4">
        <button
          onClick={handleSignOut}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-red-200
            text-[#C62828] hover:bg-red-50 transition-colors text-sm font-medium"
        >
          <LogOut className="h-4 w-4" />
          Se déconnecter
        </button>
      </div>
    </motion.div>
  )
}
