import { NextRequest, NextResponse } from 'next/server'
import { forgeApiBaseUrl } from '@/lib/forge-api'

export async function GET(req: NextRequest) {
  try {
    const montant = req.nextUrl.searchParams.get('montant') ?? '0'
    const res = await fetch(
      `${forgeApiBaseUrl()}/api/shop/conditions-paiement?montant=${encodeURIComponent(montant)}`,
      { cache: 'no-store' },
    )
    const payload = await res.json().catch(() => ({}))
    return NextResponse.json(payload, { status: res.status })
  } catch {
    return NextResponse.json({ error: 'Erreur serveur', code: 'INTERNAL_ERROR' }, { status: 500 })
  }
}
