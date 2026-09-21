/**
 * FORGE ERP — Téléphone + PIN (4 chiffres), credential séparé du mot de passe
 * du compte (cf. supabase/migrations/20260902_user_pins.sql pour le pourquoi).
 *
 * Connexion : PAS de signInWithPassword — le PIN n'est jamais envoyé à
 * Supabase Auth. On vérifie le hash nous-mêmes, puis on échange contre une
 * vraie session Supabase via un lien magique généré côté serveur
 * (auth.admin.generateLink) — voir verifyPinAndIssueSession().
 */
import { createHash, randomBytes, randomInt } from 'node:crypto'
import { supabaseAdmin } from '@forge/db'
import { sendSms, normalizePhone } from './sms.service'
import { notifyWhatsApp } from './email-queue.service'

const db = supabaseAdmin!

const MAX_FAILED_ATTEMPTS = 5
const LOCKOUT_MINUTES = 15

function hashPin(pin: string, salt: string): string {
  return createHash('sha256').update(salt).update(pin).digest('hex')
}

function generateFourDigitPin(): string {
  return String(randomInt(0, 10_000)).padStart(4, '0')
}

export interface GeneratePinResult {
  ok: boolean
  error?: string
}

/**
 * Génère un PIN aléatoire, l'enregistre (haché) et l'envoie par SMS (Africa's
 * Talking — canal fiable, déjà utilisé pour les reçus Caisse) et en best-effort
 * par WhatsApp. Utilisé (a) par un admin à l'invitation d'un utilisateur avec
 * téléphone, ou (b) en auto-service.
 *
 * Le WhatsApp (notifyWhatsApp, CallMeBot) est fourni "en plus" mais pas
 * garanti : un message sortant à froid (l'utilisateur n'a jamais écrit au
 * numéro business) peut être refusé par l'API WhatsApp Business officielle
 * sans template pré-approuvé par Meta — c'est le SMS qui fait foi.
 */
export async function generateAndSendPin(userId: string, phone: string): Promise<GeneratePinResult> {
  const normalized = normalizePhone(phone)
  if (!normalized) return { ok: false, error: 'Numéro de téléphone invalide' }

  const pin  = generateFourDigitPin()
  const salt = randomBytes(16).toString('hex')

  const { error: upsertErr } = await db.from('user_pins').upsert({
    user_id:         userId,
    pin_hash:         hashPin(pin, salt),
    salt,
    must_change:      true,
    failed_attempts:  0,
    locked_until:     null,
  }, { onConflict: 'user_id' })
  if (upsertErr) return { ok: false, error: upsertErr.message }

  const message = `FORGE TAFDIL — Votre code PIN de connexion : ${pin}\nÀ changer dès votre première connexion.`
  const sms = await sendSms(normalized, message)
  if (!sms.ok) return { ok: false, error: sms.error ?? 'Envoi SMS échoué' }

  void notifyWhatsApp(normalized.replace(/^\+/, ''), message)

  return { ok: true }
}

export interface VerifyPinResult {
  ok: boolean
  error?: string
  code?: 'LOCKED' | 'NO_ACCOUNT' | 'INVALID_PIN' | 'GENERATE_LINK_FAILED'
  userId?: string
  email?: string
  hashedToken?: string
  mustChangePin?: boolean
}

/**
 * Vérifie le PIN pour un numéro donné et, si correct, génère le jeton
 * d'échange de session (magic link, non envoyé par email — le client
 * l'échange directement via supabase.auth.verifyOtp({ token_hash, type:
 * 'magiclink', email })). Compte les échecs, verrouille après
 * MAX_FAILED_ATTEMPTS.
 */
export async function verifyPinAndIssueSession(phone: string, pin: string): Promise<VerifyPinResult> {
  const normalized = normalizePhone(phone)
  if (!normalized) return { ok: false, error: 'Numéro de téléphone invalide' }

  const { data: profile, error: profileErr } = await db
    .from('profiles')
    .select('id, email')
    .eq('telephone', normalized)
    .maybeSingle()

  if (profileErr) return { ok: false, error: profileErr.message }
  if (!profile) return { ok: false, code: 'NO_ACCOUNT', error: 'Aucun compte pour ce numéro' }

  const p = profile as { id: string; email: string }

  const { data: pinRow, error: pinErr } = await db
    .from('user_pins')
    .select('pin_hash, salt, must_change, failed_attempts, locked_until')
    .eq('user_id', p.id)
    .maybeSingle()

  if (pinErr) return { ok: false, error: pinErr.message }
  if (!pinRow) return { ok: false, code: 'NO_ACCOUNT', error: 'Connexion par PIN non activée pour ce compte' }

  const row = pinRow as { pin_hash: string; salt: string; must_change: boolean; failed_attempts: number; locked_until: string | null }

  if (row.locked_until && new Date(row.locked_until).getTime() > Date.now()) {
    return { ok: false, code: 'LOCKED', error: `Trop de tentatives — réessayez après ${new Date(row.locked_until).toLocaleTimeString('fr-CM')}` }
  }

  if (hashPin(pin, row.salt) !== row.pin_hash) {
    const attempts = row.failed_attempts + 1
    const update: Record<string, unknown> = { failed_attempts: attempts }
    if (attempts >= MAX_FAILED_ATTEMPTS) {
      update.locked_until = new Date(Date.now() + LOCKOUT_MINUTES * 60_000).toISOString()
      update.failed_attempts = 0
    }
    await db.from('user_pins').update(update).eq('user_id', p.id)
    return { ok: false, code: 'INVALID_PIN', error: 'Code PIN incorrect' }
  }

  // PIN correct — reset des compteurs et émission du jeton de session.
  await db.from('user_pins').update({ failed_attempts: 0, locked_until: null }).eq('user_id', p.id)

  const { data: linkData, error: linkErr } = await db.auth.admin.generateLink({
    type: 'magiclink',
    email: p.email,
  })
  if (linkErr || !linkData?.properties?.hashed_token) {
    return { ok: false, code: 'GENERATE_LINK_FAILED', error: linkErr?.message ?? 'Échec de génération de la session' }
  }

  return {
    ok: true,
    userId: p.id,
    email: p.email,
    hashedToken: linkData.properties.hashed_token,
    mustChangePin: row.must_change,
  }
}

export interface SetOwnPinResult {
  ok: boolean
  error?: string
}

/** Choisir/changer son propre PIN — appelé authentifié (post-login, email ou PIN temporaire). */
export async function setOwnPin(userId: string, newPin: string): Promise<SetOwnPinResult> {
  if (!/^\d{4}$/.test(newPin)) return { ok: false, error: 'Le PIN doit contenir exactement 4 chiffres' }

  const salt = randomBytes(16).toString('hex')
  const { error } = await db.from('user_pins').upsert({
    user_id:        userId,
    pin_hash:        hashPin(newPin, salt),
    salt,
    must_change:     false,
    failed_attempts: 0,
    locked_until:    null,
  }, { onConflict: 'user_id' })

  if (error) return { ok: false, error: error.message }
  return { ok: true }
}
