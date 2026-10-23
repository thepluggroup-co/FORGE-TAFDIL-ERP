import React from 'react'

// ── Kit d'interface de l'application mobile (maquette « Forge Tafdil ERP mobile ») ──
// Fond clair, cartes blanches arrondies, rouge FORGE (#C62828) pour l'action, pastilles de statut
// teintées, graphiques SVG sans dépendance. Aucune donnée n'est inventée ici : tout est affichage.

export const RED = '#C62828'

// ── Formats ─────────────────────────────────────────────────────────────────
export function formatXAF(amount: number): string {
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(Math.round(amount)).replace(/\u202f|\u00a0/g, ' ') + ' FCFA'
}

export function formatNumber(n: number): string {
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(Math.round(n)).replace(/\u202f|\u00a0/g, ' ')
}

/** 42 580 000 → « 42,6 M ». */
export function formatCompact(n: number): string {
  const abs = Math.abs(n)
  if (abs >= 1_000_000_000) return (n / 1_000_000_000).toFixed(1).replace('.', ',') + ' Md'
  if (abs >= 1_000_000) return (n / 1_000_000).toFixed(1).replace('.', ',') + ' M'
  if (abs >= 1_000) return (n / 1_000).toFixed(0) + ' k'
  return String(Math.round(n))
}

export function formatDateShort(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' }).replace('.', '')
}

export function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  if (!Number.isFinite(diff) || diff < 0) return ''
  const min = Math.floor(diff / 60_000)
  if (min < 1) return "à l'instant"
  if (min < 60) return `il y a ${min} min`
  const h = Math.floor(min / 60)
  if (h < 24) return `il y a ${h} h`
  const d = Math.floor(h / 24)
  return d === 1 ? 'hier' : `il y a ${d} j`
}

/** Variation en % entre deux périodes ; null si la période de référence est vide (rien d'inventé). */
export function trendPct(current: number, previous: number): number | null {
  if (!previous) return null
  return Math.round(((current - previous) / previous) * 100)
}

// ── Icônes (SVG en ligne, trait 1.8) ────────────────────────────────────────
export type IconName =
  | 'home' | 'grid' | 'bell' | 'user' | 'back' | 'search' | 'calendar' | 'filter' | 'chart'
  | 'cart' | 'doc' | 'box' | 'truck' | 'check' | 'wallet' | 'shield' | 'settings' | 'help'
  | 'logout' | 'building' | 'eye' | 'eyeOff' | 'lock' | 'arrowUp' | 'arrowRight' | 'alert' | 'receipt'

const PATHS: Record<IconName, React.ReactNode> = {
  home: <path d="M3 11l9-8 9 8M5 10v10h14V10" />,
  grid: <><rect x="4" y="4" width="6" height="6" rx="1.5" /><rect x="14" y="4" width="6" height="6" rx="1.5" /><rect x="4" y="14" width="6" height="6" rx="1.5" /><rect x="14" y="14" width="6" height="6" rx="1.5" /></>,
  bell: <path d="M6 9a6 6 0 1112 0c0 6 2 7 2 7H4s2-1 2-7zM10 20a2 2 0 004 0" />,
  user: <><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 4-6 8-6s8 2 8 6" /></>,
  back: <path d="M15 5l-7 7 7 7" />,
  search: <><circle cx="11" cy="11" r="7" /><path d="M20 20l-4-4" /></>,
  calendar: <><rect x="4" y="5" width="16" height="15" rx="2" /><path d="M8 3v4M16 3v4M4 10h16" /></>,
  filter: <path d="M4 6h16M7 12h10M10 18h4" />,
  chart: <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />,
  cart: <><path d="M3 4h2l2.5 11h10L20 7H7" /><circle cx="9" cy="19" r="1.5" /><circle cx="17" cy="19" r="1.5" /></>,
  doc: <><path d="M7 3h7l5 5v13H7z" /><path d="M14 3v5h5M10 13h6M10 17h6" /></>,
  box: <path d="M3 8l9-5 9 5v8l-9 5-9-5zM3 8l9 5 9-5M12 13v8" />,
  truck: <><path d="M2 6h11v10H2zM13 10h4l3 3v3h-7" /><circle cx="7" cy="18" r="1.8" /><circle cx="17" cy="18" r="1.8" /></>,
  check: <path d="M5 12l5 5 9-10" />,
  wallet: <><path d="M3 7h16a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2z" /><path d="M3 7l12-3v3M16 14h3" /></>,
  shield: <path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" />,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2" /></>,
  help: <><circle cx="12" cy="12" r="9" /><path d="M9.5 9a2.5 2.5 0 115 0c0 1.5-2.5 2-2.5 3.5M12 17v.5" /></>,
  logout: <path d="M10 4H5v16h5M15 8l4 4-4 4M19 12H9" />,
  building: <path d="M4 21V5l8-2v18M12 9h8v12M7 8h2M7 12h2M7 16h2M15 13h2M15 17h2M2 21h20" />,
  eye: <><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></>,
  eyeOff: <><path d="M3 3l18 18M10.5 6.2A9.5 9.5 0 0112 6c6 0 10 6 10 6a17 17 0 01-3 3.5M6.5 7.5C3.8 9.3 2 12 2 12s4 7 10 7c1.5 0 2.9-.4 4.1-1" /></>,
  lock: <><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V8a4 4 0 018 0v3" /></>,
  arrowUp: <path d="M12 19V5M6 11l6-6 6 6" />,
  arrowRight: <path d="M5 12h14M13 6l6 6-6 6" />,
  alert: <><path d="M12 3l10 18H2z" /><path d="M12 10v5M12 18v.5" /></>,
  receipt: <><path d="M6 3h12v18l-3-2-3 2-3-2-3 2z" /><path d="M9 8h6M9 12h6" /></>,
}

export function Icon({ name, size = 20, className, strokeWidth = 1.8 }: {
  name: IconName; size?: number; className?: string; strokeWidth?: number
}) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      {PATHS[name]}
    </svg>
  )
}

// ── Blocs ───────────────────────────────────────────────────────────────────
export function Card({ children, className = '', onClick }: {
  children: React.ReactNode; className?: string; onClick?: () => void
}) {
  const Tag = onClick ? 'button' : 'div'
  return (
    <Tag
      onClick={onClick}
      className={`block w-full text-left bg-white rounded-2xl border border-gray-100 shadow-[0_1px_3px_rgba(16,24,40,0.06)] ${onClick ? 'active:bg-gray-50' : ''} ${className}`}
    >
      {children}
    </Tag>
  )
}

export function Avatar({ name, size = 40 }: { name: string; size?: number }) {
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('') || '?'
  return (
    <div
      style={{ width: size, height: size, fontSize: size * 0.38 }}
      className="rounded-full bg-[#C62828] text-white font-bold flex items-center justify-center shrink-0"
    >
      {initials}
    </div>
  )
}

export function SearchField({ value, onChange, placeholder }: {
  value: string; onChange: (v: string) => void; placeholder: string
}) {
  return (
    <div className="flex items-center gap-2 bg-gray-100 rounded-xl px-3 py-2.5 text-gray-400">
      <Icon name="search" size={18} />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="flex-1 bg-transparent text-sm text-gray-900 placeholder-gray-400 outline-none"
      />
    </div>
  )
}

export function ChipRow<T extends string>({ options, value, onChange }: {
  options: Array<{ value: T; label: string }>; value: T; onChange: (v: T) => void
}) {
  return (
    <div className="flex gap-2 overflow-x-auto no-scrollbar -mx-4 px-4">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={`shrink-0 rounded-full px-4 py-1.5 text-xs font-semibold transition-colors ${
            o.value === value ? 'bg-[#C62828] text-white' : 'bg-gray-100 text-gray-600 active:bg-gray-200'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export type PillTone = 'red' | 'green' | 'orange' | 'blue' | 'gray'

const PILL: Record<PillTone, string> = {
  red: 'bg-red-50 text-red-600',
  green: 'bg-green-50 text-green-700',
  orange: 'bg-orange-50 text-orange-600',
  blue: 'bg-blue-50 text-blue-700',
  gray: 'bg-gray-100 text-gray-600',
}

export function StatusPill({ label, tone }: { label: string; tone: PillTone }) {
  return <span className={`inline-block rounded-full px-3 py-1 text-[11px] font-semibold ${PILL[tone]}`}>{label}</span>
}

export function Trend({ pct }: { pct: number | null }) {
  if (pct === null) return null
  const up = pct >= 0
  return (
    <span className={`inline-flex items-center gap-0.5 text-[11px] font-semibold ${up ? 'text-green-600' : 'text-red-600'}`}>
      <Icon name="arrowUp" size={11} strokeWidth={2.4} className={up ? '' : 'rotate-180'} />
      {up ? '+' : ''}{pct}%
    </span>
  )
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="text-center py-12 px-6">
      <p className="text-sm font-semibold text-gray-700">{title}</p>
      {hint && <p className="mt-1 text-xs text-gray-400">{hint}</p>}
    </div>
  )
}

export function Spinner() {
  return (
    <div className="flex justify-center py-12">
      <div className="w-7 h-7 border-2 border-[#C62828] border-t-transparent rounded-full animate-spin" />
    </div>
  )
}

// ── Graphiques ──────────────────────────────────────────────────────────────
/** Courbe lissée. `values` doit contenir au moins 2 points ; sinon rien n'est dessiné. */
export function Sparkline({ values, width = 300, height = 70, stroke = RED, fill = true, labels }: {
  values: number[]; width?: number; height?: number; stroke?: string; fill?: boolean; labels?: string[]
}) {
  if (values.length < 2) return null
  const pad = 6
  const max = Math.max(...values)
  const min = Math.min(...values)
  const span = max - min || 1
  const pts = values.map((v, i) => [
    pad + (i * (width - pad * 2)) / (values.length - 1),
    pad + (1 - (v - min) / span) * (height - pad * 2),
  ] as const)
  const line = pts.map(([x, y], i) => (i === 0 ? `M${x},${y}` : `L${x},${y}`)).join(' ')
  const area = `${line} L${pts[pts.length - 1]![0]},${height} L${pts[0]![0]},${height} Z`
  const gid = `g${Math.abs(values.reduce((a, v) => a + v, 0)) % 9973}`
  return (
    <div>
      <svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height} preserveAspectRatio="none">
        <defs>
          <linearGradient id={gid} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={stroke} stopOpacity="0.35" />
            <stop offset="100%" stopColor={stroke} stopOpacity="0" />
          </linearGradient>
        </defs>
        {fill && <path d={area} fill={`url(#${gid})`} />}
        <path d={line} fill="none" stroke={stroke} strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" />
      </svg>
      {labels && (
        <div className="flex justify-between mt-1 text-[10px] text-gray-400">
          {labels.map((l) => <span key={l}>{l}</span>)}
        </div>
      )}
    </div>
  )
}

export interface DonutPart { label: string; value: number; color: string }

export function Donut({ parts, centerTop, centerBottom, size = 120 }: {
  parts: DonutPart[]; centerTop: string; centerBottom?: string; size?: number
}) {
  const total = parts.reduce((s, p) => s + p.value, 0)
  const r = 44
  const c = 2 * Math.PI * r
  let offset = 0
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg viewBox="0 0 120 120" width={size} height={size} className="-rotate-90">
        <circle cx="60" cy="60" r={r} fill="none" stroke="#F1F2F4" strokeWidth="16" />
        {total > 0 && parts.map((p) => {
          const len = (p.value / total) * c
          const el = (
            <circle key={p.label} cx="60" cy="60" r={r} fill="none" stroke={p.color} strokeWidth="16"
              strokeDasharray={`${len} ${c - len}`} strokeDashoffset={-offset} />
          )
          offset += len
          return el
        })}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-sm font-extrabold text-gray-900">{centerTop}</span>
        {centerBottom && <span className="text-[10px] text-gray-400">{centerBottom}</span>}
      </div>
    </div>
  )
}
