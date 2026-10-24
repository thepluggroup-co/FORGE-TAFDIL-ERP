import React from 'react'
import { TopBar } from '../components/TopBar'
import { Avatar, Card, Icon, type IconName } from '../components/ui'
import { useAuth } from '../context/AuthContext'
import { APP_NAME, COMPANY_NAME, COMPANY_LOCATION, ROLE_LABELS } from '@forge/shared'

export function ProfilePage() {
  const { user, logout } = useAuth()
  if (!user) return null

  const rows: Array<{ icon: IconName; label: string; value: string }> = [
    { icon: 'user', label: 'Email', value: user.email },
    { icon: 'building', label: 'Société', value: COMPANY_NAME },
    { icon: 'home', label: 'Localisation', value: COMPANY_LOCATION },
    { icon: 'grid', label: 'Application', value: `${APP_NAME} 1.0.0` },
  ]

  return (
    <div>
      <TopBar title="Profil" />
      <div className="px-4 py-5 space-y-5">
        <div className="flex items-center gap-4">
          <Avatar name={user.name} size={64} />
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-gray-900 truncate">{user.name}</h2>
            <p className="text-sm text-gray-500">{ROLE_LABELS[user.role] ?? user.role}</p>
          </div>
        </div>

        <Card className="divide-y divide-gray-100">
          {rows.map((r) => (
            <div key={r.label} className="flex items-center gap-3 px-4 py-3.5">
              <span className="text-gray-500"><Icon name={r.icon} size={19} /></span>
              <span className="flex-1 text-sm text-gray-800">{r.label}</span>
              <span className="text-xs text-gray-500 truncate max-w-[55%]">{r.value}</span>
            </div>
          ))}
        </Card>

        <Card onClick={logout} className="px-4 py-3.5">
          <span className="flex items-center gap-3 text-sm font-semibold text-[#C62828]">
            <Icon name="logout" size={19} /> Déconnexion
          </span>
        </Card>
      </div>
    </div>
  )
}
