import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import { signToken, COOKIE_NAME } from '@/lib/auth'

function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, '')
  return digits.startsWith('237') ? `+${digits}` : `+237${digits}`
}

export async function POST(req: NextRequest) {
  const { telephone, code } = await req.json().catch(() => ({}))

  if (!telephone || !code) {
    return NextResponse.json({ error: 'telephone et code sont requis' }, { status: 400 })
  }

  const phone = normalizePhone(String(telephone))
  const db    = createServiceClient()

  // Récupérer la session OTP active
  const { data: session, error: errSession } = await db
    .from('otp_sessions')
    .select('id, code, expires_at')
    .eq('telephone', phone)
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false })
    .limit(1)
    .single()

  if (errSession || !session) {
    return NextResponse.json({ error: 'Code expiré ou introuvable. Demandez un nouveau code.' }, { status: 401 })
  }

  if (String(code).trim() !== String(session.code).trim()) {
    return NextResponse.json({ error: 'Code incorrect' }, { status: 401 })
  }

  // Supprimer la session OTP utilisée
  await db.from('otp_sessions').delete().eq('id', session.id)

  // Upsert client
  const { data: client, error: errClient } = await db
    .from('clients_shop')
    .upsert({ telephone: phone, derniere_connexion: new Date().toISOString() }, { onConflict: 'telephone' })
    .select('id, nom, telephone')
    .single()

  if (errClient || !client) {
    console.error('[otp] upsert client:', errClient)
    return NextResponse.json({ error: 'Erreur interne' }, { status: 500 })
  }

  const token = await signToken({
    sub:       String(client.id),
    telephone: client.telephone as string,
    nom:       (client.nom as string | null) ?? undefined,
  })

  const res = NextResponse.json({ ok: true, nom: client.nom })

  res.cookies.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure:   process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path:     '/',
    maxAge:   60 * 60 * 24 * 30,
  })

  return res
}
