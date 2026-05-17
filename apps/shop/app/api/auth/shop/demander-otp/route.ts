import { NextRequest, NextResponse } from 'next/server'
import { randomInt } from 'crypto'
import { createServiceClient } from '@/lib/supabase'

const PHONE_RE = /^(\+?237\s?)?6\d{8}$/

function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, '')
  return digits.startsWith('237') ? `+${digits}` : `+237${digits}`
}

async function sendSms(to: string, code: string): Promise<void> {
  const provider  = process.env.SMS_PROVIDER ?? ''
  const apiKey    = process.env.AT_API_KEY    ?? ''
  const username  = process.env.AT_USERNAME   ?? ''
  const senderId  = process.env.AT_SENDER_ID  ?? 'FORGE'

  if (provider === 'africas_talking' && apiKey && username) {
    const body = new URLSearchParams({
      username,
      to,
      message: `Votre code FORGE Shop : ${code}. Valable 5 minutes.`,
      from:    senderId,
    })
    await fetch('https://api.africastalking.com/version1/messaging', {
      method:  'POST',
      headers: {
        apiKey,
        Accept:         'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
    }).catch((e) => console.error('[sms] send error:', e))
    return
  }

  console.info(`[otp-dev] ${to} → ${code}`)
}

export async function POST(req: NextRequest) {
  const { telephone } = await req.json().catch(() => ({}))

  if (!telephone || !PHONE_RE.test(String(telephone))) {
    return NextResponse.json({ error: 'Numéro de téléphone invalide (format camerounais requis)' }, { status: 400 })
  }

  const phone = normalizePhone(String(telephone))
  const code  = String(randomInt(100000, 1000000)) // 6 chiffres
  const db    = createServiceClient()

  // Invalider les OTP précédents pour ce numéro
  await db.from('otp_sessions').delete().eq('telephone', phone)

  const expiresAt = new Date(Date.now() + 5 * 60 * 1_000).toISOString()
  const { error } = await db.from('otp_sessions').insert({
    telephone: phone,
    code,
    expires_at: expiresAt,
  })

  if (error) {
    console.error('[otp] insert error:', error)
    return NextResponse.json({ error: 'Erreur interne' }, { status: 500 })
  }

  await sendSms(phone, code)

  return NextResponse.json({ sent: true, expires_at: expiresAt }, { status: 200 })
}
