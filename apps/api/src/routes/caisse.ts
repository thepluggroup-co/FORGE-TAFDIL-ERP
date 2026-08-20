import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { supabaseAdmin } from '@forge/db'
import { requirePermission } from '../middleware/permission.middleware'
import { creerBonApprovisionnementSiNecessaire } from '../services/stock-alerts.service'
import { CAISSIER_REMISE_MAX_PCT } from '../services/rbacService'
import { genererEcritureVenteCaisse } from '../services/comptabilite.service'
import { verifierEligibiliteCreditCaisse, penaliserRetardCaisse, DELAI_ECHEANCE_JOURS } from '../services/caisse-credit.service'
import { sendSms, normalizePhone } from '../services/sms.service'
import type { HonoVariables } from '../types'

const db = supabaseAdmin!

const router = new Hono<{ Variables: HonoVariables }>()

// ── TVA désactivée temporairement (demande explicite) — remettre à 0.1925
// pour réactiver. prix_unitaire_xaf reste la seule composante du total tant
// que la TVA est à 0.
const TVA_RATE = 0

function fmt(n: number) {
  return new Intl.NumberFormat('fr-CM', { style: 'currency', currency: 'XAF', maximumFractionDigits: 0 }).format(n)
}

/** Envoi WhatsApp client — même mécanisme que apps/api/src/routes/paiements.ts (Meta Business API). */
async function sendWhatsApp(to: string, message: string) {
  const token   = process.env.WHATSAPP_API_TOKEN ?? ''
  const phoneId = process.env.WHATSAPP_BUSINESS_PHONE_ID ?? ''
  if (!token || !phoneId) {
    console.info('[whatsapp:dry-run]', to, message.slice(0, 80))
    return { ok: true, skipped: true }
  }
  try {
    const res = await fetch(`https://graph.facebook.com/v20.0/${phoneId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: to.replace(/\D/g, ''),
        type: 'text',
        text: { body: message },
      }),
    })
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` }
    return { ok: true }
  } catch (e) {
    console.error('[whatsapp] send error:', e)
    return { ok: false, error: String(e) }
  }
}

function buildRecuMessage(ticket: {
  numero_facture: string | null
  total_ttc_xaf: number
  created_at: string
}): string {
  const date = new Date(ticket.created_at).toLocaleString('fr-CM')
  return `TAFDIL FORGE — Reçu de vente comptoir\n` +
    `Ticket : ${ticket.numero_facture ?? '—'}\n` +
    `Montant : ${fmt(ticket.total_ttc_xaf)}\n` +
    `Date : ${date}\n\n` +
    `Merci de votre confiance !`
}

// ── Schémas Zod ────────────────────────────────────────────────────────────────

const openSessionSchema = z.object({
  fond_ouverture_xaf: z.number().int().min(0),
})

const closeSessionSchema = z.object({
  fond_fermeture_xaf: z.number().int().min(0),
})

const ligneSchema = z.object({
  produit_id:        z.string().uuid().optional(),
  designation:       z.string().min(1).max(200),
  unite:             z.string().default('unité'),
  quantite:          z.number().positive(),
  prix_unitaire_xaf: z.number().int().min(0),
})

const paiementSchema = z.object({
  mode:             z.enum(['espece', 'orange_money', 'mtn_momo', 'credit', 'carte']),
  montant_xaf:      z.number().int().positive(),
  montant_recu_xaf: z.number().int().min(0).optional(),
  reference:        z.string().optional(),
})

const createTicketSchema = z.object({
  op_id:        z.string().min(1).max(100),
  numero_local: z.string().optional(),
  session_id:   z.string().uuid(),
  client_id:    z.string().uuid().optional(),
  client_nom:   z.string().optional(),
  remise_xaf:   z.number().int().min(0).default(0),
  lignes:       z.array(ligneSchema).min(1),
  paiements:    z.array(paiementSchema).min(1),
})

// ── Helpers ────────────────────────────────────────────────────────────────────

function isResponsable(role: HonoVariables['user']['role']): boolean {
  return role === 'admin' || role === 'superviseur'
}

/** Numérotation ticket — même mécanisme que genererNumero() dans finance-core.service.ts. */
async function genererNumeroTicket(): Promise<string> {
  const year = new Date().getFullYear()
  const { count } = await db
    .from('tickets_vente')
    .select('*', { count: 'exact', head: true })
    .gte('created_at', `${year}-01-01T00:00:00.000Z`)
  return `TCK-${year}-${String((count ?? 0) + 1).padStart(4, '0')}`
}

interface TicketRow {
  id:             string
  caissier_id:    string
  numero_facture: string | null
  numero_local:   string | null
  statut:         string
  total_ttc_xaf:  number
  oversell:       boolean
  created_at:     string
}

interface PaiementRow {
  ticket_id:   string
  mode:        string
  montant_xaf: number
}

/** Agrège les ventes d'une session pour la fermeture et le rapport Z. */
async function buildRapportZ(sessionId: string) {
  const { data: session, error: sessErr } = await db
    .from('caisse_sessions')
    .select('*')
    .eq('id', sessionId)
    .single()

  if (sessErr || !session) return null

  const { data: tickets } = await db
    .from('tickets_vente')
    .select('id, caissier_id, numero_facture, numero_local, statut, total_ttc_xaf, oversell, created_at')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: true })

  const ticketRows = (tickets ?? []) as TicketRow[]
  const ticketsValides = ticketRows.filter((t) => t.statut !== 'annule')
  const ticketIds = ticketsValides.map((t) => t.id)

  const parMode: Record<string, number> = { espece: 0, orange_money: 0, mtn_momo: 0, credit: 0, carte: 0 }

  if (ticketIds.length > 0) {
    const { data: paiementsData } = await db
      .from('paiements_ticket')
      .select('ticket_id, mode, montant_xaf')
      .in('ticket_id', ticketIds)

    for (const p of (paiementsData ?? []) as PaiementRow[]) {
      parMode[p.mode] = (parMode[p.mode] ?? 0) + p.montant_xaf
    }
  }

  return {
    session,
    tickets_count:    ticketsValides.length,
    total_ttc_xaf:    ticketsValides.reduce((s, t) => s + t.total_ttc_xaf, 0),
    par_mode:         parMode,
    ventes_oversell:  ticketsValides.filter((t) => t.oversell).length,
    tickets:          ticketRows,
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// POST /api/caisse/sessions — ouvrir une session
// ══════════════════════════════════════════════════════════════════════════════

router.post(
  '/sessions',
  requirePermission('CAISSE', 'CREATE'),
  zValidator('json', openSessionSchema),
  async (c) => {
    const user = c.get('user')
    const body = c.req.valid('json')

    const { data: existing } = await db
      .from('caisse_sessions')
      .select('id')
      .eq('caissier_id', user.id)
      .eq('statut', 'ouverte')
      .maybeSingle()

    if (existing) {
      return c.json(
        { error: 'Une session de caisse est déjà ouverte', code: 'SESSION_ALREADY_OPEN', session_id: (existing as { id: string }).id },
        409,
      )
    }

    const { data, error } = await db
      .from('caisse_sessions')
      .insert({
        caissier_id:        user.id,
        fond_ouverture_xaf: body.fond_ouverture_xaf,
        statut:              'ouverte',
        sync_status:          'synced',
      })
      .select()
      .single()

    if (error) return c.json({ error: error.message, code: error.code }, 400)
    return c.json(data, 201)
  },
)

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/caisse/sessions/courante — la session ouverte de l'appelant (ou null)
// Nécessaire pour que l'écran web sache, au chargement, s'il doit afficher
// l'ouverture de session ou directement l'écran de vente (PROMPT 4).
// ══════════════════════════════════════════════════════════════════════════════

router.get(
  '/sessions/courante',
  requirePermission('CAISSE', 'READ'),
  async (c) => {
    const user = c.get('user')

    const { data, error } = await db
      .from('caisse_sessions')
      .select('*')
      .eq('caissier_id', user.id)
      .eq('statut', 'ouverte')
      .maybeSingle()

    if (error) return c.json({ error: error.message, code: error.code }, 400)
    return c.json(data ?? null)
  },
)

// ══════════════════════════════════════════════════════════════════════════════
// PATCH /api/caisse/sessions/:id/close — fermer, calculer l'écart, rapport Z
// ══════════════════════════════════════════════════════════════════════════════

router.patch(
  '/sessions/:id/close',
  requirePermission('CAISSE', 'UPDATE'),
  zValidator('json', closeSessionSchema),
  async (c) => {
    const { id } = c.req.param()
    const user = c.get('user')
    const body = c.req.valid('json')

    const { data: session, error: sessErr } = await db
      .from('caisse_sessions')
      .select('*')
      .eq('id', id)
      .single()

    if (sessErr || !session) return c.json({ error: 'Session introuvable', code: 'NOT_FOUND' }, 404)

    const s = session as { caissier_id: string; statut: string; fond_ouverture_xaf: number }

    if (!isResponsable(user.role) && s.caissier_id !== user.id) {
      return c.json({ error: 'Vous ne pouvez fermer que votre propre session', code: 'FORBIDDEN' }, 403)
    }
    if (s.statut === 'fermee') {
      return c.json({ error: 'Session déjà fermée', code: 'ALREADY_CLOSED' }, 409)
    }

    const rapport = await buildRapportZ(id)
    if (!rapport) return c.json({ error: 'Session introuvable', code: 'NOT_FOUND' }, 404)

    const totalEspeces      = rapport.par_mode.espece ?? 0
    const montantTheorique  = s.fond_ouverture_xaf + totalEspeces
    const ecart              = body.fond_fermeture_xaf - montantTheorique

    const { data: updated, error: updErr } = await db
      .from('caisse_sessions')
      .update({
        statut:              'fermee',
        date_fermeture:      new Date().toISOString(),
        fond_fermeture_xaf:  body.fond_fermeture_xaf,
        total_especes_xaf:   totalEspeces,
        total_om_xaf:        rapport.par_mode.orange_money ?? 0,
        total_momo_xaf:      rapport.par_mode.mtn_momo ?? 0,
        total_credit_xaf:    rapport.par_mode.credit ?? 0,
        ecart_xaf:           ecart,
        updated_at:          new Date().toISOString(),
      })
      .eq('id', id)
      .select()
      .single()

    if (updErr) return c.json({ error: updErr.message, code: updErr.code }, 400)

    return c.json({ ...rapport, session: updated, ecart_xaf: ecart, montant_theorique_xaf: montantTheorique })
  },
)

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/caisse/sessions/:id/rapport-z — rapport journalier
// ══════════════════════════════════════════════════════════════════════════════

router.get(
  '/sessions/:id/rapport-z',
  requirePermission('CAISSE', 'READ'),
  async (c) => {
    const { id } = c.req.param()
    const user = c.get('user')

    const rapport = await buildRapportZ(id)
    if (!rapport) return c.json({ error: 'Session introuvable', code: 'NOT_FOUND' }, 404)

    const s = rapport.session as { caissier_id: string }
    if (!isResponsable(user.role) && s.caissier_id !== user.id) {
      return c.json({ error: 'Accès réservé à votre propre session', code: 'FORBIDDEN' }, 403)
    }

    return c.json(rapport)
  },
)

// ══════════════════════════════════════════════════════════════════════════════
// POST /api/caisse/tickets — créer un ticket de vente (IDEMPOTENT sur op_id)
// ══════════════════════════════════════════════════════════════════════════════

router.post(
  '/tickets',
  requirePermission('CAISSE', 'CREATE'),
  zValidator('json', createTicketSchema),
  async (c) => {
    const user = c.get('user')
    const body = c.req.valid('json')

    // ── Requêtes indépendantes lancées en parallèle (au lieu de 3 aller-retours
    // séquentiels) : c'est ce qui faisait dépasser le timeout client de 15s sur
    // connexion Supabase lente/à froid — chaque round-trip s'additionnait plutôt
    // que de se chevaucher. numeroFacture est calculé même sur le chemin
    // idempotent (petit gaspillage rare, largement compensé sur le chemin normal).
    const [
      { data: existingTicket },
      { data: session, error: sessErr },
      numeroFacture,
    ] = await Promise.all([
      db.from('tickets_vente').select('*').eq('op_id', body.op_id).maybeSingle(),
      db.from('caisse_sessions').select('id, caissier_id, statut').eq('id', body.session_id).single(),
      genererNumeroTicket(),
    ])

    // ── Idempotence : op_id déjà traité → renvoyer le ticket existant, 200,
    // SANS re-décrémenter le stock ni ré-encaisser. ──────────────────────────
    if (existingTicket) {
      const ticketId = (existingTicket as { id: string }).id
      const [{ data: lignes }, { data: paiements }] = await Promise.all([
        db.from('lignes_ticket').select('*').eq('ticket_id', ticketId).order('ordre'),
        db.from('paiements_ticket').select('*').eq('ticket_id', ticketId),
      ])
      return c.json({ ...existingTicket, lignes: lignes ?? [], paiements: paiements ?? [], idempotent: true }, 200)
    }

    // ── Session ──────────────────────────────────────────────────────────────
    if (sessErr || !session) return c.json({ error: 'Session de caisse introuvable', code: 'NOT_FOUND' }, 404)
    const s = session as { id: string; caissier_id: string; statut: string }
    if (s.statut !== 'ouverte') return c.json({ error: 'Session de caisse fermée', code: 'SESSION_CLOSED' }, 409)
    if (!isResponsable(user.role) && s.caissier_id !== user.id) {
      return c.json({ error: 'Vous ne pouvez vendre que sur votre propre session', code: 'FORBIDDEN' }, 403)
    }

    // ── Totaux recalculés côté serveur — jamais fiés au payload client ────────
    const brutHt = body.lignes.reduce((sum, l) => sum + l.quantite * l.prix_unitaire_xaf, 0)

    // Plafond de remise caissier (PROMPT 1) — appliqué ici, pas seulement côté UI,
    // sinon un appel direct à l'API contournerait la règle.
    if (!isResponsable(user.role) && body.remise_xaf > 0) {
      const remisePct = brutHt > 0 ? (body.remise_xaf / brutHt) * 100 : 0
      if (remisePct > CAISSIER_REMISE_MAX_PCT) {
        return c.json({
          error: `Remise limitée à ${CAISSIER_REMISE_MAX_PCT}% pour un caissier — remise demandée : ${remisePct.toFixed(1)}%. Un responsable doit valider au-delà.`,
          code: 'REMISE_LIMIT_EXCEEDED',
        }, 403)
      }
    }

    const totalHt  = Math.max(0, Math.round(brutHt) - body.remise_xaf)
    const tva      = Math.round(totalHt * TVA_RATE)
    const totalTtc = totalHt + tva

    const sommePaiements = body.paiements.reduce((s2, p) => s2 + p.montant_xaf, 0)
    if (sommePaiements !== totalTtc) {
      return c.json({
        error: `Le total des paiements (${sommePaiements} XAF) ne correspond pas au total du ticket (${totalTtc} XAF)`,
        code: 'PAYMENT_MISMATCH',
      }, 422)
    }

    // ── Crédit — score de fiabilité caisse (règle métier : tout client est
    // éligible par défaut avec un score de 10/10, cf. caisse-credit.service.ts —
    // pas besoin de provisionner customer_credit_limits pour être éligible).
    // Un plafond via customer_credit_limits reste appliqué EN PLUS si un
    // responsable en a configuré un pour ce client spécifiquement.
    const creditPaiement = body.paiements.find((p) => p.mode === 'credit')
    if (creditPaiement) {
      if (!body.client_id) {
        return c.json({ error: 'Un client identifié est requis pour une vente à crédit', code: 'CREDIT_NO_CLIENT' }, 422)
      }

      const eligibilite = await verifierEligibiliteCreditCaisse(body.client_id)
      if (!eligibilite.eligible) {
        return c.json({
          error: eligibilite.raison ?? "Ce client n'est pas éligible au crédit comptoir",
          code:  'CREDIT_NOT_ELIGIBLE',
          score: eligibilite.score,
        }, 403)
      }

      const { data: limite } = await db
        .from('customer_credit_limits')
        .select('max_credit_amount')
        .eq('customer_id', body.client_id)
        .eq('is_active', true)
        .maybeSingle()

      if (limite) {
        const { data: client } = await db
          .from('clients')
          .select('encours_credit_xaf')
          .eq('id', body.client_id)
          .single()

        const encours      = (client as { encours_credit_xaf?: number } | null)?.encours_credit_xaf ?? 0
        const maxCreditXaf = (limite as { max_credit_amount: number }).max_credit_amount

        if (encours + creditPaiement.montant_xaf > maxCreditXaf) {
          return c.json({
            error: `Plafond crédit dépassé — encours ${encours} XAF + ${creditPaiement.montant_xaf} XAF > plafond ${maxCreditXaf} XAF`,
            code: 'CREDIT_LIMIT_EXCEEDED',
          }, 403)
        }
      }
    }

    // ── Insertion ticket (non-atomique — compensée manuellement ci-dessous,
    // même stratégie que creerBonApprovisionnementSiNecessaire) ──────────────
    const { data: ticket, error: ticketErr } = await db
      .from('tickets_vente')
      .insert({
        op_id:          body.op_id,
        numero_local:   body.numero_local ?? null,
        numero_facture: numeroFacture,
        session_id:     body.session_id,
        caissier_id:    user.id,
        client_id:      body.client_id ?? null,
        client_nom:     body.client_nom ?? null,
        total_ht_xaf:   totalHt,
        tva_xaf:        tva,
        total_ttc_xaf:  totalTtc,
        remise_xaf:     body.remise_xaf,
        statut:         'paye',
        sync_status:    'synced',
      })
      .select()
      .single()

    if (ticketErr || !ticket) {
      // Course rare : un autre appel avec le même op_id a gagné entre notre
      // check d'idempotence et cet insert → traiter comme idempotent.
      if (ticketErr?.code === '23505') {
        const { data: concurrentTicket } = await db.from('tickets_vente').select('*').eq('op_id', body.op_id).single()
        if (concurrentTicket) return c.json({ ...concurrentTicket, idempotent: true }, 200)
      }
      return c.json({ error: ticketErr?.message ?? 'Erreur création ticket', code: ticketErr?.code }, 400)
    }

    const ticketId = (ticket as { id: string }).id
    const stockDecremente: string[] = []   // produit_id déjà décrémentés — pour ne JAMAIS les rollback

    try {
      // ── Lignes + paiements — indépendants (ne se référencent pas l'un
      // l'autre, tous deux juste besoin de ticketId) → insérés en parallèle. ──
      const lignesPayload = body.lignes.map((l, i) => ({
        ticket_id:         ticketId,
        produit_id:        l.produit_id ?? null,
        designation:       l.designation,
        unite:             l.unite,
        quantite:          l.quantite,
        prix_unitaire_xaf: l.prix_unitaire_xaf,
        total_ligne_xaf:   Math.round(l.quantite * l.prix_unitaire_xaf),
        ordre:             i,
      }))

      const echeanceCredit = new Date(Date.now() + DELAI_ECHEANCE_JOURS * 86_400_000).toISOString().slice(0, 10)
      const paiementsPayload = body.paiements.map((p) => ({
        ticket_id:        ticketId,
        mode:             p.mode,
        montant_xaf:      p.montant_xaf,
        montant_recu_xaf: p.montant_recu_xaf ?? null,
        rendu_xaf:        p.mode === 'espece' && p.montant_recu_xaf != null
          ? Math.max(0, p.montant_recu_xaf - p.montant_xaf)
          : null,
        reference:            p.reference ?? null,
        date_echeance:        p.mode === 'credit' ? echeanceCredit : null,
        statut_remboursement: p.mode === 'credit' ? 'en_attente' : null,
        sync_status:      'synced',
      }))

      const [{ error: lignesErr }, { error: paiementsErr }] = await Promise.all([
        db.from('lignes_ticket').insert(lignesPayload),
        db.from('paiements_ticket').insert(paiementsPayload),
      ])
      if (lignesErr)    throw Object.assign(new Error(lignesErr.message), { code: lignesErr.code })
      if (paiementsErr) throw Object.assign(new Error(paiementsErr.message), { code: paiementsErr.code })

      // ── Décrément stock — atomique PAR LIGNE (verrou SELECT FOR UPDATE côté
      // fn_mouvement_stock_vente), jamais bloquant même si le stock passe sous 0.
      // Lignes indépendantes (produits différents dans l'immense majorité des
      // cas) → tirées en parallèle plutôt qu'une à une ; allSettled pour ne
      // perdre aucun décrément déjà appliqué si l'une d'elles échoue.
      let ticketOversell = false
      const produitIdsOversell: string[] = []

      const lignesAvecProduit = body.lignes.filter((l) => l.produit_id)
      const rpcResults = await Promise.allSettled(
        lignesAvecProduit.map((l) =>
          (db as never as {
            rpc: (fn: string, args: Record<string, unknown>) => Promise<{
              data: { oversell?: boolean } | null
              error: { message: string } | null
            }>
          }).rpc('fn_mouvement_stock_vente', {
            p_produit_id: l.produit_id,
            p_quantite:   l.quantite,
            p_reference:  numeroFacture,
            p_notes:      `Vente comptoir — ticket ${numeroFacture}`,
            p_user_id:    user.id,
          }).then((res) => {
            if (res.error) throw Object.assign(new Error(res.error.message), { code: 'STOCK_RPC_ERROR' })
            return { produitId: l.produit_id as string, oversell: res.data?.oversell ?? false }
          }),
        ),
      )

      let stockRpcError: Error | null = null
      for (const r of rpcResults) {
        if (r.status === 'fulfilled') {
          // Décrément appliqué en base — ne plus jamais le rollback, même si
          // une autre ligne échoue : le stock a physiquement bougé.
          stockDecremente.push(r.value.produitId)
          if (r.value.oversell) {
            ticketOversell = true
            produitIdsOversell.push(r.value.produitId)
          }
        } else {
          stockRpcError = r.reason instanceof Error ? r.reason : new Error(String(r.reason))
        }
      }
      if (stockRpcError) throw stockRpcError

      // ── Imputation encours crédit ────────────────────────────────────────
      if (creditPaiement && body.client_id) {
        const { data: clientNow } = await db.from('clients').select('encours_credit_xaf').eq('id', body.client_id).single()
        const encoursActuel = (clientNow as { encours_credit_xaf?: number } | null)?.encours_credit_xaf ?? 0
        await db.from('clients').update({
          encours_credit_xaf: encoursActuel + creditPaiement.montant_xaf,
          updated_at:          new Date().toISOString(),
        }).eq('id', body.client_id)
      }

      // ── Flag oversell + alerte réappro + écriture comptable — VRAIMENT non
      // bloquant cette fois : ni attendu ni capable de retarder la réponse.
      // La vente est déjà encaissée physiquement au comptoir ; ces 3 étapes
      // ne doivent jamais faire attendre le caissier ni faire échouer le ticket.
      if (ticketOversell) {
        void db.from('tickets_vente').update({ oversell: true }).eq('id', ticketId).then(({ error }) => {
          if (error) console.error('[caisse] flag oversell échoué (non bloquant):', error.message)
        })
        void creerBonApprovisionnementSiNecessaire(ticketId, produitIdsOversell, user.id).catch((e) =>
          console.error('[caisse] alerte réappro échouée (non bloquant):', e),
        )
      }

      void genererEcritureVenteCaisse({
        id:            ticketId,
        numero:        numeroFacture,
        date:          (ticket as { created_at: string }).created_at,
        client_nom:    body.client_nom ?? null,
        total_ht_xaf:  totalHt,
        tva_xaf:       tva,
        created_by:    user.id,
        paiements:     body.paiements,
      }).catch((e) => console.error('[caisse] écriture comptable échouée (non bloquant):', e))

      return c.json({
        ...ticket,
        oversell:  ticketOversell,
        lignes:    lignesPayload,
        paiements: paiementsPayload,
      }, 201)

    } catch (err) {
      const e = err as Error & { code?: string }

      if (stockDecremente.length > 0) {
        // Le stock a déjà bougé pour au moins un produit — supprimer le ticket
        // créerait un mouvement_stock orphelin invisible en compta. On garde le
        // ticket, on le marque pour reprise manuelle plutôt que de masquer la
        // perte de données.
        console.error(
          '[caisse] ÉCHEC PARTIEL après décrément stock — reprise manuelle requise',
          { ticketId, numeroFacture, stockDecremente, err: e.message },
        )
        try {
          await db.from('tickets_vente').update({
            statut: 'annule',
            notes:  `ERREUR création ticket après décrément stock (${stockDecremente.length} produit(s)) : ${e.message} — reprise manuelle requise`,
          }).eq('id', ticketId)
        } catch { /* best-effort — l'erreur principale est déjà loguée ci-dessus */ }

        return c.json({
          error: 'Erreur lors de la création du ticket après décrément du stock — reprise manuelle requise, contactez le support',
          code:  'PARTIAL_FAILURE_MANUAL_REVIEW',
          ticket_id: ticketId,
          numero_facture: numeroFacture,
          details: e.message,
        }, 500)
      }

      // Rien n'a encore touché le stock — rollback complet sûr.
      console.error('[caisse] échec création ticket, rollback complet:', e)
      await Promise.all([
        db.from('lignes_ticket').delete().eq('ticket_id', ticketId),
        db.from('paiements_ticket').delete().eq('ticket_id', ticketId),
      ])
      await db.from('tickets_vente').delete().eq('id', ticketId)

      return c.json({ error: e.message, code: e.code ?? 'TICKET_CREATION_FAILED' }, 500)
    }
  },
)

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/caisse/tickets — historique des ventes (paginé, filtrable)
// ══════════════════════════════════════════════════════════════════════════════

router.get(
  '/tickets',
  requirePermission('CAISSE', 'READ'),
  async (c) => {
    const user = c.get('user')
    const q = c.req.query()
    const page    = Math.max(1, parseInt(q.page ?? '1'))
    const perPage = Math.min(100, Math.max(1, parseInt(q.per_page ?? '20')))
    const from = (page - 1) * perPage
    const to   = from + perPage - 1

    let query = db.from('tickets_vente').select('*', { count: 'exact' })

    // Un caissier ne voit que ses propres ventes ; un responsable peut tout
    // voir, ou filtrer par caissier_id explicitement.
    if (!isResponsable(user.role)) {
      query = query.eq('caissier_id', user.id)
    } else if (q.caissier_id) {
      query = query.eq('caissier_id', q.caissier_id)
    }

    if (q.session_id)  query = query.eq('session_id', q.session_id)
    if (q.statut)      query = query.eq('statut', q.statut)
    if (q.date_debut)  query = query.gte('created_at', q.date_debut)
    if (q.date_fin)    query = query.lte('created_at', `${q.date_fin}T23:59:59.999Z`)

    const { data, count, error } = await query
      .order('created_at', { ascending: false })
      .range(from, to)

    if (error) return c.json({ error: error.message, code: error.code }, 500)

    return c.json({
      data,
      total:       count ?? 0,
      page,
      per_page:    perPage,
      total_pages: Math.ceil((count ?? 0) / perPage),
    })
  },
)

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/caisse/tickets/:id — détail d'un ticket (lignes + paiements), pour
// le clic "voir détail" depuis l'historique (impression / renvoi du reçu).
// ══════════════════════════════════════════════════════════════════════════════

router.get(
  '/tickets/:id',
  requirePermission('CAISSE', 'READ'),
  async (c) => {
    const { id } = c.req.param()
    const user = c.get('user')

    const { data: ticket, error } = await db.from('tickets_vente').select('*').eq('id', id).single()
    if (error || !ticket) return c.json({ error: 'Ticket introuvable', code: 'NOT_FOUND' }, 404)

    const t = ticket as { caissier_id: string }
    if (!isResponsable(user.role) && t.caissier_id !== user.id) {
      return c.json({ error: 'Accès réservé à vos propres tickets', code: 'FORBIDDEN' }, 403)
    }

    const [{ data: lignes }, { data: paiements }] = await Promise.all([
      db.from('lignes_ticket').select('*').eq('ticket_id', id).order('ordre'),
      db.from('paiements_ticket').select('*').eq('ticket_id', id),
    ])

    return c.json({ ...ticket, lignes: lignes ?? [], paiements: paiements ?? [] })
  },
)

// ══════════════════════════════════════════════════════════════════════════════
// POST /api/caisse/tickets/:id/envoyer — envoyer le reçu par WhatsApp ou SMS
// ══════════════════════════════════════════════════════════════════════════════

const envoyerRecuSchema = z.object({
  canal:      z.enum(['whatsapp', 'sms']),
  telephone:  z.string().optional(),
})

router.post(
  '/tickets/:id/envoyer',
  requirePermission('CAISSE', 'READ'),
  zValidator('json', envoyerRecuSchema),
  async (c) => {
    const { id } = c.req.param()
    const user = c.get('user')
    const body = c.req.valid('json')

    const { data: ticket, error } = await db
      .from('tickets_vente')
      .select('id, caissier_id, client_id, numero_facture, total_ttc_xaf, created_at')
      .eq('id', id)
      .single()

    if (error || !ticket) return c.json({ error: 'Ticket introuvable', code: 'NOT_FOUND' }, 404)

    const t = ticket as { id: string; caissier_id: string; client_id: string | null; numero_facture: string | null; total_ttc_xaf: number; created_at: string }

    if (!isResponsable(user.role) && t.caissier_id !== user.id) {
      return c.json({ error: 'Vous ne pouvez envoyer que vos propres tickets', code: 'FORBIDDEN' }, 403)
    }

    let telephone = body.telephone ?? null
    if (!telephone && t.client_id) {
      const { data: client } = await db.from('clients').select('telephone').eq('id', t.client_id).single()
      telephone = (client as { telephone?: string | null } | null)?.telephone ?? null
    }
    if (!telephone) {
      return c.json({ error: 'Aucun numéro de téléphone — précisez-en un ou sélectionnez un client sur le ticket', code: 'NO_PHONE' }, 422)
    }

    const message = buildRecuMessage(t)

    const result = body.canal === 'sms'
      ? await sendSms(telephone, message)
      : await sendWhatsApp(normalizePhone(telephone) ?? telephone, message)

    if (!result.ok) {
      return c.json({ error: `Envoi ${body.canal} échoué`, code: 'SEND_FAILED', details: result }, 502)
    }

    return c.json({ ok: true, canal: body.canal, telephone, skipped: (result as { skipped?: boolean }).skipped ?? false })
  },
)

// ══════════════════════════════════════════════════════════════════════════════
// PATCH /api/caisse/paiements/:id/rembourser — solder une échéance crédit comptoir
// ══════════════════════════════════════════════════════════════════════════════

router.patch(
  '/paiements/:id/rembourser',
  requirePermission('CAISSE', 'UPDATE'),
  async (c) => {
    const { id } = c.req.param()

    const { data: paiement, error } = await db
      .from('paiements_ticket')
      .select('id, ticket_id, mode, montant_xaf, date_echeance, statut_remboursement, tickets_vente(client_id)')
      .eq('id', id)
      .single()

    if (error || !paiement) return c.json({ error: 'Paiement introuvable', code: 'NOT_FOUND' }, 404)

    const p = paiement as unknown as {
      id: string; ticket_id: string; mode: string; montant_xaf: number
      date_echeance: string | null; statut_remboursement: string | null
      tickets_vente: { client_id: string | null } | null
    }

    if (p.mode !== 'credit') {
      return c.json({ error: "Ce paiement n'est pas un crédit — rien à rembourser", code: 'NOT_CREDIT' }, 422)
    }
    if (p.statut_remboursement === 'paye') {
      return c.json({ error: 'Ce crédit est déjà remboursé', code: 'ALREADY_PAID' }, 409)
    }

    const now = new Date()
    const { error: upErr } = await db
      .from('paiements_ticket')
      .update({ statut_remboursement: 'paye', date_remboursement: now.toISOString() })
      .eq('id', id)

    if (upErr) return c.json({ error: upErr.message, code: upErr.code }, 400)

    const clientId = p.tickets_vente?.client_id
    if (clientId) {
      // Encours crédit diminué du montant remboursé.
      const { data: client } = await db.from('clients').select('encours_credit_xaf').eq('id', clientId).single()
      const encoursActuel = (client as { encours_credit_xaf?: number } | null)?.encours_credit_xaf ?? 0
      await db.from('clients').update({
        encours_credit_xaf: Math.max(0, encoursActuel - p.montant_xaf),
        updated_at:          now.toISOString(),
      }).eq('id', clientId)
    }

    // Réglé après l'échéance et pas déjà marqué en_retard par le cron (sinon
    // déjà pénalisé) → pénalité appliquée maintenant plutôt que d'attendre le
    // prochain passage du cron.
    const enRetard = Boolean(p.date_echeance) && p.date_echeance! < now.toISOString().slice(0, 10)
    let score: number | undefined
    if (enRetard && p.statut_remboursement !== 'en_retard' && clientId) {
      const penalite = await penaliserRetardCaisse(clientId, p.ticket_id)
      score = penalite.nouveauScore
    }

    return c.json({ ok: true, paiement_id: id, en_retard: enRetard, score })
  },
)

export { router as caisseRouter }
