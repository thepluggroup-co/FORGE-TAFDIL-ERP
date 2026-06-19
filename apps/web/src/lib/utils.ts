import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatXAF(amount: number): string {
  return new Intl.NumberFormat('fr-CM', {
    style: 'currency',
    currency: 'XAF',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount).replace(/[  ]/g, ' ')
}

export function formatNombre(n: number): string {
  return new Intl.NumberFormat('fr-CM', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(n).replace(/[  ]/g, ' ')
}

export function formatDate(iso: string): string {
  return new Intl.DateTimeFormat('fr-CM', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date(iso))
}

export function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat('fr-CM', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso))
}
