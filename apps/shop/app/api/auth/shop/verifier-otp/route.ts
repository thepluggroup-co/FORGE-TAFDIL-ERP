import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import { signToken, empreinteOtp, COOKIE_NAME } from '@/lib/auth'

const MAX_ESSAIS = 5

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
    .select('*') // inclut « tentatives » quand la colonne existe (migration 20261017)
    .eq('telephone', phone)
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false })
    .limit(1)
    .single()

  if (errSession || !session) {
    return NextResponse.json({ error: 'Code expiré ou introuvable. Demandez un nouveau code.' }, { status: 401 })
  }

  if ((await empreinteOtp(phone, String(code))) !== String(session.code)) {
    // Essais limités : un code à 6 chiffres sans limite d'essais se devine par
    // force brute en quelques minutes. Sans la colonne « tentatives » (migration
    // 20261017 pas encore appliquée), le code est invalidé dès la première erreur.
    const tentatives = 'tentatives' in session ? Number(session.tentatives ?? 0) + 1 : MAX_ESSAIS
    if (tentatives >= MAX_ESSAIS) {
      await db.from('otp_sessions').delete().eq('id', session.id)
      return NextResponse.json({ error: 'Code incorrect. Demandez un nouveau code.' }, { status: 401 })
    }
    await db.from('otp_sessions').update({ tentatives }).eq('id', session.id)
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
