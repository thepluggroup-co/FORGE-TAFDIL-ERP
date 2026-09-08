/**
 * FORGE ERP — Téléphone + PIN : génération/vérification des codes OTP de
 * confirmation, et rattachement du numéro confirmé au compte Supabase Auth.
 *
 * Ne gère PAS la connexion elle-même — une fois le téléphone confirmé,
 * apps/web/src/pages/Login.tsx appelle directement
 * supabase.auth.signInWithPassword({ phone, password }), comme pour l'email.
 */
import { createHash, randomInt } from 'node:crypto'
import { supabaseAdmin } from '@forge/db'
import { sendSms, normalizePhone } from './sms.service'

const db = supabaseAdmin!

const OTP_TTL_MINUTES = 5
const OTP_MAX_ATTEMPTS = 5

function hashCode(code: string): string {
  return createHash('sha256').update(code).digest('hex')
}

function generateCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0')
}

export interface RequestOtpResult {
  ok: boolean
  skipped?: boolean
  error?: string
}

/**
 * Génère un code, l'enregistre (haché) et l'envoie par SMS via Africa's Talking.
 * `phone` doit déjà être au format normalisé (+237...).
 */
export async function requestPhoneOtp(userId: string, phone: string): Promise<RequestOtpResult> {
  const normalized = normalizePhone(phone)
  if (!normalized) return { ok: false, error: 'Numéro de téléphone invalide' }

  const code = generateCode()
  const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60_000).toISOString()

  // Invalider les codes en attente précédents pour cet utilisateur — un seul
  // code valide à la fois, évite qu'un ancien code traîne indéfiniment.
  await db.from('phone_otp_codes').update({ consumed: true }).eq('user_id', userId).eq('consumed', false)

  const { error: insertErr } = await db.from('phone_otp_codes').insert({
    user_id:    userId,
    phone:      normalized,
    code_hash:  hashCode(code),
    expires_at: expiresAt,
  })
  if (insertErr) return { ok: false, error: insertErr.message }

  const sms = await sendSms(normalized, `FORGE TAFDIL — Votre code de confirmation : ${code} (valable ${OTP_TTL_MINUTES} min)`)
  if (!sms.ok) return { ok: false, error: sms.error ?? 'Envoi SMS échoué' }

  return { ok: true, skipped: sms.skipped }
}

export interface VerifyOtpResult {
  ok: boolean
  error?: string
  code?: 'EXPIRED' | 'INVALID' | 'TOO_MANY_ATTEMPTS' | 'NO_PENDING_CODE'
}

/**
 * Vérifie le code, et si valide : confirme le téléphone sur le compte
 * Supabase Auth (auth.admin.updateUserById, phone_confirm: true) et met à
 * jour profiles.telephone. C'est CE flag phone_confirmed_at côté Supabase —
 * pas notre table — qui autorise ensuite signInWithPassword({ phone, ... }).
 */
export async function verifyPhoneOtp(userId: string, submittedCode: string): Promise<VerifyOtpResult> {
  const { data: pending, error: fetchErr } = await db
    .from('phone_otp_codes')
    .select('id, phone, code_hash, attempts, expires_at')
    .eq('user_id', userId)
    .eq('consumed', false)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (fetchErr) return { ok: false, error: fetchErr.message }
  if (!pending) return { ok: false, code: 'NO_PENDING_CODE', error: 'Aucun code en attente — redemandez-en un' }

  const row = pending as { id: string; phone: string; code_hash: string; attempts: number; expires_at: string }

  if (new Date(row.expires_at).getTime() < Date.now()) {
    await db.from('phone_otp_codes').update({ consumed: true }).eq('id', row.id)
    return { ok: false, code: 'EXPIRED', error: 'Code expiré — redemandez-en un' }
  }

  if (row.attempts >= OTP_MAX_ATTEMPTS) {
    await db.from('phone_otp_codes').update({ consumed: true }).eq('id', row.id)
    return { ok: false, code: 'TOO_MANY_ATTEMPTS', error: 'Trop de tentatives — redemandez un code' }
  }

  if (hashCode(submittedCode) !== row.code_hash) {
    await db.from('phone_otp_codes').update({ attempts: row.attempts + 1 }).eq('id', row.id)
    return { ok: false, code: 'INVALID', error: 'Code incorrect' }
  }

  await db.from('phone_otp_codes').update({ consumed: true }).eq('id', row.id)

  // Rattacher + confirmer le téléphone sur le compte Auth — sans phone_confirm,
  // Supabase refuse signInWithPassword({ phone }) même mot de passe correct.
  const { error: authErr } = await db.auth.admin.updateUserById(userId, {
    phone: row.phone,
    phone_confirm: true,
  })
  if (authErr) return { ok: false, error: `Téléphone vérifié mais rattachement au compte échoué : ${authErr.message}` }

  await db.from('profiles').update({ telephone: row.phone }).eq('id', userId)

  return { ok: true }
}
