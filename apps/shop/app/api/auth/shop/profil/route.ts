import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifyToken, COOKIE_NAME } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase'

export async function PATCH(req: NextRequest) {
  const token   = cookies().get(COOKIE_NAME)?.value
  const payload = token ? await verifyToken(token) : null

  if (!payload) {
    return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })
  }

  const { nom } = await req.json().catch(() => ({}))
  if (typeof nom !== 'string' || nom.trim().length < 2) {
    return NextResponse.json({ error: 'Nom invalide (min 2 caractères)' }, { status: 400 })
  }

  const db = createServiceClient()
  const { error } = await db
    .from('clients_shop')
    .update({ nom: nom.trim() })
    .eq('id', payload.sub)

  if (error) {
    return NextResponse.json({ error: 'Erreur interne' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
