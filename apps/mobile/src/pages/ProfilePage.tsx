import React from 'react'
import { TopBar } from '../components/TopBar'
import { useAuth } from '../context/AuthContext'
import { APP_NAME, COMPANY_NAME, COMPANY_LOCATION } from '@forge/shared'

const roleLabel: Record<string, string> = {
  admin:       'Administrateur',
  superviseur: 'Superviseur',
  operateur:   'Opérateur',
  apprenant:   'Apprenant',
  livreur:     'Livreur',
}

export function ProfilePage() {
  const { user, logout } = useAuth()

  if (!user) return null

  return (
    <div>
      <TopBar title="Profil" />

      <div className="px-4 py-6 space-y-5">
        {/* Avatar + name */}
        <div className="flex flex-col items-center text-center">
          <div className="w-20 h-20 rounded-full bg-[#C62828] flex items-center justify-center text-white text-3xl font-bold">
            {user.name.charAt(0)}
          </div>
          <h2 className="mt-3 text-lg font-bold text-gray-900">{user.name}</h2>
          <p className="text-sm text-gray-500">{user.email}</p>
          <span className="mt-2 inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-[#C62828]/10 text-[#C62828]">
            {roleLabel[user.role]}
          </span>
        </div>

        {/* Company info */}
        <section className="bg-white rounded-xl border border-gray-100 shadow-sm divide-y divide-gray-100">
          <InfoRow label="Entreprise" value={COMPANY_NAME} />
          <InfoRow label="Localisation" value={COMPANY_LOCATION} />
          <InfoRow label="Application" value={APP_NAME} />
          <InfoRow label="Version" value="1.0.0" />
        </section>

        {/* Sign out */}
        <button
          onClick={logout}
          className="w-full py-3 rounded-xl border border-red-200 text-[#C62828] text-sm font-semibold bg-white active:bg-red-50 transition-colors"
        >
          Se déconnecter
        </button>
      </div>
    </div>
  )
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between px-4 py-3">
      <span className="text-sm text-gray-500">{label}</span>
      <span className="text-sm font-medium text-gray-900">{value}</span>
    </div>
  )
}
