import { NextRequest, NextResponse } from 'next/server'
import { randomInt } from 'crypto'
import { createServiceClient } from '@/lib/supabase'
import { empreinteOtp } from '@/lib/auth'

const PHONE_RE = /^(\+?237\s?)?6\d{8}$/
const DELAI_ENTRE_ENVOIS_MS = 60_000

function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, '')
  return digits.startsWith('237') ? `+${digits}` : `+237${digits}`
}

async function postAt(to: string, message: string, username: string, apiKey: string, senderId: string) {
  const body = new URLSearchParams({ username, to, message })
  if (senderId) body.set('from', senderId)
  const res = await fetch('https://api.africastalking.com/version1/messaging', {
    method:  'POST',
    headers: {
      apiKey,
      Accept:         'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
    signal: AbortSignal.timeout(8_000),
  })
  const text = await res.text()
  if (!res.ok) return `HTTP ${res.status} — ${text.trim().slice(0, 160)}`
  // AT répond 201 même quand rien n'est parti : le statut réel est dans le corps.
  try {
    const data = JSON.parse(text)?.SMSMessageData
    const recipients: { status?: string }[] = data?.Recipients ?? []
    if (recipients.some((r) => r.status === 'Success')) return null
    return recipients[0]?.status ?? data?.Message ?? 'Aucun destinataire accepté'
  } catch {
    return text.slice(0, 160) || 'Réponse Africa\'s Talking illisible'
  }
}

/** Retourne null si le SMS est parti, sinon la raison de l'échec. */
async function sendSms(to: string, code: string): Promise<string | null> {
  const provider  = (process.env.SMS_PROVIDER ?? '').trim()
  const apiKey    = (process.env.AT_API_KEY   ?? '').trim()
  const username  = (process.env.AT_USERNAME  ?? '').trim()
  let senderId    = (process.env.AT_SENDER_ID ?? '').trim()
  // Sender du sandbox AT uniquement — rejeté en production (InvalidSenderId).
  if (senderId.toUpperCase() === 'AFRICASTALKING') senderId = ''

  if (provider === 'africas_talking' && apiKey && username) {
    const message = `Votre code FORGE Shop : ${code}. Valable 5 minutes.`
    try {
      let failure = await postAt(to, message, username, apiKey, senderId)
      if (failure === 'InvalidSenderId' && senderId) {
        console.warn(`[sms] sender "${senderId}" refusé — renvoi sans sender`)
        failure = await postAt(to, message, username, apiKey, '')
      }
      if (failure) console.error('[sms] Africa\'s Talking a refusé l\'envoi:', to, failure)
      return failure
    } catch (e) {
      console.error('[sms] send error:', e)
      return e instanceof Error ? e.message : String(e)
    }
  }

  console.info(`[otp-dev] ${to} → ${code}`)
  return null
}

export async function POST(req: NextRequest) {
  const { telephone } = await req.json().catch(() => ({}))

  if (!telephone || !PHONE_RE.test(String(telephone))) {
    return NextResponse.json({ error: 'Numéro de téléphone invalide (format camerounais requis)' }, { status: 400 })
  }

  const phone = normalizePhone(String(telephone))
  const code  = String(randomInt(100000, 1000000)) // 6 chiffres
  const db    = createServiceClient()

  // Un SMS par minute et par numéro : sans ça, la route sert à inonder un
  // numéro de SMS (et à faire grimper la facture d'envoi).
  const { data: recent } = await db
    .from('otp_sessions')
    .select('created_at')
    .eq('telephone', phone)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  const dernier = (recent as { created_at: string } | null)?.created_at
  if (dernier && Date.now() - new Date(dernier).getTime() < DELAI_ENTRE_ENVOIS_MS) {
    return NextResponse.json(
      { error: 'Un code vient d\'être envoyé. Patientez une minute avant d\'en demander un autre.' },
      { status: 429 },
    )
  }

  // Invalider les OTP précédents pour ce numéro
  await db.from('otp_sessions').delete().eq('telephone', phone)

  const expiresAt = new Date(Date.now() + 5 * 60 * 1_000).toISOString()
  const { error } = await db.from('otp_sessions').insert({
    telephone: phone,
    code: await empreinteOtp(phone, code), // jamais le code en clair
    expires_at: expiresAt,
  })

  if (error) {
    console.error('[otp] insert error:', error)
    return NextResponse.json({ error: 'Erreur interne' }, { status: 500 })
  }

  const smsFailure = await sendSms(phone, code)
  if (smsFailure) {
    // Sans ça, le client attend un code qui n'arrivera jamais.
    await db.from('otp_sessions').delete().eq('telephone', phone)
    return NextResponse.json(
      { error: 'Impossible d\'envoyer le SMS de connexion pour le moment. Réessayez dans quelques minutes.' },
      { status: 502 },
    )
  }

  return NextResponse.json({ sent: true, expires_at: expiresAt }, { status: 200 })
}
