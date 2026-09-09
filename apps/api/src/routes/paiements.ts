import { Hono } from 'hono'
import { createHmac } from 'crypto'
import { supabaseAdmin } from '@forge/db'
import { enregistrerPaiementCommande } from '../services/finance-core.service'
import { resolveCommandeContext } from '../services/commande-workflow.service'
import { notifyWorkflow } from '../services/workflow-notifications.service'

const db = supabaseAdmin!

// ── Constants ──────────────────────────────────────────────────────────────────
// Référence : NOKASH API_PAYIN Documentation, NOKASH GLOBAL, juin 2025 (v407).

const NOKASH_API = 'https://api.nokash.app'
const NOKASH_INIT_PATH   = '/lapas-on-trans/trans/api-payin-request/407'
const NOKASH_STATUS_PATH = '/lapas-on-trans/trans/310/status-request'

type NokashApiResponse = {
  status:  string
  message: string
  data:    Record<string, unknown> | null
}

// ── In-memory status cache (3s TTL) ───────────────────────────────────────────

const statusCache = new Map<string, { data: unknown; expires: number }>()

function getCached(ref: string) {
  const entry = statusCache.get(ref)
  if (entry && entry.expires > Date.now()) return entry.data
  return null
}

function setCache(ref: string, data: unknown) {
  statusCache.set(ref, { data, expires: Date.now() + 3_000 })
  if (statusCache.size > 500) {
    const now = Date.now()
    for (const [k, v] of statusCache.entries()) {
      if (v.expires < now) statusCache.delete(k)
    }
  }
}

// ── Helpers NOKASH ─────────────────────────────────────────────────────────────

function nokashAppKey() {
  return process.env.NOKASH_APPLICATION_KEY ?? ''
}

function nokashIntegrationKey() {
  return process.env.NOKASH_INTEGRATION_KEY ?? ''
}

function nokashConfigured() {
  return Boolean(nokashAppKey() && nokashIntegrationKey())
}

// Signature exigée par NOKASH sur l'initiation : hmac-sha256(i_space_key, "orderId:amount:user_phone:app_space_key")
function nokashSignature(orderId: string, amount: number, userPhone: string): string {
  const payload = `${orderId}:${amount}:${userPhone}:${nokashAppKey()}`
  return createHmac('sha256', nokashIntegrationKey()).update(payload).digest('hex')
}

function nokashPaymentMethod(canal: string): 'MTN_MOMO' | 'ORANGE_MONEY' | null {
  if (canal === 'cm.mtn')    return 'MTN_MOMO'
  if (canal === 'cm.orange') return 'ORANGE_MONEY'
  return null
}

// Statuts NOKASH : PENDING, FAILED, CANCELED, TIMEOUT, SUCCESS
function normalizeStatus(status: unknown): 'complete' | 'failed' | 'pending' {
  const value = String(status ?? 'PENDING').toUpperCase()
  if (value === 'SUCCESS') return 'complete'
  if (value === 'FAILED' || value === 'CANCELED' || value === 'CANCELLED' || value === 'TIMEOUT') return 'failed'
  return 'pending'
}

async function nokashStatusRequest(transactionId: string): Promise<NokashApiResponse> {
  const res = await fetch(`${NOKASH_API}${NOKASH_STATUS_PATH}`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ transaction_id: transactionId }),
  })
  return await res.json() as NokashApiResponse
}

async function sendWhatsApp(to: string, message: string) {
  const token   = process.env.WHATSAPP_API_TOKEN ?? ''
  const phoneId = process.env.WHATSAPP_BUSINESS_PHONE_ID ?? ''
  if (!token || !phoneId) {
    console.info('[whatsapp]', to, message.slice(0, 80))
    return
  }
  await fetch(`https://graph.facebook.com/v20.0/${phoneId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to: to.replace(/\D/g, ''),
      type: 'text',
      text: { body: message },
    }),
  }).catch((e) => console.error('[whatsapp] send error:', e))
}

function fmt(n: number) {
  return new Intl.NumberFormat('fr-CM', { style: 'currency', currency: 'XAF', maximumFractionDigits: 0 }).format(n)
}

// ── Router ─────────────────────────────────────────────────────────────────────

export const paiementsRouter = new Hono()

// ══════════════════════════════════════════════════════════════════════════════
// POST /api/paiements/initier
// Initialise un paiement NOKASH (Mobile Money CM) pour une commande web existante
// ══════════════════════════════════════════════════════════════════════════════

paiementsRouter.post('/initier', async (c) => {
  const { commande_ref, montant, telephone, canal, email } = await c.req.json<{
    commande_ref: string
    montant?:     number
    telephone?:   string
    canal?:       string
    email?:       string
  }>()

  if (!commande_ref) {
    return c.json({ error: 'commande_ref est requis' }, 400)
  }
  if (!nokashConfigured()) {
    return c.json({ error: 'NOKASH non configuré', code: 'PAYMENT_NOT_CONFIGURED' }, 503)
  }
  const paymentMethod = nokashPaymentMethod(canal ?? '')
  if (!paymentMethod) {
    return c.json({ error: 'Canal Mobile Money invalide' }, 400)
  }

  const phone = telephone?.replace(/\D/g, '') ?? ''
  if (phone.length < 9) {
    return c.json({ error: 'Numero Mobile Money invalide' }, 400)
  }

  // Vérifier que la commande existe et est en attente de paiement
  const { data: commande, error: errCommande } = await db
    .from('commandes_shop')
    .select('id, ref, montant_ttc, statut_paiement, mode_paiement, client_nom, client_email, client_telephone')
    .eq('ref', commande_ref)
    .single()

  if (errCommande || !commande) {
    return c.json({ error: 'Commande introuvable' }, 404)
  }
  if (commande.statut_paiement === 'paye') {
    return c.json({ error: 'Cette commande est déjà payée' }, 409)
  }

  const totalCommande = Math.round(Number(commande.montant_ttc))
  const montantDemande = Math.round(Number(montant ?? totalCommande))
  const avancesLivraison = [30, 50, 70].map((pct) => Math.round(totalCommande * pct / 100))
  const montantPaiement = commande.mode_paiement === 'livraison'
    ? montantDemande
    : totalCommande

  if (commande.mode_paiement === 'livraison' && !avancesLivraison.some((m) => Math.abs(m - montantPaiement) <= 1)) {
    return c.json({
      error: 'Le paiement à la livraison exige une avance de 30%, 50% ou 70%',
      code: 'INVALID_DELIVERY_ADVANCE',
    }, 422)
  }

  // callback_url : optionnel côté NOKASH (clés production uniquement). Si absent,
  // on reste sur le polling client (/statut) qui fonctionne dans tous les cas.
  const callbackUrl = process.env.NOKASH_CALLBACK_URL || undefined

  const body: Record<string, unknown> = {
    i_space_key:    nokashIntegrationKey(),
    app_space_key:  nokashAppKey(),
    payment_type:   'CM_MOBILEMONEY',
    country:        'CM',
    payment_method: paymentMethod,
    order_id:       commande_ref,
    amount:         montantPaiement,
    user_data:      { user_phone: phone },
  }
  if (callbackUrl) body.callback_url = callbackUrl

  let nokashJson: NokashApiResponse
  try {
    const res = await fetch(`${NOKASH_API}${NOKASH_INIT_PATH}`, {
      method:  'POST',
      headers: {
        'Content-Type':   'application/json',
        'hmac-signature': nokashSignature(commande_ref, montantPaiement, phone),
      },
      body: JSON.stringify(body),
    })
    nokashJson = await res.json() as NokashApiResponse
  } catch (e) {
    console.error('[nokash] network error:', e)
    return c.json({ error: 'NOKASH injoignable' }, 503)
  }

  if (nokashJson.status !== 'REQUEST_OK' || !nokashJson.data) {
    console.error('[nokash] init error:', nokashJson)
    return c.json({ error: nokashJson.message || 'Erreur NOKASH', code: nokashJson.status }, 502)
  }

  const paymentRef = String(nokashJson.data.id ?? '')
  if (!paymentRef) {
    return c.json({ error: 'Référence paiement absente dans la réponse NOKASH' }, 502)
  }

  await db
    .from('commandes_shop')
    .update({ payment_reference: paymentRef, updated_at: new Date().toISOString() })
    .eq('ref', commande_ref)

  return c.json({
    payment_reference: paymentRef,
    checkout_url:      null,
    expires_at:        null,
    status:             normalizeStatus(nokashJson.data.status),
  }, 201)
})

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/paiements/:reference/statut
// Poll du statut d'un paiement (cache 3s)
// ══════════════════════════════════════════════════════════════════════════════

paiementsRouter.get('/:reference/statut', async (c) => {
  const reference = c.req.param('reference')
  c.header('Cache-Control', 'no-store')

  const cached = getCached(reference)
  if (cached) return c.json(cached)

  const { data: localCommande } = await db
    .from('commandes_shop')
    .select('statut_paiement, updated_at')
    .eq('payment_reference', reference)
    .maybeSingle()

  if (localCommande?.statut_paiement === 'paye') {
    const result = {
      statut:     'complete',
      montant:    null,
      devise:     'XAF',
      updated_at: localCommande.updated_at ?? new Date().toISOString(),
    }
    setCache(reference, result)
    return c.json(result)
  }

  if (localCommande?.statut_paiement === 'echec') {
    const result = {
      statut:     'failed',
      montant:    null,
      devise:     'XAF',
      updated_at: localCommande.updated_at ?? new Date().toISOString(),
    }
    setCache(reference, result)
    return c.json(result)
  }

  if (!nokashConfigured()) {
    return c.json({
      statut:     'pending',
      montant:    null,
      devise:     'XAF',
      updated_at: new Date().toISOString(),
    })
  }

  let nokashJson: NokashApiResponse
  try {
    nokashJson = await nokashStatusRequest(reference)
  } catch {
    return c.json({ error: 'NOKASH injoignable' }, 503)
  }

  if (nokashJson.status !== 'REQUEST_OK' || !nokashJson.data) {
    return c.json({ error: 'Paiement introuvable' }, 404)
  }

  const t = nokashJson.data
  const result = {
    statut:     normalizeStatus(t.status),
    montant:    t.amount ?? null,
    devise:     'XAF',
    updated_at: new Date().toISOString(),
  }

  setCache(reference, result)
  return c.json(result)
})

// ══════════════════════════════════════════════════════════════════════════════
// POST /api/paiements/webhook
// Reçoit callback_url NOKASH : { id, status, amount, phone, orderId }
// NOKASH ne documente aucune signature sur ce callback — on ne fait donc jamais
// confiance au corps reçu : on revérifie systématiquement le statut réel auprès
// de NOKASH (status-request) avant de marquer quoi que ce soit comme payé.
// ══════════════════════════════════════════════════════════════════════════════

paiementsRouter.post('/webhook', async (c) => {
  const payload = await c.req.json<{
    id?:      string
    status?:  string
    amount?:  number
    phone?:   string
    orderId?: string
  }>().catch(() => null)

  if (!payload?.id) {
    return c.json({ error: 'Payload invalide' }, 400)
  }

  let verified: NokashApiResponse
  try {
    verified = await nokashStatusRequest(payload.id)
  } catch (e) {
    console.error('[nokash-webhook] revérification impossible:', e)
    return c.json({ received: true }) // 200 — la revérification se refera au prochain poll client
  }

  if (verified.status !== 'REQUEST_OK' || !verified.data) {
    console.error('[nokash-webhook] revérification échouée pour', payload.id, verified)
    return c.json({ received: true })
  }

  const reference = payload.id
  const status    = normalizeStatus(verified.data.status)
  const amount    = Number(verified.data.amount ?? payload.amount ?? 0)

  console.info(`[nokash-webhook] ${reference} → ${status}`)

  // ── Paiement confirmé ────────────────────────────────────────────────────────

  if (status === 'complete') {
    const { data: commande, error: errFetch } = await db
      .from('commandes_shop')
      .select('id, ref, montant_ttc, mode_paiement, client_nom, client_telephone, client_adresse, lignes, erp_commande_id')
      .eq('payment_reference', reference)
      .single()

    if (errFetch || !commande) {
      console.error('[webhook] commande introuvable pour payment_reference:', reference)
      return c.json({ received: true }) // 200 pour éviter les retries NOKASH
    }

    const totalCommande = Number(commande.montant_ttc)
    const avancesLivraison = [30, 50, 70].map((pct) => Math.round(totalCommande * pct / 100))
    const isAcompteLivraison = commande.mode_paiement === 'livraison' &&
      avancesLivraison.some((m) => Math.abs(m - amount) <= 1)
    const isPaiementTotal = Math.abs(amount - totalCommande) <= 1

    // Anti-fraude : paiement total ou avance livraison autorisee uniquement.
    if (!isPaiementTotal && !isAcompteLivraison) {
      console.error(`[fraude] ref=${reference} attendu=${commande.montant_ttc} reçu=${amount}`)
      return c.json({ received: true })
    }

    const { error: errUpdate } = await db
      .from('commandes_shop')
      .update({
        statut_paiement: isPaiementTotal ? 'paye' : 'en_attente',
        statut_commande: 'confirmee',
        updated_at:      new Date().toISOString(),
      })
      .eq('id', commande.id)

    if (errUpdate) {
      console.error('[webhook] update commande_shop:', errUpdate)
      return c.json({ error: 'Erreur interne' }, 500)
    }

    const context = await resolveCommandeContext({
      erp_commande_id: (commande as { erp_commande_id?: string | null }).erp_commande_id ?? null,
      ref:             (commande as { ref?: string | null }).ref ?? null,
      commande_shop_id:(commande as { id?: string | null }).id ?? null,
    }).catch((e) => {
      console.error('[webhook] resolution commande ERP:', e)
      return null
    })

    if (context?.commandeId) {
      try {
        await enregistrerPaiementCommande({
          commandeId:               context.commandeId,
          montantXaf:               amount,
          methode:                  'NOKASH',
          referenceExt:             reference,
          datePaiement:             new Date().toISOString().slice(0, 10),
          notes:                    isPaiementTotal
            ? `Paiement NOKASH commande web ${commande.ref}`
            : `Avance NOKASH commande web ${commande.ref}`,
          ensureFacture:            true,
          factureStatutSiCreation:  isPaiementTotal ? 'paye' : 'envoye',
        })
      } catch (e) {
        console.error('[webhook] sync finance commande ERP:', e)
      }
    }

    // Le paiement ne sort pas le stock. La sortie physique est faite uniquement
    // par l'execution du bon de sortie par le magasinier.

    await db.channel('erp-notifications').send({
      type:    'broadcast',
      event:   'commande_web_payee',
      payload: {
        ref:        commande.ref,
        montant:    commande.montant_ttc,
        client_nom: commande.client_nom,
      },
    }).catch(() => {})

    await notifyWorkflow({
      event:   isPaiementTotal ? 'finance.paiement_shop_recu' : 'finance.avance_livraison_recue',
      module:  'finance',
      severite:'success',
      titre:   isPaiementTotal ? 'Paiement shop recu' : 'Avance livraison recue',
      message: isPaiementTotal
        ? `Commande ${commande.ref} payee via NOKASH.`
        : `Commande ${commande.ref} : avance recue, solde a encaisser a la livraison.`,
      ref:     commande.ref,
      url:     '/finance',
      data:    {
        montant_xaf: amount,
        total_xaf: totalCommande,
        mode_paiement: commande.mode_paiement,
        erp_commande_id: context?.commandeId ?? commande.erp_commande_id,
      },
    })

    const siteUrl = process.env.SITE_URL ?? 'https://shop.tafdil.cm'
    if (commande.client_telephone) {
      await sendWhatsApp(
        commande.client_telephone,
        `✅ Paiement reçu pour la commande *${commande.ref}*.\n` +
        `Montant : ${fmt(Number(commande.montant_ttc))}\n` +
        `Suivi : ${siteUrl}/suivi/${commande.ref}\n\n` +
        `Merci de votre confiance ! — TAFDIL`
      )
    }

    const tafdilTel = process.env.WHATSAPP_TAFDIL_NUMBER ?? ''
    if (tafdilTel) {
      await sendWhatsApp(
        tafdilTel,
        `🔔 *Nouvelle commande web payée*\n` +
        `Réf : ${commande.ref}\n` +
        `Client : ${commande.client_nom} (${commande.client_telephone ?? '—'})\n` +
        `Montant : ${fmt(Number(commande.montant_ttc))}\n` +
        `Livraison : ${commande.client_adresse ?? '—'}`
      )
    }

    statusCache.delete(reference)
    return c.json({ received: true })
  }

  // ── Paiement échoué / annulé / expiré ───────────────────────────────────────

  if (status === 'failed') {
    const { data: commande } = await db
      .from('commandes_shop')
      .select('ref, client_nom, client_telephone')
      .eq('payment_reference', reference)
      .single()

    if (commande) {
      await db
        .from('commandes_shop')
        .update({ statut_paiement: 'echec', updated_at: new Date().toISOString() })
        .eq('payment_reference', reference)

      if (commande.client_telephone) {
        await sendWhatsApp(
          commande.client_telephone,
          `❌ Paiement échoué pour la commande *${commande.ref}*.\n` +
          `Votre commande est conservée. Réessayez ou contactez-nous : +237 95 88 45 28`
        )
      }
    }

    statusCache.delete(reference)
    return c.json({ received: true })
  }

  return c.json({ received: true })
})
