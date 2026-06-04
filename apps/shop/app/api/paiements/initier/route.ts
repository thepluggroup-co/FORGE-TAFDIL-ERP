import { NextRequest, NextResponse } from 'next/server'
import { forgeApiBaseUrl } from '@/lib/forge-api'

export async function POST(request: NextRequest) {
  const body = await request.text()

  try {
    const res = await fetch(`${forgeApiBaseUrl()}/api/paiements/initier`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body,
    })

    const json = await res.json().catch(() => ({ error: 'Reponse paiement invalide' }))

    return NextResponse.json(json, {
      status: res.status,
      headers: { 'Cache-Control': 'no-store' },
    })
  } catch {
    return NextResponse.json(
      { error: 'Service paiement injoignable', code: 'PAYMENT_API_UNREACHABLE' },
      { status: 503 }
    )
  }
}
