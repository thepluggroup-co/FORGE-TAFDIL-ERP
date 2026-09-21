// Service de notifications WhatsApp pour les changements de statut commandes web

import { notifyCommandeSms } from './sms.service'

const SITE_URL   = process.env.SITE_URL   ?? 'https://shop.tafdil.cm'
const TAFDIL_TEL = process.env.WHATSAPP_TAFDIL_NUMBER ?? ''

// ── WhatsApp ───────────────────────────────────────────────────────────────────

export async function sendWhatsApp(to: string, message: string): Promise<void> {
  const token   = process.env.WHATSAPP_API_TOKEN        ?? ''
  const phoneId = process.env.WHATSAPP_BUSINESS_PHONE_ID ?? ''

  if (!token || !phoneId) {
    console.info('[whatsapp]', to, message.slice(0, 100))
    return
  }

  await fetch(`https://graph.facebook.com/v20.0/${phoneId}/messages`, {
    method:  'POST',
    headers: {
      Authorization:  `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to:   to.replace(/\D/g, ''),
      type: 'text',
      text: { body: message },
    }),
  }).catch((e) => console.error('[whatsapp] send error:', e))
}

// ── Notifications statut commande ─────────────────────────────────────────────

interface CommandeInfo {
  ref:              string
  client_nom:       string
  client_telephone: string
  montant_ttc:      number
  erp_commande_id?: string | null
}

function fmt(n: number) {
  return new Intl.NumberFormat('fr-CM', { style: 'currency', currency: 'XAF', maximumFractionDigits: 0 }).format(n)
}

export async function notifyStatutChange(
  commande:      CommandeInfo,
  ancienStatut:  string,
  nouveauStatut: string,
): Promise<void> {
  const { ref, client_telephone, client_nom, montant_ttc } = commande
  const suivi = `${SITE_URL}/suivi/${ref}`
  const prenom = client_nom.split(' ')[0]

  let messageClient: string | null = null

  if (nouveauStatut === 'en_preparation') {
    messageClient =
      `🔧 *TAFDIL FORGE* — Bonjour ${prenom} !\n` +
      `Votre commande *${ref}* est en cours de fabrication.\n` +
      `Délai estimé : 2–5 jours ouvrables.\n` +
      `Suivi en temps réel : ${suivi}`

  } else if (nouveauStatut === 'expediee') {
    messageClient =
      `📦 *TAFDIL FORGE* — Bonjour ${prenom} !\n` +
      `Votre commande *${ref}* est prête et en cours de livraison.\n` +
      `Livraison prévue sous 48h.\n` +
      `Pour toute question : ${TAFDIL_TEL}`

  } else if (nouveauStatut === 'livree') {
    messageClient =
      `✅ *TAFDIL FORGE* — Bonjour ${prenom} !\n` +
      `Votre commande *${ref}* (${fmt(montant_ttc)}) a bien été livrée.\n` +
      `Votre facture sera disponible sur : ${suivi}\n\n` +
      `Merci pour votre confiance ! — TAFDIL`

  } else if (nouveauStatut === 'annulee') {
    messageClient =
      `❌ *TAFDIL FORGE* — Bonjour ${prenom},\n` +
      `Votre commande *${ref}* a été annulée.\n` +
      `Pour toute question : ${TAFDIL_TEL}`
  }

  if (messageClient && client_telephone) {
    await sendWhatsApp(client_telephone, messageClient)
  }

  const smsEvent: Record<string, Parameters<typeof notifyCommandeSms>[1]> = {
    en_preparation: 'commande_en_production',
    expediee:       'commande_prete',
    livree:         'commande_livree',
    annulee:        'commande_annulee',
  }
  const event = smsEvent[nouveauStatut]
  if (event && client_telephone) {
    void notifyCommandeSms({
      numero:        ref,
      client_nom,
      telephone:     client_telephone,
      total_ttc_xaf: montant_ttc,
    }, event).catch((e) => console.error('[sms] statut commande web:', e))
  }
}

// ── Notification paiement échoué ──────────────────────────────────────────────

export async function notifyPaiementEchoue(
  ref:              string,
  client_telephone: string,
): Promise<void> {
  const message =
    `❌ *TAFDIL FORGE* : Votre paiement pour la commande *${ref}* a échoué.\n` +
    `Réessayez ici : ${SITE_URL}/suivi/${ref}\n` +
    `Ou appelez-nous : ${TAFDIL_TEL}`

  await sendWhatsApp(client_telephone, message)
}

// ── Notification livraison confirmée avec BL signé (T03) ──────────────────────

export interface LivraisonConfirmeeBLPayload {
  client_nom:        string
  client_telephone:  string | null
  client_email?:     string | null
  commande_ref:      string
  numero_bl:         string
  bl_signed_url:     string
}

/**
 * Notifie le client qu'il a reçu sa commande et lui transmet le bon de livraison
 * signé sous forme de lien signé 7 jours (SMS + WhatsApp).
 * L'email complet est envoyé séparément via sendBlEmail().
 */
export async function notifyLivraisonConfirmeeAvecBL(payload: LivraisonConfirmeeBLPayload): Promise<void> {
  const { client_nom, client_telephone, commande_ref, numero_bl, bl_signed_url } = payload
  const prenom = client_nom.split(' ')[0] || 'client'

  const smsMessage =
    `TAFDIL: Bonjour ${prenom}, votre commande ${commande_ref} a été livrée. ` +
    `Bon de livraison signé ${numero_bl} : ${bl_signed_url} ` +
    `(lien valide 7 jours).`

  const whatsappMessage =
    `✅ *TAFDIL FORGE* — Bonjour ${prenom} !\n\n` +
    `Votre commande *${commande_ref}* a bien été livrée.\n` +
    `📄 *Bon de livraison signé* : ${numero_bl}\n` +
    `🔗 Téléchargez votre BL : ${bl_signed_url}\n\n` +
    `Ce lien est valable 7 jours. Conservez le document pour toute réclamation.\n` +
    `Merci pour votre confiance !`

  if (client_telephone) {
    await sendWhatsApp(client_telephone, whatsappMessage)
    // Le SMS est en backup (le canal WhatsApp peut être down)
    await notifyCommandeSms(
      {
        numero:    commande_ref,
        client_nom,
        telephone: client_telephone,
        total_ttc_xaf: null,
      },
      'commande_livree',
    ).catch((e) => console.warn('[notif] sms livraison mybe failed:', e))
  }
}
