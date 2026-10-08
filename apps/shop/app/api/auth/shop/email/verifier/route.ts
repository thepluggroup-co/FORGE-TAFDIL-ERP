import { NextRequest, NextResponse } from 'next/server'
import { appelApiClient, ouvrirSession, type CompteClient } from '@/lib/compte-client'

// Vérifie le code reçu par email ; crée le compte au besoin et ouvre la session.
export async function POST(req: NextRequest) {
  const { email, code } = await req.json().catch(() => ({}))
  if (typeof email !== 'string' || typeof code !== 'string') {
    return NextResponse.json({ error: 'Email et code requis' }, { status: 400 })
  }

  const res = await appelApiClient<{ client?: CompteClient; error?: string }>('/auth/email/verifier', {
    method: 'POST', body: JSON.stringify({ email: email.trim(), code: code.trim() }),
  })
  if (!res.ok || !res.data.client) {
    return NextResponse.json({ error: res.data.error ?? 'Code incorrect' }, { status: res.status || 401 })
  }

  return ouvrirSession(NextResponse.json({ ok: true, nom: res.data.client.nom }), res.data.client)
}
