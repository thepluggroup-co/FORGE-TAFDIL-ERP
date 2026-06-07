import React, { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  User, Mail, Shield, Key, Bell, LogOut,
  CheckCircle, ChevronRight, Lock, Crown,
  Phone, Save, Loader2, Globe, MapPin,
} from 'lucide-react'
import { Button } from '@forge/ui'
import { useAuth } from '@/context/AuthContext'
import { supabase } from '@/lib/supabase'
import { toast } from 'sonner'
import { useNavigate } from 'react-router-dom'
import { useProfile } from '@/hooks/useProfile'

// ── Role config ───────────────────────────────────────────────────────────────

const ROLE_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  admin:       { label: 'Admin',       color: '#C62828', bg: '#FFEBEE' },
  superviseur: { label: 'Superviseur', color: '#1d4ed8', bg: '#dbeafe' },
  operateur:   { label: 'Opérateur',   color: '#15803d', bg: '#dcfce7' },
  apprenant:   { label: 'Apprenant',   color: '#6b7280', bg: '#f3f4f6' },
}

// ── Shared field ──────────────────────────────────────────────────────────────

function Field({
  label, icon, children,
}: {
  label: string
  icon?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="space-y-1.5">
      <label className="flex items-center gap-1.5 text-[11px] font-semibold text-gray-500 uppercase tracking-wide">
        {icon && <span className="text-gray-400">{icon}</span>}
        {label}
      </label>
      {children}
    </div>
  )
}

const inputCls =
  'w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg ' +
  'focus:outline-none focus:ring-2 focus:ring-[#C62828] focus:border-transparent transition-shadow bg-white'

const inputIconCls =
  'w-full pl-9 pr-3 py-2.5 text-sm border border-gray-200 rounded-lg ' +
  'focus:outline-none focus:ring-2 focus:ring-[#C62828] focus:border-transparent transition-shadow bg-white'

// ══════════════════════════════════════════════════════════════════════════════
// TAB: PROFIL
// ══════════════════════════════════════════════════════════════════════════════

function TabProfil() {
  const { user, role: appRole } = useAuth()
  const { data: profile, loading, saving, update } = useProfile()

  const [nom,       setNom]       = useState('')
  const [telephone, setTelephone] = useState('')
  const [adresse,   setAdresse]   = useState('')
  const [dirty,     setDirty]     = useState(false)

  useEffect(() => {
    if (profile && !dirty) {
      setNom(profile.nom ?? '')
      setTelephone(profile.telephone ?? '')
      setAdresse(profile.adresse ?? '')
    }
  }, [profile, dirty])

  const roleConfig  = ROLE_CONFIG[appRole ?? ''] ?? ROLE_CONFIG['apprenant']
  const email       = user?.email ?? ''
  const displayName = nom.trim() || profile?.nom || email
  const initial     = displayName.charAt(0).toUpperCase()

  const mark = () => setDirty(true)

  const handleSave = async () => {
    await update({
      nom:       nom.trim() || undefined,
      telephone: telephone.trim() || null,
      adresse:   adresse.trim() || null,
    })
    setDirty(false)
  }

  const handleCancel = () => {
    setNom(profile?.nom ?? '')
    setTelephone(profile?.telephone ?? '')
    setAdresse(profile?.adresse ?? '')
    setDirty(false)
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-gray-400 text-sm py-8 justify-center">
        <Loader2 className="h-4 w-4 animate-spin" /> Chargement du profil…
      </div>
    )
  }

  return (
    <div className="space-y-8">

      {/* Avatar + identité */}
      <div className="flex items-center gap-5">
        <div
          className="flex items-center justify-center w-20 h-20 rounded-full text-white text-3xl font-bold shrink-0 select-none shadow-md"
          style={{ backgroundColor: roleConfig.color }}
        >
          {initial}
        </div>
        <div className="min-w-0">
          <p className="text-lg font-bold text-[#212121] truncate">{displayName}</p>
          <p className="text-sm text-gray-400 truncate">{email}</p>
          <span
            className="inline-block mt-1.5 text-[11px] font-bold px-2.5 py-0.5 rounded-full"
            style={{ color: roleConfig.color, backgroundColor: roleConfig.bg }}
          >
            {roleConfig.label}
          </span>
        </div>
      </div>

      <div className="border-t border-gray-100" />

      {/* Grille de champs — 2 colonnes sur md+ */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">

        {/* Email — lecture seule */}
        <Field label="Adresse e-mail" icon={<Mail className="h-3.5 w-3.5" />}>
          <div className="flex items-center gap-2 px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-lg">
            <Mail className="h-4 w-4 text-gray-400 shrink-0" />
            <span className="text-sm text-gray-500 flex-1 truncate">{email}</span>
            <span className="flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded-full text-green-700 bg-green-100 shrink-0">
              <CheckCircle className="h-3 w-3" /> Vérifié
            </span>
          </div>
        </Field>

        {/* Nom complet */}
        <Field label="Nom complet" icon={<User className="h-3.5 w-3.5" />}>
          <div className="relative">
            <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" />
            <input
              type="text"
              value={nom}
              onChange={(e) => { setNom(e.target.value); mark() }}
              placeholder="Votre nom complet"
              className={inputIconCls}
            />
          </div>
        </Field>

        {/* Téléphone */}
        <Field label="Téléphone" icon={<Phone className="h-3.5 w-3.5" />}>
          <div className="relative">
            <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" />
            <input
              type="tel"
              value={telephone}
              onChange={(e) => { setTelephone(e.target.value); mark() }}
              placeholder="+237 6XX XXX XXX"
              className={inputIconCls}
            />
          </div>
        </Field>

        {/* Adresse — pleine largeur sur les 2 colonnes */}
        <Field label="Adresse" icon={<MapPin className="h-3.5 w-3.5" />}>
          <div className="relative">
            <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" />
            <input
              type="text"
              value={adresse}
              onChange={(e) => { setAdresse(e.target.value); mark() }}
              placeholder="Quartier, Ville, Pays"
              className={inputIconCls}
            />
          </div>
        </Field>

      </div>

      {/* Actions */}
      <div className="flex items-center gap-3 pt-2 border-t border-gray-100">
        <Button onClick={handleSave} disabled={!dirty || saving}>
          {saving
            ? <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5 inline" />Sauvegarde…</>
            : <><Save className="h-3.5 w-3.5 mr-1.5 inline" />Enregistrer les modifications</>
          }
        </Button>
        {dirty && (
          <button onClick={handleCancel} className="text-sm text-gray-400 hover:text-gray-600 transition-colors">
            Annuler
          </button>
        )}
      </div>

    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// TAB: SÉCURITÉ
// ══════════════════════════════════════════════════════════════════════════════

function TabSecurite() {
  const [currentPwd, setCurrentPwd] = useState('')
  const [newPwd,     setNewPwd]     = useState('')
  const [confirmPwd, setConfirmPwd] = useState('')
  const [saving,     setSaving]     = useState(false)

  const pwdOk = newPwd.length >= 8 && newPwd === confirmPwd && Boolean(currentPwd)

  const handleChange = async () => {
    if (!pwdOk) return
    setSaving(true)
    const { error } = await supabase.auth.updateUser({ password: newPwd })
    setSaving(false)
    if (error) { toast.error(error.message); return }
    toast.success('Mot de passe mis à jour')
    setCurrentPwd(''); setNewPwd(''); setConfirmPwd('')
  }

  return (
    <div className="max-w-lg space-y-6">

      <div>
        <h3 className="text-sm font-semibold text-[#212121] mb-4">Changer le mot de passe</h3>
        <div className="space-y-4">

          <Field label="Mot de passe actuel" icon={<Key className="h-3.5 w-3.5" />}>
            <input
              type="password"
              value={currentPwd}
              onChange={(e) => setCurrentPwd(e.target.value)}
              placeholder="••••••••"
              className={inputCls}
            />
          </Field>

          <Field label="Nouveau mot de passe" icon={<Key className="h-3.5 w-3.5" />}>
            <input
              type="password"
              value={newPwd}
              onChange={(e) => setNewPwd(e.target.value)}
              placeholder="••••••••"
              className={inputCls}
            />
            {newPwd && newPwd.length < 8 && (
              <p className="text-xs text-amber-600 mt-1">Au moins 8 caractères requis</p>
            )}
          </Field>

          <Field label="Confirmer le nouveau mot de passe" icon={<Key className="h-3.5 w-3.5" />}>
            <input
              type="password"
              value={confirmPwd}
              onChange={(e) => setConfirmPwd(e.target.value)}
              placeholder="••••••••"
              className={inputCls}
            />
            {confirmPwd && newPwd !== confirmPwd && (
              <p className="text-xs text-red-600 mt-1">Les mots de passe ne correspondent pas</p>
            )}
          </Field>

          <div className="pt-1">
            <Button disabled={!pwdOk || saving} onClick={handleChange}>
              {saving ? 'Mise à jour…' : 'Changer le mot de passe'}
            </Button>
          </div>

        </div>
      </div>

      {/* Conseils */}
      <div className="rounded-xl border border-blue-100 bg-blue-50 p-4 text-xs text-blue-700 space-y-1">
        <p className="font-semibold">Conseils pour un mot de passe fort</p>
        <ul className="list-disc ml-4 space-y-0.5 text-blue-600">
          <li>Au moins 12 caractères</li>
          <li>Majuscules, minuscules, chiffres et symboles</li>
          <li>Ne pas réutiliser un ancien mot de passe</li>
        </ul>
      </div>

    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// TAB: PERMISSIONS
// ══════════════════════════════════════════════════════════════════════════════

const PERMS_LIST = [
  { label: 'Stocks & Inventaire',    roles: ['admin', 'superviseur', 'operateur'] },
  { label: 'Commandes & Devis',       roles: ['admin', 'superviseur', 'operateur'] },
  { label: 'Finance & Comptabilité',  roles: ['admin', 'superviseur'] },
  { label: 'Ressources Humaines',     roles: ['admin', 'superviseur'] },
  { label: 'Intelligence IA',         roles: ['admin', 'superviseur'] },
  { label: 'Rapports & Exports',      roles: ['admin', 'superviseur'] },
  { label: 'Production',              roles: ['admin', 'superviseur', 'operateur'] },
  { label: 'Logistique & Livraisons', roles: ['admin', 'superviseur', 'operateur'] },
  { label: 'Paramètres système',      roles: ['admin'] },
  { label: 'Gestion utilisateurs',    roles: ['admin'] },
]

function TabPermissions() {
  const { role: appRole } = useAuth()
  const navigate = useNavigate()
  const roleConfig = ROLE_CONFIG[appRole ?? ''] ?? ROLE_CONFIG['apprenant']

  return (
    <div className="space-y-6">

      <div className="flex items-center gap-3">
        <span
          className="text-sm font-bold px-3 py-1 rounded-full"
          style={{ color: roleConfig.color, backgroundColor: roleConfig.bg }}
        >
          {roleConfig.label}
        </span>
        <span className="text-sm text-gray-400">Accès de votre compte</span>
      </div>

      {/* Grille 2 colonnes */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {PERMS_LIST.map(({ label, roles }) => {
          const ok = roles.includes(appRole ?? '')
          return (
            <div
              key={label}
              className={`flex items-center gap-3 px-4 py-3 rounded-xl border transition-colors ${
                ok
                  ? 'border-green-100 bg-green-50 text-[#212121]'
                  : 'border-gray-100 bg-gray-50 text-gray-400'
              }`}
            >
              <div className={`w-2 h-2 rounded-full shrink-0 ${ok ? 'bg-green-500' : 'bg-gray-300'}`} />
              <span className={`text-sm ${ok ? 'font-medium' : ''} flex-1`}>{label}</span>
              {ok && <CheckCircle className="h-3.5 w-3.5 text-green-500 shrink-0" />}
            </div>
          )
        })}
      </div>

      {appRole === 'admin' && (
        <div className="flex items-center justify-between gap-4 p-4 bg-[#FFEBEE] border border-[#FFCDD2] rounded-xl text-sm text-[#C62828]">
          <div>
            <p className="font-semibold">Accès administrateur complet</p>
            <p className="text-xs mt-0.5 text-[#C62828]/70">Vous pouvez inviter des utilisateurs et modifier leurs rôles depuis l'administration.</p>
          </div>
          <button
            onClick={() => navigate('/admin')}
            className="shrink-0 flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg bg-[#C62828] text-white hover:bg-[#B71C1C] transition-colors"
          >
            <Crown className="h-3.5 w-3.5" /> Gérer
          </button>
        </div>
      )}

    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// TAB: PRÉFÉRENCES
// ══════════════════════════════════════════════════════════════════════════════

const PREF_DEFAULTS = {
  stocks_critiques:    true,
  nouvelles_commandes: true,
  alertes_ia:          true,
  resume_quotidien:    false,
  langue:              'fr' as 'fr' | 'en',
}
type Prefs = typeof PREF_DEFAULTS

function useLocalPrefs(userId: string) {
  const key = `forge_prefs_${userId}`
  const [prefs, setPrefs] = useState<Prefs>(() => {
    try {
      const raw = localStorage.getItem(key)
      if (raw) return { ...PREF_DEFAULTS, ...(JSON.parse(raw) as Partial<Prefs>) }
    } catch {}
    return PREF_DEFAULTS
  })
  const setPref = <K extends keyof Prefs>(field: K, value: Prefs[K]) => {
    setPrefs(prev => {
      const next = { ...prev, [field]: value }
      localStorage.setItem(key, JSON.stringify(next))
      return next
    })
  }
  return { prefs, setPref }
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={onChange}
      className="relative inline-flex h-5 w-9 shrink-0 rounded-full border-2 border-transparent transition-colors"
      style={{ backgroundColor: checked ? '#C62828' : '#e5e7eb' }}
    >
      <span
        className="block h-4 w-4 rounded-full bg-white shadow transition-transform duration-200"
        style={{ transform: checked ? 'translateX(16px)' : 'translateX(0)' }}
      />
    </button>
  )
}

function TabPreferences({ userId }: { userId: string }) {
  const { prefs, setPref } = useLocalPrefs(userId)

  const notifications: Array<{ key: keyof Prefs; label: string; desc: string }> = [
    { key: 'stocks_critiques',    label: 'Alertes stocks critiques', desc: 'Quand un produit atteint son seuil critique' },
    { key: 'nouvelles_commandes', label: 'Nouvelles commandes',       desc: 'À chaque nouvelle commande ERP ou web' },
    { key: 'alertes_ia',          label: 'Alertes Intelligence IA',   desc: 'Alertes proactives générées par FORGE AI' },
    { key: 'resume_quotidien',    label: 'Résumé quotidien',          desc: 'Rapport journalier envoyé chaque matin' },
  ]

  return (
    <div className="space-y-8 max-w-lg">

      {/* Langue */}
      <div>
        <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-3 flex items-center gap-1.5">
          <Globe className="h-3.5 w-3.5" /> Langue de l'interface
        </p>
        <div className="flex gap-2">
          {(['fr', 'en'] as const).map(lang => (
            <button
              key={lang}
              onClick={() => setPref('langue', lang)}
              className={`flex items-center gap-2 px-4 py-2.5 text-sm font-semibold rounded-xl border-2 transition-all ${
                prefs.langue === lang
                  ? 'bg-[#C62828] text-white border-[#C62828] shadow-sm'
                  : 'border-gray-200 text-gray-600 hover:bg-gray-50'
              }`}
            >
              <span className="text-base">{lang === 'fr' ? '🇫🇷' : '🇬🇧'}</span>
              {lang === 'fr' ? 'Français' : 'English'}
            </button>
          ))}
        </div>
      </div>

      {/* Notifications */}
      <div>
        <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-3 flex items-center gap-1.5">
          <Bell className="h-3.5 w-3.5" /> Notifications
        </p>
        <div className="space-y-1">
          {notifications.map(({ key, label, desc }) => (
            <div
              key={key}
              className="flex items-center justify-between gap-4 px-4 py-3 rounded-xl hover:bg-gray-50 transition-colors group cursor-pointer"
              onClick={() => setPref(key, !(prefs[key] as boolean) as Prefs[typeof key])}
            >
              <div>
                <p className="text-sm font-medium text-[#212121] group-hover:text-[#C62828] transition-colors">{label}</p>
                <p className="text-xs text-gray-400 mt-0.5">{desc}</p>
              </div>
              <Toggle
                checked={prefs[key] as boolean}
                onChange={() => setPref(key, !(prefs[key] as boolean) as Prefs[typeof key])}
              />
            </div>
          ))}
        </div>
        <p className="text-xs text-gray-400 mt-3 px-4">
          Sauvegardées localement sur cet appareil.
        </p>
      </div>

    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// ONGLETS CONFIG
// ══════════════════════════════════════════════════════════════════════════════

type TabKey = 'profil' | 'securite' | 'permissions' | 'preferences'

const TABS: Array<{ key: TabKey; label: string; icon: React.ReactNode }> = [
  { key: 'profil',      label: 'Profil',       icon: <User  className="h-4 w-4" /> },
  { key: 'securite',    label: 'Sécurité',     icon: <Key   className="h-4 w-4" /> },
  { key: 'permissions', label: 'Permissions',  icon: <Lock  className="h-4 w-4" /> },
  { key: 'preferences', label: 'Préférences',  icon: <Bell  className="h-4 w-4" /> },
]

// ══════════════════════════════════════════════════════════════════════════════
// PAGE PRINCIPALE
// ══════════════════════════════════════════════════════════════════════════════

export default function Account() {
  const { user, role: appRole, signOut } = useAuth()
  const { data: profile } = useProfile()
  const navigate = useNavigate()
  const [activeTab, setActiveTab] = useState<TabKey>('profil')
  const tabBarRef = useRef<HTMLDivElement>(null)

  const roleConfig  = ROLE_CONFIG[appRole ?? ''] ?? ROLE_CONFIG['apprenant']
  const displayName = profile?.nom?.trim() || user?.email || 'U'
  const initial     = displayName.charAt(0).toUpperCase()

  const handleSignOut = async () => {
    await signOut()
    navigate('/login')
  }

  // Scroll active tab into view on mobile
  useEffect(() => {
    if (!tabBarRef.current) return
    const el = tabBarRef.current.querySelector('[data-active="true"]') as HTMLElement | null
    el?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' })
  }, [activeTab])

  const renderContent = () => {
    switch (activeTab) {
      case 'profil':      return <TabProfil />
      case 'securite':    return <TabSecurite />
      case 'permissions': return <TabPermissions />
      case 'preferences': return <TabPreferences userId={user?.id ?? ''} />
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.25 }}
      className="h-full flex flex-col"
    >

      {/* ── Header ── */}
      <div className="mb-5">
        <h1 className="text-xl font-bold text-[#212121]">Mon compte</h1>
        <p className="text-sm text-gray-400 mt-0.5">Gérez votre profil, votre sécurité et vos préférences</p>
      </div>

      {/* ── Layout principal ── */}
      <div className="flex flex-col lg:flex-row gap-4 flex-1 min-h-0">

        {/* ── Sidebar gauche (desktop) ── */}
        <aside className="hidden lg:flex flex-col w-60 shrink-0 gap-2">

          {/* Carte identité */}
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 text-center">
            <div
              className="mx-auto flex items-center justify-center w-16 h-16 rounded-full text-white text-2xl font-bold select-none shadow"
              style={{ backgroundColor: roleConfig.color }}
            >
              {initial}
            </div>
            <p className="mt-2 text-sm font-semibold text-[#212121] truncate">{displayName}</p>
            {profile?.nom && (
              <p className="text-xs text-gray-400 truncate">{user?.email}</p>
            )}
            <span
              className="inline-block mt-1.5 text-[11px] font-bold px-2.5 py-0.5 rounded-full"
              style={{ color: roleConfig.color, backgroundColor: roleConfig.bg }}
            >
              {roleConfig.label}
            </span>
          </div>

          {/* Navigation onglets */}
          <nav className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
            {TABS.map(({ key, label, icon }) => {
              const active = activeTab === key
              return (
                <button
                  key={key}
                  onClick={() => setActiveTab(key)}
                  className={`w-full flex items-center gap-3 px-4 py-3 text-sm font-medium transition-colors text-left border-l-2 ${
                    active
                      ? 'border-[#C62828] text-[#C62828] bg-[#FFEBEE]'
                      : 'border-transparent text-gray-600 hover:bg-gray-50 hover:text-[#212121]'
                  }`}
                >
                  <span className={active ? 'text-[#C62828]' : 'text-gray-400'}>{icon}</span>
                  {label}
                  {active && <ChevronRight className="ml-auto h-3.5 w-3.5 text-[#C62828]" />}
                </button>
              )
            })}
          </nav>

          {/* Navigation rapide */}
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="px-4 py-2.5 border-b border-gray-50">
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Navigation rapide</p>
            </div>
            <button
              onClick={() => navigate('/securite')}
              className="w-full flex items-center gap-3 px-4 py-2.5 text-xs text-gray-500 hover:bg-gray-50 hover:text-[#212121] transition-colors text-left"
            >
              <Shield className="h-3.5 w-3.5 text-gray-400" /> Sécurité & accès
            </button>
            {appRole === 'admin' && (
              <button
                onClick={() => navigate('/admin')}
                className="w-full flex items-center gap-3 px-4 py-2.5 text-xs text-gray-500 hover:bg-gray-50 hover:text-[#C62828] transition-colors text-left"
              >
                <Crown className="h-3.5 w-3.5 text-gray-400" /> Administration
              </button>
            )}
          </div>

          {/* Déconnexion */}
          <button
            onClick={handleSignOut}
            className="flex items-center gap-2.5 px-4 py-3 rounded-xl border border-red-100 text-[#C62828]
              hover:bg-red-50 transition-colors text-sm font-medium bg-white shadow-sm"
          >
            <LogOut className="h-4 w-4" />
            Se déconnecter
          </button>

        </aside>

        {/* ── Contenu principal ── */}
        <div className="flex-1 min-w-0 flex flex-col gap-4">

          {/* Onglets horizontaux (mobile/tablet) */}
          <div
            ref={tabBarRef}
            className="lg:hidden flex gap-1.5 overflow-x-auto pb-1 scrollbar-hide bg-white rounded-xl border border-gray-100 shadow-sm p-1.5"
          >
            {TABS.map(({ key, label, icon }) => {
              const active = activeTab === key
              return (
                <button
                  key={key}
                  data-active={active}
                  onClick={() => setActiveTab(key)}
                  className={`flex items-center gap-2 px-3.5 py-2 text-sm font-medium rounded-lg whitespace-nowrap transition-all shrink-0 ${
                    active
                      ? 'bg-[#C62828] text-white shadow-sm'
                      : 'text-gray-500 hover:bg-gray-50 hover:text-[#212121]'
                  }`}
                >
                  <span className={active ? 'text-white' : 'text-gray-400'}>{icon}</span>
                  {label}
                </button>
              )
            })}
          </div>

          {/* Panneau du tab actif */}
          <div className="flex-1 bg-white rounded-xl border border-gray-100 shadow-sm p-5 md:p-6 overflow-y-auto">
            <AnimatePresence mode="wait">
              <motion.div
                key={activeTab}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.18 }}
              >
                {renderContent()}
              </motion.div>
            </AnimatePresence>
          </div>

          {/* Déconnexion mobile — en bas de page */}
          <div className="lg:hidden">
            <button
              onClick={handleSignOut}
              className="w-full flex items-center justify-center gap-2.5 px-4 py-3 rounded-xl
                border border-red-100 text-[#C62828] hover:bg-red-50 transition-colors text-sm font-medium bg-white shadow-sm"
            >
              <LogOut className="h-4 w-4" />
              Se déconnecter
            </button>
          </div>

        </div>
      </div>

    </motion.div>
  )
}
