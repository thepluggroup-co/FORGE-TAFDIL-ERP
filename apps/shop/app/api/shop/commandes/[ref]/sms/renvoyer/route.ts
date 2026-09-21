import { NextRequest, NextResponse } from 'next/server'
import { forgeApiBaseUrl } from '@/lib/forge-api'

export async function POST(req: NextRequest, { params }: { params: { ref: string } }) {
  try {
    const body = await req.json().catch(() => ({}))
    const res = await fetch(`${forgeApiBaseUrl()}/api/shop/commandes/${params.ref}/sms/renvoyer`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
      cache:   'no-store',
    })

    const payload = await res.json().catch(() => ({}))
    return NextResponse.json(payload, { status: res.status })
  } catch {
    return NextResponse.json({ error: 'Erreur serveur', code: 'INTERNAL_ERROR' }, { status: 500 })
  }
}
