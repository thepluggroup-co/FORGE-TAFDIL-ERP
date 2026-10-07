const SITE_URL = process.env.SITE_URL ?? 'https://shop.tafdil.cm'
const DEFAULT_COUNTRY_CODE = process.env.SMS_DEFAULT_COUNTRY_CODE ?? '237'

type SmsEvent =
  | 'commande_recue'
  | 'commande_en_production'
  | 'commande_prete'
  | 'commande_livree'
  | 'commande_annulee'
  | 'facture_emise'

export interface SmsResult {
  ok: boolean
  skipped?: boolean
  provider?: 'africastalking'
  error?: string
  response?: unknown
}

export interface CommandeSmsInfo {
  numero: string
  client_nom: string
  telephone?: string | null
  total_ttc_xaf?: number | null
}

function cleanPhone(phone: string) {
  return phone.trim().replace(/[^\d+]/g, '')
}

export function normalizePhone(phone?: string | null) {
  if (!phone) return null
  const cleaned = cleanPhone(phone)
  if (!cleaned) return null
  if (cleaned.startsWith('+')) return cleaned
  if (cleaned.startsWith('00')) return `+${cleaned.slice(2)}`
  if (cleaned.startsWith(DEFAULT_COUNTRY_CODE)) return `+${cleaned}`
  if (cleaned.startsWith('6') && cleaned.length === 9) return `+${DEFAULT_COUNTRY_CODE}${cleaned}`
  return `+${cleaned}`
}

function isSandbox() {
  const env = (process.env.AFRICASTALKING_ENV ?? process.env.AT_ENV ?? '').trim().toLowerCase()
  return env === 'sandbox' || process.env.AFRICASTALKING_SANDBOX === 'true'
}

function smsEndpoint() {
  return isSandbox()
    ? 'https://api.sandbox.africastalking.com/version1/messaging'
    : 'https://api.africastalking.com/version1/messaging'
}

function smsConfig() {
  // trim : un espace/retour chariot collé dans la console Railway/Vercel suffit
  // à faire répondre "authentication is invalid" ou "missing field" par AT.
  const username = (process.env.AFRICASTALKING_USERNAME ?? process.env.AT_USERNAME ?? '').trim()
  const apiKey   = (process.env.AFRICASTALKING_API_KEY ?? process.env.AT_API_KEY ?? '').trim()
  let senderId   = (process.env.AFRICASTALKING_SENDER_ID ?? process.env.AT_SENDER_ID ?? '').trim()
  // "AFRICASTALKING" est le sender du sandbox uniquement : en production AT
  // rejette tout le lot avec InvalidSenderId (HTTP 201, aucun SMS envoyé).
  if (!isSandbox() && senderId.toUpperCase() === 'AFRICASTALKING') senderId = ''
  return { username, apiKey, senderId }
}

interface AtRecipient { number?: string; status?: string; statusCode?: number }

/**
 * AT répond HTTP 201 même quand rien n'est parti (sender refusé, solde
 * insuffisant, numéro invalide) : le vrai résultat est dans le corps.
 * Retourne null si au moins un destinataire est en Success, sinon la raison.
 */
function atFailureReason(payload: unknown): string | null {
  const data = (payload as { SMSMessageData?: { Message?: string; Recipients?: AtRecipient[] } })?.SMSMessageData
  if (!data) return typeof payload === 'string' && payload ? payload.slice(0, 160) : 'Réponse Africa\'s Talking illisible'
  const recipients = data.Recipients ?? []
  if (recipients.some((r) => r.status === 'Success')) return null
  return recipients[0]?.status ?? data.Message ?? 'Aucun destinataire accepté'
}

async function postSms(phone: string, message: string, username: string, apiKey: string, senderId: string) {
  const body = new URLSearchParams({
    username,
    to:      phone,
    message: message.slice(0, 640),
  })
  if (senderId) body.set('from', senderId)

  // Sans timeout, un provider lent/injoignable bloque toute la requête
  // POST /tickets/:id/envoyer jusqu'au timeout CLIENT (15s, apiClient) — le
  // caissier voit "Délai dépassé (serveur API non disponible ?)" alors que le
  // serveur tourne très bien, juste bloqué sur cet appel sortant.
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 8_000)
  try {
    const res = await fetch(smsEndpoint(), {
      method:  'POST',
      headers: {
        Accept:         'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
        apiKey,
      },
      body,
      signal: controller.signal,
    })
    const text = await res.text()
    let payload: unknown = text
    try { payload = JSON.parse(text) } catch { /* keep raw provider response */ }
    return { status: res.status, ok: res.ok, text, payload }
  } finally {
    clearTimeout(timer)
  }
}

export async function sendSms(to: string, message: string): Promise<SmsResult> {
  const phone = normalizePhone(to)
  if (!phone) return { ok: false, skipped: true, error: 'Telephone invalide' }

  const { username, apiKey, senderId } = smsConfig()
  if (!username || !apiKey) {
    console.info('[sms:africastalking:dry-run]', phone, message.slice(0, 120))
    return { ok: true, skipped: true, provider: 'africastalking' }
  }

  try {
    let res = await postSms(phone, message, username, apiKey, senderId)

    // Sender ID non (encore) approuvé par AT : on renvoie sans `from` pour que
    // le client reçoive quand même le SMS (expéditeur générique AT).
    if (res.ok && senderId && atFailureReason(res.payload) === 'InvalidSenderId') {
      console.warn(`[sms:africastalking] sender "${senderId}" refusé (InvalidSenderId) — renvoi sans sender`)
      res = await postSms(phone, message, username, apiKey, '')
    }

    if (!res.ok) {
      // Le corps d'AT est du texte brut explicite ("Request is missing required
      // form field 'username'", "The supplied authentication is invalid"…) :
      // on le remonte, sinon l'UI n'affiche qu'un "HTTP 400" indéchiffrable.
      const detail = res.text.trim().slice(0, 160)
      console.warn('[sms:africastalking] non-OK response:', res.status, detail)
      return { ok: false, provider: 'africastalking', error: `HTTP ${res.status}${detail ? ` — ${detail}` : ''}`, response: res.payload }
    }

    const failure = atFailureReason(res.payload)
    if (failure) {
      console.warn('[sms:africastalking] rejected:', phone, failure)
      return { ok: false, provider: 'africastalking', error: failure, response: res.payload }
    }

    return { ok: true, provider: 'africastalking', response: res.payload }
  } catch (err) {
    const isTimeout = err instanceof Error && err.name === 'AbortError'
    const messageError = isTimeout ? 'Délai dépassé (Africa\'s Talking injoignable)' : err instanceof Error ? err.message : String(err)
    console.error('[sms:africastalking] send error:', messageError)
    return { ok: false, provider: 'africastalking', error: messageError }
  }
}

function firstName(name: string) {
  return name.trim().split(/\s+/)[0] || 'client'
}

function formatXaf(value?: number | null) {
  if (!value || value <= 0) return ''
  return new Intl.NumberFormat('fr-CM', {
    style: 'currency',
    currency: 'XAF',
    maximumFractionDigits: 0,
  }).format(value)
}

export function buildCommandeSms(commande: CommandeSmsInfo, event: SmsEvent) {
  const prenom = firstName(commande.client_nom)
  const montant = formatXaf(commande.total_ttc_xaf)
  const suivi = `${SITE_URL}/suivi/${commande.numero}`

  if (event === 'commande_recue') {
    return `TAFDIL FORGE: Commande ${commande.numero} recue${montant ? ` (${montant})` : ''}. Suivi: ${suivi}`
  }
  if (event === 'commande_en_production') {
    return `TAFDIL FORGE: Bonjour ${prenom}, votre commande ${commande.numero} est lancee en production. Suivi: ${suivi}`
  }
  if (event === 'commande_prete') {
    return `TAFDIL FORGE: Bonjour ${prenom}, votre commande ${commande.numero} est prete. Nous preparons la livraison.`
  }
  if (event === 'commande_livree') {
    return `TAFDIL FORGE: Bonjour ${prenom}, votre commande ${commande.numero}${montant ? ` (${montant})` : ''} a ete livree. Merci pour votre confiance.`
  }
  if (event === 'commande_annulee') {
    return `TAFDIL FORGE: Bonjour ${prenom}, votre commande ${commande.numero} a ete annulee. Contactez-nous pour toute question.`
  }
  return `TAFDIL FORGE: Bonjour ${prenom}, la facture de votre commande ${commande.numero}${montant ? ` (${montant})` : ''} est disponible. Suivi: ${suivi}`
}

export async function notifyCommandeSms(commande: CommandeSmsInfo, event: SmsEvent) {
  if (!commande.telephone) return { ok: false, skipped: true, error: 'Telephone client manquant' }
  return sendSms(commande.telephone, buildCommandeSms(commande, event))
}
