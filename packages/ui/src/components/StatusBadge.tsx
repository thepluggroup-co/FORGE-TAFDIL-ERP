import React from 'react'

export interface StatusConfig {
  label: string
  color: string
  bgColor: string
}

export type StatusMap = Record<string, StatusConfig>

export interface StatusBadgeProps {
  status: string
  map?: StatusMap
}

export const STOCK_STATUS_MAP: StatusMap = {
  normal:    { label: 'Normal',    color: '#15803d', bgColor: '#dcfce7' },
  alerte:    { label: 'Alerte',    color: '#d97706', bgColor: '#fef3c7' },
  critique:  { label: 'Critique',  color: '#dc2626', bgColor: '#fee2e2' },
  rupture:   { label: 'Rupture',   color: '#7f1d1d', bgColor: '#fecaca' },
}

export const BON_STATUS_MAP: StatusMap = {
  soumis:   { label: 'Soumis',   color: '#1d4ed8', bgColor: '#dbeafe' },
  valide:   { label: 'Validé',   color: '#15803d', bgColor: '#dcfce7' },
  execute:  { label: 'Exécuté',  color: '#6d28d9', bgColor: '#ede9fe' },
  annule:   { label: 'Annulé',   color: '#6b7280', bgColor: '#f3f4f6' },
}

export const CREDIT_STATUS_MAP: StatusMap = {
  en_cours:  { label: 'En cours',  color: '#1d4ed8', bgColor: '#dbeafe' },
  rembourse: { label: 'Remboursé', color: '#15803d', bgColor: '#dcfce7' },
  echu:      { label: 'Échu',      color: '#dc2626', bgColor: '#fee2e2' },
}

export const ORDER_STATUS_MAP: StatusMap = {
  draft:         { label: 'Brouillon',     color: '#6b7280', bgColor: '#f3f4f6' },
  confirmed:     { label: 'Confirmée',     color: '#1d4ed8', bgColor: '#dbeafe' },
  in_production: { label: 'En production', color: '#d97706', bgColor: '#fef3c7' },
  pret:          { label: 'Prête',         color: '#6d28d9', bgColor: '#ede9fe' },
  shipped:       { label: 'Expédiée',      color: '#0891b2', bgColor: '#cffafe' },
  delivered:     { label: 'Livrée',        color: '#15803d', bgColor: '#dcfce7' },
  cancelled:     { label: 'Annulée',       color: '#dc2626', bgColor: '#fee2e2' },
}

export const SHOP_COMMANDE_STATUS_MAP: StatusMap = {
  recue:          { label: 'Reçue',          color: '#1d4ed8', bgColor: '#dbeafe' },
  confirmee:      { label: 'Confirmée',      color: '#0891b2', bgColor: '#cffafe' },
  en_preparation: { label: 'En préparation', color: '#d97706', bgColor: '#fef3c7' },
  expediee:       { label: 'Expédiée',       color: '#6d28d9', bgColor: '#ede9fe' },
  livree:         { label: 'Livrée',         color: '#15803d', bgColor: '#dcfce7' },
  annulee:        { label: 'Annulée',        color: '#dc2626', bgColor: '#fee2e2' },
}

const DEFAULT_STATUS: StatusConfig = { label: 'Inconnu', color: '#6b7280', bgColor: '#f3f4f6' }

const COMBINED_MAP: StatusMap = {
  ...STOCK_STATUS_MAP,
  ...BON_STATUS_MAP,
  ...CREDIT_STATUS_MAP,
  ...ORDER_STATUS_MAP,
  ...SHOP_COMMANDE_STATUS_MAP,
}

export function StatusBadge({ status, map }: StatusBadgeProps) {
  const resolvedMap = map ?? COMBINED_MAP
  const config = resolvedMap[status] ?? DEFAULT_STATUS

  return (
    <span
      className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold whitespace-nowrap"
      style={{ color: config.color, backgroundColor: config.bgColor }}
    >
      {config.label}
    </span>
  )
}
