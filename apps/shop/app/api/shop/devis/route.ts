import { NextRequest, NextResponse } from 'next/server'
import { forgeApiBaseUrl } from '@/lib/forge-api'

// Demande de devis : relais vers l'API FORGE, seule à écrire en base
// (validation, numéro DEM-, pièces jointes vérifiées par signature, historique).
// Le corps est transmis tel quel : JSON, ou multipart avec les fichiers « documents ».
export async function POST(req: NextRequest) {
  try {
    const contentType = req.headers.get('content-type') ?? 'application/json'
    const headers: Record<string, string> = { 'Content-Type': contentType }
    const ip = req.headers.get('x-forwarded-for')
    if (ip) headers['X-Forwarded-For'] = ip

    const res = await fetch(`${forgeApiBaseUrl()}/api/shop/devis`, {
      method: 'POST',
      headers,
      body:   await req.arrayBuffer(),
      cache:  'no-store',
    })

    const payload = await res.json().catch(() => ({}))
    return NextResponse.json(payload, { status: res.status })
  } catch {
    return NextResponse.json({ error: 'Erreur serveur', code: 'INTERNAL_ERROR' }, { status: 500 })
  }
}
