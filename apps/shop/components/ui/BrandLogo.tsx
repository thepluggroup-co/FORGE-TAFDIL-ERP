'use client'

import type { CSSProperties } from 'react'

interface IconProps {
  size?: number
  variant?: 'color' | 'white'
  className?: string
}

interface LogoProps extends IconProps {
  showText?: boolean
}

function logoStyle(size: number, variant: IconProps['variant'] = 'color'): CSSProperties {
  return {
    width: Math.round(size * 1.65),
    height: Math.round(size * 1.65),
    objectFit: 'contain',
    backgroundColor: variant === 'white' ? '#ffffff' : 'transparent',
    borderRadius: variant === 'white' ? 8 : 0,
  }
}

export function MetalForgeIcon({ size = 40, variant = 'color', className }: IconProps) {
  return (
    <img
      src="/tafdil-logo.png"
      alt="TAFDIL"
      className={className}
      style={logoStyle(size, variant)}
    />
  )
}

export function MetalForgeLogo({ size = 32, variant = 'color', className }: LogoProps) {
  return (
    <span className={`inline-flex items-center ${className ?? ''}`}>
      <img
        src="/tafdil-logo.png"
        alt="TAFDIL"
        style={logoStyle(size, variant)}
      />
    </span>
  )
}

export function MetalForgeHeaderLogo({ label = 'Shop' }: { label?: string }) {
  return (
    <span className="inline-flex items-center">
      <img
        src="/tafdil-logo.png"
        alt={label ? `TAFDIL ${label}` : 'TAFDIL'}
        style={logoStyle(32, 'color')}
      />
    </span>
  )
}
