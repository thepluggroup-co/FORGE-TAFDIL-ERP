import { NextRequest, NextResponse } from 'next/server'
import { forgeApiBaseUrl } from '@/lib/forge-api'

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ reference: string }> }
) {
  const { reference } = await params

  try {
    const res = await fetch(
      `${forgeApiBaseUrl()}/api/paiements/${encodeURIComponent(reference)}/statut`,
      { cache: 'no-store' }
    )
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
