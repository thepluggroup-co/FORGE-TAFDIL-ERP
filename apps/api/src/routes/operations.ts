import { Hono } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { supabaseAdmin } from '@forge/db'

const db = supabaseAdmin!
import { requireRole } from '../middleware/rbac'
import { notifyCommandeSms } from '../services/sms.service'
import { enregistrerPaiementCommande, ensureFactureForCommande, getFactureActiveByCommande } from '../services/finance-core.service'
import { notifyWorkflow } from '../services/workflow-notifications.service'
import type { HonoVariables } from '../types'

const router = new Hono<{ Variables: HonoVariables }>()

function calcStatutStock(stock: number, min: number, critique: number) {
  if (stock <= 0) return 'rupture'
  if (stock <= critique) return 'critique'
  if (stock <= min) return 'alerte'
  return 'normal'
}


async function enregistrerMouvementStock(args: {
  produit_id: string
  type: 'entree' | 'sortie'
  quantite: number
  reference: string
  notes: string
  user_id?: string
}) {
  const { data: produit, error: produitError } = await db
    .from('produits')
    .select('stock_actuel, stock_min, stock_critique')
    .eq('id', args.produit_id)
    .single()

  if (produitError || !produit) throw new Error('Produit introuvable')

  const p = produit as { stock_actuel: number; stock_min: number; stock_critique: number }
  const nouvelleQte = args.type === 'entree'
    ? p.stock_actuel + args.quantite
    : p.stock_actuel - args.quantite

  if (nouvelleQte < 0) {
    throw Object.assign(new Error(`Stock insuffisant : ${p.stock_actuel} disponible`), {
      code:       'INSUFFICIENT_STOCK',
      httpStatus: 422,
    })
  }

  const statut = calcStatutStock(nouvelleQte, p.stock_min, p.stock_critique)
  const [mvtRes, produitRes] = await Promise.all([
    db.from('mouvements_stock').insert({
      produit_id:  args.produit_id,
      type:        args.type,
      quantite:    args.quantite,
      reference:   args.reference,
      notes:       args.notes,
      created_by:  args.user_id ?? null,
    }),
    db.from('produits')
      .update({ stock_actuel: nouvelleQte, statut, updated_at: new Date().toISOString() })
      .eq('id', args.produit_id),
  ])

  if (mvtRes.error) throw new Error(mvtRes.error.message)
  if (produitRes.error) throw new Error(produitRes.error.message)
}

async function ensureFactureCommande(commandeId: string, userId?: string) {
  try {
    const result = await ensureFactureForCommande({
      commandeId,
      statut: 'brouillon',
      userId,
      notes: 'Facture generee automatiquement apres production. Validation finance requise avant envoi.',
    })
    return result.created
  } catch (e) {
    console.error('[finance] facture auto production:', e)
    return false
  }
}

async function getCommandeSmsInfo(commandeId: string) {
  const { data } = await db
    .from('commandes')
    .select('numero, client_nom, total_ttc_xaf, clients(telephone)')
    .eq('id', commandeId)
    .single()

  if (!data) return null
  const row = data as {
    numero: string
    client_nom: string
    total_ttc_xaf: number
    clients?: { telephone?: string | null } | null
  }

  return {
    numero:        row.numero,
    client_nom:    row.client_nom,
    total_ttc_xaf: row.total_ttc_xaf,
    telephone:     row.clients?.telephone ?? null,
  }
}

async function notifyCommandeEvent(commandeId: string, event: Parameters<typeof notifyCommandeSms>[1]) {
  const commande = await getCommandeSmsInfo(commandeId)
  if (!commande) return
  void notifyCommandeSms(commande, event).catch((e) => console.error('[sms] notify commande:', e))
}

async function finaliserProductionStock(job: Record<string, unknown>, userId?: string, quantiteProduite?: number) {
  if (job.type_job !== 'stock') return null
  if (Number(job.quantite_produite ?? 0) > 0) return job.produit_id ?? null

  const quantite = quantiteProduite ?? Number(job.quantite_prevue ?? 0)
  if (!Number.isFinite(quantite) || quantite <= 0) {
    throw Object.assign(new Error('Quantite produite requise pour entrer le stock'), { httpStatus: 422 })
  }

  let produitId = (job.produit_id as string | null) ?? null
  const designation = String(job.produit_designation ?? '').trim()

  if (!produitId) {
    const stockMin = 5
    const stockCritique = 2
    const statut = calcStatutStock(quantite, stockMin, stockCritique)
    const { data: produit, error } = await db
      .from('produits')
      .insert({
        ref:               job.produit_ref || `PRD-${Date.now().toString().slice(-6)}`,
        designation,
        description:       job.description_produit ?? null,
        categorie:         job.categorie || 'Production',
        unite:             job.unite || 'unite',
        stock_actuel:      0,
        stock_min:         stockMin,
        stock_critique:    stockCritique,
        prix_unitaire_xaf: Number(job.prix_unitaire_xaf ?? 0),
        statut,
        created_by:        userId ?? null,
        sync_status:       'synced',
      })
      .select('id')
      .single()

    if (error || !produit) throw new Error(error?.message ?? 'Produit impossible a creer')
    produitId = (produit as { id: string }).id
  }

  await enregistrerMouvementStock({
    produit_id: produitId,
    type:       'entree',
    quantite,
    reference:  String(job.numero ?? 'PRODUCTION'),
    notes:      `Production stock terminee - ${designation}`,
    user_id:    userId,
  })

  const produitUpdates: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (Number(job.prix_unitaire_xaf ?? 0) > 0) produitUpdates.prix_unitaire_xaf = Number(job.prix_unitaire_xaf)
  if (job.description_produit) produitUpdates.description = job.description_produit
  if (Object.keys(produitUpdates).length > 1) {
    await db.from('produits').update(produitUpdates).eq('id', produitId)
  }

  const prixPublic = Number(job.prix_public_xaf ?? job.prix_unitaire_xaf ?? 0)
  await db.from('produits_shop').upsert({
    product_id:    produitId,
    visible_shop:  Boolean(job.publier_shop),
    prix_public:   prixPublic > 0 ? prixPublic : null,
    min_commande:  1,
  }, { onConflict: 'product_id' })

  await db.from('jobs_production')
    .update({ produit_id: produitId, quantite_produite: quantite, updated_at: new Date().toISOString() })
    .eq('id', job.id)

  return produitId
}

// ── Machines d'état ────────────────────────────────────────────────────────────

const TRANSITIONS_JOB: Record<string, string[]> = {
  confirmed:     ['in_production', 'cancelled'],
  in_production: ['pret', 'cancelled'],
  pret:          ['delivered', 'cancelled'],
  delivered:     [],
  cancelled:     [],
}

const TRANSITIONS_PROJET: Record<string, string[]> = {
  planifie:  ['en_cours', 'annule'],
  en_cours:  ['suspendu', 'livre', 'annule'],
  suspendu:  ['en_cours', 'annule'],
  livre:     [],
  annule:    [],
}

const TRANSITIONS_LIVRAISON: Record<string, string[]> = {
  en_preparation: ['planifiee', 'annulee'],
  planifiee:      ['en_transit', 'annulee'],
  en_transit:     ['livree', 'annulee'],
  livree:         [],
  annulee:        [],
  // compat anciennes données
  confirmed:      ['pret', 'cancelled'],
  pret:           ['delivered', 'cancelled'],
  delivered:      [],
  cancelled:      [],
}

// ══════════════════════════════════════════════════════════════════════════════
// PRODUCTION — JOBS
// ══════════════════════════════════════════════════════════════════════════════

const jobSchema = z.object({
  commande_id:         z.string().optional(),
  type_job:            z.enum(['commande', 'stock']).default('commande').optional(),
  produit_id:          z.string().optional(),
  produit_ref:         z.string().optional(),
  produit_designation: z.string().min(1),
  categorie:           z.string().optional(),
  unite:               z.string().optional(),
  quantite_prevue:     z.number().positive().optional(),
  prix_unitaire_xaf:   z.number().min(0).optional(),
  prix_public_xaf:     z.number().min(0).optional(),
  publier_shop:        z.boolean().optional(),
  description_produit: z.string().optional(),
  machine_id:          z.string().optional(),
  machine_nom:         z.string().optional(),
  technicien_id:       z.string().optional(),
  technicien_nom:      z.string().optional(),
  date_debut:          z.string().optional(),
  date_fin_prevue:     z.string().optional(),
  notes:               z.string().optional(),
})

const jobStatutSchema = z.object({
  statut:          z.enum(['confirmed', 'in_production', 'pret', 'delivered', 'cancelled']),
  avancement_pct:  z.number().int().min(0).max(100).optional(),
  quantite_produite: z.number().positive().optional(),
  intrants:        z.array(z.object({
    produit_id: z.string(),
    quantite:   z.number().positive(),
    notes:      z.string().optional(),
  })).optional(),
  date_fin_reelle: z.string().optional(),
  notes:           z.string().optional(),
})

const jobAvancementSchema = z.object({
  avancement_pct: z.number().int().min(0).max(100),
  notes:          z.string().optional(),
})

router.get('/production/jobs', async (c) => {
  const { statut, commande_id, search } = c.req.query()
  const page    = Math.max(1, parseInt(c.req.query('page') ?? '1'))
  const perPage = Math.min(100, parseInt(c.req.query('per_page') ?? '20'))
  const from    = (page - 1) * perPage

  let q = db.from('jobs_production').select('*', { count: 'exact' })
  if (statut)      q = q.eq('statut', statut)
  if (commande_id) q = q.eq('commande_id', commande_id)
  if (search)      q = q.ilike('produit_designation', `%${search}%`)

  const { data, count, error } = await q
    .order('created_at', { ascending: false })
    .range(from, from + perPage - 1)

  if (error) return c.json({ error: error.message }, 500)

  // Signaler les retards : date_fin_prevue dépassée et job pas encore livré
  const today = new Date().toISOString().slice(0, 10)
  const enriched = (data ?? []).map((j: Record<string, unknown>) => ({
    ...j,
    en_retard: j.date_fin_prevue && (j.date_fin_prevue as string) < today &&
               !['delivered', 'cancelled'].includes(j.statut as string),
  }))

  return c.json({ data: enriched, total: count ?? 0, page, per_page: perPage })
})

router.get('/production/jobs/:id', async (c) => {
  const { id } = c.req.param()
  const { data, error } = await db
    .from('jobs_production')
    .select('*, commandes(numero, statut, client_nom)')
    .eq('id', id)
    .single()
  if (error || !data) return c.json({ error: 'Job introuvable', code: 'NOT_FOUND' }, 404)

  const today = new Date().toISOString().slice(0, 10)
  const j = data as Record<string, unknown>
  return c.json({
    ...j,
    en_retard: j.date_fin_prevue && (j.date_fin_prevue as string) < today &&
               !['delivered', 'cancelled'].includes(j.statut as string),
  })
})

router.post('/production/jobs', requireRole(['admin', 'superviseur', 'operateur']), zValidator('json', jobSchema), async (c) => {
  const user = c.get('user')
  const body = c.req.valid('json')
  const typeJob = body.type_job ?? (body.commande_id ? 'commande' : 'commande')

  if (typeJob === 'stock') {
    if (!body.produit_id && !body.produit_designation.trim()) {
      return c.json({ error: 'Produit requis pour une production stock', code: 'PRODUIT_REQUIRED' }, 422)
    }
    if (!body.quantite_prevue || body.quantite_prevue <= 0) {
      return c.json({ error: 'Quantite prevue requise pour une production stock', code: 'QUANTITE_REQUIRED' }, 422)
    }
  }

  // ── Bloquer si la machine est en panne ou en maintenance ─────────────────
  if (body.machine_id) {
    const { data: machine } = await db
      .from('machines')
      .select('nom, statut')
      .eq('id', body.machine_id)
      .single()

    if (machine) {
      const m = machine as { nom: string; statut: string }
      if (m.statut === 'panne') {
        return c.json({
          error: `Machine "${m.nom}" est en panne — assignation impossible`,
          code:  'MACHINE_PANNE',
        }, 422)
      }
      if (m.statut === 'maintenance') {
        return c.json({
          error: `Machine "${m.nom}" est en maintenance — assignation impossible`,
          code:  'MACHINE_MAINTENANCE',
        }, 422)
      }
    }
  }

  // Numéro séquentiel : JOB-YYYY-NNN
  const { count } = await db.from('jobs_production').select('*', { count: 'exact', head: true })
  const year      = new Date().getFullYear()
  const numero    = `JOB-${year}-${String((count ?? 0) + 1).padStart(3, '0')}`

  const { data, error } = await db
    .from('jobs_production')
    .insert({ ...body, type_job: typeJob, numero, statut: 'confirmed', avancement_pct: 0, created_by: user.id, sync_status: 'synced' })
    .select().single()

  if (error) return c.json({ error: error.message, code: error.code }, 400)
  return c.json(data, 201)
})

/**
 * PATCH /production/jobs/:id/statut
 * Transition validée par machine d'état.
 * Si avancement_pct = 100 → statut passe à 'pret' automatiquement.
 * Si statut = 'delivered' → date_fin_reelle capturée.
 * Si commande liée et statut 'pret' → commande passe à 'pret'.
 */
router.patch(
  '/production/jobs/:id/statut',
  requireRole(['admin', 'superviseur', 'operateur']),
  zValidator('json', jobStatutSchema),
  async (c) => {
    const { id } = c.req.param()
    const body   = c.req.valid('json')

    const { data: existing } = await db
      .from('jobs_production')
      .select('*')
      .eq('id', id)
      .single()

    if (!existing) return c.json({ error: 'Job introuvable', code: 'NOT_FOUND' }, 404)

    const ex       = existing as {
      id: string
      statut: string
      commande_id: string | null
      numero: string
      avancement_pct: number
      type_job?: string
    } & Record<string, unknown>
    const allowed  = TRANSITIONS_JOB[ex.statut] ?? []

    if (!allowed.includes(body.statut)) {
      return c.json({
        error: `Transition "${ex.statut}" → "${body.statut}" non autorisée`,
        code:  'INVALID_TRANSITION',
        transitions_autorisees: allowed,
      }, 422)
    }

    if (body.statut === 'in_production' && body.intrants?.length) {
      for (const intrant of body.intrants) {
        await enregistrerMouvementStock({
          produit_id: intrant.produit_id,
          type:       'sortie',
          quantite:   intrant.quantite,
          reference:  ex.numero,
          notes:      intrant.notes ?? `Sortie intrant production ${ex.numero}`,
          user_id:    c.get('user')?.id,
        })
      }
    }

    const updates: Record<string, unknown> = {
      statut:     body.statut,
      updated_at: new Date().toISOString(),
    }

    if (body.avancement_pct !== undefined) updates.avancement_pct = body.avancement_pct
    if (body.notes !== undefined)          updates.notes          = body.notes

    // Capturer date_fin_reelle quand le job est livré ou prêt
    if (['delivered', 'pret'].includes(body.statut) && !body.date_fin_reelle) {
      updates.date_fin_reelle = new Date().toISOString().slice(0, 10)
    } else if (body.date_fin_reelle) {
      updates.date_fin_reelle = body.date_fin_reelle
    }

    // Quand pret → mettre avancement à 100%
    if (body.statut === 'pret' || body.statut === 'delivered') {
      updates.avancement_pct = 100
    }
    const { data, error } = await db
      .from('jobs_production')
      .update(updates)
      .eq('id', id)
      .select().single()

    if (error) return c.json({ error: error.message }, 400)
    if (!data)  return c.json({ error: 'Job introuvable', code: 'NOT_FOUND' }, 404)

    if (body.statut === 'pret') {
      try {
        await finaliserProductionStock({ ...ex, ...data }, c.get('user')?.id, body.quantite_produite)
        if (ex.commande_id) {
          const factureCreee = await ensureFactureCommande(ex.commande_id, c.get('user')?.id)
          if (factureCreee) {
            await notifyCommandeEvent(ex.commande_id, 'facture_emise')
            await notifyWorkflow({
              event:   'finance.facture_production_generee',
              module:  'finance',
              severite:'warning',
              titre:   'Facture production generee',
              message: `Job ${ex.numero} termine : facture a controler dans Finance.`,
              ref:     ex.numero,
              url:     '/finance',
              data:    { job_id: id, commande_id: ex.commande_id },
            })
          }
        }
      } catch (err) {
        const e = err as Error & { httpStatus?: number; code?: string }
        return c.json({ error: e.message, code: e.code ?? 'PRODUCTION_FINALIZE_ERROR' }, (e.httpStatus ?? 400) as ContentfulStatusCode)
      }
    }

    // ── Auto-transition commande liée ────────────────────────────────────
    if (ex.commande_id) {
      const COMMANDE_STATUT: Record<string, string | null> = {
        in_production: 'in_production',
        pret:          'pret',
        delivered:     'delivered',
        cancelled:     null,  // on ne ferme pas la commande auto depuis le job
      }
      const cStatut = COMMANDE_STATUT[body.statut]
      if (cStatut) {
        const { data: commande } = await db
          .from('commandes')
          .select('statut')
          .eq('id', ex.commande_id)
          .single()

        if (commande) {
          const TRANSITIONS_COMMANDE: Record<string, string[]> = {
            confirmed:     ['in_production', 'cancelled'],
            in_production: ['pret', 'cancelled'],
            pret:          ['delivered', 'cancelled'],
            delivered:     [],
            cancelled:     [],
          }
          const cmdStatut  = (commande as { statut: string }).statut
          const cmdAllowed = TRANSITIONS_COMMANDE[cmdStatut] ?? []
          if (cmdAllowed.includes(cStatut)) {
            await db.from('commandes')
              .update({ statut: cStatut, updated_at: new Date().toISOString() })
              .eq('id', ex.commande_id)
            await db.from('historique_commandes').insert({
              commande_id:    ex.commande_id,
              ancien_statut:  cmdStatut,
              nouveau_statut: cStatut,
              commentaire:    `[Auto] Job ${ex.numero} passé à "${body.statut}"`,
            })
            if (cStatut === 'in_production') {
              await notifyCommandeEvent(ex.commande_id, 'commande_en_production')
              await notifyWorkflow({
                event:   'production.commande_en_production',
                module:  'production',
                severite:'info',
                titre:   'Commande en production',
                message: `Job ${ex.numero} demarre : la commande est en production.`,
                ref:     ex.numero,
                url:     '/production',
                data:    { job_id: id, commande_id: ex.commande_id },
              })
            }
            if (cStatut === 'pret') {
              await notifyCommandeEvent(ex.commande_id, 'commande_prete')
              await notifyWorkflow({
                event:   'commandes.commande_prete_livraison',
                module:  'commandes',
                severite:'success',
                titre:   'Commande prete',
                message: `Job ${ex.numero} termine : la commande peut passer en livraison apres controle facture/bon.`,
                ref:     ex.numero,
                url:     '/commandes',
                data:    { job_id: id, commande_id: ex.commande_id },
              })
            }
            if (cStatut === 'delivered') await notifyCommandeEvent(ex.commande_id, 'commande_livree')
          }
        }
      }
    }

    return c.json(data)
  },
)

/**
 * PATCH /production/jobs/:id/avancement
 * Met à jour l'avancement en %. Si 100% → transition auto vers 'pret'.
 */
router.patch(
  '/production/jobs/:id/avancement',
  requireRole(['admin', 'superviseur', 'operateur']),
  zValidator('json', jobAvancementSchema),
  async (c) => {
    const { id } = c.req.param()
    const body   = c.req.valid('json')

    const { data: existing } = await db
      .from('jobs_production')
      .select('statut, commande_id, numero')
      .eq('id', id)
      .single()

    if (!existing) return c.json({ error: 'Job introuvable', code: 'NOT_FOUND' }, 404)

    const ex = existing as { statut: string; commande_id: string | null; numero: string }
    if (['delivered', 'cancelled'].includes(ex.statut)) {
      return c.json({
        error: `Avancement ne peut pas être modifié sur un job en statut "${ex.statut}"`,
        code: 'INVALID_TRANSITION',
      }, 422)
    }

    const updates: Record<string, unknown> = {
      avancement_pct: body.avancement_pct,
      updated_at:     new Date().toISOString(),
    }
    if (body.notes) updates.notes = body.notes

    // 100% → passer automatiquement à 'pret' si le job est en production
    let nouveauStatut = ex.statut
    if (body.avancement_pct === 100 && ex.statut === 'in_production') {
      updates.statut          = 'pret'
      updates.date_fin_reelle = new Date().toISOString().slice(0, 10)
      nouveauStatut           = 'pret'
    }

    const { data, error } = await db
      .from('jobs_production')
      .update(updates)
      .eq('id', id)
      .select().single()

    if (error) return c.json({ error: error.message }, 400)

    // Auto-transition commande si job passe à 'pret'
    if (nouveauStatut === 'pret' && ex.commande_id) {
      const { data: commande } = await db
        .from('commandes').select('statut').eq('id', ex.commande_id).single()
      if (commande && (commande as { statut: string }).statut === 'in_production') {
        await db.from('commandes')
          .update({ statut: 'pret', updated_at: new Date().toISOString() })
          .eq('id', ex.commande_id)
        await db.from('historique_commandes').insert({
          commande_id:    ex.commande_id,
          ancien_statut:  'in_production',
          nouveau_statut: 'pret',
          commentaire:    `[Auto] Job ${ex.numero} à 100% — commande prête`,
        })
        const factureCreee = await ensureFactureCommande(ex.commande_id, c.get('user')?.id)
        await notifyCommandeEvent(ex.commande_id, 'commande_prete')
        await notifyWorkflow({
          event:   'commandes.commande_prete_livraison',
          module:  'commandes',
          severite:'success',
          titre:   'Commande prete',
          message: `Job ${ex.numero} a 100% : la commande peut passer en livraison apres controle facture/bon.`,
          ref:     ex.numero,
          url:     '/commandes',
          data:    { job_id: id, commande_id: ex.commande_id },
        })
        if (factureCreee) {
          await notifyCommandeEvent(ex.commande_id, 'facture_emise')
          await notifyWorkflow({
            event:   'finance.facture_production_generee',
            module:  'finance',
            severite:'warning',
            titre:   'Facture production generee',
            message: `Job ${ex.numero} pret : facture a controler dans Finance.`,
            ref:     ex.numero,
            url:     '/finance',
            data:    { job_id: id, commande_id: ex.commande_id },
          })
        }
      }
    }

    return c.json(data)
  },
)

// Historique de production enrichi d'une commande
router.get('/production/historique/:commande_id', async (c) => {
  const { commande_id } = c.req.param()

  const { data, error } = await db
    .from('jobs_production')
    .select(`
      id, numero, produit_designation, statut, avancement_pct,
      date_debut, date_fin_prevue, date_fin_reelle, notes,
      created_at, updated_at,
      machines(id, nom, type, statut),
      employes(id, nom, poste)
    `)
    .eq('commande_id', commande_id)
    .order('created_at', { ascending: true })

  if (error) return c.json({ error: error.message }, 500)

  const today = new Date()

  const enriched = (data ?? []).map((j: Record<string, unknown>) => {
    const debut      = j.date_debut      ? new Date(j.date_debut as string)      : null
    const finPrevue  = j.date_fin_prevue ? new Date(j.date_fin_prevue as string)  : null
    const finReelle  = j.date_fin_reelle ? new Date(j.date_fin_reelle as string)  : null

    const duree_prevue_h = debut && finPrevue
      ? Math.round((finPrevue.getTime() - debut.getTime()) / 3600000 * 10) / 10
      : null

    const duree_reelle_h = debut && finReelle
      ? Math.round((finReelle.getTime() - debut.getTime()) / 3600000 * 10) / 10
      : null

    const en_retard = finPrevue && !finReelle &&
      !['delivered', 'cancelled'].includes(j.statut as string) &&
      today > finPrevue

    return {
      ...j,
      statut:         j.statut as string,
      avancement_pct: j.avancement_pct as number,
      duree_prevue_h,
      duree_reelle_h,
      en_retard,
      ecart_h: duree_prevue_h && duree_reelle_h
        ? Math.round((duree_reelle_h - duree_prevue_h) * 10) / 10
        : null,
    }
  })

  // Récapitulatif
  const total          = enriched.length
  const termines       = enriched.filter(j => j.statut === 'delivered').length
  const enRetard       = enriched.filter(j => j.en_retard).length
  const avancementMoyen = total > 0
    ? Math.round(enriched.reduce((s, j) => s + ((j.avancement_pct as number) ?? 0), 0) / total)
    : 0

  return c.json({
    commande_id,
    jobs:              enriched,
    total,
    recapitulatif: {
      termines,
      en_cours:         enriched.filter(j => j.statut === 'in_production').length,
      en_retard:        enRetard,
      avancement_moyen: avancementMoyen,
    },
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// PROJETS
// ══════════════════════════════════════════════════════════════════════════════

const projetSchema = z.object({
  nom:             z.string().min(1),
  description:     z.string().optional(),
  client_id:       z.string().optional(),
  client_nom:      z.string().optional(),
  chef_projet_id:  z.string().optional(),
  chef_projet_nom: z.string().optional(),
  budget_xaf:      z.number().min(0).default(0),
  date_debut:      z.string().optional(),
  deadline:        z.string().optional(),
})

const projetStatutSchema = z.object({
  statut:         z.enum(['planifie', 'en_cours', 'suspendu', 'livre', 'annule']),
  avancement_pct: z.number().int().min(0).max(100).optional(),
  depense_xaf:    z.number().min(0).optional(),
})

const tacheSchema = z.object({
  titre:          z.string().min(1),
  description:    z.string().optional(),
  responsable_id: z.string().optional(),
  priorite:       z.enum(['basse', 'normale', 'haute', 'critique']).default('normale'),
  date_echeance:  z.string().optional(),
})

const tacheStatutSchema = z.object({
  statut: z.enum(['todo', 'en_cours', 'done', 'bloque']),
})

router.get('/projets', async (c) => {
  const { statut, search } = c.req.query()
  const page    = Math.max(1, parseInt(c.req.query('page') ?? '1'))
  const perPage = Math.min(100, parseInt(c.req.query('per_page') ?? '20'))
  const from    = (page - 1) * perPage

  let q = db.from('projets').select('*', { count: 'exact' })
  if (statut) q = q.eq('statut', statut)
  if (search) q = q.ilike('nom', `%${search}%`)

  const { data, count, error } = await q
    .order('created_at', { ascending: false })
    .range(from, from + perPage - 1)

  if (error) return c.json({ error: error.message }, 500)

  // Enrichir avec alerte budget
  const enriched = (data ?? []).map((p: Record<string, unknown>) => ({
    ...p,
    alerte_budget: (p.depense_xaf as number) > (p.budget_xaf as number) && (p.budget_xaf as number) > 0,
  }))

  return c.json({ data: enriched, total: count ?? 0, page, per_page: perPage })
})

router.get('/projets/:id', async (c) => {
  const { id } = c.req.param()

  const { data, error } = await db
    .from('projets')
    .select('*, taches_projet(*)')
    .eq('id', id)
    .single()

  if (error || !data) return c.json({ error: 'Projet introuvable', code: 'NOT_FOUND' }, 404)

  const p = data as Record<string, unknown>
  return c.json({
    ...p,
    alerte_budget: (p.depense_xaf as number) > (p.budget_xaf as number) && (p.budget_xaf as number) > 0,
  })
})

router.post('/projets', requireRole(['admin', 'superviseur']), zValidator('json', projetSchema), async (c) => {
  const user = c.get('user')
  const body = c.req.valid('json')

  // Si client_id fourni, récupérer le nom du client
  let client_nom = body.client_nom
  if (body.client_id && !client_nom) {
    const { data: client } = await db.from('clients').select('nom').eq('id', body.client_id).single()
    client_nom = (client as { nom: string } | null)?.nom
  }

  // Si chef_projet_id fourni, récupérer le nom
  let chef_projet_nom = body.chef_projet_nom
  if (body.chef_projet_id && !chef_projet_nom) {
    const { data: emp } = await db.from('employes').select('nom').eq('id', body.chef_projet_id).single()
    chef_projet_nom = (emp as { nom: string } | null)?.nom
  }

  // Construire l'objet d'insertion en évitant les colonnes chef_projet_id / assistant_id
  // qui peuvent ne pas exister si la migration 20260530_projets_equipe n'a pas été jouée.
  const insertRow: Record<string, unknown> = {
    nom:             body.nom,
    description:     body.description ?? null,
    client_id:       body.client_id   ?? null,
    client_nom:      client_nom       ?? null,
    chef_projet_nom: chef_projet_nom  ?? null,
    budget_xaf:      body.budget_xaf  ?? 0,
    date_debut:      body.date_debut  ?? null,
    deadline:        body.deadline    ?? null,
    created_by:      user.id,
    sync_status:     'synced',
  }

  const { data, error } = await db
    .from('projets')
    .insert(insertRow)
    .select().single()

  if (error) return c.json({ error: error.message, code: error.code }, 400)
  return c.json(data, 201)
})

router.patch('/projets/:id/statut', requireRole(['admin', 'superviseur']), zValidator('json', projetStatutSchema), async (c) => {
  const { id } = c.req.param()
  const body   = c.req.valid('json')

  const { data: existing } = await db.from('projets').select('statut, budget_xaf, depense_xaf').eq('id', id).single()
  if (!existing) return c.json({ error: 'Projet introuvable', code: 'NOT_FOUND' }, 404)

  const ex      = existing as { statut: string; budget_xaf: number; depense_xaf: number }
  const allowed = TRANSITIONS_PROJET[ex.statut] ?? []

  if (!allowed.includes(body.statut)) {
    return c.json({
      error: `Transition "${ex.statut}" → "${body.statut}" non autorisée`,
      code:  'INVALID_TRANSITION',
      transitions_autorisees: allowed,
    }, 422)
  }

  const updates: Record<string, unknown> = { statut: body.statut, updated_at: new Date().toISOString() }
  if (body.avancement_pct !== undefined) updates.avancement_pct = body.avancement_pct
  if (body.depense_xaf    !== undefined) updates.depense_xaf    = body.depense_xaf

  const { data, error } = await db
    .from('projets').update(updates).eq('id', id).select().single()

  if (error) return c.json({ error: error.message }, 400)
  if (!data)  return c.json({ error: 'Projet introuvable', code: 'NOT_FOUND' }, 404)

  const p = data as Record<string, unknown>
  const alerte_budget = (p.depense_xaf as number) > (p.budget_xaf as number) && (p.budget_xaf as number) > 0

  return c.json({ ...data, alerte_budget })
})

// ── Tâches de projet ──────────────────────────────────────────────────────────

router.get('/projets/:id/taches', async (c) => {
  const { id } = c.req.param()

  // Trier par priorité : critique → haute → normale → basse
  const PRIORITE_ORDER: Record<string, number> = { critique: 0, haute: 1, normale: 2, basse: 3 }

  const { data, error } = await db
    .from('taches_projet')
    .select('*')
    .eq('projet_id', id)

  if (error) return c.json({ error: error.message }, 500)

  const sorted = (data ?? []).sort((a: Record<string, unknown>, b: Record<string, unknown>) =>
    (PRIORITE_ORDER[a.priorite as string] ?? 99) - (PRIORITE_ORDER[b.priorite as string] ?? 99)
  )

  return c.json({ data: sorted, total: sorted.length })
})

router.post('/projets/:id/taches', requireRole(['admin', 'superviseur']), zValidator('json', tacheSchema), async (c) => {
  const { id }  = c.req.param()
  const body    = c.req.valid('json')

  // Bloquer la création de tâche si le projet est suspendu ou annulé
  const { data: projet } = await db.from('projets').select('statut').eq('id', id).single()
  if (!projet) return c.json({ error: 'Projet introuvable', code: 'NOT_FOUND' }, 404)

  const p = projet as { statut: string }
  if (['suspendu', 'annule'].includes(p.statut)) {
    return c.json({
      error: `Projet "${p.statut}" — création de tâche impossible`,
      code:  'PROJET_BLOQUE',
    }, 422)
  }

  const { data, error } = await db
    .from('taches_projet')
    .insert({ ...body, projet_id: id, statut: 'todo' })
    .select().single()

  if (error) return c.json({ error: error.message, code: error.code }, 400)
  return c.json(data, 201)
})

router.patch('/projets/:projetId/taches/:tacheId/statut', requireRole(['admin', 'superviseur', 'operateur']), zValidator('json', tacheStatutSchema), async (c) => {
  const { projetId, tacheId } = c.req.param()
  const body = c.req.valid('json')

  // Bloquer les mises à jour si le projet est suspendu
  const { data: projet } = await db.from('projets').select('statut').eq('id', projetId).single()
  if (!projet) return c.json({ error: 'Projet introuvable', code: 'NOT_FOUND' }, 404)

  if ((projet as { statut: string }).statut === 'suspendu') {
    return c.json({
      error: 'Projet suspendu — mises à jour de tâches bloquées',
      code:  'PROJET_SUSPENDU',
    }, 422)
  }

  const { data, error } = await db
    .from('taches_projet')
    .update({ statut: body.statut, updated_at: new Date().toISOString() })
    .eq('id', tacheId)
    .eq('projet_id', projetId)
    .select().single()

  if (error) return c.json({ error: error.message }, 400)
  if (!data)  return c.json({ error: 'Tâche introuvable', code: 'NOT_FOUND' }, 404)

  // Recalculer avancement du projet : % de tâches done
  const { data: toutesTouches } = await db
    .from('taches_projet')
    .select('statut')
    .eq('projet_id', projetId)

  if (toutesTouches && toutesTouches.length > 0) {
    const done  = toutesTouches.filter((t: { statut: string }) => t.statut === 'done').length
    const total = toutesTouches.length
    const avancement_pct = Math.round((done / total) * 100)
    await db.from('projets')
      .update({ avancement_pct, updated_at: new Date().toISOString() })
      .eq('id', projetId)
  }

  return c.json(data)
})

// ══════════════════════════════════════════════════════════════════════════════
// PROJETS — MEMBRES D'ÉQUIPE (PRJ03)
// ══════════════════════════════════════════════════════════════════════════════

const membreSchema = z.object({
  employe_id:        z.string(),
  role_projet:       z.enum(['chef_projet', 'assistant', 'technicien', 'stagiaire', 'sous_traitant']).default('technicien'),
  date_debut:        z.string().optional(),
  date_fin:          z.string().optional(),
  heures_planifiees: z.number().min(0).default(0),
})

const membreHeuresSchema = z.object({
  heures_reelles: z.number().min(0),
})

router.get('/projets/:id/membres', async (c) => {
  const { id } = c.req.param()

  const { data, error } = await db
    .from('projets_membres')
    .select('*, employes(id, nom, poste, departement, telephone)')
    .eq('projet_id', id)
    .order('role_projet')

  if (error) return c.json({ error: error.message }, 500)
  return c.json({ data: data ?? [], total: (data ?? []).length })
})

router.post('/projets/:id/membres', requireRole(['admin', 'superviseur']), zValidator('json', membreSchema), async (c) => {
  const { id }  = c.req.param()
  const user    = c.get('user')
  const body    = c.req.valid('json')

  const { data: projet } = await db.from('projets').select('statut').eq('id', id).single()
  if (!projet) return c.json({ error: 'Projet introuvable', code: 'NOT_FOUND' }, 404)

  if ((projet as { statut: string }).statut === 'annule') {
    return c.json({ error: 'Projet annulé — ajout de membres impossible', code: 'PROJET_ANNULE' }, 422)
  }

  // Vérifier que l'employé existe
  const { data: emp } = await db.from('employes').select('nom').eq('id', body.employe_id).single()
  if (!emp) return c.json({ error: 'Employé introuvable', code: 'EMP_NOT_FOUND' }, 404)

  const { data, error } = await db
    .from('projets_membres')
    .upsert(
      { ...body, projet_id: id, created_by: user.id },
      { onConflict: 'projet_id,employe_id' },
    )
    .select('*, employes(nom, poste)').single()

  if (error) return c.json({ error: error.message, code: error.code }, 400)

  // Si c'est un chef_projet → mettre à jour chef_projet_id sur le projet
  if (body.role_projet === 'chef_projet') {
    await db.from('projets').update({
      chef_projet_id:  body.employe_id,
      chef_projet_nom: (emp as { nom: string }).nom,
      updated_at:      new Date().toISOString(),
    }).eq('id', id)
  }
  if (body.role_projet === 'assistant') {
    await db.from('projets').update({
      assistant_id: body.employe_id,
      updated_at:   new Date().toISOString(),
    }).eq('id', id)
  }

  return c.json(data, 201)
})

router.delete('/projets/:id/membres/:employe_id', requireRole(['admin', 'superviseur']), async (c) => {
  const { id, employe_id } = c.req.param()

  const { error } = await db
    .from('projets_membres')
    .delete()
    .eq('projet_id', id)
    .eq('employe_id', employe_id)

  if (error) return c.json({ error: error.message }, 400)
  return c.body(null, 204)
})

router.patch('/projets/:id/membres/:employe_id/heures', requireRole(['admin', 'superviseur', 'operateur']), zValidator('json', membreHeuresSchema), async (c) => {
  const { id, employe_id } = c.req.param()
  const body = c.req.valid('json')

  const { data, error } = await db
    .from('projets_membres')
    .update({ heures_reelles: body.heures_reelles })
    .eq('projet_id', id)
    .eq('employe_id', employe_id)
    .select().single()

  if (error) return c.json({ error: error.message }, 400)
  if (!data)  return c.json({ error: 'Membre introuvable', code: 'NOT_FOUND' }, 404)
  return c.json(data)
})

// ══════════════════════════════════════════════════════════════════════════════
// LOGISTIQUE — LIVRAISONS
// ══════════════════════════════════════════════════════════════════════════════

const livraisonSchema = z.object({
  commande_id:             z.string().optional(),
  client_id:               z.string().optional(),
  client_nom:              z.string().min(1),
  destination:             z.string().min(1),
  transporteur:            z.string().optional(),
  date_depart:             z.string().optional(),
  date_livraison_prevue:   z.string().optional(),
  notes:                   z.string().optional(),
})

const livraisonStatutSchema = z.object({
  statut:                z.enum(['planifiee', 'en_transit', 'livree', 'annulee']),
  date_livraison_reelle: z.string().optional(),
  notes:                 z.string().optional(),
  paiement_livraison:    z.object({
    montant_xaf:    z.number().min(0),
    methode:        z.enum(['mobile_money', 'especes']),
    reference_ext:  z.string().optional(),
  }).optional(),
})

async function verifierCommandeLivrable(commandeId: string) {
  const [bonRes, facture] = await Promise.all([
    db.from('bons_sortie')
      .select('id, numero, statut')
      .eq('commande_id', commandeId)
      .eq('statut', 'execute')
      .limit(1)
      .maybeSingle(),
    getFactureActiveByCommande(commandeId),
  ])

  if (bonRes.error) throw new Error(bonRes.error.message)
  if (!bonRes.data) {
    return {
      ok: false,
      code: 'BON_SORTIE_NOT_EXECUTED',
      error: 'Le bon de sortie doit etre execute avant la livraison.',
    }
  }

  const f = facture as {
    id?: string
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
    }
  }

  if (!['valide', 'envoye', 'paye'].includes(String(f.statut))) {
    return {
      ok: false,
      code: 'FACTURE_NOT_READY',
      error: `La facture ${f.numero ?? ''} doit etre validee/envoyee avant la livraison.`,
    }
  }

  const total = Number(f.total_ttc_xaf ?? 0)
  const paye = Number(f.montant_paye_xaf ?? 0)
  return {
    ok: true,
    facture: f,
    solde_restant_xaf: Math.max(0, Math.round(total - paye)),
  }
}

async function insertHistoriqueLivraison(params: {
  livraisonId: string
  ancienStatut?: string | null
  nouveauStatut: string
  commentaire?: string | null
  userId?: string
}) {
  const { error } = await db.from('livraisons_historique').insert({
    livraison_id:   params.livraisonId,
    ancien_statut:  params.ancienStatut ?? null,
    nouveau_statut: params.nouveauStatut,
    commentaire:    params.commentaire ?? null,
    changed_by:     params.userId ?? null,
  })
  if (error) console.error('[logistique] historique livraison:', error)
}

router.get('/logistique/livraisons', async (c) => {
  const { statut, search } = c.req.query()
  const page    = Math.max(1, parseInt(c.req.query('page') ?? '1'))
  const perPage = Math.min(100, parseInt(c.req.query('per_page') ?? '20'))
  const from    = (page - 1) * perPage

  let q = db.from('livraisons').select('*', { count: 'exact' })
  if (statut) q = q.eq('statut', statut)
  if (search) q = q.or(`client_nom.ilike.%${search}%,numero.ilike.%${search}%`)

  const { data, count, error } = await q
    .order('created_at', { ascending: false })
    .range(from, from + perPage - 1)

  if (error) return c.json({ error: error.message }, 500)

  const livraisons = data ?? []
  const livraisonIds = livraisons.map((livraison) => livraison.id).filter(Boolean)
  const historiqueParLivraison = new Map<string, unknown[]>()

  if (livraisonIds.length > 0) {
    const { data: historique, error: historiqueError } = await db
      .from('livraisons_historique')
      .select('*')
      .in('livraison_id', livraisonIds)
      .order('changed_at', { ascending: false })

    if (historiqueError) {
      console.error('[logistique] lecture historique livraison:', historiqueError)
    } else {
      for (const entree of historique ?? []) {
        const livraisonId = entree.livraison_id
        if (!historiqueParLivraison.has(livraisonId)) historiqueParLivraison.set(livraisonId, [])
        historiqueParLivraison.get(livraisonId)?.push(entree)
      }
    }
  }

  const enrichedData = []
  for (const livraison of livraisons) {
    let soldeRestant = 0
    let factureStatut: string | null = null
    if (livraison.commande_id) {
      const facture = await getFactureActiveByCommande(livraison.commande_id).catch(() => null) as {
        statut?: string
        total_ttc_xaf?: number
        montant_paye_xaf?: number
      } | null
      factureStatut = facture?.statut ?? null
      soldeRestant = Math.max(0, Math.round(Number(facture?.total_ttc_xaf ?? 0) - Number(facture?.montant_paye_xaf ?? 0)))
    }
    enrichedData.push({
      ...livraison,
      facture_statut: factureStatut,
      solde_restant_xaf: soldeRestant,
      livraisons_historique: historiqueParLivraison.get(livraison.id) ?? [],
    })
  }

  return c.json({ data: enrichedData, total: count ?? 0, page, per_page: perPage })
})

router.get('/logistique/commandes-pretes', async (c) => {
  const { data: livraisonsActives } = await db
    .from('livraisons')
    .select('commande_id')
    .in('statut', ['en_preparation', 'planifiee', 'en_transit', 'confirmed', 'pret'])
    .not('commande_id', 'is', null)

  const commandeIdsDejaPlanifiees = ((livraisonsActives ?? []) as { commande_id: string | null }[])
    .map((l) => l.commande_id)
    .filter(Boolean) as string[]

  let q = db
    .from('commandes')
    .select('id, numero, client_id, client_nom, date_livraison_prevue, total_ttc_xaf, statut')
    .eq('statut', 'pret')

  if (commandeIdsDejaPlanifiees.length > 0) {
    q = q.not('id', 'in', `(${commandeIdsDejaPlanifiees.join(',')})`)
  }

  const { data, error } = await q.order('date_livraison_prevue', { ascending: true, nullsFirst: false })
  if (error) return c.json({ error: error.message }, 500)

  const eligible = []
  for (const commande of data ?? []) {
    const check = await verifierCommandeLivrable(commande.id)
    if (check.ok) eligible.push({
      ...commande,
      facture_statut: (check.facture as { statut?: string } | undefined)?.statut ?? null,
      solde_restant_xaf: check.solde_restant_xaf ?? 0,
    })
  }

  return c.json({ data: eligible, total: eligible.length })
})

/** Tableau de bord préparation — 4 colonnes */
router.get('/logistique/preparation/resume', async (c) => {
  const [
    { count: aPreparerCount },
    { count: enCoursCount },
    { count: pretALivrerCount },
    { count: planifieeCount },
  ] = await Promise.all([
    db.from('bons_sortie').select('*', { count: 'exact', head: true })
      .eq('statut', 'valide').eq('statut_preparation', 'a_preparer'),
    db.from('bons_sortie').select('*', { count: 'exact', head: true })
      .eq('statut', 'valide').eq('statut_preparation', 'en_cours'),
    db.from('livraisons').select('*', { count: 'exact', head: true })
      .eq('statut', 'en_preparation'),
    db.from('livraisons').select('*', { count: 'exact', head: true })
      .eq('statut', 'planifiee'),
  ])

  return c.json({
    a_preparer:    aPreparerCount  ?? 0,
    en_cours:      enCoursCount    ?? 0,
    pret_a_livrer: pretALivrerCount ?? 0,
    planifiee:     planifieeCount  ?? 0,
  })
})

router.post('/logistique/livraisons', requireRole(['admin', 'superviseur', 'operateur']), zValidator('json', livraisonSchema), async (c) => {
  const user = c.get('user')
  const body = c.req.valid('json')

  // Si commande_id fourni, copier les données client automatiquement
  let client_nom = body.client_nom
  let client_id  = body.client_id
  if (body.commande_id) {
    const { data: commande } = await db
      .from('commandes')
      .select('client_id, client_nom, statut, numero, date_livraison_prevue')
      .eq('id', body.commande_id)
      .single()
    if (!commande) return c.json({ error: 'Commande introuvable', code: 'COMMANDE_NOT_FOUND' }, 404)

    const cmd = commande as { client_id: string | null; client_nom: string; statut: string; numero: string; date_livraison_prevue: string | null }
    if (cmd.statut !== 'pret') {
      return c.json({
        error: `La commande ${cmd.numero} n'est pas prête à livrer`,
        code: 'COMMANDE_NOT_READY',
      }, 422)
    }

    const readiness = await verifierCommandeLivrable(body.commande_id)
    if (!readiness.ok) {
      return c.json({
        error: readiness.error,
        code:  readiness.code,
      }, 422)
    }

    const { count: activeLivraisons } = await db
      .from('livraisons')
      .select('*', { count: 'exact', head: true })
      .eq('commande_id', body.commande_id)
      .in('statut', ['en_preparation', 'planifiee', 'en_transit', 'confirmed', 'pret'])

    if ((activeLivraisons ?? 0) > 0) {
      return c.json({
        error: `Une livraison active existe déjà pour la commande ${cmd.numero}`,
        code: 'LIVRAISON_ALREADY_EXISTS',
      }, 422)
    }

    client_id  = client_id  ?? cmd.client_id ?? undefined
    client_nom = client_nom ?? cmd.client_nom

    if (!body.date_livraison_prevue && cmd.date_livraison_prevue) {
      body.date_livraison_prevue = cmd.date_livraison_prevue
    }
  }

  // Si client_id fourni mais pas de nom, le récupérer
  if (client_id && !client_nom) {
    const { data: client } = await db.from('clients').select('nom').eq('id', client_id).single()
    client_nom = (client as { nom: string } | null)?.nom ?? client_nom
  }

  const { count } = await db.from('livraisons').select('*', { count: 'exact', head: true })
  const year      = new Date().getFullYear()
  const numero    = `LIV-${year}-${String((count ?? 0) + 1).padStart(3, '0')}`

  const { data, error } = await db
    .from('livraisons')
    .insert({
      ...body,
      numero,
      statut: 'planifiee',
      client_id: client_id ?? null,
      client_nom,
      created_by: user.id,
      sync_status: 'synced',
    })
    .select().single()

  if (error) return c.json({ error: error.message, code: error.code }, 400)
  await insertHistoriqueLivraison({
    livraisonId: (data as { id: string }).id,
    ancienStatut: null,
    nouveauStatut: 'planifiee',
    commentaire: body.commande_id ? 'Livraison planifiée depuis une commande prête' : 'Livraison planifiée',
    userId: user.id,
  })
  await notifyWorkflow({
    event:   'logistique.livraison_planifiee',
    module:  'logistique',
    severite:'info',
    titre:   'Livraison planifiee',
    message: body.commande_id
      ? `Livraison ${numero} planifiee pour la commande liee.`
      : `Livraison ${numero} planifiee.`,
    ref:     numero,
    url:     '/logistique',
    data:    { livraison_id: (data as { id: string }).id, commande_id: body.commande_id ?? null },
  })
  return c.json(data, 201)
})

router.patch('/logistique/livraisons/:id/statut', requireRole(['admin', 'superviseur', 'operateur']), zValidator('json', livraisonStatutSchema), async (c) => {
  const { id } = c.req.param()
  const body   = c.req.valid('json')
  const user   = c.get('user')

  const { data: existing } = await db
    .from('livraisons')
    .select('statut, commande_id')
    .eq('id', id)
    .single()

  if (!existing) return c.json({ error: 'Livraison introuvable', code: 'NOT_FOUND' }, 404)

  const ex      = existing as { statut: string; commande_id: string | null }
  const allowed = TRANSITIONS_LIVRAISON[ex.statut] ?? []

  if (!allowed.includes(body.statut)) {
    return c.json({
      error: `Transition "${ex.statut}" -> "${body.statut}" non autorisee`,
      code:  'INVALID_TRANSITION',
      transitions_autorisees: allowed,
    }, 422)
  }

  if (ex.commande_id && ['en_transit', 'livree'].includes(body.statut)) {
    const readiness = await verifierCommandeLivrable(ex.commande_id)
    if (!readiness.ok) {
      return c.json({
        error: readiness.error,
        code:  readiness.code,
      }, 422)
    }

    if (body.statut === 'livree') {
      const solde = Number(readiness.solde_restant_xaf ?? 0)
      const montantLivreur = Number(body.paiement_livraison?.montant_xaf ?? 0)
      if (solde > 0 && !body.paiement_livraison) {
        return c.json({
          error: `Paiement livraison requis : solde restant ${Math.round(solde).toLocaleString('fr-CM')} XAF`,
          code:  'DELIVERY_PAYMENT_REQUIRED',
          solde_restant_xaf: Math.round(solde),
        }, 422)
      }
      if (solde > 0 && Math.abs(montantLivreur - solde) > 1) {
        return c.json({
          error: `Montant encaisse incorrect. Solde attendu : ${Math.round(solde).toLocaleString('fr-CM')} XAF`,
          code:  'INVALID_DELIVERY_PAYMENT_AMOUNT',
          solde_restant_xaf: Math.round(solde),
        }, 422)
      }
      if (body.paiement_livraison && body.paiement_livraison.montant_xaf > 0) {
        await enregistrerPaiementCommande({
          commandeId:              ex.commande_id,
          montantXaf:              body.paiement_livraison.montant_xaf,
          methode:                 body.paiement_livraison.methode,
          referenceExt:            body.paiement_livraison.reference_ext ?? null,
          datePaiement:            body.date_livraison_reelle ?? new Date().toISOString().slice(0, 10),
          notes:                   `Paiement encaisse a la livraison ${id}`,
          userId:                  user.id,
          ensureFacture:           true,
          factureStatutSiCreation: 'envoye',
        })
      }
    }
  }

  const updates: Record<string, unknown> = {
    statut:     body.statut,
    updated_at: new Date().toISOString(),
  }
  if (body.notes) updates.notes = body.notes

  if (body.statut === 'livree') {
    updates.date_livraison_reelle = body.date_livraison_reelle ?? new Date().toISOString().slice(0, 10)
  }

  const { data, error } = await db
    .from('livraisons').update(updates).eq('id', id).select().single()

  if (error) return c.json({ error: error.message }, 400)
  if (!data)  return c.json({ error: 'Livraison introuvable', code: 'NOT_FOUND' }, 404)

  await insertHistoriqueLivraison({
    livraisonId: id,
    ancienStatut: ex.statut,
    nouveauStatut: body.statut,
    commentaire: body.notes ?? null,
    userId: user.id,
  })

  if (body.statut === 'en_transit' && ex.commande_id) {
    await db.from('commandes_shop')
      .update({ statut_commande: 'expediee', updated_at: new Date().toISOString() })
      .eq('erp_commande_id', ex.commande_id)
    await notifyWorkflow({
      event:   'logistique.livraison_en_transit',
      module:  'logistique',
      severite:'info',
      titre:   'Livraison en transit',
      message: 'Le livreur a demarre la livraison.',
      ref:     id,
      url:     '/logistique',
      data:    { livraison_id: id, commande_id: ex.commande_id },
    })
  }

  if (body.statut === 'livree' && ex.commande_id) {
    const { data: commande } = await db
      .from('commandes').select('statut').eq('id', ex.commande_id).single()
    if (commande && (commande as { statut: string }).statut === 'pret') {
      await db.from('commandes')
        .update({ statut: 'delivered', updated_at: new Date().toISOString() })
        .eq('id', ex.commande_id)
      await db.from('historique_commandes').insert({
        commande_id:    ex.commande_id,
        ancien_statut:  'pret',
        nouveau_statut: 'delivered',
        commentaire:    `[Auto] Livraison ${id} confirmee`,
        changed_by:     user.id,
      })
      await notifyCommandeEvent(ex.commande_id, 'commande_livree')
    }

    await db.from('commandes_shop')
      .update({
        statut_commande:  'livree',
        statut_paiement:  'paye',
        updated_at:       new Date().toISOString(),
      })
      .eq('erp_commande_id', ex.commande_id)

    await notifyWorkflow({
      event:   'logistique.livraison_terminee',
      module:  'logistique',
      severite:'success',
      titre:   'Livraison terminee',
      message: body.paiement_livraison && body.paiement_livraison.montant_xaf > 0
        ? `Livraison confirmee avec encaissement de ${Math.round(body.paiement_livraison.montant_xaf).toLocaleString('fr-CM')} XAF.`
        : 'Livraison confirmee.',
      ref:     id,
      url:     '/logistique',
      data:    {
        livraison_id: id,
        commande_id: ex.commande_id,
        paiement_livraison: body.paiement_livraison ?? null,
      },
    })
  }

  return c.json(data)
})

// MARKETING - CAMPAGNES
const campagneSchema = z.object({
  nom:         z.string().min(1),
  description: z.string().optional(),
  canal:       z.string().min(1),
  budget_xaf:  z.number().min(0).default(0),
  date_debut:  z.string(),
  date_fin:    z.string(),
})

const campagneStatutSchema = z.object({
  statut:              z.enum(['planifie', 'active', 'pause', 'termine', 'annule']),
  reach:               z.number().int().min(0).optional(),
  leads_count:         z.number().int().min(0).optional(),
  conversions_count:   z.number().int().min(0).optional(),
})

router.get('/marketing/campagnes', async (c) => {
  const { statut, search } = c.req.query()
  const page    = Math.max(1, parseInt(c.req.query('page') ?? '1'))
  const perPage = Math.min(100, parseInt(c.req.query('per_page') ?? '20'))
  const from    = (page - 1) * perPage

  let q = db.from('campagnes_marketing').select('*', { count: 'exact' })
  if (statut) q = q.eq('statut', statut)
  if (search) q = q.ilike('nom', `%${search}%`)

  const { data, count, error } = await q
    .order('created_at', { ascending: false })
    .range(from, from + perPage - 1)

  if (error) return c.json({ error: error.message }, 500)
  return c.json({ data, total: count ?? 0, page, per_page: perPage })
})

router.post('/marketing/campagnes', requireRole(['admin', 'superviseur']), zValidator('json', campagneSchema), async (c) => {
  const user = c.get('user')
  const body = c.req.valid('json')
  const { data, error } = await db
    .from('campagnes_marketing')
    .insert({ ...body, created_by: user.id, sync_status: 'synced' })
    .select().single()
  if (error) return c.json({ error: error.message, code: error.code }, 400)
  return c.json(data, 201)
})

router.patch('/marketing/campagnes/:id/statut', requireRole(['admin', 'superviseur']), zValidator('json', campagneStatutSchema), async (c) => {
  const { id } = c.req.param()
  const body   = c.req.valid('json')
  const { data, error } = await db
    .from('campagnes_marketing')
    .update({ ...body, updated_at: new Date().toISOString() })
    .eq('id', id).select().single()
  if (error) return c.json({ error: error.message }, 400)
  if (!data)  return c.json({ error: 'Campagne introuvable', code: 'NOT_FOUND' }, 404)
  return c.json(data)
})

// ══════════════════════════════════════════════════════════════════════════════
// SÉCURITÉ — INCIDENTS
// ══════════════════════════════════════════════════════════════════════════════

const TRANSITIONS_INCIDENT: Record<string, string[]> = {
  ouvert:  ['traite'],
  traite:  ['corrige'],
  corrige: ['resolu'],
  resolu:  [],
}

const incidentSchema = z.object({
  type:           z.string().min(1),
  description:    z.string().min(1),
  zone:           z.string().min(1),
  signale_par:    z.string().min(1),
  date_incident:  z.string(),
})

const incidentStatutSchema = z.object({
  statut:               z.enum(['ouvert', 'traite', 'corrige', 'resolu']),
  date_resolution:      z.string().optional(),
  actions_correctives:  z.string().optional(),
})

router.get('/securite/incidents', async (c) => {
  const { statut, search } = c.req.query()
  const page    = Math.max(1, parseInt(c.req.query('page') ?? '1'))
  const perPage = Math.min(100, parseInt(c.req.query('per_page') ?? '20'))
  const from    = (page - 1) * perPage

  let q = db.from('incidents_securite').select('*', { count: 'exact' })
  if (statut) q = q.eq('statut', statut)
  if (search) q = q.ilike('description', `%${search}%`)

  const { data, count, error } = await q
    .order('created_at', { ascending: false })
    .range(from, from + perPage - 1)

  if (error) return c.json({ error: error.message }, 500)
  return c.json({ data, total: count ?? 0, page, per_page: perPage })
})

router.post('/securite/incidents', requireRole(['admin', 'superviseur', 'operateur']), zValidator('json', incidentSchema), async (c) => {
  const user = c.get('user')
  const body = c.req.valid('json')
  const { data, error } = await db
    .from('incidents_securite')
    .insert({ ...body, statut: 'ouvert', created_by: user.id, sync_status: 'synced' })
    .select().single()
  if (error) return c.json({ error: error.message, code: error.code }, 400)
  return c.json(data, 201)
})

router.patch('/securite/incidents/:id/statut', requireRole(['admin', 'superviseur']), zValidator('json', incidentStatutSchema), async (c) => {
  const { id } = c.req.param()
  const body   = c.req.valid('json')

  const { data: existing } = await db
    .from('incidents_securite').select('statut').eq('id', id).single()
  if (!existing) return c.json({ error: 'Incident introuvable', code: 'NOT_FOUND' }, 404)

  const ex      = existing as { statut: string }
  const allowed = TRANSITIONS_INCIDENT[ex.statut] ?? []

  if (!allowed.includes(body.statut)) {
    return c.json({
      error: `Transition "${ex.statut}" → "${body.statut}" non autorisée`,
      code:  'INVALID_TRANSITION',
      transitions_autorisees: allowed,
    }, 422)
  }

  const updates: Record<string, unknown> = {
    statut:     body.statut,
    updated_at: new Date().toISOString(),
  }
  if (body.date_resolution)     updates.date_resolution    = body.date_resolution
  if (body.actions_correctives) updates.actions_correctives = body.actions_correctives

  // Capturer la date de résolution automatiquement
  if (body.statut === 'resolu' && !body.date_resolution) {
    updates.date_resolution = new Date().toISOString().slice(0, 10)
  }

  const { data, error } = await db
    .from('incidents_securite').update(updates).eq('id', id).select().single()
  if (error) return c.json({ error: error.message }, 400)
  if (!data)  return c.json({ error: 'Incident introuvable', code: 'NOT_FOUND' }, 404)
  return c.json(data)
})

// ── EPI — contrainte conformes ≤ total ────────────────────────────────────────

const epiSchema = z.object({
  designation:          z.string().min(1),
  total:                z.number().int().min(0),
  conformes:            z.number().int().min(0),
  derniere_verification: z.string().optional(),
  notes:                z.string().optional(),
})

router.get('/securite/epi', async (c) => {
  const { data, error } = await db
    .from('epi_items').select('*').order('designation')
  if (error) return c.json({ error: error.message }, 500)
  return c.json({ data: data ?? [], total: (data ?? []).length })
})

router.post('/securite/epi', requireRole(['admin', 'superviseur']), zValidator('json', epiSchema), async (c) => {
  const body = c.req.valid('json')

  if (body.conformes > body.total) {
    return c.json({
      error: `conformes (${body.conformes}) ne peut pas dépasser total (${body.total})`,
      code:  'INVALID_EPI_COUNT',
    }, 422)
  }

  const { data, error } = await db.from('epi_items').insert(body).select().single()
  if (error) return c.json({ error: error.message, code: error.code }, 400)
  return c.json(data, 201)
})

router.put('/securite/epi/:id', requireRole(['admin', 'superviseur']), zValidator('json', epiSchema.partial()), async (c) => {
  const { id } = c.req.param()
  const body   = c.req.valid('json')

  if (body.conformes !== undefined && body.total !== undefined && body.conformes > body.total) {
    return c.json({
      error: `conformes (${body.conformes}) ne peut pas dépasser total (${body.total})`,
      code:  'INVALID_EPI_COUNT',
    }, 422)
  }

  // Si seulement conformes fourni, vérifier par rapport au total existant
  if (body.conformes !== undefined && body.total === undefined) {
    const { data: existing } = await db.from('epi_items').select('total').eq('id', id).single()
    if (existing && body.conformes > (existing as { total: number }).total) {
      return c.json({
        error: `conformes (${body.conformes}) dépasse le total actuel (${(existing as { total: number }).total})`,
        code:  'INVALID_EPI_COUNT',
      }, 422)
    }
  }

  const { data, error } = await db
    .from('epi_items')
    .update({ ...body, updated_at: new Date().toISOString() })
    .eq('id', id).select().single()

  if (error) return c.json({ error: error.message }, 400)
  if (!data)  return c.json({ error: 'EPI introuvable', code: 'NOT_FOUND' }, 404)
  return c.json(data)
})

// ══════════════════════════════════════════════════════════════════════════════
// PROJETS — RESSOURCES (main-d'œuvre, intrants, consommables, équipements)
// ══════════════════════════════════════════════════════════════════════════════

const ressourceSchema = z.object({
  type:              z.enum(['main_oeuvre', 'intrant', 'consommable', 'equipement', 'sous_traitant']).default('main_oeuvre'),
  designation:       z.string().min(1),
  employe_id:        z.string().optional(),
  produit_id:        z.string().optional(),
  equipement_id:     z.string().optional(),
  quantite:          z.number().positive().default(1),
  unite:             z.string().default('unité'),
  cout_unitaire_xaf: z.number().min(0).default(0),
  statut:            z.enum(['planifie', 'disponible', 'en_cours', 'utilise', 'manquant']).default('planifie'),
  notes:             z.string().optional(),
})

router.get('/projets/:id/ressources', async (c) => {
  const { id } = c.req.param()
  const type   = c.req.query('type')

  let q = db
    .from('projets_ressources')
    .select('*, employes(id, nom, poste), produits(id, designation, unite), equipements(id, code, designation)')
    .eq('projet_id', id)

  if (type) q = q.eq('type', type)

  const { data, error } = await q.order('type').order('created_at')
  if (error) return c.json({ error: error.message }, 500)

  const ressources = data ?? []
  // Calcul totaux par type
  type RessourceRow = {
    type: string; quantite: number; cout_unitaire_xaf: number
  }
  const totalCout = ressources.reduce(
    (s: number, r: RessourceRow) => s + r.quantite * r.cout_unitaire_xaf, 0
  )

  return c.json({ data: ressources, total: ressources.length, total_cout_xaf: Math.round(totalCout) })
})

router.post('/projets/:id/ressources', requireRole(['admin', 'superviseur']), zValidator('json', ressourceSchema), async (c) => {
  const { id }  = c.req.param()
  const user    = c.get('user')
  const body    = c.req.valid('json')

  const { data: projet } = await db.from('projets').select('statut').eq('id', id).single()
  if (!projet) return c.json({ error: 'Projet introuvable', code: 'NOT_FOUND' }, 404)
  if ((projet as { statut: string }).statut === 'annule') {
    return c.json({ error: 'Projet annulé — ajout de ressources impossible', code: 'PROJET_ANNULE' }, 422)
  }

  // Si employe_id fourni sans désignation → utiliser le nom de l'employé
  let designation = body.designation
  if (body.type === 'main_oeuvre' && body.employe_id && !designation) {
    const { data: emp } = await db.from('employes').select('nom, poste').eq('id', body.employe_id).single()
    if (emp) designation = `${(emp as { nom: string }).nom} — ${(emp as { poste: string }).poste}`
  }

  // Si produit_id → récupérer désignation et prix unitaire si non fournis
  let coutUnitaire = body.cout_unitaire_xaf
  if (body.produit_id && coutUnitaire === 0) {
    const { data: prod } = await db.from('produits').select('designation, prix_unitaire_xaf').eq('id', body.produit_id).single()
    if (prod) {
      if (!designation || designation === body.produit_id) {
        designation = (prod as { designation: string }).designation
      }
      coutUnitaire = (prod as { prix_unitaire_xaf: number }).prix_unitaire_xaf ?? 0
    }
  }

  // Si equipement_id → récupérer désignation
  if (body.equipement_id && (!designation || designation === body.equipement_id)) {
    const { data: eq } = await db.from('equipements').select('designation, code').eq('id', body.equipement_id).single()
    if (eq) designation = `${(eq as { code: string }).code} — ${(eq as { designation: string }).designation}`
  }

  const { data, error } = await db
    .from('projets_ressources')
    .insert({
      projet_id:         id,
      type:              body.type,
      designation,
      employe_id:        body.employe_id    ?? null,
      produit_id:        body.produit_id    ?? null,
      equipement_id:     body.equipement_id ?? null,
      quantite:          body.quantite,
      unite:             body.unite,
      cout_unitaire_xaf: coutUnitaire,
      statut:            body.statut,
      notes:             body.notes ?? null,
      created_by:        user.id,
    })
    .select('*, employes(nom, poste), produits(designation), equipements(code, designation)')
    .single()

  if (error) return c.json({ error: error.message, code: error.code }, 400)

  // Mise à jour du coût total du projet (dépense_xaf) si ressource utilisée
  if (body.statut === 'utilise') {
    const { data: allRes } = await db
      .from('projets_ressources')
      .select('quantite, cout_unitaire_xaf, statut')
      .eq('projet_id', id)

    type RRow = { quantite: number; cout_unitaire_xaf: number; statut: string }
    const depense = ((allRes ?? []) as RRow[])
      .filter((r) => r.statut === 'utilise')
      .reduce((s, r) => s + r.quantite * r.cout_unitaire_xaf, 0)

    await db.from('projets').update({
      depense_xaf: Math.round(depense),
      updated_at:  new Date().toISOString(),
    }).eq('id', id)
  }

  return c.json(data, 201)
})

router.patch('/projets/:id/ressources/:rid/statut', requireRole(['admin', 'superviseur', 'operateur']), async (c) => {
  const { id, rid } = c.req.param()
  const body = await c.req.json<{ statut: string; notes?: string }>()

  const validStatuts = ['planifie', 'disponible', 'en_cours', 'utilise', 'manquant']
  if (!validStatuts.includes(body.statut)) {
    return c.json({ error: 'Statut invalide', code: 'INVALID_STATUS' }, 422)
  }

  const { data, error } = await db
    .from('projets_ressources')
    .update({ statut: body.statut, ...(body.notes ? { notes: body.notes } : {}) })
    .eq('id', rid)
    .eq('projet_id', id)
    .select().single()

  if (error) return c.json({ error: error.message }, 400)
  if (!data)  return c.json({ error: 'Ressource introuvable', code: 'NOT_FOUND' }, 404)

  // Recalculer depense_xaf si statut passe à 'utilise'
  if (body.statut === 'utilise') {
    const { data: allRes } = await db
      .from('projets_ressources')
      .select('quantite, cout_unitaire_xaf, statut')
      .eq('projet_id', id)

    type RRow = { quantite: number; cout_unitaire_xaf: number; statut: string }
    const depense = ((allRes ?? []) as RRow[])
      .filter((r) => r.statut === 'utilise')
      .reduce((s, r) => s + r.quantite * r.cout_unitaire_xaf, 0)

    await db.from('projets').update({
      depense_xaf: Math.round(depense),
      updated_at:  new Date().toISOString(),
    }).eq('id', id)
  }

  return c.json(data)
})

router.delete('/projets/:id/ressources/:rid', requireRole(['admin', 'superviseur']), async (c) => {
  const { id, rid } = c.req.param()
  const { error } = await db
    .from('projets_ressources')
    .delete()
    .eq('id', rid)
    .eq('projet_id', id)
  if (error) return c.json({ error: error.message }, 400)
  return c.body(null, 204)
})

export { router as operationsRouter }

