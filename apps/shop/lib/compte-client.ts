/**
 * Espace client — helpers CÔTÉ SERVEUR uniquement (routes /api et pages
 * serveur). Ne jamais importer depuis un composant client : SHOP_API_SECRET
 * ne doit pas partir dans le navigateur.
 */
import { NextResponse } from 'next/server'
import { forgeApiBaseUrl } from './forge-api'
import { signToken, COOKIE_NAME } from './auth'

export interface CompteClient {
  id:         string
  nom:        string | null
  email:      string | null
  telephone:  string | null
  avatar_url?: string | null
}

/** Appel à l'API FORGE réservée au serveur du shop (/api/shop-client/*). */
export async function appelApiClient<T>(chemin: string, init: RequestInit = {}): Promise<{ ok: boolean; status: number; data: T }> {
  const res = await fetch(`${forgeApiBaseUrl()}/api/shop-client${chemin}`, {
    ...init,
    headers: {
      'Content-Type':  'application/json',
      'x-shop-secret': process.env.SHOP_API_SECRET ?? '',
      ...(init.headers ?? {}),
    },
    cache: 'no-store',
  })
  const data = await res.json().catch(() => ({})) as T
  return { ok: res.ok, status: res.status, data }
}

/** Pose le cookie de session du shop (30 jours) — même session quel que soit le mode de connexion. */
export async function ouvrirSession(res: NextResponse, client: CompteClient): Promise<NextResponse> {
  const token = await signToken({
    sub:       client.id,
    telephone: client.telephone ?? undefined,
    email:     client.email ?? undefined,
    nom:       client.nom ?? undefined,
  })
  res.cookies.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure:   process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path:     '/',
    maxAge:   60 * 60 * 24 * 30,
  })
  return res
}

/** URL publique du shop (redirections OAuth). */
export function urlShop(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL ?? 'https://shop.tafdil.cm').replace(/\/$/, '')
}
