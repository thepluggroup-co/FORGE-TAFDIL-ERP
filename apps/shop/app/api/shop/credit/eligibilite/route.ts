import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifyToken, COOKIE_NAME } from '@/lib/auth'
import { forgeApiBaseUrl } from '@/lib/forge-api'

export async function GET(req: NextRequest) {
  const token = cookies().get(COOKIE_NAME)?.value
  if (!token) {
    return NextResponse.json({ eligible: false, reason: 'non_connecte', loggedin: false, availableCredit: 0 })
  }

  const payload = await verifyToken(token)
  if (!payload) {
    return NextResponse.json({ eligible: false, reason: 'session_invalide', loggedin: false, availableCredit: 0 })
  }

  const url     = new URL(req.url)
  const montant = url.searchParams.get('montant') ?? '0'

  try {
    const res = await fetch(
      `${forgeApiBaseUrl()}/api/credit/limits/${payload.sub}/check?montant=${montant}`,
      {
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        cache: 'no-store',
      }
    )

    if (!res.ok) {
      return NextResponse.json({
        eligible: false, reason: 'verification_impossible', loggedin: true, availableCredit: 0,
      })
    }

    const data = await res.json()
    return NextResponse.json({ ...data, loggedin: true })
  } catch {
    return NextResponse.json({
      eligible: false, reason: 'service_indisponible', loggedin: true, availableCredit: 0,
    })
  }
}
