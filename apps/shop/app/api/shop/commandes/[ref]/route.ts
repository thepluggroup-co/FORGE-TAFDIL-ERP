import { NextRequest, NextResponse } from 'next/server'
import { forgeApiBaseUrl } from '@/lib/forge-api'

// Proxy du suivi public : l'API FORGE ne renvoie la ville et les photos de
// livraison que si ?tel= correspond au téléphone de la commande.
export async function GET(req: NextRequest, { params }: { params: { ref: string } }) {
  try {
    const tel = req.nextUrl.searchParams.get('tel')
    const qs  = tel ? `?tel=${encodeURIComponent(tel)}` : ''
    const res = await fetch(`${forgeApiBaseUrl()}/api/shop/commandes/${encodeURIComponent(params.ref.toUpperCase())}${qs}`, {
      cache: 'no-store',
    })

    const payload = await res.json().catch(() => ({}))
    return NextResponse.json(payload, { status: res.status })
  } catch {
    return NextResponse.json({ error: 'Erreur serveur', code: 'INTERNAL_ERROR' }, { status: 500 })
  }
}
