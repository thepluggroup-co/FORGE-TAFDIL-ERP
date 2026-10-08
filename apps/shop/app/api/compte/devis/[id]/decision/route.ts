import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifyToken, COOKIE_NAME } from '@/lib/auth'
import { appelApiClient } from '@/lib/compte-client'

// Le client connecté accepte ou refuse SON devis. L'API vérifie que le devis
// lui appartient (même email vérifié ou même téléphone que la fiche client).
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const token   = cookies().get(COOKIE_NAME)?.value
  const session = token ? await verifyToken(token) : null
  if (!session) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })

  const { decision, commentaire } = await req.json().catch(() => ({}))
  if (decision !== 'accepte' && decision !== 'refuse') {
    return NextResponse.json({ error: 'Décision invalide' }, { status: 400 })
  }

  const res = await appelApiClient<{ succes?: boolean; error?: string }>(
    `/clients/${encodeURIComponent(session.sub)}/devis/${encodeURIComponent(params.id)}/decision`,
    { method: 'POST', body: JSON.stringify({ decision, commentaire: typeof commentaire === 'string' ? commentaire : undefined }) },
  )
  return NextResponse.json(res.data, { status: res.status })
}
