import React from 'react'
import { useNavigate } from 'react-router-dom'
import { Icon } from './ui'

interface TopBarProps {
  title: string
  subtitle?: string
  /** Affiche la flèche de retour (retour à l'écran précédent). */
  back?: boolean
  /** Élément à droite (icône d'action : calendrier, filtre…). */
  right?: React.ReactNode
}

// En-tête clair de la maquette : titre à gauche, flèche de retour et action à droite optionnelles.
export function TopBar({ title, subtitle, back, right }: TopBarProps) {
  const navigate = useNavigate()
  return (
    <div className="bg-white safe-top px-4 pt-4 pb-3 border-b border-gray-100 flex items-center gap-3">
      {back && (
        <button type="button" onClick={() => navigate(-1)} aria-label="Retour" className="-ml-1 p-1 text-gray-900 active:opacity-60">
          <Icon name="back" size={22} />
        </button>
      )}
      <div className="flex-1 min-w-0">
        <h1 className="text-lg font-bold text-gray-900 truncate">{title}</h1>
        {subtitle && <p className="text-xs text-gray-500 truncate">{subtitle}</p>}
      </div>
      {right && <div className="shrink-0 text-gray-700">{right}</div>}
    </div>
  )
}
