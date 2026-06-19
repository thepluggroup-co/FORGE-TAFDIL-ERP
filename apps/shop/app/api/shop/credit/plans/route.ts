import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifyToken, COOKIE_NAME } from '@/lib/auth'
import { forgeApiBaseUrl } from '@/lib/forge-api'

export async function POST(req: NextRequest) {
  const token = cookies().get(COOKIE_NAME)?.value
  if (!token) {
    return NextResponse.json({ error: 'Non authentifié — connectez-vous à votre espace client' }, { status: 401 })
  }

  const payload = await verifyToken(token)
  if (!payload) {
    return NextResponse.json({ error: 'Session expirée — reconnectez-vous' }, { status: 401 })
  }

  const body = await req.json().catch(() => ({}))

  try {
    const res = await fetch(`${forgeApiBaseUrl()}/api/credit/plans`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ ...body, customer_id: payload.sub }),
    })

    const data = await res.json().catch(() => ({ error: 'Réponse invalide du service crédit' }))
    return NextResponse.json(data, { status: res.status })
  } catch {
    return NextResponse.json(
      { error: 'Service crédit indisponible', code: 'CREDIT_API_UNREACHABLE' },
      { status: 503 }
    )
  }
}
