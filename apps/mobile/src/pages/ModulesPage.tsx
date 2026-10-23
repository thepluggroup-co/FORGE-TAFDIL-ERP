import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { TopBar } from '../components/TopBar'
import { Card, Icon, type IconName } from '../components/ui'
import { usePermissions } from '../context/PermissionsContext'
import { fetchBonsSoumis } from '../lib/api'
import type { MobileScreen } from '@forge/shared'

interface ModuleTile { screen: MobileScreen; to: string; label: string; hint: string; icon: IconName }

const TILES: ModuleTile[] = [
  { screen: 'orders',       to: '/orders',       label: 'Commandes',   hint: 'Suivi des commandes clients', icon: 'cart' },
  { screen: 'stocks',       to: '/stocks',       label: 'Stocks',      hint: 'Matériaux et équipements',    icon: 'box' },
  { screen: 'factures',     to: '/factures',     label: 'Factures',    hint: 'Payées, en attente, en retard', icon: 'receipt' },
  { screen: 'performance',  to: '/performance',  label: 'Analytique',  hint: "Chiffre d'affaires",          icon: 'chart' },
  { screen: 'approbation',  to: '/approbation',  label: 'Approbation', hint: 'Bons de sortie à valider',    icon: 'check' },
  { screen: 'livraisons',   to: '/livraisons',   label: 'Livraisons',  hint: 'Mes livraisons',              icon: 'truck' },
  { screen: 'caisse',       to: '/caisse',       label: 'Caisse',      hint: 'Ventes et session',           icon: 'wallet' },
]

export function ModulesPage() {
  const navigate = useNavigate()
  const { canScreen } = usePermissions()
  const [pendingBons, setPendingBons] = useState(0)
  const canApprove = canScreen('approbation')

  useEffect(() => {
    if (!canApprove) return
    let cancelled = false
    fetchBonsSoumis().then((b) => { if (!cancelled) setPendingBons(b.length) }).catch(() => { /* hors ligne */ })
    return () => { cancelled = true }
  }, [canApprove])

  // Seuls les modules autorisés par les permissions du rôle (définies en base) sont proposés.
  const tiles = TILES.filter((t) => canScreen(t.screen))

  return (
    <div>
      <TopBar title="Modules" subtitle="Vos espaces de travail" />
      <div className="px-4 py-4 grid grid-cols-2 gap-3">
        {tiles.map((t) => (
          <Card key={t.to} onClick={() => navigate(t.to)} className="p-4">
            <div className="flex items-start justify-between">
              <span className="w-10 h-10 rounded-xl bg-red-50 text-[#C62828] flex items-center justify-center">
                <Icon name={t.icon} size={20} />
              </span>
              {t.screen === 'approbation' && pendingBons > 0 && (
                <span className="min-w-[20px] h-5 px-1.5 rounded-full bg-[#C62828] text-white text-[10px] font-bold flex items-center justify-center">
                  {pendingBons}
                </span>
              )}
            </div>
            <p className="mt-3 text-sm font-bold text-gray-900">{t.label}</p>
            <p className="text-[11px] text-gray-500 leading-snug">{t.hint}</p>
          </Card>
        ))}
        {tiles.length === 0 && (
          <p className="col-span-2 text-center text-sm text-gray-500 py-10">
            Aucun module n'est activé pour votre rôle. Contactez l'administrateur.
          </p>
        )}
      </div>
    </div>
  )
}
