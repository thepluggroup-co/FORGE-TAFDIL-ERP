const SITE_URL = process.env.SITE_URL ?? 'https://shop.tafdil.cm'
const DEFAULT_COUNTRY_CODE = process.env.SMS_DEFAULT_COUNTRY_CODE ?? '237'

type SmsEvent =
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

function smsEndpoint() {
  const env = (process.env.AFRICASTALKING_ENV ?? process.env.AT_ENV ?? '').toLowerCase()
  if (env === 'sandbox' || process.env.AFRICASTALKING_SANDBOX === 'true') {
    return 'https://api.sandbox.africastalking.com/version1/messaging'
  }
  return 'https://api.africastalking.com/version1/messaging'
}

function smsConfig() {
  const username = process.env.AFRICASTALKING_USERNAME ?? process.env.AT_USERNAME ?? ''
  const apiKey   = process.env.AFRICASTALKING_API_KEY ?? process.env.AT_API_KEY ?? ''
  const senderId = process.env.AFRICASTALKING_SENDER_ID ?? process.env.AT_SENDER_ID ?? ''
  return { username, apiKey, senderId }
}

export async function sendSms(to: string, message: string): Promise<SmsResult> {
  const phone = normalizePhone(to)
  if (!phone) return { ok: false, skipped: true, error: 'Telephone invalide' }

  const { username, apiKey, senderId } = smsConfig()
  if (!username || !apiKey) {
    console.info('[sms:africastalking:dry-run]', phone, message.slice(0, 120))
    return { ok: true, skipped: true, provider: 'africastalking' }
  }

  const body = new URLSearchParams({
    username,
    to:      phone,
    message: message.slice(0, 640),
  })
  if (senderId) body.set('from', senderId)

  try {
    const res = await fetch(smsEndpoint(), {
      method:  'POST',
      headers: {
        Accept:         'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
        apiKey,
      },
      body,
    })

    const text = await res.text()
    let payload: unknown = text
    try { payload = JSON.parse(text) } catch { /* keep raw provider response */ }

    if (!res.ok) {
      console.warn('[sms:africastalking] non-OK response:', res.status, text.slice(0, 200))
      return { ok: false, provider: 'africastalking', error: `HTTP ${res.status}`, response: payload }
    }

    return { ok: true, provider: 'africastalking', response: payload }
  } catch (err) {
    const messageError = err instanceof Error ? err.message : String(err)
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
