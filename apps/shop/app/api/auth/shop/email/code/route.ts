import { NextRequest, NextResponse } from 'next/server'
import { appelApiClient } from '@/lib/compte-client'

// Envoie un code de connexion à 6 chiffres par email (via l'API FORGE).
export async function POST(req: NextRequest) {
  const { email } = await req.json().catch(() => ({}))
  if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
    return NextResponse.json({ error: 'Adresse email invalide' }, { status: 400 })
  }

  const res = await appelApiClient<{ envoye?: boolean; error?: string }>('/auth/email/code', {
    method: 'POST', body: JSON.stringify({ email: email.trim() }),
  })
  return NextResponse.json(res.data, { status: res.status })
}
