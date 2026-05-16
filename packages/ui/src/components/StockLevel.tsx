import React from 'react'

export interface StockLevelProps {
  current: number
  alertThreshold: number
  criticalThreshold: number
  max: number
  unit?: string
  showLabel?: boolean
}

export function StockLevel({ current, alertThreshold, criticalThreshold, max, unit = '', showLabel = true }: StockLevelProps) {
  const pct = Math.min(100, (current / max) * 100)
  const alertPct = (alertThreshold / max) * 100
  const criticalPct = (criticalThreshold / max) * 100

  const color =
    current <= criticalThreshold
      ? '#dc2626'
      : current <= alertThreshold
      ? '#d97706'
      : '#16a34a'

  return (
    <div className="w-full">
      {/* Bar */}
      <div className="relative h-2.5 rounded-full bg-gray-100 overflow-hidden">
        {/* Zone fill */}
        <div
          className="absolute inset-y-0 left-0 rounded-full transition-all duration-500"
          style={{ width: `${pct}%`, backgroundColor: color }}
        />
        {/* Alert threshold marker */}
        <div
          className="absolute inset-y-0 w-px bg-amber-400 opacity-70"
          style={{ left: `${alertPct}%` }}
        />
        {/* Critical threshold marker */}
        <div
          className="absolute inset-y-0 w-px bg-red-500 opacity-70"
          style={{ left: `${criticalPct}%` }}
        />
      </div>

      {/* Label */}
      {showLabel && (
        <div className="flex justify-between mt-1">
          <span className="text-xs font-semibold" style={{ color }}>
            {current.toLocaleString('fr-CM')} {unit}
          </span>
          <span className="text-xs text-gray-400">
            / {max.toLocaleString('fr-CM')} {unit}
          </span>
        </div>
      )}
    </div>
  )
}
