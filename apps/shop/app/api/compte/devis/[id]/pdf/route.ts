import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifyToken, COOKIE_NAME } from '@/lib/auth'
import { forgeApiBaseUrl } from '@/lib/forge-api'

// PDF d'un devis du client connecté (l'API vérifie que le devis lui appartient).
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const token   = cookies().get(COOKIE_NAME)?.value
  const session = token ? await verifyToken(token) : null
  if (!session) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })

  const res = await fetch(
    `${forgeApiBaseUrl()}/api/shop-client/clients/${encodeURIComponent(session.sub)}/devis/${encodeURIComponent(params.id)}/pdf`,
    { headers: { 'x-shop-secret': process.env.SHOP_API_SECRET ?? '' }, cache: 'no-store' },
  )
  if (!res.ok) return NextResponse.json(await res.json().catch(() => ({ error: 'PDF indisponible' })), { status: res.status })

  return new NextResponse(res.body, {
    headers: {
      'Content-Type':        'application/pdf',
      'Content-Disposition': res.headers.get('Content-Disposition') ?? 'inline',
      'Cache-Control':       'no-store',
    },
  })
}
