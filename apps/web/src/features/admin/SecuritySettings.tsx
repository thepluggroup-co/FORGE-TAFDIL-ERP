import React, { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { Shield, Clock, Lock, AlertTriangle, TrendingDown, Users, CheckCircle } from 'lucide-react'
import { Button } from '@forge/ui'
import { useSecuritySettings, useLoginStats } from '@/hooks/useRbac'

// ── NumberInput ───────────────────────────────────────────────────────────────

function NumberInput({
  label, value, onChange, min, max, unit,
}: {
  label: string
  value: number
  onChange: (v: number) => void
  min?: number
  max?: number
  unit?: string
}) {
  return (
    <label className="flex items-center justify-between gap-4">
      <span className="text-sm text-gray-700">{label}</span>
      <div className="flex items-center gap-1">
        <input
          type="number"
          min={min}
          max={max}
          value={value}
          onChange={e => onChange(Number(e.target.value))}
          className="w-20 px-2 py-1.5 border border-gray-200 rounded-lg text-sm text-right focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        {unit && <span className="text-xs text-gray-500">{unit}</span>}
      </div>
    </label>
  )
}

// ── Toggle ────────────────────────────────────────────────────────────────────

function Toggle({
  label, checked, onChange,
}: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center justify-between gap-4 cursor-pointer">
      <span className="text-sm text-gray-700">{label}</span>
      <button
        type="button"
        onClick={() => onChange(!checked)}
        className={`w-11 h-6 rounded-full transition-colors ${checked ? 'bg-blue-600' : 'bg-gray-300'}`}
      >
        <span
          className={`block w-5 h-5 rounded-full bg-white shadow transition-transform mx-0.5 ${checked ? 'translate-x-5' : 'translate-x-0'}`}
        />
      </button>
    </label>
  )
}

// ── StatCard ──────────────────────────────────────────────────────────────────

function StatCard({
  icon, label, value, color,
}: { icon: React.ReactNode; label: string; value: number | null; color: string }) {
  return (
    <div className={`rounded-xl p-4 border ${color}`}>
      <div className="flex items-center gap-2 mb-1">
        {icon}
        <span className="text-xs font-medium">{label}</span>
      </div>
      <p className="text-2xl font-bold">{value ?? '—'}</p>
    </div>
  )
}

// ── SecuritySettings ──────────────────────────────────────────────────────────

export function SecuritySettings() {
  const { data: settings, loading, save } = useSecuritySettings()
  const { data: stats, loading: statsLoading, refetch: refetchStats } = useLoginStats()
  const [saving, setSaving] = useState(false)

  // Local form state mirrors the settings object
  const [form, setForm] = useState({
    password_min_length:      8,
    password_require_upper:   true,
    password_require_number:  true,
    password_require_special: false,
    password_expiration_days: 90,
    max_login_attempts:       5,
    lockout_duration_minutes: 30,
    session_timeout_minutes:  60,
    allowed_hours_enabled:    false,
    allowed_hours_start:      '08:00',
    allowed_hours_end:        '18:00',
    allowed_days:             '1,2,3,4,5',
  })

  useEffect(() => {
    if (settings) setForm({ ...settings })
  }, [settings])

  async function handleSave() {
    setSaving(true)
    try {
      await save({
        passwordMinLength:      form.password_min_length,
        passwordRequireUpper:   form.password_require_upper,
        passwordRequireNumber:  form.password_require_number,
        passwordRequireSpecial: form.password_require_special,
        passwordExpirationDays: form.password_expiration_days,
        maxLoginAttempts:       form.max_login_attempts,
        lockoutDurationMinutes: form.lockout_duration_minutes,
        sessionTimeoutMinutes:  form.session_timeout_minutes,
        allowedHoursEnabled:    form.allowed_hours_enabled,
        allowedHoursStart:      form.allowed_hours_start,
        allowedHoursEnd:        form.allowed_hours_end,
        allowedDays:            form.allowed_days,
      })
    } finally {
      setSaving(false)
    }
  }

  const DAY_LABELS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim']
  const allowedDaysArr = form.allowed_days.split(',').filter(Boolean)

  function toggleDay(d: string) {
    const arr = form.allowed_days.split(',').filter(Boolean)
    const next = arr.includes(d) ? arr.filter(x => x !== d) : [...arr, d].sort()
    setForm(f => ({ ...f, allowed_days: next.join(',') }))
  }

  if (loading) {
    return <div className="flex justify-center py-12 text-gray-400">Chargement…</div>
  }

  return (
    <div className="space-y-6">
      {/* En-tête */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Shield className="w-6 h-6 text-gray-600" />
          <h1 className="text-xl font-bold text-gray-900">Paramètres de sécurité</h1>
        </div>
        <Button onClick={handleSave} disabled={saving} className="gap-2">
          <CheckCircle className="w-4 h-4" />
          {saving ? 'Sauvegarde…' : 'Enregistrer'}
        </Button>
      </div>

      {/* Stats 24h */}
      <div className="grid grid-cols-3 gap-4">
        <StatCard
          icon={<TrendingDown className="w-4 h-4 text-blue-600" />}
          label="Tentatives 24h"
          value={stats?.totalAttempts24h ?? null}
          color="border-blue-200 bg-blue-50 text-blue-800"
        />
        <StatCard
          icon={<AlertTriangle className="w-4 h-4 text-red-600" />}
          label="Échecs 24h"
          value={stats?.failedAttempts24h ?? null}
          color="border-red-200 bg-red-50 text-red-800"
        />
        <StatCard
          icon={<Users className="w-4 h-4 text-orange-600" />}
          label="Comptes bloqués"
          value={stats?.currentlyBlocked ?? null}
          color="border-orange-200 bg-orange-50 text-orange-800"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* Politique mot de passe */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white rounded-xl border border-gray-200 p-5 space-y-4"
        >
          <div className="flex items-center gap-2">
            <Lock className="w-5 h-5 text-gray-500" />
            <h2 className="font-semibold text-gray-900">Politique de mot de passe</h2>
          </div>

          <div className="space-y-3">
            <NumberInput
              label="Longueur minimale"
              value={form.password_min_length}
              onChange={v => setForm(f => ({ ...f, password_min_length: v }))}
              min={6} max={64} unit="car."
            />
            <NumberInput
              label="Expiration"
              value={form.password_expiration_days}
              onChange={v => setForm(f => ({ ...f, password_expiration_days: v }))}
              min={0} max={365} unit="jours"
            />
            <Toggle
              label="Majuscule obligatoire"
              checked={form.password_require_upper}
              onChange={v => setForm(f => ({ ...f, password_require_upper: v }))}
            />
            <Toggle
              label="Chiffre obligatoire"
              checked={form.password_require_number}
              onChange={v => setForm(f => ({ ...f, password_require_number: v }))}
            />
            <Toggle
              label="Caractère spécial obligatoire"
              checked={form.password_require_special}
              onChange={v => setForm(f => ({ ...f, password_require_special: v }))}
            />
          </div>
        </motion.div>

        {/* Politique de connexion */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05 }}
          className="bg-white rounded-xl border border-gray-200 p-5 space-y-4"
        >
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-gray-500" />
            <h2 className="font-semibold text-gray-900">Sécurité de connexion</h2>
          </div>

          <div className="space-y-3">
            <NumberInput
              label="Tentatives max. avant blocage"
              value={form.max_login_attempts}
              onChange={v => setForm(f => ({ ...f, max_login_attempts: v }))}
              min={1} max={20}
            />
            <NumberInput
              label="Durée blocage"
              value={form.lockout_duration_minutes}
              onChange={v => setForm(f => ({ ...f, lockout_duration_minutes: v }))}
              min={5} max={1440} unit="min"
            />
            <NumberInput
              label="Timeout session"
              value={form.session_timeout_minutes}
              onChange={v => setForm(f => ({ ...f, session_timeout_minutes: v }))}
              min={5} max={1440} unit="min"
            />
          </div>
        </motion.div>

        {/* Plages horaires */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="bg-white rounded-xl border border-gray-200 p-5 space-y-4 lg:col-span-2"
        >
          <div className="flex items-center gap-2">
            <Clock className="w-5 h-5 text-gray-500" />
            <h2 className="font-semibold text-gray-900">Restriction horaire</h2>
          </div>

          <Toggle
            label="Restreindre les connexions à des plages horaires"
            checked={form.allowed_hours_enabled}
            onChange={v => setForm(f => ({ ...f, allowed_hours_enabled: v }))}
          />

          {form.allowed_hours_enabled && (
            <div className="space-y-3 pl-1">
              <div className="flex items-center gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Heure début</label>
                  <input
                    type="time"
                    value={form.allowed_hours_start}
                    onChange={e => setForm(f => ({ ...f, allowed_hours_start: e.target.value }))}
                    className="px-2 py-1.5 border border-gray-200 rounded-lg text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Heure fin</label>
                  <input
                    type="time"
                    value={form.allowed_hours_end}
                    onChange={e => setForm(f => ({ ...f, allowed_hours_end: e.target.value }))}
                    className="px-2 py-1.5 border border-gray-200 rounded-lg text-sm"
                  />
                </div>
              </div>

              <div>
                <p className="text-xs font-medium text-gray-600 mb-2">Jours autorisés</p>
                <div className="flex gap-2">
                  {DAY_LABELS.map((label, i) => {
                    const d = String(i + 1)
                    return (
                      <button
                        key={d}
                        onClick={() => toggleDay(d)}
                        className={`w-10 h-10 rounded-lg text-xs font-medium transition-colors ${
                          allowedDaysArr.includes(d)
                            ? 'bg-blue-600 text-white'
                            : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                        }`}
                      >
                        {label}
                      </button>
                    )
                  })}
                </div>
              </div>
            </div>
          )}
        </motion.div>
      </div>
    </div>
  )
}
