import React from 'react'
import type { OrderStatus } from '@forge/shared'

type BadgeVariant = 'default' | 'success' | 'warning' | 'danger' | 'info'

interface BadgeProps {
  variant?: BadgeVariant
  children: React.ReactNode
}

const variantClasses: Record<BadgeVariant, string> = {
  default: 'bg-gray-100 text-gray-700',
  success: 'bg-green-100 text-green-700',
  warning: 'bg-yellow-100 text-yellow-700',
  danger: 'bg-red-100 text-red-700',
  info: 'bg-blue-100 text-blue-700',
}

export function Badge({ variant = 'default', children }: BadgeProps) {
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium
      ${variantClasses[variant]}`}>
      {children}
    </span>
  )
}

const orderStatusVariant: Record<OrderStatus, BadgeVariant> = {
  draft: 'default',
  confirmed: 'info',
  in_production: 'warning',
  shipped: 'warning',
  delivered: 'success',
  cancelled: 'danger',
}

export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  const labels: Record<OrderStatus, string> = {
    draft: 'Brouillon',
    confirmed: 'Confirmé',
    in_production: 'En production',
    shipped: 'Expédié',
    delivered: 'Livré',
    cancelled: 'Annulé',
  }
  return <Badge variant={orderStatusVariant[status]}>{labels[status]}</Badge>
}
