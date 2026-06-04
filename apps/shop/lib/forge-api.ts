const PRODUCTION_API_URL = 'https://shimmering-balance-forge-tafdil.up.railway.app'

export function forgeApiBaseUrl(): string {
  const configured = process.env.FORGE_API_URL ?? process.env.NEXT_PUBLIC_API_URL

  if (configured && !(process.env.NODE_ENV === 'production' && configured.includes('localhost'))) {
    return configured.replace(/\/$/, '')
  }

  if (process.env.NODE_ENV === 'development') return 'http://localhost:3003'

  return PRODUCTION_API_URL
}
