import { NextRequest, NextResponse } from 'next/server'
import { forgeApiBaseUrl } from '@/lib/forge-api'

// Schéma public du configurateur (Catalogue Hybride Phase 3) — aucun coût exposé par l'API.
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const res = await fetch(`${forgeApiBaseUrl()}/api/shop/configurateur/${encodeURIComponent(params.id)}`, { cache: 'no-store' })
    const payload = await res.json().catch(() => ({}))
    return NextResponse.json(payload, { status: res.status })
  } catch {
    return NextResponse.json({ error: 'Erreur serveur', code: 'INTERNAL_ERROR' }, { status: 500 })
  }
}
