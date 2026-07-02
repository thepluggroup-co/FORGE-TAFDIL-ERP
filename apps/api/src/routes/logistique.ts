import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { supabaseAdmin } from '@forge/db'
import { requireRole } from '../middleware/rbac'
import { checkPermission, writeAuditLog } from '../services/rbacService'
import { enregistrerPaiementCommande, ensureFactureForCommande, getFactureActiveByCommande } from '../services/finance-core.service'
import { resolveBonSortieLivrableForCommande, synchroniserCommandesWorkflow } from '../services/commande-workflow.service'
import type { HonoVariables } from '../types'

const db = supabaseAdmin!

// ── State machine ─────────────────────────────────────────────────────────────
// planifiee → en_route → livree | echec_livraison
// en_preparation est l'état initial auto-créé quand tous les bons sont prêts

const VALID_TRANSITIONS: Record<string, string[]> = {
  en_preparation:  ['planifiee', 'annulee'],
  planifiee:       ['en_route', 'annulee'],
  en_route:        ['livree', 'echec_livraison'],
  en_transit:      ['livree', 'echec_livraison'],  // backward-compat alias
  livree:          [],
  echec_livraison: [],
  annulee:         [],
}

function normalizeLivraisonStatut(statut: string) {
  return statut === 'en_transit' ? 'en_route' : statut
}

async function verifierCommandeLivrable(commandeId: string) {
  const bonResolution = await resolveBonSortieLivrableForCommande({ commande_id: commandeId })
  const context = bonResolution.context

  if (!context) {
    return {
      ok: false,
      code: 'COMMANDE_NOT_FOUND',
      error: 'Commande introuvable ou impossible a reconstruire pour la livraison.',
      document_requis: {
        type:   'commande',
        label:  'Commande',
        etat:   'introuvable',
        module: 'Commandes',
        url:    '/commandes',
        action: 'Verifier que la commande ERP ou la commande web existe et qu elle est synchronisee.',
      },
    }
  }

  if (!bonResolution.bonLivrable) {
    const bon = bonResolution.dernierBon as { numero?: string; statut?: string; statut_preparation?: string | null } | null
    return {
      ok: false,
      code: 'BON_SORTIE_NOT_READY',
      error: 'Le bon de sortie doit etre prepare, marque pret ou execute avant la livraison.',
      document_requis: {
        type:   'bon_sortie',
        label:  bon?.numero ? `Bon de sortie ${bon.numero}` : 'Bon de sortie',
        etat:   bon?.statut_preparation ?? bon?.statut ?? 'absent',
        module: 'Stocks > Bons de sortie',
        url:    '/stocks/bons-sortie',
        action: bon
          ? 'Assigner un preparateur, verifier le stock, puis marquer la preparation prete ou executer le bon.'
          : 'Creer ou synchroniser le bon de sortie de cette commande, puis le preparer.',
      },
    }
  }

  const facture = await getFactureActiveByCommande(context.commandeId)

  const f = facture as {
    numero?: string
    statut?: string
    total_ttc_xaf?: number
    montant_paye_xaf?: number
  } | null

  if (!f) {
    return {
      ok: false,
      code: 'FACTURE_MISSING',
      error: 'La facture doit etre generee par Finance avant la livraison.',
      document_requis: {
        type:   'facture',
        label:  'Facture client',
        etat:   'absente',
        module: 'Finance > Factures',
        url:    '/finance',
        action: 'Generer la facture de la commande, puis la valider ou l envoyer.',
      },
    }
  }

  if (!['valide', 'envoye', 'paye'].includes(String(f.statut))) {
    return {
      ok: false,
      code: 'FACTURE_NOT_READY',
      error: `La facture ${f.numero ?? ''} doit etre validee/envoyee avant la livraison.`,
      document_requis: {
        type:   'facture',
        label:  f.numero ? `Facture ${f.numero}` : 'Facture client',
        etat:   f.statut ?? 'brouillon',
        module: 'Finance > Factures',
        url:    '/finance',
        action: 'Valider ou envoyer cette facture avant de demarrer la livraison.',
      },
    }
  }

  const total = Number(f.total_ttc_xaf ?? 0)
  const paye = Number(f.montant_paye_xaf ?? 0)
  return {
    ok: true,
    facture: f,
    document_requis: null,
    solde_restant_xaf: Math.max(0, Math.round(total - paye)),
  }
}

// ── Schémas Zod ───────────────────────────────────────────────────────────────

const createLivraisonSchema = z.object({
  commande_id:           z.string().uuid(),
  client_id:             z.string().uuid().optional(),
  client_nom:            z.string().min(1),
  destination:           z.string().min(1),
  transporteur:          z.string().optional(),
  date_livraison_prevue: z.string().datetime({ offset: true }).optional(),
  date_depart:           z.string().datetime({ offset: true }).optional(),
  notes:                 z.string().optional(),
})

const patchStatutSchema = z.object({
  // 'planifiee' inclus pour la transition en_preparation → planifiee (logistique confirme)
  statut:                z.enum(['planifiee', 'en_route', 'en_transit', 'livree', 'echec_livraison', 'annulee']),
  commentaire:           z.string().optional(),
  geoloc:                z.string().optional(),
  destination:           z.string().optional(),
  transporteur:          z.string().optional(),
  date_depart:           z.string().optional(),
  date_livraison_prevue: z.string().optional(),
  date_livraison_reelle: z.string().optional(),
  paiement_livraison: z.object({
    montant_xaf:   z.number().min(0),
    methode:       z.enum(['mobile_money', 'especes']),
    reference_ext: z.string().optional(),
  }).optional(),
})

const assignerSchema = z.object({
  livreur_id:   z.string().uuid(),
  transporteur: z.string().optional(),
})

const livraisonsQuerySchema = z.object({
  statut:       z.string().optional(),
  transporteur: z.string().optional(),
  client_id:    z.string().uuid().optional(),
  date_debut:   z.string().optional(),
  date_fin:     z.string().optional(),
  page:         z.coerce.number().int().min(1).default(1),
  per_page:     z.coerce.number().int().min(1).max(500).default(20),
})

// ── Helper numéro ─────────────────────────────────────────────────────────────

async function genererNumeroLivraison(): Promise<string> {
  const today = new Date()
  const yyyymmdd = today.toISOString().slice(0, 10).replace(/-/g, '')
  const startOfDay = `${today.toISOString().slice(0, 10)}T00:00:00.000Z`
  const { count } = await db
    .from('livraisons')
    .select('*', { count: 'exact', head: true })
    .gte('created_at', startOfDay)
  return `LIV-${yyyymmdd}-${String((count ?? 0) + 1).padStart(4, '0')}`
}

// ── Router ────────────────────────────────────────────────────────────────────

export const logistiqueRouter = new Hono<{ Variables: HonoVariables }>()

// ── GET /preparation/resume — dashboard préparation 4 compteurs ───────────────
// Doit être avant /:id pour ne pas être capturé par le wildcard

logistiqueRouter.get(
  '/preparation/resume',
  requireRole(['admin', 'superviseur', 'operateur', 'livreur']),
  async (c) => {
    const [aPreparer, enCours, pret, planifiee] = await Promise.all([
      db.from('bons_sortie').select('*', { count: 'exact', head: true }).eq('statut_preparation', 'a_preparer'),
      db.from('bons_sortie').select('*', { count: 'exact', head: true }).eq('statut_preparation', 'en_cours'),
      db.from('bons_sortie').select('*', { count: 'exact', head: true }).eq('statut_preparation', 'pret'),
      db.from('livraisons').select('*', { count: 'exact', head: true }).eq('statut', 'planifiee'),
    ])

    return c.json({
      a_preparer:    aPreparer.count ?? 0,
      en_cours:      enCours.count ?? 0,
      pret_a_livrer: pret.count ?? 0,
      planifiee:     planifiee.count ?? 0,
    })
  },
)

// ── GET /livraisons/mes-livraisons — DOIT être avant /livraisons/:id ──────────

logistiqueRouter.get(
  '/livraisons/mes-livraisons',
  requireRole(['admin', 'superviseur', 'operateur', 'livreur']),
  async (c) => {
    const user    = c.get('user')
    const page    = Math.max(1, parseInt(c.req.query('page')     ?? '1'))
    const perPage = Math.min(100, Math.max(1, parseInt(c.req.query('per_page') ?? '20')))
    const from = (page - 1) * perPage
    const to   = from + perPage - 1

    const { data, count, error } = await db
      .from('livraisons')
      .select('*, commandes(numero, statut), clients(nom, telephone)', { count: 'exact' })
      .eq('livreur_id', user.id)
      .order('date_livraison_prevue', { ascending: true, nullsFirst: false })
      .range(from, to)

    if (error) {
      console.error('[logistique] GET /mes-livraisons:', error.message)
      return c.json({ error: error.message }, 500)
    }

    return c.json({
      data:        data ?? [],
      total:       count ?? 0,
      page,
      per_page:    perPage,
      total_pages: Math.ceil((count ?? 0) / perPage),
    })
  },
)

// ── GET /livraisons — liste paginée + filtres ─────────────────────────────────

logistiqueRouter.get(
  '/livraisons',
  requireRole(['admin', 'superviseur', 'operateur', 'livreur']),
  zValidator('query', livraisonsQuerySchema),
  async (c) => {
    const { statut, transporteur, client_id, date_debut, date_fin, page, per_page } = c.req.valid('query')
    const from = (page - 1) * per_page
    const to   = from + per_page - 1

    let query = db
      .from('livraisons')
      .select('*, commandes(numero, statut), clients(nom, telephone)', { count: 'exact' })

    if (statut)      query = query.eq('statut', statut)
    if (transporteur) query = query.ilike('transporteur', `%${transporteur}%`)
    if (client_id)   query = query.eq('client_id', client_id)
    if (date_debut)  query = query.gte('date_livraison_prevue', date_debut)
    if (date_fin)    query = query.lte('date_livraison_prevue', `${date_fin}T23:59:59.999Z`)

    const { data, count, error } = await query
      .order('created_at', { ascending: false })
      .range(from, to)

    if (error) {
      console.error('[logistique] GET /livraisons:', error.message)
      return c.json({ error: error.message }, 500)
    }

    const enriched = []
    for (const livraison of data ?? []) {
      let livrable = true
      let blocageLivraisonCode: string | null = null
      let blocageLivraisonMessage: string | null = null
      let documentRequis: unknown = null
      let factureStatut: string | null = null
      let soldeRestant = 0

      if (livraison.commande_id) {
        const readiness = await verifierCommandeLivrable(livraison.commande_id).catch((e) => {
          console.error('[logistique] verification livrable:', e)
          return null
        }) as {
          ok?: boolean
          code?: string
          error?: string
          facture?: { statut?: string; total_ttc_xaf?: number; montant_paye_xaf?: number } | null
          solde_restant_xaf?: number
          document_requis?: unknown
        } | null

        livrable = Boolean(readiness?.ok)
        blocageLivraisonCode = readiness?.ok ? null : readiness?.code ?? 'VERIFICATION_LIVRAISON_FAILED'
        blocageLivraisonMessage = readiness?.ok ? null : readiness?.error ?? 'Verification des documents de livraison impossible.'
        documentRequis = readiness?.ok ? null : readiness?.document_requis ?? null
        factureStatut = readiness?.facture?.statut ?? null
        soldeRestant = Number(readiness?.solde_restant_xaf ?? 0)
      }

      enriched.push({
        ...livraison,
        livrable,
        blocage_livraison_code: blocageLivraisonCode,
        blocage_livraison_message: blocageLivraisonMessage,
        document_requis: documentRequis,
        facture_statut: factureStatut,
        solde_restant_xaf: soldeRestant,
      })
    }

    return c.json({
      data:        enriched,
      total:       count ?? 0,
      page,
      per_page,
      total_pages: Math.ceil((count ?? 0) / per_page),
    })
  },
)

// ── GET /commandes-pretes — commandes prêtes à planifier en livraison ─────────

logistiqueRouter.get(
  '/commandes-pretes',
  requireRole(['admin', 'superviseur', 'operateur', 'livreur']),
  async (c) => {
    const { data: livraisonsActives } = await db
      .from('livraisons')
      .select('commande_id')
      .in('statut', ['en_preparation', 'planifiee', 'en_route', 'en_transit', 'confirmed', 'pret'])
      .not('commande_id', 'is', null)

    const commandeIdsDejaPlanifiees = ((livraisonsActives ?? []) as { commande_id: string | null }[])
      .map((l) => l.commande_id)
      .filter(Boolean) as string[]

    let query = db
      .from('commandes')
      .select('id, numero, client_id, client_nom, date_livraison_prevue, total_ttc_xaf, statut')
      .eq('statut', 'pret')

    if (commandeIdsDejaPlanifiees.length > 0) {
      query = query.not('id', 'in', `(${commandeIdsDejaPlanifiees.join(',')})`)
    }

    const { data, error } = await query.order('date_livraison_prevue', { ascending: true, nullsFirst: false })
    if (error) return c.json({ error: error.message }, 500)

    const eligible = []
    for (const commande of data ?? []) {
      const readiness = await verifierCommandeLivrable(commande.id).catch((e) => {
        console.error('[logistique] commandes-pretes:', e)
        return null
      })
      if (readiness?.ok) {
        eligible.push({
          ...commande,
          facture_statut: (readiness.facture as { statut?: string } | undefined)?.statut ?? null,
          solde_restant_xaf: readiness.solde_restant_xaf ?? 0,
        })
      }
    }

    return c.json({ data: eligible, total: eligible.length })
  },
)

// ── POST /synchroniser-livraisons — rattrapage livraisons manquantes ──────────

logistiqueRouter.post(
  '/synchroniser-livraisons',
  requireRole(['admin', 'superviseur', 'operateur']),
  async (c) => {
    const user = c.get('user')
    const result = await synchroniserCommandesWorkflow({
      cible:  'livraisons',
      userId: user.id,
    })

    return c.json(result)
  },
)

// ── GET /livraisons/:id — détail avec historique ──────────────────────────────

logistiqueRouter.get(
  '/livraisons/:id',
  requireRole(['admin', 'superviseur', 'operateur', 'livreur']),
  async (c) => {
    const { id } = c.req.param()

    const { data, error } = await db
      .from('livraisons')
      .select(`
        *,
        commandes(id, numero, statut, montant_ttc),
        clients(id, nom, telephone, email),
        livraisons_historique(
          id, ancien_statut, nouveau_statut, commentaire, geoloc, changed_by, changed_at,
          profiles!changed_by(full_name)
        )
      `)
      .eq('id', id)
      .single()

    if (error) {
      if (error.code === 'PGRST116') {
        return c.json({ error: 'Livraison introuvable', code: 'NOT_FOUND' }, 404)
      }
      console.error('[logistique] GET /livraisons/:id:', error.message)
      return c.json({ error: error.message }, 500)
    }

    return c.json(data)
  },
)

// ── POST /livraisons — création liée à une commande ───────────────────────────

logistiqueRouter.post(
  '/livraisons',
  requireRole(['admin', 'superviseur']),
  zValidator('json', createLivraisonSchema),
  async (c) => {
    const user = c.get('user')
    const body = c.req.valid('json')

    // Vérifier que la commande existe (avant de générer le numéro)
    const { data: commande, error: cmdErr } = await db
      .from('commandes')
      .select('id, numero')
      .eq('id', body.commande_id)
      .single()

    if (cmdErr || !commande) {
      return c.json({ error: 'Commande introuvable', code: 'COMMANDE_NOT_FOUND' }, 422)
    }

    const readiness = await verifierCommandeLivrable(body.commande_id)
    if (!readiness.ok) {
      return c.json({
        error: readiness.error,
        code:  readiness.code,
        document_requis: readiness.document_requis,
      }, 422)
    }

    const numero = await genererNumeroLivraison()

    const { data: livraison, error } = await db
      .from('livraisons')
      .insert({
        numero,
        commande_id:           body.commande_id,
        client_id:             body.client_id ?? null,
        client_nom:            body.client_nom,
        destination:           body.destination,
        transporteur:          body.transporteur ?? null,
        statut:                'planifiee',
        date_livraison_prevue: body.date_livraison_prevue ?? null,
        date_depart:           body.date_depart ?? null,
        notes:                 body.notes ?? null,
        created_by:            user.id,
        sync_status:           'pending',
      })
      .select()
      .single()

    if (error) {
      console.error('[logistique] POST /livraisons:', error.message)
      return c.json({ error: error.message }, 500)
    }

    const lv = livraison as { id: string }

    await db.from('livraisons_historique').insert({
      livraison_id:   lv.id,
      ancien_statut:  null,
      nouveau_statut: 'planifiee',
      commentaire:    'Livraison créée',
      changed_by:     user.id,
    })

    return c.json(livraison, 201)
  },
)

// ── PATCH /livraisons/:id/statut — transition de statut ──────────────────────

logistiqueRouter.patch(
  '/livraisons/:id/statut',
  requireRole(['admin', 'superviseur', 'operateur', 'livreur']),
  zValidator('json', patchStatutSchema),
  async (c) => {
    const user = c.get('user')
    const { id } = c.req.param()
    const body = c.req.valid('json')

    const { data: livraison, error: fetchErr } = await db
      .from('livraisons')
      .select('id, statut, commande_id, livreur_id, created_by')
      .eq('id', id)
      .single()

    if (fetchErr || !livraison) {
      return c.json({ error: 'Livraison introuvable', code: 'NOT_FOUND' }, 404)
    }

    const lv = livraison as {
      id: string; statut: string; commande_id: string | null
      livreur_id: string | null; created_by: string | null
    }

    // Un operateur ne peut modifier que ses propres livraisons
    if (user.role === 'operateur') {
      const isOwner = lv.livreur_id === user.id || lv.created_by === user.id
      if (!isOwner) {
        writeAuditLog({
          userId:       user.id,
          actionType:   'ACCESS_DENIED',
          module:       'LOGISTICS',
          resourceType: 'livraison',
          resourceId:   id,
        })
        return c.json({ error: 'Accès refusé', code: 'FORBIDDEN' }, 403)
      }
    }

    // Valider la transition via la state machine
    const nextStatut = normalizeLivraisonStatut(body.statut)
    const allowed = VALID_TRANSITIONS[lv.statut] ?? []
    if (!allowed.includes(nextStatut)) {
      return c.json({
        error:   `Transition invalide : ${lv.statut} → ${nextStatut}`,
        code:    'INVALID_TRANSITION',
        allowed,
      }, 422)
    }

    let readiness: Awaited<ReturnType<typeof verifierCommandeLivrable>> | null = null
    if (lv.commande_id && ['en_route', 'livree'].includes(nextStatut)) {
      readiness = await verifierCommandeLivrable(lv.commande_id)
      if (!readiness.ok) {
        return c.json({
          error: readiness.error,
          code:  readiness.code,
          document_requis: readiness.document_requis,
        }, 422)
      }
    }

    let soldeApresPaiementLivraison = Number(readiness?.solde_restant_xaf ?? 0)
    if (lv.commande_id && nextStatut === 'livree') {
      const solde = Number(readiness?.solde_restant_xaf ?? 0)
      const paiement = body.paiement_livraison

      if (solde > 0 && !paiement) {
        return c.json({
          error: `Paiement livraison requis : solde restant ${Math.round(solde).toLocaleString('fr-CM')} XAF.`,
          code:  'DELIVERY_PAYMENT_REQUIRED',
          solde_restant_xaf: Math.round(solde),
        }, 422)
      }

      if (paiement && solde > 0 && Number(paiement.montant_xaf ?? 0) > solde + 1) {
        return c.json({
          error: `Le montant encaisse ne peut pas depasser le solde restant (${Math.round(solde).toLocaleString('fr-CM')} XAF).`,
          code:  'INVALID_DELIVERY_PAYMENT_AMOUNT',
          solde_restant_xaf: Math.round(solde),
        }, 422)
      }

      if (paiement && paiement.montant_xaf > 0) {
        const encaissement = await enregistrerPaiementCommande({
          commandeId:              lv.commande_id,
          montantXaf:              Math.round(paiement.montant_xaf),
          methode:                 paiement.methode,
          referenceExt:            paiement.reference_ext ?? null,
          datePaiement:            new Date().toISOString(),
          notes:                   body.commentaire ?? 'Paiement encaisse a la livraison.',
          userId:                  user.id,
          ensureFacture:           true,
          factureStatutSiCreation: 'envoye',
        })
        soldeApresPaiementLivraison = Number(encaissement.solde_restant_xaf ?? 0)
      }
    }

    const updatePayload: Record<string, unknown> = {
      statut:     nextStatut,
      updated_at: new Date().toISOString(),
    }

    if (nextStatut === 'planifiee') {
      if (!body.date_depart || !body.date_livraison_prevue) {
        return c.json({
          error: 'La date de depart et la date de livraison prevue sont requises pour planifier la livraison.',
          code:  'PLANNING_DATES_REQUIRED',
        }, 422)
      }
      updatePayload.date_depart = body.date_depart
      updatePayload.date_livraison_prevue = body.date_livraison_prevue
      if (body.destination) updatePayload.destination = body.destination
      if (body.transporteur) updatePayload.transporteur = body.transporteur
    }

    if (nextStatut === 'livree') {
      updatePayload.date_livraison_reelle = body.date_livraison_reelle ?? new Date().toISOString()
    }

    const { data: updated, error: updateErr } = await db
      .from('livraisons')
      .update(updatePayload)
      .eq('id', id)
      .select()
      .single()

    if (updateErr) {
      console.error('[logistique] PATCH statut:', updateErr.message)
      return c.json({ error: updateErr.message }, 500)
    }

    // Audit trail dans livraisons_historique
    await db.from('livraisons_historique').insert({
      livraison_id:   id,
      ancien_statut:  lv.statut,
      nouveau_statut: nextStatut,
      commentaire:    body.commentaire ?? null,
      geoloc:         body.geoloc ?? null,
      changed_by:     user.id,
    })

    let facture: unknown = null
    if (nextStatut === 'en_route' && lv.commande_id) {
      await db.from('commandes_shop')
        .update({ statut_commande: 'expediee', updated_at: new Date().toISOString() })
        .eq('erp_commande_id', lv.commande_id)
    }

    if (nextStatut === 'livree' && lv.commande_id) {
      const { data: commande } = await db
        .from('commandes')
        .select('statut, numero')
        .eq('id', lv.commande_id)
        .single()

      const cmd = commande as { statut: string; numero: string } | null
      if (cmd && cmd.statut !== 'delivered') {
        const { error: cmdUpdateErr } = await db
          .from('commandes')
          .update({ statut: 'delivered', updated_at: new Date().toISOString() })
          .eq('id', lv.commande_id)

        if (cmdUpdateErr) return c.json({ error: cmdUpdateErr.message }, 500)

        await db.from('historique_commandes').insert({
          commande_id:    lv.commande_id,
          ancien_statut:  cmd.statut,
          nouveau_statut: 'delivered',
          commentaire:    body.commentaire ?? `Livraison ${id} marquee livree`,
          changed_by:     user.id,
        })
      }

      const shopUpdate: Record<string, unknown> = {
        statut_commande: 'livree',
        updated_at:      new Date().toISOString(),
      }
      if (soldeApresPaiementLivraison <= 0) {
        shopUpdate.statut_paiement = 'paye'
      }
      await db.from('commandes_shop')
        .update(shopUpdate)
        .eq('erp_commande_id', lv.commande_id)

      try {
        const ensured = await ensureFactureForCommande({
          commandeId: lv.commande_id,
          statut:    soldeApresPaiementLivraison <= 0 ? 'paye' : 'envoye',
          userId:    user.id,
          notes:     'Facture verifiee automatiquement apres livraison logistique.',
        })
        facture = ensured.facture
      } catch (e) {
        return c.json({
          error: `Livraison marquee livree, mais la facture automatique n'a pas pu etre generee : ${(e as Error).message}`,
          code:  'FACTURE_AUTO_FAILED',
        }, 500)
      }
    }

    return c.json({ ...(updated as Record<string, unknown>), facture })
  },
)

// ── PATCH /livraisons/:id/assigner — assigner un livreur ─────────────────────
// Réservé aux rôles MANAGER et SUPER_ADMIN (LOGISTICS:UPDATE)

logistiqueRouter.patch(
  '/livraisons/:id/assigner',
  requireRole(['admin', 'superviseur', 'operateur', 'livreur']),
  zValidator('json', assignerSchema),
  async (c) => {
    const user = c.get('user')
    const { id } = c.req.param()
    const body = c.req.valid('json')

    // Vérification RBAC : MANAGER ou SUPER_ADMIN uniquement
    const perm = await checkPermission(user.id, 'LOGISTICS', 'UPDATE', user.role)
    if (!perm.allowed) {
      writeAuditLog({
        userId:       user.id,
        actionType:   'ACCESS_DENIED',
        module:       'LOGISTICS',
        resourceType: 'livraison',
        resourceId:   id,
      })
      return c.json({
        error: `Accès refusé — MANAGER ou SUPER_ADMIN requis (rôle actuel : ${perm.roleName ?? user.role})`,
        code:  'FORBIDDEN',
      }, 403)
    }

    const { data: livraison, error: fetchErr } = await db
      .from('livraisons')
      .select('id, statut')
      .eq('id', id)
      .single()

    if (fetchErr || !livraison) {
      return c.json({ error: 'Livraison introuvable', code: 'NOT_FOUND' }, 404)
    }

    const { data: livreurProfile, error: profileErr } = await db
      .from('profiles')
      .select('id, nom')
      .eq('id', body.livreur_id)
      .single()

    if (profileErr || !livreurProfile) {
      return c.json({ error: 'Profil livreur introuvable', code: 'LIVREUR_NOT_FOUND' }, 422)
    }

    const updatePayload: Record<string, unknown> = {
      livreur_id: body.livreur_id,
      updated_at: new Date().toISOString(),
    }
    if (body.transporteur !== undefined) {
      updatePayload.transporteur = body.transporteur
    }

    const { data: updated, error: updateErr } = await db
      .from('livraisons')
      .update(updatePayload)
      .eq('id', id)
      .select()
      .single()

    if (updateErr) {
      console.error('[logistique] PATCH assigner:', updateErr.message)
      return c.json({ error: updateErr.message }, 500)
    }

    const lv = livraison as { statut: string }
    const lp = livreurProfile as { nom: string }

    await db.from('livraisons_historique').insert({
      livraison_id:   id,
      ancien_statut:  lv.statut,
      nouveau_statut: lv.statut,
      commentaire:    `Assigné à ${lp.nom}`,
      changed_by:     user.id,
    })

    return c.json(updated)
  },
)
