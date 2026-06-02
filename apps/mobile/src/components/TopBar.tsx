import React from 'react'

interface TopBarProps {
  title: string
  subtitle?: string
}

export function TopBar({ title, subtitle }: TopBarProps) {
  return (
    <div className="bg-[#C62828] safe-top px-4 pt-4 pb-4 shadow-sm">
      <p className="text-xs font-medium text-red-200 uppercase tracking-widest">
        {subtitle ?? 'FORGE'}
      </p>
      <h1 className="text-xl font-bold text-white mt-0.5">{title}</h1>
    </div>
  )
}
