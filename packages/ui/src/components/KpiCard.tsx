import React from 'react'
import { motion } from 'framer-motion'

export interface KpiCardProps {
  title: string
  value: string | number
  unit?: string
  trend?: 'up' | 'down' | 'neutral'
  trendValue?: string
  icon: React.ReactNode
  color?: string
  delay?: number
}

const trendConfig = {
  up: { color: '#16a34a', bg: '#dcfce7', arrow: '↑' },
  down: { color: '#dc2626', bg: '#fee2e2', arrow: '↓' },
  neutral: { color: '#6b7280', bg: '#f3f4f6', arrow: '→' },
}

export function KpiCard({ title, value, unit, trend, trendValue, icon, color = '#C62828', delay = 0 }: KpiCardProps) {
  const t = trend ? trendConfig[trend] : null

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay, ease: 'easeOut' }}
      className="bg-white rounded-xl border border-gray-100 shadow-sm p-5 flex items-start gap-4"
    >
      {/* Icon */}
      <div
        className="flex items-center justify-center rounded-xl shrink-0"
        style={{ width: 48, height: 48, backgroundColor: `${color}15` }}
      >
        <span style={{ color }}>{icon}</span>
      </div>

      {/* Content */}
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-gray-500 truncate">{title}</p>
        <div className="flex items-baseline gap-1 mt-0.5">
          <span className="text-2xl font-bold text-[#212121]">{value}</span>
          {unit && <span className="text-sm font-medium text-gray-400">{unit}</span>}
        </div>

        {t && trendValue && (
          <div
            className="inline-flex items-center gap-1 mt-1.5 px-2 py-0.5 rounded-full text-xs font-semibold"
            style={{ color: t.color, backgroundColor: t.bg }}
          >
            <span>{t.arrow}</span>
            <span>{trendValue}</span>
          </div>
        )}
      </div>
    </motion.div>
  )
}
