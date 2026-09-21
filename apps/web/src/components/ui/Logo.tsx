import type { CSSProperties } from 'react'

interface IconProps {
  size?: number
  variant?: 'color' | 'white'
  className?: string
}

interface LogoProps extends IconProps {
  title?: string
  subtitle?: string
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

export function TafdilIcon({ size = 40, variant = 'color', className }: IconProps) {
  return (
    <img
      src="/tafdil-logo.png"
      alt="TAFDIL"
      className={className}
      style={logoStyle(size, variant)}
    />
  )
}

export function TafdilLogo({ size = 36, variant = 'color', subtitle, className }: LogoProps) {
  return (
    <span className={`inline-flex items-center gap-2.5 ${className ?? ''}`}>
      <img
        src="/tafdil-logo.png"
        alt={subtitle ? `TAFDIL ${subtitle}` : 'TAFDIL'}
        style={logoStyle(size, variant)}
      />
    </span>
  )
}

export function TafdilLogoHero({ variant = 'white' }: Pick<IconProps, 'variant'>) {
  return (
    <div className="flex flex-col items-center gap-3">
      <img
        src="/tafdil-logo.png"
        alt="TAFDIL"
        style={logoStyle(72, variant)}
      />
    </div>
  )
}
