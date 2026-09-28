import { NextRequest, NextResponse } from 'next/server'
import { forgeApiBaseUrl } from '@/lib/forge-api'

// Proxy vers POST /api/shop/configurateur/:id/estimer — le prix est toujours recalculé par l'API.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const body = await req.json()
    const res = await fetch(`${forgeApiBaseUrl()}/api/shop/configurateur/${encodeURIComponent(params.id)}/estimer`, {
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
