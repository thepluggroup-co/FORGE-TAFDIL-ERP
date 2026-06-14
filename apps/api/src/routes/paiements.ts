import { Hono } from 'hono'
import { createHmac } from 'crypto'
import { supabaseAdmin } from '@forge/db'
import { enregistrerPaiementCommande } from '../services/finance-core.service'
import { notifyWorkflow } from '../services/workflow-notifications.service'

const db = supabaseAdmin!

// ── Constants ──────────────────────────────────────────────────────────────────

const NOTCHPAY_API = 'https://api.notchpay.co'

// ── In-memory status cache (3s TTL) ───────────────────────────────────────────

const statusCache = new Map<string, { data: unknown; expires: number }>()

function getCached(ref: string) {
  const entry = statusCache.get(ref)
  if (entry && entry.expires > Date.now()) return entry.data
  return null
}

function setCache(ref: string, data: unknown) {
  statusCache.set(ref, { data, expires: Date.now() + 3_000 })
  // Nettoyage si cache trop grand
  if (statusCache.size > 500) {
    const now = Date.now()
    for (const [k, v] of statusCache.entries()) {
      if (v.expires < now) statusCache.delete(k)
    }
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function notchpayApiKey() {
  return process.env.NOTCHPAY_PUBLIC_KEY ?? process.env.NOTCHPAY_API_KEY ?? process.env.NOTCHPAY_SECRET_KEY ?? ''
}

function notchpayConfigured() {
  return Boolean(notchpayApiKey())
}

function notchpayHeader() {
  return {
    Authorization: notchpayApiKey(),
    'Content-Type': 'application/json',
    Accept: 'application/json',
  }
}

function normalizeStatus(status: unknown) {
  const value = String(status ?? 'pending').toLowerCase()
  if (value === 'paid') return 'complete'
  return value
}

function verifySignature(rawBody: string, header: string): boolean {
  const secret = process.env.NOTCHPAY_SECRET_KEY ?? ''
  if (!secret) return true // pas de clé configurée = skip en dev
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex')
  return expected === header
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
// Initialise un paiement Notchpay pour une commande web existante
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
  if (!notchpayConfigured()) {
    return c.json({ error: 'Notchpay non configure', code: 'PAYMENT_NOT_CONFIGURED' }, 503)
  }
  if (canal !== 'cm.mtn' && canal !== 'cm.orange') {
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

  // Appel Notchpay
  const siteUrl = process.env.SITE_URL ?? process.env.NEXT_PUBLIC_SITE_URL ?? 'https://shop.tafdil.cm'
  const payload: Record<string, unknown> = {
    amount:      montantPaiement,
    currency:    'XAF',
    email:       email ?? commande.client_email ?? 'client@forge.cm',
    reference:   commande_ref,
    description: commande.mode_paiement === 'livraison'
      ? `Avance commande FORGE Shop ${commande_ref}`
      : `Commande FORGE Shop ${commande_ref}`,
    callback:    `${siteUrl}/paiement-en-cours?commande_ref=${commande_ref}`,
    channel:     canal,
    channels:    [canal],
    locked_currency: 'XAF',
    locked_country:  'CM',
    locked_channel:  canal,
    phone,
    country:     'CM',
    customer: {
      name:  commande.client_nom ?? 'Client FORGE',
      email: email ?? commande.client_email ?? 'client@forge.cm',
      phone,
    },
    customer_meta: {
      commande_id:  commande.id,
      commande_ref: commande.ref,
    },
  }

  let notchJson: Record<string, unknown>
  try {
    const notchRes = await fetch(`${NOTCHPAY_API}/payments`, {
      method:  'POST',
      headers: notchpayHeader(),
      body:    JSON.stringify(payload),
    })

    notchJson = await notchRes.json() as Record<string, unknown>

    if (!notchRes.ok) {
      console.error('[notchpay] init error:', notchJson)
      return c.json({ error: 'Erreur Notchpay', details: notchJson }, 502)
    }
  } catch (e) {
    console.error('[notchpay] network error:', e)
    return c.json({ error: 'Notchpay injoignable' }, 503)
  }

  const transaction = notchJson.transaction as Record<string, unknown> | undefined
  const paymentRef  = (transaction?.reference ?? notchJson.reference ?? commande_ref) as string | undefined

  if (!paymentRef) {
    return c.json({ error: 'Référence paiement absente dans la réponse Notchpay' }, 502)
  }

  // Declencher le prompt Mobile Money sur le telephone du client
  let promptJson: Record<string, unknown> = {}
  try {
    const promptRes = await fetch(`${NOTCHPAY_API}/payments/${encodeURIComponent(paymentRef)}`, {
      method:  'POST',
      headers: notchpayHeader(),
      body:    JSON.stringify({
        channel: canal,
        data: {
          phone,
          account_number: phone,
          country: 'CM',
        },
      }),
    })

    promptJson = await promptRes.json().catch(() => ({})) as Record<string, unknown>

    if (!promptRes.ok) {
      console.error('[notchpay] prompt error:', promptJson)
      return c.json({ error: 'Prompt Mobile Money non initie', details: promptJson }, 502)
    }
  } catch (e) {
    console.error('[notchpay] prompt network error:', e)
    return c.json({ error: 'Prompt Mobile Money injoignable' }, 503)
  }

  await db
    .from('commandes_shop')
    .update({ payment_reference: paymentRef, updated_at: new Date().toISOString() })
    .eq('ref', commande_ref)

  return c.json({
    payment_reference: paymentRef,
    checkout_url:      transaction?.checkout_url ?? null,
    expires_at:        transaction?.expires_at   ?? null,
    status:            normalizeStatus(
      ((promptJson.transaction as Record<string, unknown> | undefined)?.status) ??
      transaction?.status ??
      'pending'
    ),
  }, 201)
})

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/paiements/:reference/statut
// Poll du statut d'un paiement (cache 3s)
// ══════════════════════════════════════════════════════════════════════════════

paiementsRouter.get('/:reference/statut', async (c) => {
  const reference = c.req.param('reference')
  c.header('Cache-Control', 'no-store')

  // Cache local 3s
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

  if (!notchpayConfigured()) {
    return c.json({
      statut:     'pending',
      montant:    null,
      devise:     'XAF',
      updated_at: new Date().toISOString(),
    })
  }

  let notchJson: Record<string, unknown>
  try {
    const notchRes = await fetch(`${NOTCHPAY_API}/payments/${reference}`, {
      headers: notchpayHeader(),
    })
    if (notchRes.status === 404) {
      return c.json({ error: 'Paiement introuvable' }, 404)
    }
    notchJson = await notchRes.json() as Record<string, unknown>
  } catch {
    return c.json({ error: 'Notchpay injoignable' }, 503)
  }

  const t = (notchJson.transaction ?? notchJson) as Record<string, unknown>
  const result = {
    statut:     normalizeStatus(t.status),
    montant:    t.amount     ?? null,
    devise:     t.currency   ?? 'XAF',
    updated_at: t.updated_at ?? t.created_at ?? new Date().toISOString(),
  }

  setCache(reference, result)
  return c.json(result)
})

// ══════════════════════════════════════════════════════════════════════════════
// POST /api/paiements/webhook
// Reçoit les événements Notchpay (appelé directement par Notchpay, sans CORS)
// ══════════════════════════════════════════════════════════════════════════════

paiementsRouter.post('/webhook', async (c) => {
  const rawBody  = await c.req.text()
  const sigHeader = c.req.header('x-notch-signature') ?? c.req.header('notch-signature') ?? ''

  // Vérification de signature
  if (!verifySignature(rawBody, sigHeader)) {
    console.warn('[security] Webhook Notchpay — signature invalide')
    return c.json({ error: 'Signature invalide' }, 401)
  }

  let payload: { event: string; data: Record<string, unknown> }
  try {
    payload = JSON.parse(rawBody)
  } catch {
    return c.json({ error: 'Payload invalide' }, 400)
  }

  const { event } = payload
  const data = (payload.data?.transaction ?? payload.data ?? {}) as Record<string, unknown>
  console.info(`[notchpay-webhook] ${event}`, data?.reference)

  // ── payment.complete ────────────────────────────────────────────────────────

  if (['payment.complete', 'payment.completed', 'payment.success', 'payment.paid'].includes(event)) {
    const reference = data.reference as string
    const amount    = Number(data.amount ?? 0)

    // Récupérer la commande
    const { data: commande, error: errFetch } = await db
      .from('commandes_shop')
      .select('id, ref, montant_ttc, mode_paiement, client_nom, client_telephone, client_adresse, lignes, erp_commande_id')
      .eq('payment_reference', reference)
      .single()

    if (errFetch || !commande) {
      console.error('[webhook] commande introuvable pour payment_reference:', reference)
      return c.json({ received: true }) // 200 pour éviter les retries Notchpay
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

    // Mise à jour statut paiement + commande
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

    // Synchronisation finance de la commande ERP liée
    if (commande.erp_commande_id) {
      try {
        await enregistrerPaiementCommande({
          commandeId:               commande.erp_commande_id,
          montantXaf:               amount,
          methode:                  'notchpay',
          referenceExt:             reference,
          datePaiement:             new Date().toISOString().slice(0, 10),
          notes:                    isPaiementTotal
            ? `Paiement NotchPay commande web ${commande.ref}`
            : `Avance NotchPay commande web ${commande.ref}`,
          ensureFacture:            true,
          factureStatutSiCreation:  isPaiementTotal ? 'paye' : 'envoye',
        })
      } catch (e) {
        console.error('[webhook] sync finance commande ERP:', e)
      }
    }

    // Le paiement ne sort pas le stock. La sortie physique est faite uniquement
    // par l'execution du bon de sortie par le magasinier.

    // Notifier l'ERP via Supabase Realtime
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
        ? `Commande ${commande.ref} payee via NotchPay.`
        : `Commande ${commande.ref} : avance recue, solde a encaisser a la livraison.`,
      ref:     commande.ref,
      url:     '/finance',
      data:    {
        montant_xaf: amount,
        total_xaf: totalCommande,
        mode_paiement: commande.mode_paiement,
        erp_commande_id: commande.erp_commande_id,
      },
    })

    // WhatsApp — client
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

    // WhatsApp — secrétaire TAFDIL
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

    // Invalidation cache statut
    statusCache.delete(reference)

    return c.json({ received: true })
  }

  // ── payment.failed / payment.cancelled ─────────────────────────────────────

  if (['payment.failed', 'payment.cancelled', 'payment.canceled', 'payment.expired'].includes(event)) {
    const reference = data.reference as string

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
