'use client'

// MetalForge brand logo components — gear + Saturn-ring orbital design
// variant='color'  → black gear + red orbit  (light backgrounds, shop header)
// variant='white'  → white gear + red orbit  (dark backgrounds, shop footer)

const GEAR = [
  'M73.47,45.01 L81.76,46.1 L81.76,53.9 L73.47,54.99',
  'L72.83,57.42 L79.46,62.5 L75.56,69.26 L67.83,66.06',
  'L66.06,67.83 L69.26,75.56 L62.5,79.46 L57.42,72.83',
  'L54.99,73.47 L53.9,81.76 L46.1,81.76 L45.01,73.47',
  'L42.58,72.83 L37.5,79.46 L30.74,75.56 L33.94,67.83',
  'L32.17,66.06 L24.44,69.26 L20.54,62.5 L27.17,57.42',
  'L26.53,54.99 L18.24,53.9 L18.24,46.1 L26.53,45.01',
  'L27.17,42.58 L20.54,37.5 L24.44,30.74 L32.17,33.94',
  'L33.94,32.17 L30.74,24.44 L37.5,20.54 L42.58,27.17',
  'L45.01,26.53 L46.1,18.24 L53.9,18.24 L54.99,26.53',
  'L57.42,27.17 L62.5,20.54 L69.26,24.44 L66.06,32.17',
  'L67.83,33.94 L75.56,30.74 L79.46,37.5 L72.83,42.58 Z',
  'M50,39 A11,11,0,0,1,50,61 A11,11,0,0,1,50,39 Z',
].join(' ')

// Orbital ring — ellipse at (50,52), rx=44, ry=16, rotated -18°
// Split into bottom-half (behind gear) and top-half (in front of gear).
const ORBIT_BOTTOM = 'M6,52 A44,16,0,0,1,94,52'   // clockwise → sweeps through bottom
const ORBIT_TOP    = 'M94,52 A44,16,0,0,0,6,52'    // counterclockwise → sweeps through top
const ORBIT_ROTATE = 'rotate(-18,50,52)'

interface IconProps {
  size?: number
  variant?: 'color' | 'white'
  className?: string
}

/** Icon only — gear with Saturn-ring orbit. No text. */
export function MetalForgeIcon({ size = 40, variant = 'color', className }: IconProps) {
  const gear = variant === 'white' ? '#ffffff' : '#1a1a1a'
  const red  = '#C62828'

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      preserveAspectRatio="xMidYMid meet"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      {/* Bottom half of orbital ring — appears behind the gear */}
      <g transform={ORBIT_ROTATE}>
        <path d={ORBIT_BOTTOM} fill="none" stroke={red} strokeWidth="5.5" strokeLinecap="round" />
      </g>

      {/* Gear body with center hole */}
      <path fillRule="evenodd" fill={gear} d={GEAR} />

      {/* Top half of orbital ring — appears in front of the gear */}
      <g transform={ORBIT_ROTATE}>
        <path d={ORBIT_TOP} fill="none" stroke={red} strokeWidth="5.5" strokeLinecap="round" />
      </g>

      {/* Red accent dot — at the bottom of the orbit arc */}
      <circle cx="55" cy="67" r="5.5" fill={red} />
    </svg>
  )
}

interface LogoProps extends IconProps {
  showText?: boolean
}

/** Full horizontal logo: MetalForge icon + two-tone "METAL"/"FORGE" text. */
export function MetalForgeLogo({ size = 32, variant = 'color', showText = true, className }: LogoProps) {
  const primaryText   = variant === 'white' ? '#ffffff' : '#1a1a1a'

  return (
    <span className={`inline-flex items-center gap-2 ${className ?? ''}`}>
      <MetalForgeIcon size={size} variant={variant} />
      {showText && (
        <span className="font-black tracking-tight text-xl leading-none">
          <span style={{ color: primaryText }}>METAL</span>
          <span style={{ color: '#C62828' }}>FORGE</span>
        </span>
      )}
    </span>
  )
}

/** Compact logo for header: icon + "FORGE" + optional label */
export function MetalForgeHeaderLogo({ label = 'Shop' }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-2">
      <MetalForgeIcon size={28} variant="color" />
      <span className="font-bold tracking-tight text-xl leading-none">
        <span style={{ color: '#C62828' }}>FOR</span>
        <span className="text-forge-dark">GE</span>
      </span>
      {label && (
        <span className="hidden text-sm font-medium text-forge-steel sm:block">{label}</span>
      )}
    </span>
  )
}
