// Tafdil brand logo components — gear + circuit-orbit design
// variant='color'  → black gear + red orbit  (light backgrounds)
// variant='white'  → white gear + red orbit  (dark backgrounds like sidebar, login)

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
  // hub hole (even-odd creates transparent cutout)
  'M50,39 A11,11,0,0,1,50,61 A11,11,0,0,1,50,39 Z',
].join(' ')

interface IconProps {
  size?: number
  variant?: 'color' | 'white'
  className?: string
}

/** Icon only — gear + circuit-orbit arc. No text. */
export function TafdilIcon({ size = 40, variant = 'color', className }: IconProps) {
  const gear = variant === 'white' ? '#ffffff' : '#1a1a1a'
  const red  = '#C62828'

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      {/* Circuit-orbit arc — large sweep from lower-right to upper-left */}
      <path
        d="M 70 70 A 38 38 0 1 0 30 22"
        fill="none"
        stroke={red}
        strokeWidth="6"
        strokeLinecap="round"
      />
      {/* Gear body with center hole */}
      <path fillRule="evenodd" fill={gear} d={GEAR} />
      {/* Circuit node — hollow circle at arc endpoint */}
      <circle cx="30" cy="22" r="5" fill="none" stroke={red} strokeWidth="3" />
    </svg>
  )
}

interface LogoProps extends IconProps {
  /** Primary label (e.g. "FORGE") */
  title?: string
  /** Secondary subtitle (e.g. "ERP · TAFDIL") */
  subtitle?: string
}

/** Full horizontal logo — icon left, two-line text right. For sidebar expanded state. */
export function TafdilLogo({ size = 36, variant = 'color', title = 'FORGE', subtitle, className }: LogoProps) {
  const titleColor    = variant === 'white' ? '#ffffff' : '#1a1a1a'
  const subtitleColor = variant === 'white' ? 'rgba(255,255,255,0.45)' : 'rgba(0,0,0,0.45)'

  return (
    <span className={`inline-flex items-center gap-2.5 ${className ?? ''}`}>
      <TafdilIcon size={size} variant={variant} />
      <span className="flex flex-col leading-none">
        <span
          className="font-bold text-base leading-none tracking-tight"
          style={{ color: titleColor }}
        >
          <span style={{ color: '#C62828' }}>{title.slice(0, 3)}</span>
          {title.slice(3)}
        </span>
        {subtitle && (
          <span className="text-xs mt-0.5" style={{ color: subtitleColor }}>
            {subtitle}
          </span>
        )}
      </span>
    </span>
  )
}

/** Large centered logo for login / splash screens. */
export function TafdilLogoHero({ variant = 'white' }: Pick<IconProps, 'variant'>) {
  const titleColor    = variant === 'white' ? '#ffffff' : '#1a1a1a'
  const subtitleColor = variant === 'white' ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.4)'

  return (
    <div className="flex flex-col items-center gap-3">
      <TafdilIcon size={72} variant={variant} />
      <div className="text-center">
        <h1 className="text-4xl font-black tracking-tight" style={{ color: titleColor }}>
          <span style={{ color: '#C62828' }}>FOR</span>GE
        </h1>
        <p className="mt-1 text-sm" style={{ color: subtitleColor }}>
          ERP natif · TAFDIL · Douala
        </p>
      </div>
    </div>
  )
}
