import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { supabaseAdmin } from '@forge/db'

const db = supabaseAdmin!
import { requireRole } from '../middleware/rbac'
import { localCreateBon, localValiderBon, getBonsSortieLocal } from '../services/db-local'
import { withOfflineFallback } from '../services/offline-fallback'
import {
  ensureWorkflowApresExecutionBon,
  ensureWorkflowApresPreparationBon,
  resolveCommandeContext,
} from '../services/commande-workflow.service'
import { genererEcritureBonSortieInterne } from '../services/comptabilite.service'
import { creerBonApprovisionnementSiNecessaire } from '../services/stock-alerts.service'
import { sendWhatsApp } from '../services/notifications'
import { notifyWorkflow } from '../services/workflow-notifications.service'
import type { HonoVariables } from '../types'

async function notifyDgBonSoumis(numero: string, demandeur: string, motif: string, nbLignes: number) {
  const dgPhone = process.env.DIRECTEUR_WHATSAPP_PHONE
  if (!dgPhone) return
  const appUrl = process.env.MOBILE_APP_URL ?? ''
  const msg =
    `📦 *TAFDIL FORGE — Bon de sortie à valider*\n` +
    `Numéro : *${numero}*\n` +
    `Demandeur : ${demandeur}\n` +
    `Motif : ${motif}\n` +
    `Articles : ${nbLignes} ligne${nbLignes > 1 ? 's' : ''}\n` +
    (appUrl ? `\nOuvrir l'app : ${appUrl}` : '')
  await sendWhatsApp(dgPhone, msg).catch(e => console.error('[bons] notify DG:', e))
}

const router = new Hono<{ Variables: HonoVariables }>()

// ── Schémas Zod ────────────────────────────────────────────────────────────────

const ligneSchema = z.object({
  produit_id:        z.string().optional(),
  designation:       z.string().min(1),
  unite:             z.string().default('unité'),
  quantite_demandee: z.number().positive(),
})

const createBonSchema = z.object({
  demandeur:          z.string().min(1),
  motif:              z.string().min(1),
  notes:              z.string().optional(),
  commande_id:        z.string().uuid().optional(),
  nature_transaction: z.enum(['comptant', 'credit', 'deduction_acompte']),
  imputation_payeur:  z.enum(['entreprise_tafdil', 'atelier', 'administration']),
  lignes:             z.array(ligneSchema).min(1),
})

const validerBonSchema = z.object({
  decision:    z.enum(['valide', 'refuse']),
  commentaire: z.string().optional(),
})

const executerBonSchema = z.object({
  code_unique:     z.string().min(1),
  quantites_reelles: z.array(z.object({
    ligne_id:        z.string(),
    quantite_servie: z.number().min(0),
  })).optional(),
})

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Génère un numéro bon : TAF-YYYYMMDD-XXXX */
async function genererNumeroBon(): Promise<string> {
  const today = new Date()
  const yyyymmdd = today.toISOString().slice(0, 10).replace(/-/g, '')
  const startOfDay = `${today.toISOString().slice(0, 10)}T00:00:00.000Z`

  const { count } = await db
    .from('bons_sortie')
    .select('*', { count: 'exact', head: true })
    .gte('created_at', startOfDay)

  const seq = String((count ?? 0) + 1).padStart(4, '0')
  return `TAF-${yyyymmdd}-${seq}`
}

/** Notifie via Supabase Realtime Broadcast */
async function broadcastBon(event: string, payload: Record<string, unknown>): Promise<void> {
  try {
    const channel = db.channel('forge-bons')
    await channel.send({ type: 'broadcast', event, payload })
    db.removeChannel(channel)
  } catch {
    // Realtime non critique — ne pas bloquer la réponse
  }
}

// ── Garde-fous métier : nature_transaction ↔ commande ─────────────────────────

async function checkNatureCompatibilite(
  nature: string,
  commande_id: string | null,
): Promise<void> {
  if (['credit', 'deduction_acompte'].includes(nature) && !commande_id) {
    throw Object.assign(
      new Error(`Nature "${nature}" requiert une commande liée.`),
      { code: 'NATURE_INCOMPATIBLE', httpStatus: 422 },
    )
  }

  if (nature === 'credit' && commande_id) {
    const { data: cmd } = await db
      .from('commandes')
      .select('condition_paiement_id, cp:conditions_paiement!condition_paiement_id(acompte_pct)')
      .eq('id', commande_id)
      .maybeSingle()

    const acomptePct = (cmd as { cp?: { acompte_pct: number } | null } | null)?.cp?.acompte_pct
    if (acomptePct !== undefined && acomptePct >= 100) {
      throw Object.assign(
        new Error('Cette commande est en paiement comptant intégral (P100) — nature crédit impossible.'),
        { code: 'NATURE_INCOMPATIBLE', httpStatus: 422 },
      )
    }
  }

  if (nature === 'deduction_acompte' && commande_id) {
    const { data: cmd } = await db
      .from('commandes')
      .select('montant_acompte_xaf')
      .eq('id', commande_id)
      .maybeSingle()

    const acompteTotal = Number((cmd as { montant_acompte_xaf?: number | null } | null)?.montant_acompte_xaf ?? 0)
    if (acompteTotal <= 0) {
      throw Object.assign(
        new Error('Acompte insuffisant : aucun acompte reçu sur cette commande.'),
        { code: 'ACOMPTE_INSUFFISANT', httpStatus: 422 },
      )
    }

    const { data: existingDeds } = await db
      .from('bons_sortie')
      .select('montant_total_xaf')
      .eq('commande_id', commande_id)
      .eq('nature_transaction', 'deduction_acompte')
      .in('statut', ['soumis', 'valide', 'execute'])

    const dejaDeduitsXaf = ((existingDeds ?? []) as { montant_total_xaf: number | null }[])
      .reduce((sum, b) => sum + (Number(b.montant_total_xaf) || 0), 0)

    if (acompteTotal - dejaDeduitsXaf <= 0) {
      throw Object.assign(
        new Error(`Acompte épuisé : ${acompteTotal.toLocaleString('fr-FR')} XAF déjà intégralement déduits.`),
        { code: 'ACOMPTE_INSUFFISANT', httpStatus: 422 },
      )
    }
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// ROUTES
// ══════════════════════════════════════════════════════════════════════════════

async function resolveCommandeIdForBon(bon: {
  id: string
  commande_id?: string | null
  demandeur?: string | null
}) {
  const context = await resolveCommandeContext({
    bon_id:      bon.id,
    commande_id: bon.commande_id ?? null,
    demandeur:   bon.demandeur ?? null,
  })
  return context?.commandeId ?? null
}

/** Liste des bons avec filtres */
router.get('/', async (c) => {
  const { statut, technicien, search } = c.req.query()
  const statutPreparation = c.req.query('statut_preparation')
  const page    = Math.max(1, parseInt(c.req.query('page') ?? '1'))
  const perPage = Math.min(100, Math.max(1, parseInt(c.req.query('per_page') ?? '20')))
  const from    = (page - 1) * perPage
  const to      = from + perPage - 1

  // Filtre date
  const dateDebut = c.req.query('date_debut')
  const dateFin   = c.req.query('date_fin')

  let query = db
    .from('bons_sortie')
    .select('*, bons_sortie_lignes(*)', { count: 'exact' })

  if (statut)              query = query.eq('statut', statut)
  if (statutPreparation)   query = query.eq('statut_preparation', statutPreparation)
  if (technicien)          query = query.ilike('demandeur', `%${technicien}%`)
  if (search)              query = query.or(`numero.ilike.%${search}%,demandeur.ilike.%${search}%,motif.ilike.%${search}%`)
  if (dateDebut)           query = query.gte('created_at', `${dateDebut}T00:00:00.000Z`)
  if (dateFin)             query = query.lte('created_at', `${dateFin}T23:59:59.999Z`)

  const { data, count, error } = await query
    .order('created_at', { ascending: false })
    .range(from, to)

  if (error) {
    console.warn('[bons] GET / Supabase error — fallback SQLite:', error.message)
    const local = getBonsSortieLocal({ statut })
    if (local.data.length > 0) return c.json(local)
    return c.json({ error: error.message }, 500)
  }

  return c.json({
    data,
    total: count ?? 0,
    page,
    per_page: perPage,
    total_pages: Math.ceil((count ?? 0) / perPage),
  })
})

/** Créer un bon de sortie — avec fallback SQLite offline */
router.post(
  '/',
  requireRole(['admin', 'superviseur', 'operateur']),
  zValidator('json', createBonSchema),
  async (c) => {
    const user = c.get('user')
    const body = c.req.valid('json')

    const result = await withOfflineFallback(
      'POST /bons',

      // ── Online : Supabase ──────────────────────────────────────────────────
      async () => {
        await checkNatureCompatibilite(body.nature_transaction, body.commande_id ?? null)

        const numero = await genererNumeroBon()

        const { data: bon, error: bonErr } = await db
          .from('bons_sortie')
          .insert({
            numero, statut: 'soumis', demandeur: body.demandeur,
            motif: body.motif, notes: body.notes ?? null,
            commande_id:        body.commande_id ?? null,
            nature_transaction: body.nature_transaction,
            imputation_payeur:  body.imputation_payeur,
            created_by: user.id, sync_status: 'synced',
          })
          .select().single()

        if (bonErr || !bon) throw new Error(bonErr?.message ?? 'Erreur création bon')

        const bonId = (bon as { id: string }).id
        const lignes = body.lignes.map((l) => ({
          bon_id: bonId, produit_id: l.produit_id ?? null,
          designation: l.designation, unite: l.unite,
          quantite_demandee: l.quantite_demandee, quantite_servie: 0,
        }))

        const { data: lignesData, error: lignesErr } = await db
          .from('bons_sortie_lignes').insert(lignes).select()

        if (lignesErr) {
          await db.from('bons_sortie').delete().eq('id', bonId)
          throw new Error(lignesErr.message)
        }

        await broadcastBon('nouveau_bon', {
          bon_id: bonId, numero, demandeur: body.demandeur,
          motif: body.motif, nb_lignes: body.lignes.length,
        })

        void notifyDgBonSoumis(numero, body.demandeur, body.motif, body.lignes.length)
        await notifyWorkflow({
          event:   'stock.bon_sortie_a_valider',
          module:  'stock',
          severite:'warning',
          titre:   'Bon de sortie a valider',
          message: `Bon ${numero} soumis par ${body.demandeur}.`,
          ref:     numero,
          url:     '/stocks/bons-sortie',
          data:    { bon_id: bonId, nb_lignes: body.lignes.length },
        })

        return { ...bon, lignes: lignesData }
      },

      // ── Offline : SQLite local ─────────────────────────────────────────────
      () => localCreateBon({
        demandeur: body.demandeur,
        motif:     body.motif,
        notes:     body.notes,
        lignes:    body.lignes.map((l) => ({
          produit_id:        l.produit_id,
          designation:       l.designation,
          unite:             l.unite,
          quantite_demandee: l.quantite_demandee,
        })),
        user_id: user.id,
      }),
    )

    return c.json(result, 201)
  },
)

/** Détail bon + lignes + historique statuts */
router.get('/:id{[0-9a-f-]{36}}', async (c) => {
  const { id } = c.req.param()

  const { data, error } = await db
    .from('bons_sortie')
    .select(`
      *,
      bons_sortie_lignes (
        *,
        produits ( ref, designation, stock_actuel, unite )
      )
    `)
    .eq('id', id)
    .single()

  if (error || !data) {
    return c.json({ error: 'Bon introuvable', code: 'NOT_FOUND' }, 404)
  }

  return c.json(data)
})

/** Vérification préalable des stocks avant exécution d'un bon */
router.get('/:id{[0-9a-f-]{36}}/verifier-stock', async (c) => {
  const { id } = c.req.param()

  const { data: bon, error } = await db
    .from('bons_sortie')
    .select('statut, bons_sortie_lignes(id, designation, quantite_demandee, produit_id)')
    .eq('id', id)
    .single()

  if (error || !bon) return c.json({ error: 'Bon introuvable', code: 'NOT_FOUND' }, 404)

  const b = bon as {
    statut: string
    bons_sortie_lignes: Array<{
      id: string; designation: string; quantite_demandee: number; produit_id: string | null
    }>
  }

  const lignes = await Promise.all(
    b.bons_sortie_lignes.map(async (ligne) => {
      if (!ligne.produit_id) {
        return {
          designation:       ligne.designation,
          quantite_demandee: ligne.quantite_demandee,
          stock_disponible:  null as number | null,
          suffisant:         true,
          sans_produit:      true,
        }
      }
      const { data: produit } = await db
        .from('produits')
        .select('stock_actuel')
        .eq('id', ligne.produit_id)
        .single()
      const stock = (produit as { stock_actuel: number } | null)?.stock_actuel ?? 0
      return {
        designation:       ligne.designation,
        quantite_demandee: ligne.quantite_demandee,
        stock_disponible:  stock,
        suffisant:         stock >= ligne.quantite_demandee,
        sans_produit:      false,
      }
    })
  )

  const toutSuffisant = lignes.every((l) => l.suffisant)

  return c.json({ bon_statut: b.statut, lignes, toutSuffisant })
})

/** Valider ou refuser un bon (secrétaire / directeur) — avec fallback SQLite offline */
router.put(
  '/:id/valider',
  requireRole(['admin', 'superviseur']),
  zValidator('json', validerBonSchema),
  async (c) => {
    const { id } = c.req.param()
    const user   = c.get('user')
    const body   = c.req.valid('json')

    const result = await withOfflineFallback(
      `PUT /bons/${id}/valider`,

      // ── Online : Supabase ──────────────────────────────────────────────────
      async () => {
        const { data: existing } = await db
          .from('bons_sortie')
          .select('id, statut, demandeur, numero, created_by, commande_id, nature_transaction, imputation_payeur')
          .eq('id', id).single()

        if (!existing) throw Object.assign(new Error('Bon introuvable'), { code: 'NOT_FOUND', httpStatus: 404 })

        const ex = existing as {
          id: string; statut: string; demandeur: string; numero: string; created_by: string
          commande_id: string | null
          nature_transaction: 'comptant' | 'credit' | 'deduction_acompte' | null
          imputation_payeur: string | null
        }

        if (!['en_attente', 'soumis'].includes(ex.statut))
          throw Object.assign(
            new Error(`Impossible de valider un bon en statut "${ex.statut}"`),
            { code: 'INVALID_TRANSITION', httpStatus: 422 },
          )

        if (!ex.nature_transaction || !ex.imputation_payeur)
          throw Object.assign(
            new Error('Impossible de valider ce bon : nature de transaction et imputation payeur sont requis.'),
            { code: 'MISSING_NATURE_PAYEUR', httpStatus: 422 },
          )

        await checkNatureCompatibilite(ex.nature_transaction, ex.commande_id)

        const { data, error } = await db.from('bons_sortie')
          .update({
            statut:             body.decision,
            valide_par_id:      user.id,
            updated_at:         new Date().toISOString(),
            ...(body.decision === 'valide' ? { statut_preparation: 'a_preparer' } : {}),
          })
          .eq('id', id).select().single()

        if (error) throw new Error(error.message)

        await broadcastBon('bon_valide', {
          bon_id:      id,
          numero:      ex.numero,
          decision:    body.decision,
          demandeur:   ex.demandeur,
          valide_par:  user.email,
          commentaire: body.commentaire ?? null,
        })

        await notifyWorkflow({
          event:   body.decision === 'valide' ? 'stock.bon_sortie_valide' : 'stock.bon_sortie_refuse',
          module:  'stock',
          severite:body.decision === 'valide' ? 'success' : 'warning',
          titre:   body.decision === 'valide' ? 'Bon de sortie valide' : 'Bon de sortie refuse',
          message: `Bon ${ex.numero} ${body.decision}.`,
          ref:     ex.numero,
          url:     '/stocks/bons-sortie',
          data:    { bon_id: id, decision: body.decision },
        })

        return data
      },

      // ── Offline : SQLite local ─────────────────────────────────────────────
      () => {
        localValiderBon({
          bon_id:      id,
          decision:    body.decision as 'valide' | 'refuse',
          commentaire: body.commentaire,
          user_id:     user.id,
        })
        return { id, statut: body.decision, offline: true }
      },
    )

    return c.json(result)
  },
)

// ── Préparation physique ──────────────────────────────────────────────────────

async function ensureLivraisonEnPreparation(commandeId: string, userId?: string): Promise<boolean> {
  const { data: existing } = await db
    .from('livraisons')
    .select('id')
    .eq('commande_id', commandeId)
    .neq('statut', 'annulee')
    .limit(1)
    .maybeSingle()
  if (existing) return false

  const { data: cmd } = await db
    .from('commandes')
    .select('numero, client_id, client_nom')
    .eq('id', commandeId)
    .single()
  if (!cmd) return false

  const c2 = cmd as { numero: string; client_id: string | null; client_nom: string }
  const year = new Date().getFullYear()
  const { count } = await db.from('livraisons').select('*', { count: 'exact', head: true })
  const numero = `LIV-${year}-${String((count ?? 0) + 1).padStart(3, '0')}`

  const { data: livraison, error } = await db
    .from('livraisons')
    .insert({
      numero,
      commande_id:  commandeId,
      client_id:    c2.client_id,
      client_nom:   c2.client_nom,
      destination:  'À définir',
      statut:       'en_preparation',
      created_by:   userId ?? null,
      sync_status:  'synced',
    })
    .select('id')
    .single()

  if (error || !livraison) { console.error('[bons] livraison auto:', error); return false }

  const livId = (livraison as { id: string }).id
  await db.from('livraisons_historique').insert({
    livraison_id:   livId,
    ancien_statut:  null,
    nouveau_statut: 'en_preparation',
    commentaire:    `Livraison créée automatiquement — tous les bons de la commande ${c2.numero} sont prêts`,
    changed_by:     userId ?? null,
  })

  await notifyWorkflow({
    event:    'logistique.livraison_en_preparation',
    module:   'logistique',
    severite: 'info',
    titre:    'Livraison en préparation',
    message:  `Commande ${c2.numero} : tous les bons prêts — livraison ${numero} créée, planification requise.`,
    ref:      numero,
    url:      '/logistique',
    data:     { livraison_id: livId, commande_id: commandeId },
  })

  return true
}

/** Assigner un préparateur à un bon validé */
router.patch(
  '/:id/preparateur',
  requireRole(['admin', 'superviseur']),
  zValidator('json', z.object({ preparateur_id: z.string().uuid() })),
  async (c) => {
    const { id } = c.req.param()
    const body   = c.req.valid('json')
    const user   = c.get('user')

    const { data: existing } = await db
      .from('bons_sortie')
      .select('id, statut, statut_preparation, numero')
      .eq('id', id).single()

    if (!existing) return c.json({ error: 'Bon introuvable', code: 'NOT_FOUND' }, 404)
    const ex = existing as { id: string; statut: string; statut_preparation: string | null; numero: string }

    if (ex.statut !== 'valide')
      return c.json({ error: 'Le bon doit être validé pour assigner un préparateur', code: 'INVALID_STATE' }, 422)
    if (ex.statut_preparation === 'pret')
      return c.json({ error: 'Ce bon est déjà prêt', code: 'ALREADY_PRET' }, 422)

    const { data: prep } = await db
      .from('employes')
      .select('id, nom, poste, departement, telephone, statut')
      .eq('id', body.preparateur_id).single()
    if (!prep) return c.json({ error: 'Préparateur introuvable', code: 'PREP_NOT_FOUND' }, 404)

    const p = prep as { id: string; nom: string; poste: string | null; departement: string | null; telephone: string | null; statut: string }
    if (p.statut !== 'actif') {
      return c.json({ error: 'Le preparateur doit etre un employe RH actif', code: 'PREP_INACTIF' }, 422)
    }

    const { data, error } = await db
      .from('bons_sortie')
      .update({ preparateur_id: body.preparateur_id, statut_preparation: 'en_cours', updated_at: new Date().toISOString() })
      .eq('id', id)
      .select().single()

    if (error) return c.json({ error: error.message }, 400)

    if (p.telephone) {
      const msg = `🏭 *TAFDIL FORGE — Bon de sortie à préparer*\nNuméro : *${ex.numero}*\nVous avez été assigné(e) comme préparateur(trice) par ${user.email}.\nMerci de préparer les articles et marquer le bon comme prêt.`
      await sendWhatsApp(p.telephone, msg).catch(e => console.error('[bons] notify preparateur:', e))
    }

    await notifyWorkflow({
      event:    'stock.bon_sortie_assigne',
      module:   'stock',
      severite: 'info',
      titre:    'Bon assigné au préparateur',
      message:  `Bon ${ex.numero} assigné à ${p.nom} pour préparation.`,
      ref:      ex.numero,
      url:      '/stocks/bons-sortie',
      data:     { bon_id: id, preparateur_id: body.preparateur_id },
    })

    return c.json(data)
  },
)

/** Marquer un bon comme prêt (préparateur ou superviseur) */
router.patch(
  '/:id/preparation',
  requireRole(['admin', 'superviseur', 'operateur']),
  zValidator('json', z.object({ statut: z.enum(['pret']) })),
  async (c) => {
    const { id } = c.req.param()
    const user   = c.get('user')

    const { data: existing } = await db
      .from('bons_sortie')
      .select('id, statut, statut_preparation, preparateur_id, commande_id, numero, demandeur, bons_sortie_lignes(id, designation, quantite_demandee, produit_id)')
      .eq('id', id).single()

    if (!existing) return c.json({ error: 'Bon introuvable', code: 'NOT_FOUND' }, 404)
    const ex = existing as {
      id: string; statut: string; statut_preparation: string | null
      preparateur_id: string | null; commande_id: string | null; numero: string; demandeur?: string | null
      bons_sortie_lignes?: Array<{ id: string; designation: string; quantite_demandee: number; produit_id: string | null }>
    }

    if (ex.statut !== 'valide')
      return c.json({ error: 'Le bon doit être validé', code: 'INVALID_STATE' }, 422)
    if (ex.statut_preparation !== 'en_cours')
      return c.json({
        error: `Transition "${ex.statut_preparation ?? 'null'}" → "pret" non autorisée — le bon doit être en cours (préparateur assigné).`,
        code:  'INVALID_PREPARATION_TRANSITION',
      }, 422)
    if (!ex.preparateur_id)
      return c.json({ error: 'Aucun préparateur assigné', code: 'NO_PREPARATEUR' }, 422)

    const insuffisants: string[] = []
    for (const ligne of ex.bons_sortie_lignes ?? []) {
      if (!ligne.produit_id) continue
      const { data: produit } = await db
        .from('produits')
        .select('stock_actuel')
        .eq('id', ligne.produit_id)
        .maybeSingle()
      const stock = Number((produit as { stock_actuel?: number | null } | null)?.stock_actuel ?? 0)
      if (stock < Number(ligne.quantite_demandee ?? 0)) {
        insuffisants.push(`${ligne.designation} (stock ${stock}, requis ${ligne.quantite_demandee})`)
      }
    }
    if (insuffisants.length > 0) {
      return c.json({
        error: `Stock insuffisant pour marquer le bon pret : ${insuffisants.join(' | ')}`,
        code:  'INSUFFICIENT_STOCK',
      }, 422)
    }

    const { data, error } = await db
      .from('bons_sortie')
      .update({ statut_preparation: 'pret', updated_at: new Date().toISOString() })
      .eq('id', id)
      .select().single()

    if (error) return c.json({ error: error.message }, 400)

    await notifyWorkflow({
      event:    'stock.bon_sortie_pret',
      module:   'stock',
      severite: 'success',
      titre:    'Bon prêt',
      message:  `Bon ${ex.numero} préparé et prêt pour livraison.`,
      ref:      ex.numero,
      url:      '/stocks/bons-sortie',
      data:     { bon_id: id },
    })

    // Vérifier si tous les bons validés de la commande sont prêts → déclencher livraison auto
    const resolvedContext = await resolveCommandeContext({
      bon_id:      ex.id,
      commande_id: ex.commande_id,
      demandeur:   ex.demandeur ?? null,
      userId:      user.id,
    }).catch((e) => {
      console.error('[bons] resolution commande preparation:', e)
      return null
    })
    const commandeId = resolvedContext?.commandeId ?? ex.commande_id

    if (commandeId) {
      const { count: bonsPending } = await db
        .from('bons_sortie')
        .select('*', { count: 'exact', head: true })
        .eq('commande_id', commandeId)
        .eq('statut', 'valide')
        .in('statut_preparation', ['a_preparer', 'en_cours'])

      if ((bonsPending ?? 0) === 0) {
        await ensureWorkflowApresPreparationBon({
          bon_id:      ex.id,
          commande_id: commandeId,
          demandeur:   ex.demandeur ?? null,
          userId:      user.id,
        }).catch(e => console.error('[bons] workflow preparation:', e))
      }
    }

    return c.json(data)
  },
)

/** Exécuter un bon (magasin) — transaction atomique ALL-or-NOTHING */
router.put(
  '/:id/executer',
  requireRole(['admin', 'superviseur', 'operateur']),
  zValidator('json', executerBonSchema),
  async (c) => {
    const { id } = c.req.param()
    const user   = c.get('user')
    const body   = c.req.valid('json')

    // Récupérer le bon avec ses lignes
    const { data: bon, error: fetchErr } = await db
      .from('bons_sortie')
      .select('*, bons_sortie_lignes(*)')
      .eq('id', id)
      .single()

    if (fetchErr || !bon) return c.json({ error: 'Bon introuvable', code: 'NOT_FOUND' }, 404)

    const b = bon as {
      id: string; numero: string; statut: string; commande_id: string | null; demandeur?: string | null
      preparateur_id?: string | null
      statut_preparation?: string | null
      nature_transaction?: 'comptant' | 'credit' | 'deduction_acompte' | null
      imputation_payeur?:  'entreprise_tafdil' | 'atelier' | 'administration' | null
      montant_total_xaf?:  number | null
      bons_sortie_lignes: Array<{
        id: string; produit_id: string | null
        designation: string; quantite_demandee: number
      }>
    }

    // Vérifier le code unique
    if (b.numero !== body.code_unique) {
      return c.json({ error: 'Code unique invalide', code: 'INVALID_CODE' }, 422)
    }

    // Vérifier la transition de statut
    if (b.statut !== 'valide') {
      return c.json({
        error: `Impossible d'exécuter un bon en statut "${b.statut}" (statut requis : valide)`,
        code: 'INVALID_TRANSITION',
      }, 422)
    }

    if (!b.preparateur_id || b.statut_preparation !== 'pret') {
      return c.json({
        error: 'Impossible d\'executer ce bon : un preparateur doit etre assigne et la preparation doit etre marquee prete.',
        code:  'PREPARATION_REQUIRED',
      }, 422)
    }

    // Essayer la fonction PostgreSQL atomique
    const { data: rpcData, error: rpcError } = await (db as never as {
      rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { code: string; message: string } | null }>
    }).rpc('fn_executer_bon', {
      p_bon_id:  id,
      p_user_id: user.id,
      p_quantites_reelles: body.quantites_reelles ?? null,
    })

    if (!rpcError) {
      // Si le bon est lié à une commande, garantir l'existence d'une facture Finance
      let workflow: Awaited<ReturnType<typeof ensureWorkflowApresExecutionBon>> = {
        commandeId: null,
        facture: null,
        livraison: null,
        livraisonCreated: false,
      }
      try {
        workflow = await ensureWorkflowApresExecutionBon({
          bon_id:      b.id,
          commande_id: b.commande_id,
          demandeur:   b.demandeur ?? null,
          userId:      user.id,
        })
      } catch (e) {
        return c.json({
          error: `Bon execute, mais l'automatisation facture/livraison a echoue : ${(e as Error).message}`,
          code:  'WORKFLOW_AUTO_FAILED',
        }, 500)
      }

      // Écriture comptable selon la nature de la transaction
      if (b.nature_transaction && b.montant_total_xaf && b.montant_total_xaf > 0) {
        genererEcritureBonSortieInterne({
          numero:             b.numero,
          date:               new Date().toISOString(),
          montant_xaf:        b.montant_total_xaf,
          nature_transaction: b.nature_transaction,
          imputation_payeur:  b.imputation_payeur ?? 'entreprise_tafdil',
          commande_id:        workflow.commandeId ?? b.commande_id,
          created_by:         user.id,
        }).catch(e => console.error('[bons/executer] ecriture comptable:', e))
      }

      // Vérifier les niveaux de stock et créer un bon d'approvisionnement si nécessaire
      const produitIds = b.bons_sortie_lignes
        .filter(l => l.produit_id !== null)
        .map(l => l.produit_id as string)
      creerBonApprovisionnementSiNecessaire(id, produitIds, user.id)
        .catch(e => console.error('[bons/executer] appro auto:', e))

      await broadcastBon('bon_execute', {
        bon_id: id,
        numero: b.numero,
      })
      await notifyWorkflow({
        event:   'stock.bon_sortie_execute',
        module:  'stock',
        severite:'success',
        titre:   'Bon de sortie execute',
        message: `Bon ${b.numero} execute : stock mis a jour, facture et livraison synchronisees si commande liee.`,
        ref:     b.numero,
        url:     '/stocks/bons-sortie',
        data:    { bon_id: id, commande_id: workflow.commandeId, livraison_created: workflow.livraisonCreated },
      })
      return c.json(rpcData ?? {
        success: true,
        bon_id: id,
        commande_id: workflow.commandeId,
        facture_triggered: Boolean(workflow.facture),
        facture: workflow.facture,
        livraison: workflow.livraison,
        livraison_created: workflow.livraisonCreated,
      })
    }

    // Fonction absente — migration non appliquée
    if (rpcError.code === '42883' || rpcError.message.includes('does not exist')) {
      return c.json({
        error: 'Configuration base de données incomplète : fn_executer_bon est manquante.',
        code:  'RPC_MISSING',
        fix:   'Appliquer packages/db/migrations/0001_fn_executer_bon.sql dans Supabase SQL Editor.',
      }, 503)
    }

    // Erreurs métier renvoyées par la fonction PG
    const msg = rpcError.message ?? ''
    if (msg.includes('INSUFFICIENT_STOCK')) {
      return c.json({ error: msg.replace('INSUFFICIENT_STOCK: ', ''), code: 'INSUFFICIENT_STOCK' }, 422)
    }
    if (msg.includes('INVALID_TRANSITION')) {
      return c.json({ error: msg.replace('INVALID_TRANSITION: ', ''), code: 'INVALID_TRANSITION' }, 422)
    }
    if (msg.includes('BON_NOT_FOUND')) {
      return c.json({ error: 'Bon introuvable', code: 'NOT_FOUND' }, 404)
    }

    return c.json({ error: msg }, 400)
  },
)

// ══════════════════════════════════════════════════════════════════════════════
// BONS D'APPROVISIONNEMENT
// ══════════════════════════════════════════════════════════════════════════════

const statutApproSchema = z.object({
  statut: z.enum(['brouillon', 'valide', 'envoye', 'commande', 'recu_partiel', 'recu_total', 'recu', 'annule']),
})

const creerApproManuelSchema = z.object({
  produit_id:               z.string().uuid(),
  quantite:                 z.number().positive(),
  fournisseur_nom:          z.string().optional(),
  fournisseur_id:           z.string().uuid().optional(),
  date_livraison_souhaitee: z.string().optional(),
  notes:                    z.string().optional(),
})

/** Nombre de bons d'appro en brouillon — pour badge UI */
router.get('/appro/count', async (c) => {
  const { count, error } = await db
    .from('bons_approvisionnement')
    .select('*', { count: 'exact', head: true })
    .eq('statut', 'brouillon')
  if (error) return c.json({ count: 0 })
  return c.json({ count: count ?? 0 })
})

/** Liste paginée des bons d'approvisionnement */
router.get('/appro', requireRole(['admin', 'superviseur', 'operateur']), async (c) => {
  const { statut, search } = c.req.query()
  const page    = Math.max(1, parseInt(c.req.query('page') ?? '1'))
  const perPage = Math.min(100, parseInt(c.req.query('per_page') ?? '20'))
  const from    = (page - 1) * perPage
  const to      = from + perPage - 1

  let q = db
    .from('bons_approvisionnement')
    .select('*', { count: 'exact' })

  if (statut) q = q.eq('statut', statut)
  if (search) q = q.ilike('numero', `%${search}%`)

  const { data: bons, count, error } = await q
    .order('created_at', { ascending: false })
    .range(from, to)

  if (error) return c.json({ error: error.message }, 500)

  // Charger les lignes séparément (FK non garantie dans le cache PostgREST)
  const bonIds = (bons ?? []).map((b) => (b as { id: string }).id)
  const lignesMap: Record<string, unknown[]> = {}
  if (bonIds.length > 0) {
    const { data: lignes } = await db
      .from('bons_approvisionnement_lignes')
      .select('*')
      .in('bon_id', bonIds)
    for (const l of lignes ?? []) {
      const ligne = l as { bon_id: string }
      if (!lignesMap[ligne.bon_id]) lignesMap[ligne.bon_id] = []
      lignesMap[ligne.bon_id].push(l)
    }
  }

  const data = (bons ?? []).map((b) => {
    const bon = b as { id: string }
    return { ...b, bons_approvisionnement_lignes: lignesMap[bon.id] ?? [] }
  })

  return c.json({
    data,
    total:       count ?? 0,
    page,
    per_page:    perPage,
    total_pages: Math.ceil((count ?? 0) / perPage),
  })
})

/** Créer un bon d'approvisionnement manuel (depuis la page Stocks) */
router.post(
  '/appro',
  requireRole(['admin', 'superviseur', 'operateur']),
  zValidator('json', creerApproManuelSchema),
  async (c) => {
    const user = c.get('user')
    const body = c.req.valid('json')

    // Récupérer le produit pour pré-remplir la ligne
    const { data: produit, error: prodErr } = await db
      .from('produits')
      .select('designation, unite, stock_actuel, stock_min, statut, fournisseur')
      .eq('id', body.produit_id)
      .single()

    if (prodErr || !produit) return c.json({ error: 'Produit introuvable', code: 'NOT_FOUND' }, 404)

    const p = produit as {
      designation: string; unite: string; stock_actuel: number
      stock_min: number; statut: string; fournisseur: string | null
    }

    // Générer le numéro
    const today    = new Date()
    const yyyymmdd = today.toISOString().slice(0, 10).replace(/-/g, '')
    const startOfDay = `${today.toISOString().slice(0, 10)}T00:00:00.000Z`
    const { count } = await db
      .from('bons_approvisionnement')
      .select('*', { count: 'exact', head: true })
      .gte('created_at', startOfDay)
    const numero = `APPRO-${yyyymmdd}-${String((count ?? 0) + 1).padStart(4, '0')}`

    // Créer le bon
    const { data: bon, error: bonErr } = await db
      .from('bons_approvisionnement')
      .insert({
        numero,
        statut:                   'brouillon',
        type:                     'manuel',
        fournisseur_id:           body.fournisseur_id ?? null,
        fournisseur_nom:          body.fournisseur_nom ?? p.fournisseur ?? null,
        date_livraison_souhaitee: body.date_livraison_souhaitee ?? null,
        notes:                    body.notes ?? null,
        created_by:               user.id,
        sync_status:              'synced',
      })
      .select()
      .single()

    if (bonErr || !bon) return c.json({ error: bonErr?.message ?? 'Erreur création bon' }, 500)

    const bonId = (bon as { id: string }).id

    // Créer la ligne produit
    const { error: ligneErr } = await db.from('bons_approvisionnement_lignes').insert({
      bon_id:               bonId,
      produit_id:           body.produit_id,
      designation:          p.designation,
      unite:                p.unite,
      quantite_a_commander: body.quantite,
      stock_actuel_snap:    p.stock_actuel,
      stock_min_snap:       p.stock_min,
      statut_alerte:        ['alerte', 'critique', 'rupture'].includes(p.statut) ? p.statut : 'alerte',
      fournisseur:          body.fournisseur_nom ?? p.fournisseur ?? null,
    })

    if (ligneErr) {
      await db.from('bons_approvisionnement').delete().eq('id', bonId)
      return c.json({ error: ligneErr.message }, 500)
    }

    // Broadcast notification admin
    try {
      const channel = db.channel('forge-stock')
      await channel.send({
        type:  'broadcast',
        event: 'alerte_appro',
        payload: {
          bon_appro_id: bonId,
          numero,
          nb_produits: 1,
          produits_alertes: [{ id: body.produit_id, designation: p.designation, statut: p.statut }],
          source: 'manuel',
        },
      })
      db.removeChannel(channel)
    } catch { /* non critique */ }

    return c.json({ ...bon, lignes: [{ produit_id: body.produit_id, quantite_a_commander: body.quantite }] }, 201)
  },
)

/** Changer le statut d'un bon d'approvisionnement */
router.patch(
  '/appro/:id/statut',
  requireRole(['admin', 'superviseur']),
  zValidator('json', statutApproSchema),
  async (c) => {
    const { id }     = c.req.param()
    const { statut } = c.req.valid('json')

    const { data, error } = await db
      .from('bons_approvisionnement')
      .update({ statut, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single()

    if (error) return c.json({ error: error.message }, 400)
    if (!data) return c.json({ error: 'Bon introuvable', code: 'NOT_FOUND' }, 404)
    return c.json(data)
  },
)

export { router as bonsRouter }
