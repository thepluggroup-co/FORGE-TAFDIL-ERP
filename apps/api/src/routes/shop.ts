import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { randomUUID } from 'crypto'
import { supabaseAdmin } from '@forge/db'
import { FRAIS_LIVRAISON } from '@forge/shared'
import { notifyCommandeSms } from '../services/sms.service'
import { verifierEligibiliteCredit } from '../services/credit-eligibility.service'
import { notifyWorkflow } from '../services/workflow-notifications.service'

const db = supabaseAdmin!
import type { HonoVariables } from '../types'

// ── Constantes ─────────────────────────────────────────────────────────────────

const TVA_RATE = 0.1925

const TARIFS_LIVRAISON: Record<string, { tarif: number; delaiJours: number }> = FRAIS_LIVRAISON
const SMS_RESEND_COOLDOWN_MS = 2 * 60 * 1000
const smsResendAttempts = new Map<string, number>()

// ── Helpers ────────────────────────────────────────────────────────────────────

function genRef(): string {
  const year = new Date().getFullYear()
  const seq  = String(Math.floor(Math.random() * 9000) + 1000) // simplifié — voir note ci-dessous
  return `WEB-${year}-${seq}`
}

async function genNumeroBon(): Promise<string> {
  const today = new Date()
  const yyyymmdd = today.toISOString().slice(0, 10).replace(/-/g, '')
  const startOfDay = `${today.toISOString().slice(0, 10)}T00:00:00.000Z`

  const { count } = await db
    .from('bons_sortie')
    .select('*', { count: 'exact', head: true })
    .gte('created_at', startOfDay)

  return `TAF-${yyyymmdd}-${String((count ?? 0) + 1).padStart(4, '0')}`
}

function disponibilite(stock: number, seuil: number): 'disponible' | 'stock_faible' | 'indisponible' {
  if (stock <= 0)      return 'indisponible'
  if (stock <= seuil)  return 'stock_faible'
  return 'disponible'
}

function smsStatusPayload(result: Awaited<ReturnType<typeof notifyCommandeSms>>) {
  if (result.ok && !result.skipped) {
    return { ok: true, message: 'SMS envoyé au client.' }
  }
  if (result.skipped) {
    return {
      ok: false,
      skipped: true,
      message: result.error ?? 'SMS non envoyé.',
      retry_after_seconds: 120,
    }
  }
  return {
    ok: false,
    message: result.error ? `SMS non envoyé : ${result.error}` : 'SMS non envoyé par Africa’s Talking.',
    retry_after_seconds: 120,
  }
}

function samePhone(a?: string | null, b?: string | null) {
  const left = String(a ?? '').replace(/\D/g, '')
  const right = String(b ?? '').replace(/\D/g, '')
  if (!left || !right) return false
  return left.endsWith(right) || right.endsWith(left)
}

async function creerBonSortieShop(args: {
  commandeId?: string | null
  ref: string
  clientNom: string
  clientTelephone: string
  montantTtc: number
  lignes: Array<{ product_id: string; designation: string; quantite: number }>
}) {
  let existingQuery = db
    .from('bons_sortie')
    .select('id, commande_id')

  existingQuery = args.commandeId
    ? existingQuery.or(`commande_id.eq.${args.commandeId},demandeur.eq.${args.ref}`)
    : existingQuery.eq('demandeur', args.ref)

  const { data: existing } = await existingQuery.maybeSingle()

  if (existing) {
    if (args.commandeId && !(existing as { commande_id?: string | null }).commande_id) {
      await db.from('bons_sortie')
        .update({
          commande_id:       args.commandeId,
          montant_total_xaf: args.montantTtc,
          updated_at:        new Date().toISOString(),
        })
        .eq('id', (existing as { id: string }).id)
    }
    return existing
  }

  const numero = await genNumeroBon()
  const { data: bon, error: bonErr } = await db
    .from('bons_sortie')
    .insert({
      numero,
      statut:            'en_attente',
      type:              'commande',
      ...(args.commandeId ? { commande_id: args.commandeId } : {}),
      demandeur:         args.ref,
      motif:             `Préparation commande shop ${args.ref}`,
      montant_total_xaf: args.montantTtc,
      notes:             `Commande shop à préparer — client : ${args.clientNom} (${args.clientTelephone})`,
      sync_status:       'synced',
    })
    .select('id')
    .single()

  if (bonErr || !bon) {
    throw new Error(bonErr?.message ?? 'Erreur création bon de sortie shop')
  }

  const bonId = (bon as { id: string }).id
  const lignesBon = args.lignes.map((l) => ({
    bon_id:            bonId,
    produit_id:        l.product_id,
    designation:       l.designation,
    unite:             'unité',
    quantite_demandee: l.quantite,
    quantite_servie:   0,
  }))

  const { error: lignesErr } = await db.from('bons_sortie_lignes').insert(lignesBon)
  if (lignesErr) {
    await db.from('bons_sortie').delete().eq('id', bonId)
    throw new Error(lignesErr.message)
  }

  await db.channel('forge-bons').send({
    type:  'broadcast',
    event: 'nouveau_bon_commande_shop',
    payload: {
      bon_id:       bonId,
      numero,
      commande_id:  args.commandeId,
      commande_ref: args.ref,
      client:       args.clientNom,
      nb_lignes:    lignesBon.length,
    },
  }).catch(() => {})

  return bon
}

// ── Schémas Zod ────────────────────────────────────────────────────────────────

const ligneCommandeSchema = z.object({
  product_id:      z.string().uuid(),
  designation:     z.string().min(1),
  quantite:        z.number().positive(),
  prix_unitaire:   z.number().min(0),
})

const commandeShopSchema = z.object({
  client_nom:              z.string().min(2).max(200),
  client_telephone:        z.string().min(8).max(20),
  client_email:            z.string().email().optional(),
  client_adresse:          z.string().min(5),
  client_ville:            z.string().optional(),
  lignes:                  z.array(ligneCommandeSchema).min(1),
  mode_paiement:           z.enum(['mtn_momo', 'orange_money', 'livraison']),
  avance_livraison_pct:    z.enum(['30', '50', '70']).or(z.number().refine((v) => [30, 50, 70].includes(v))).optional(),
  notes_client:            z.string().max(500).optional(),
  frais_livraison:         z.number().min(0).default(0),
  condition_paiement_code: z.string().default('P100'),
})

const resendSmsSchema = z.object({
  telephone: z.string().min(8).max(20),
})

const devisWebSchema = z.object({
  nom:          z.string().min(2).max(200),
  telephone:    z.string().min(8).max(20),
  email:        z.string().email().optional(),
  description:  z.string().min(10).max(2000),
  type_projet:  z.string().max(100).optional(),
  produit_ref:  z.string().max(50).optional(),
})

// ── Router ─────────────────────────────────────────────────────────────────────

export const shopRouter = new Hono()

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/shop/catalogue
// Liste des produits visibles — cache 60s
// ══════════════════════════════════════════════════════════════════════════════

shopRouter.get('/catalogue', async (c) => {
  const { categorie, q } = c.req.query()

  const client = db
  let query = client
    .from('produits_shop')
    .select(`
      product_id,
      prix_public,
      description_longue,
      images,
      tags,
      delai_fabrication_jours,
      min_commande,
      produits!inner (
        ref, designation, categorie, stock_actuel, stock_min, unite, statut
      )
    `)
    .eq('visible_shop', true)
    .order('updated_at', { ascending: false })

  if (categorie) {
    query = query.eq('produits.categorie', categorie)
  }
  if (q) {
    query = query.ilike('produits.designation', `%${q}%`)
  }

  const { data, error } = await query

  if (error) {
    console.error('[shop/catalogue] DB error:', JSON.stringify(error))
    return c.json({ error: 'Erreur catalogue', code: 'DB_ERROR', details: error.message }, 500)
  }

  const catalogue = (data ?? []).map((row: any) => {
    const p = row.produits
    return {
      id:                    row.product_id,
      ref:                   p.ref,
      nom:                   p.designation,
      categorie:             p.categorie,
      unite:                 p.unite,
      stock_actuel:          p.stock_actuel,
      seuil_alerte:          p.stock_min,
      prix_public:           row.prix_public,
      description_longue:    row.description_longue,
      images:                row.images ?? [],
      tags:                  row.tags ?? [],
      delai_fabrication_jours: row.delai_fabrication_jours,
      min_commande:          row.min_commande,
      disponibilite:         disponibilite(p.stock_actuel, p.stock_min),
    }
  })

  c.header('Cache-Control', 'public, max-age=60, stale-while-revalidate=30')
  return c.json({ data: catalogue, total: catalogue.length })
})

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/shop/catalogue/:id
// Détail d'un produit avec stock temps réel (pas de cache)
// ══════════════════════════════════════════════════════════════════════════════

shopRouter.get('/catalogue/:id', async (c) => {
  const id = c.req.param('id')

  const { data, error } = await db
    .from('produits_shop')
    .select(`
      product_id,
      prix_public,
      description_longue,
      images,
      tags,
      delai_fabrication_jours,
      min_commande,
      produits!inner (
        ref, designation, description, categorie, stock_actuel, stock_min, stock_critique, unite, statut, fournisseur
      )
    `)
    .eq('product_id', id)
    .eq('visible_shop', true)
    .single()

  if (error || !data) {
    return c.json({ error: 'Produit introuvable', code: 'NOT_FOUND' }, 404)
  }

  const p = (data as any).produits
  return c.json({
    data: {
      id:                    data.product_id,
      ref:                   p.ref,
      nom:                   p.designation,
      description:           p.description,
      categorie:             p.categorie,
      unite:                 p.unite,
      stock_actuel:          p.stock_actuel,
      seuil_alerte:          p.stock_min,
      prix_public:           data.prix_public,
      description_longue:    data.description_longue,
      images:                data.images ?? [],
      tags:                  data.tags ?? [],
      delai_fabrication_jours: data.delai_fabrication_jours,
      min_commande:          data.min_commande,
      disponibilite:         disponibilite(p.stock_actuel, p.stock_min),
    },
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/shop/categories
// Catégories ayant au moins 1 produit visible
// ══════════════════════════════════════════════════════════════════════════════

shopRouter.get('/categories', async (c) => {
  const { data, error } = await db
    .from('produits_shop')
    .select('produits!inner(categorie)')
    .eq('visible_shop', true)

  if (error) {
    return c.json({ error: 'Erreur catégories', code: 'DB_ERROR' }, 500)
  }

  const categories = [...new Set((data ?? []).map((r: any) => r.produits.categorie))].sort()

  c.header('Cache-Control', 'public, max-age=300')
  return c.json({ data: categories })
})

// ══════════════════════════════════════════════════════════════════════════════
// POST /api/shop/commandes
// Créer une commande web (sans auth)
// ══════════════════════════════════════════════════════════════════════════════

shopRouter.post('/commandes', zValidator('json', commandeShopSchema), async (c) => {
  const body = c.req.valid('json')

  if (body.mode_paiement === 'livraison' && !body.avance_livraison_pct) {
    return c.json({
      error: 'Le paiement à la livraison exige une avance de 30%, 50% ou 70%',
      code: 'ACOMPTE_LIVRAISON_REQUIS',
    }, 422)
  }

  // 1. Vérifier disponibilité stock pour chaque ligne
  for (const ligne of body.lignes) {
    const { data: produit } = await db
      .from('produits')
      .select('id, designation, stock_actuel, unite')
      .eq('id', ligne.product_id)
      .single()

    if (!produit) {
      return c.json({
        error: `Produit introuvable : ${ligne.product_id}`,
        code: 'PRODUCT_NOT_FOUND',
      }, 404)
    }

    if (produit.stock_actuel < ligne.quantite) {
      return c.json({
        error: 'Stock insuffisant',
        code: 'STOCK_INSUFFISANT',
        details: {
          product_id:   ligne.product_id,
          designation:  produit.designation,
          stock_actuel: produit.stock_actuel,
          demande:      ligne.quantite,
          unite:        produit.unite,
        },
      }, 409)
    }
  }

  // 2. Vérifier éligibilité crédit si condition ≠ P100
  const condCode = body.condition_paiement_code ?? 'P100'
  if (condCode !== 'P100') {
    const montantEstime = Math.round(body.lignes.reduce((s, l) => s + l.quantite * l.prix_unitaire, 0))
    const tvaEstimee    = Math.round(montantEstime * TVA_RATE)
    const ttcEstime     = Math.round(montantEstime + tvaEstimee + body.frais_livraison)

    const eligibilite = await verifierEligibiliteCredit(null, ttcEstime, 'web', condCode)
    if (!eligibilite.eligible) {
      return c.json({
        error: eligibilite.raison ?? 'Condition de crédit non autorisée pour les commandes web',
        code: 'CREDIT_NON_ELIGIBLE',
      }, 422)
    }
  }

  // 4. Calculer montants : la livraison est ajoutee apres TVA.
  const montant_ht       = Math.round(body.lignes.reduce((s, l) => s + l.quantite * l.prix_unitaire, 0))
  const frais_livraison  = Math.round(body.frais_livraison)
  const tva              = Math.round(montant_ht * TVA_RATE)
  const montant_ttc      = Math.round(montant_ht + tva + frais_livraison)

  // 5. Générer référence unique
  const ref = genRef()

  // 6. Lignes JSONB
  const lignesJson = body.lignes.map((l) => ({
    product_id:     l.product_id,
    designation:    l.designation,
    quantite:       l.quantite,
    prix_unitaire:  l.prix_unitaire,
    total_ht:       Math.round(l.quantite * l.prix_unitaire),
  }))

  // 7. Insérer commande_shop
  const { data: commandeShop, error: errShop } = await db
    .from('commandes_shop')
    .insert({
      ref,
      client_nom:       body.client_nom,
      client_telephone: body.client_telephone,
      client_email:     body.client_email ?? null,
      client_adresse:   body.client_adresse,
      client_ville:     body.client_ville ?? null,
      lignes:           lignesJson,
      montant_ht,
      tva,
      montant_ttc,
      frais_livraison,
      mode_paiement:    body.mode_paiement,
      notes_client:     body.notes_client ?? null,
      statut_commande:  'recue',
      statut_paiement:  'en_attente',
    })
    .select('id, ref')
    .single()

  if (errShop || !commandeShop) {
    console.error('[shop] insert commandes_shop:', errShop)
    return c.json({ error: 'Erreur création commande', code: 'DB_ERROR' }, 500)
  }

  // 8. Créer la commande ERP en miroir (source web)
  const today = new Date().toISOString().split('T')[0]
  const { data: erpCommande, error: errErpCommande } = await db
    .from('commandes')
    .insert({
      numero:              ref,
      client_nom:          body.client_nom,
      statut:              'confirmed',
      date_commande:       today,
      total_ht_xaf:        montant_ht,
      tva_xaf:             tva,
      frais_livraison_xaf: frais_livraison,
      total_ttc_xaf:       montant_ttc,
      notes:               `[SOURCE WEB] ${body.notes_client ?? ''}`.trim(),
    })
    .select('id')
    .single()

  if (errErpCommande) {
    console.error('[shop] insert commande ERP:', errErpCommande.message)
  }

  // 9. Lier commande_shop → commande ERP
  if (erpCommande?.id) {
    await db
      .from('commandes_shop')
      .update({ erp_commande_id: erpCommande.id })
      .eq('id', commandeShop.id)

    // Insérer les lignes ERP
    const lignesErp = body.lignes.map((l, i) => ({
      commande_id:          erpCommande.id,
      produit_id:           l.product_id,
      designation:          l.designation,
      quantite:             l.quantite,
      prix_unitaire_ht_xaf: l.prix_unitaire,
      total_ht_xaf:         Math.round(l.quantite * l.prix_unitaire),
      ordre:                i,
    }))
    await db.from('commandes_lignes').insert(lignesErp)

    let bonSortie: unknown = null
    try {
      bonSortie = await creerBonSortieShop({
        commandeId:      erpCommande.id,
        ref,
        clientNom:       body.client_nom,
        clientTelephone: body.client_telephone,
        montantTtc:      montant_ttc,
        lignes:          body.lignes,
      })
    } catch (e) {
      console.error('[shop] auto bon sortie:', e)
      try {
        bonSortie = await creerBonSortieShop({
          commandeId:      null,
          ref,
          clientNom:       body.client_nom,
          clientTelephone: body.client_telephone,
          montantTtc:      montant_ttc,
          lignes:          body.lignes,
        })
      } catch (fallbackError) {
        console.error('[shop] auto bon sortie fallback:', fallbackError)
      }
    }

    if (bonSortie) {
      await notifyWorkflow({
        event:   'stock.bon_sortie_a_preparer',
        module:  'stock',
        severite:'warning',
        titre:   'Bon de sortie a preparer',
        message: `Commande shop ${ref} : verifier les articles et preparer la sortie stock.`,
        ref,
        url:     '/stocks/bons-sortie',
        data:    { commande_id: erpCommande.id, bon_id: (bonSortie as { id?: string }).id },
      })
    }
  } else {
    try {
      const bonSortie = await creerBonSortieShop({
        commandeId:      null,
        ref,
        clientNom:       body.client_nom,
        clientTelephone: body.client_telephone,
        montantTtc:      montant_ttc,
        lignes:          body.lignes,
      })
      await notifyWorkflow({
        event:   'stock.bon_sortie_a_preparer',
        module:  'stock',
        severite:'warning',
        titre:   'Bon de sortie a preparer',
        message: `Commande shop ${ref} : verifier les articles et preparer la sortie stock.`,
        ref,
        url:     '/stocks/bons-sortie',
        data:    { commande_id: null, bon_id: (bonSortie as { id?: string }).id },
      })
    } catch (e) {
      console.error('[shop] auto bon sortie fallback sans ERP:', e)
    }
  }

  // 10. Notifier ERP via Realtime (broadcast sur canal dédié)
  await db.channel('commandes_web_nouvelles').send({
    type:    'broadcast',
    event:   'nouvelle_commande_web',
    payload: { ref, montant_ttc, client: body.client_nom },
  })

  await notifyWorkflow({
    event:   'boutique.commande_shop_recue',
    module:  'boutique',
    severite:'info',
    titre:   'Nouvelle commande shop',
    message: `${body.client_nom} a passe la commande ${ref}.`,
    ref,
    url:     '/boutique',
    data:    { montant_ttc, mode_paiement: body.mode_paiement },
  })

  const smsResult = await notifyCommandeSms({
    numero:        ref,
    client_nom:    body.client_nom,
    telephone:     body.client_telephone,
    total_ttc_xaf: montant_ttc,
  }, 'commande_recue').catch((e) => {
    console.error('[sms] confirmation commande shop:', e)
    return { ok: false, provider: 'africastalking' as const, error: e instanceof Error ? e.message : String(e) }
  })

  return c.json({ ref, montant_ttc, statut: 'recue', sms: smsStatusPayload(smsResult) }, 201)
})

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/shop/commandes/:ref
// Suivi public par référence (sans auth)
// ══════════════════════════════════════════════════════════════════════════════

shopRouter.get('/commandes/:ref', async (c) => {
  const ref = c.req.param('ref')

  const { data, error } = await db
    .from('commandes_shop')
    .select('ref, statut_commande, statut_paiement, mode_paiement, payment_reference, lignes, montant_ht, tva, montant_ttc, frais_livraison, created_at, updated_at, client_ville, photos_livraison')
    .eq('ref', ref)
    .single()

  if (error || !data) {
    return c.json({ error: 'Commande introuvable', code: 'NOT_FOUND' }, 404)
  }

  return c.json({ data })
})

shopRouter.post('/commandes/:ref/sms/renvoyer', zValidator('json', resendSmsSchema), async (c) => {
  const ref = c.req.param('ref').toUpperCase()
  const body = c.req.valid('json')
  const cacheKey = `${ref}:${String(body.telephone ?? '').replace(/\D/g, '')}`
  const lastAttempt = smsResendAttempts.get(cacheKey) ?? 0
  const waitMs = SMS_RESEND_COOLDOWN_MS - (Date.now() - lastAttempt)

  if (waitMs > 0) {
    return c.json({
      error: 'Renvoi SMS temporairement indisponible',
      code: 'SMS_COOLDOWN',
      retry_after_seconds: Math.ceil(waitMs / 1000),
    }, 429)
  }

  const { data, error } = await db
    .from('commandes_shop')
    .select('ref, client_nom, client_telephone, montant_ttc')
    .eq('ref', ref)
    .single()

  if (error || !data) {
    return c.json({ error: 'Commande introuvable', code: 'NOT_FOUND' }, 404)
  }

  const commande = data as {
    ref: string
    client_nom: string
    client_telephone: string | null
    montant_ttc: number | null
  }

  if (body.telephone && !samePhone(body.telephone, commande.client_telephone)) {
    return c.json({ error: 'Téléphone non associé à cette commande', code: 'PHONE_MISMATCH' }, 403)
  }

  smsResendAttempts.set(cacheKey, Date.now())
  const smsResult = await notifyCommandeSms({
    numero:        commande.ref,
    client_nom:    commande.client_nom,
    telephone:     commande.client_telephone,
    total_ttc_xaf: commande.montant_ttc,
  }, 'commande_recue').catch((e) => {
    console.error('[sms] renvoi confirmation commande shop:', e)
    return { ok: false, provider: 'africastalking' as const, error: e instanceof Error ? e.message : String(e) }
  })

  const sms = smsStatusPayload(smsResult)
  if (!sms.ok) {
    return c.json({ sms }, 502)
  }

  return c.json({ sms })
})

// ══════════════════════════════════════════════════════════════════════════════
// POST /api/shop/devis
// Soumettre une demande de devis web
// ══════════════════════════════════════════════════════════════════════════════

shopRouter.post('/devis', zValidator('json', devisWebSchema), async (c) => {
  const body = c.req.valid('json')

  const { data, error } = await db
    .from('demandes_devis_web')
    .insert({
      nom:          body.nom,
      telephone:    body.telephone,
      email:        body.email ?? null,
      description:  body.description,
      type_projet:  body.type_projet ?? null,
      produit_ref:  body.produit_ref ?? null,
      statut:       'nouvelle',
    })
    .select('id, created_at')
    .single()

  if (error || !data) {
    console.error('[shop] insert demandes_devis_web:', error)
    return c.json({ error: 'Erreur enregistrement devis', code: 'DB_ERROR' }, 500)
  }

  // Créer automatiquement un devis ERP brouillon
  const numero   = await genererNumeroDevis()
  const today    = new Date().toISOString().split('T')[0]
  const validite = new Date(Date.now() + 30 * 86_400_000).toISOString().split('T')[0]
  const notes    = [
    `[SOURCE WEB] ${body.description}`,
    body.type_projet  ? `Type de projet : ${body.type_projet}`    : null,
    `Téléphone : ${body.telephone}`,
    body.email        ? `Email : ${body.email}`                   : null,
    body.produit_ref  ? `Réf. produit : ${body.produit_ref}`      : null,
  ].filter(Boolean).join('\n')

  const { data: condP100 } = await db
    .from('conditions_paiement')
    .select('id')
    .eq('code', 'P100')
    .single()

  const { data: erpDevis, error: errDevis } = await db
    .from('devis')
    .insert({
      numero,
      client_nom:            body.nom,
      statut:                'brouillon',
      date_emission:         today,
      date_validite:         validite,
      validite_jours:        30,
      condition_paiement_id: condP100?.id ?? null,
      notes,
      total_ht_xaf:        0,
      tva_xaf:             0,
      total_ttc_xaf:       0,
      sync_status:         'synced',
    })
    .select('id, numero')
    .single()

  if (!errDevis && erpDevis) {
    await db
      .from('demandes_devis_web')
      .update({ statut: 'en_cours', erp_devis_id: erpDevis.id })
      .eq('id', data.id)
  } else {
    console.error('[shop] auto-create devis ERP:', errDevis)
  }

  // Notifier l'ERP
  await db.channel('commandes_web_nouvelles').send({
    type:    'broadcast',
    event:   'nouvelle_demande_devis',
    payload: { id: data.id, nom: body.nom, telephone: body.telephone, erp_devis_id: erpDevis?.id ?? null },
  })

  return c.json({ id: data.id, statut: 'nouvelle', created_at: data.created_at }, 201)
})

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/shop/conditions-paiement?montant=<ttc>
// Conditions de paiement web-compatibles avec éligibilité (pas d'auth requise)
// Exclut PROJ-* (réservés aux contrats hors-boutique)
// ══════════════════════════════════════════════════════════════════════════════

shopRouter.get('/conditions-paiement', async (c) => {
  const montantNum = Math.round(Math.max(0, parseFloat(c.req.query('montant') ?? '0') || 0))

  const { data: conditions, error } = await db
    .from('conditions_paiement')
    .select('id, code, libelle, acompte_pct, delai_solde_jours')
    .eq('actif', true)
    .not('code', 'like', 'PROJ%')
    .order('code')

  if (error) return c.json({ error: error.message }, 500)

  const results = await Promise.all(
    (conditions ?? []).map(async (cp: Record<string, unknown>) => {
      const check = await verifierEligibiliteCredit(null, montantNum, 'web', cp.code as string)
      return { ...cp, eligible: check.eligible, raison: check.raison ?? null }
    }),
  )

  c.header('Cache-Control', 'no-store')
  return c.json({ data: results })
})

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/shop/livraison/tarifs?ville=douala
// Tarifs et délais de livraison par zone
// ══════════════════════════════════════════════════════════════════════════════

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/shop/realisations?limit=N
// Images du portfolio depuis Supabase Storage (bucket 'realisations')
// ══════════════════════════════════════════════════════════════════════════════

shopRouter.get('/realisations', async (c) => {
  const limit = Math.min(30, Math.max(1, parseInt(c.req.query('limit') ?? '10')))

  const { data, error } = await db.storage
    .from('realisations')
    .list('', { limit, sortBy: { column: 'created_at', order: 'desc' } })

  if (error) {
    return c.json({ data: [] })
  }

  const baseUrl = `${process.env.SUPABASE_URL}/storage/v1/object/public/realisations`

  const realisations = (data ?? [])
    .filter((f) => /\.(jpg|jpeg|png|webp|avif)$/i.test(f.name))
    .map((f) => ({
      id:        f.id ?? f.name,
      url:       `${baseUrl}/${f.name}`,
      alt:       f.name.replace(/[-_]/g, ' ').replace(/\.[^.]+$/, ''),
      categorie: null as string | null,
    }))

  c.header('Cache-Control', 'public, max-age=300')
  return c.json({ data: realisations, total: realisations.length })
})

shopRouter.get('/livraison/tarifs', (c) => {
  const villeRaw = (c.req.query('ville') ?? '').toLowerCase().trim()
  const zone     = TARIFS_LIVRAISON[villeRaw] ?? TARIFS_LIVRAISON['autre']

  c.header('Cache-Control', 'public, max-age=3600')
  return c.json({
    data: {
      ville:           villeRaw || null,
      tarif_xaf:       zone.tarif,
      delai_jours:     zone.delaiJours,
      zones_connues:   Object.keys(TARIFS_LIVRAISON),
    },
  })
})

// ── TEST ONLY: remove before production ───────────────────────────────────────
shopRouter.post('/test-sms', async (c) => {
  if (process.env.NODE_ENV === 'production') return c.json({ error: 'Disabled in production' }, 403)
  const { telephone } = await c.req.json<{ telephone: string }>()
  const result = await notifyCommandeSms({
    numero:        'WEB-2026-TEST',
    client_nom:    'Client Test',
    telephone,
    total_ttc_xaf: 50000,
  }, 'commande_recue')
  return c.json(result)
})

// ══════════════════════════════════════════════════════════════════════════════
// SHOP ERP ROUTER — protégé par authMiddleware (opérateurs ERP)
// Monté sur /api/shop-erp dans index.ts
// ══════════════════════════════════════════════════════════════════════════════

export const shopErpRouter = new Hono<{ Variables: HonoVariables }>()

// ── Helpers locaux ─────────────────────────────────────────────────────────────

async function genererNumeroDevis(): Promise<string> {
  const today     = new Date()
  const yyyymmdd  = today.toISOString().slice(0, 10).replace(/-/g, '')
  const startOfDay = `${today.toISOString().slice(0, 10)}T00:00:00.000Z`
  const { count } = await db
    .from('devis')
    .select('*', { count: 'exact', head: true })
    .gte('created_at', startOfDay)
  return `DEV-${yyyymmdd}-${String((count ?? 0) + 1).padStart(4, '0')}`
}

async function syncProduitsShopManquants(): Promise<void> {
  const [produitsRes, shopRes] = await Promise.all([
    db.from('produits').select('id, prix_unitaire_xaf'),
    db.from('produits_shop').select('product_id'),
  ])

  if (produitsRes.error || shopRes.error) return

  const idsShop = new Set((shopRes.data ?? []).map((p: { product_id: string }) => p.product_id))
  const manquants = (produitsRes.data ?? [])
    .filter((p: { id: string }) => !idsShop.has(p.id))
    .map((p: { id: string; prix_unitaire_xaf?: number | null }) => ({
      product_id:   p.id,
      visible_shop: false,
      prix_public:  p.prix_unitaire_xaf || null,
      min_commande: 1,
    }))

  if (manquants.length === 0) return
  await db.from('produits_shop').insert(manquants)
}

function extFromFile(file: File): string {
  const byName = file.name.split('.').pop()?.toLowerCase()
  if (byName && /^[a-z0-9]{2,5}$/.test(byName)) return byName
  const byType = file.type.split('/').pop()?.toLowerCase()
  return byType && /^[a-z0-9]{2,5}$/.test(byType) ? byType : 'jpg'
}

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/shop-erp/analytics
// KPIs + CA mensuel comparé ERP vs Shop (6 derniers mois)
// ══════════════════════════════════════════════════════════════════════════════

shopErpRouter.get('/analytics', async (c) => {
  const today     = new Date().toISOString().split('T')[0]
  const debutMois = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString()

  const [todayRes, monthRes] = await Promise.all([
    db.from('commandes_shop').select('montant_ttc, statut_commande')
      .gte('created_at', `${today}T00:00:00.000Z`)
      .neq('statut_commande', 'annulee'),
    db.from('commandes_shop').select('montant_ttc, statut_commande')
      .gte('created_at', debutMois)
      .neq('statut_commande', 'annulee'),
  ])

  const todayRows = (todayRes.data ?? [])
  const monthRows = (monthRes.data ?? [])
  const caMois    = monthRows.reduce((s, r) => s + (r.montant_ttc ?? 0), 0)

  const kpis = {
    commandes_aujourd_hui: todayRows.length,
    ca_aujourd_hui:        todayRows.reduce((s, r) => s + (r.montant_ttc ?? 0), 0),
    commandes_mois:        monthRows.length,
    ca_mois:               caMois,
    panier_moyen:          monthRows.length > 0 ? Math.round(caMois / monthRows.length) : 0,
  }

  // CA mensuel sur 6 mois — shop vs ERP classique
  const caMensuel: Array<{
    mois: string
    ca_shop: number
    ca_erp: number
    ca_total: number
  }> = []

  for (let i = 5; i >= 0; i--) {
    const d     = new Date()
    d.setMonth(d.getMonth() - i)
    const year  = d.getFullYear()
    const month = d.getMonth() + 1
    const debut = new Date(year, month - 1, 1).toISOString()
    const fin   = new Date(year, month, 0, 23, 59, 59, 999).toISOString()
    const dateDebut = debut.split('T')[0]
    const dateFin   = fin.split('T')[0]

    const [shopMonth, erpMonth] = await Promise.all([
      db.from('commandes_shop').select('montant_ttc')
        .gte('created_at', debut).lte('created_at', fin)
        .neq('statut_commande', 'annulee'),
      db.from('commandes').select('total_ttc_xaf')
        .gte('date_commande', dateDebut).lte('date_commande', dateFin)
        .neq('statut', 'cancelled'),
    ])

    const caShop  = (shopMonth.data ?? []).reduce((s, r) => s + (r.montant_ttc ?? 0), 0)
    const caTotal = (erpMonth.data ?? []).reduce((s, r) => s + (r.total_ttc_xaf ?? 0), 0)
    const caErpSeul = Math.max(0, caTotal - caShop)

    caMensuel.push({
      mois:     `${year}-${String(month).padStart(2, '0')}`,
      ca_shop:  Math.round(caShop),
      ca_erp:   Math.round(caErpSeul),
      ca_total: Math.round(caTotal),
    })
  }

  return c.json({ data: { kpis, ca_mensuel: caMensuel } })
})

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/shop-erp/produits
// Tous les produits avec visibilité shop + stock ERP
// ══════════════════════════════════════════════════════════════════════════════

shopErpRouter.get('/produits', async (c) => {
  await syncProduitsShopManquants()

  const { data, error } = await db
    .from('produits_shop')
    .select(`
      product_id,
      visible_shop,
      prix_public,
      description_longue,
      images,
      tags,
      delai_fabrication_jours,
      min_commande,
      updated_at,
      produits!inner (
        ref, designation, description, categorie, stock_actuel, stock_min, stock_critique, unite, statut
      )
    `)
    .order('updated_at', { ascending: false })

  if (error) return c.json({ error: 'Erreur DB', code: 'DB_ERROR' }, 500)

  const produits = (data ?? []).map((r: any) => ({
    id:             r.product_id,
    ref:            r.produits.ref,
    nom:            r.produits.designation,
    categorie:      r.produits.categorie,
    description:    r.produits.description,
    unite:          r.produits.unite,
    stock_actuel:   r.produits.stock_actuel,
    stock_min:      r.produits.stock_min,
    stock_critique: r.produits.stock_critique,
    statut:         r.produits.statut,
    visible_shop:   r.visible_shop,
    prix_public:    r.prix_public,
    description_longue: r.description_longue,
    images:         r.images ?? [],
    tags:           r.tags ?? [],
    delai_fabrication_jours: r.delai_fabrication_jours,
    min_commande:   r.min_commande,
  }))

  return c.json({ data: produits, total: produits.length })
})

// ══════════════════════════════════════════════════════════════════════════════
// PUT /api/shop-erp/produits/:id/visibilite
// Activer/désactiver la visibilité shop d'un produit
// ══════════════════════════════════════════════════════════════════════════════

shopErpRouter.put('/produits/:id/visibilite',
  zValidator('json', z.object({ visible: z.boolean() })),
  async (c) => {
    const id      = c.req.param('id')
    const { visible } = c.req.valid('json')

    const { data, error } = await db
      .from('produits_shop')
      .update({ visible_shop: visible, updated_at: new Date().toISOString() })
      .eq('product_id', id)
      .select('product_id, visible_shop')
      .single()

    if (error || !data) return c.json({ error: 'Produit introuvable', code: 'NOT_FOUND' }, 404)

    return c.json({ data })
  }
)

// ══════════════════════════════════════════════════════════════════════════════
// PUT /api/shop-erp/produits/:id/prix
// Mettre à jour le prix public d'un produit
// ══════════════════════════════════════════════════════════════════════════════

shopErpRouter.put('/produits/:id/prix',
  zValidator('json', z.object({ prix: z.number().min(0) })),
  async (c) => {
    const id    = c.req.param('id')
    const { prix } = c.req.valid('json')

    const { data, error } = await db
      .from('produits_shop')
      .update({ prix_public: prix, updated_at: new Date().toISOString() })
      .eq('product_id', id)
      .select('product_id, prix_public')
      .single()

    if (error || !data) return c.json({ error: 'Produit introuvable', code: 'NOT_FOUND' }, 404)

    return c.json({ data })
  }
)

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/shop-erp/devis-web
// Demandes de devis web à traiter
// ══════════════════════════════════════════════════════════════════════════════

shopErpRouter.put('/produits/:id/vitrine',
  zValidator('json', z.object({
    visible_shop: z.boolean().optional(),
    prix_public: z.number().min(0).nullable().optional(),
    description_longue: z.string().max(4000).nullable().optional(),
    images: z.array(z.string().url()).max(12).optional(),
    tags: z.array(z.string().min(1).max(40)).max(12).optional(),
    delai_fabrication_jours: z.number().int().min(0).max(365).optional(),
    min_commande: z.number().positive().optional(),
  })),
  async (c) => {
    const id = c.req.param('id')
    const body = c.req.valid('json')

    const updates: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    }

    for (const key of [
      'visible_shop',
      'prix_public',
      'description_longue',
      'images',
      'tags',
      'delai_fabrication_jours',
      'min_commande',
    ] as const) {
      if (key in body) updates[key] = body[key]
    }

    const { data, error } = await db
      .from('produits_shop')
      .update(updates)
      .eq('product_id', id)
      .select(`
        product_id,
        visible_shop,
        prix_public,
        description_longue,
        images,
        tags,
        delai_fabrication_jours,
        min_commande
      `)
      .single()

    if (error || !data) return c.json({ error: 'Produit introuvable', code: 'NOT_FOUND' }, 404)

    return c.json({ data })
  }
)

shopErpRouter.post('/produits/:id/images', async (c) => {
  const id = c.req.param('id')
  const form = await c.req.formData()
  const files = form.getAll('images').filter(item => item instanceof File) as unknown as File[]

  if (files.length === 0) {
    return c.json({ error: 'Aucune image fournie', code: 'NO_FILE' }, 400)
  }

  const { data: produit } = await db
    .from('produits')
    .select('id')
    .eq('id', id)
    .single()

  if (!produit) return c.json({ error: 'Produit introuvable', code: 'NOT_FOUND' }, 404)

  const bucket = 'produits-shop'
  await db.storage.createBucket(bucket, { public: true }).catch(() => {})

  const urls: string[] = []

  for (const file of files.slice(0, 12)) {
    if (!file.type.startsWith('image/')) {
      return c.json({ error: 'Seuls les fichiers image sont acceptes', code: 'INVALID_FILE' }, 400)
    }
    if (file.size > 5 * 1024 * 1024) {
      return c.json({ error: 'Image trop lourde, maximum 5 Mo', code: 'FILE_TOO_LARGE' }, 413)
    }

    const ext = extFromFile(file)
    const path = `${id}/${Date.now()}-${randomUUID()}.${ext}`
    const buffer = Buffer.from(await file.arrayBuffer())
    const { error } = await db.storage.from(bucket).upload(path, buffer, {
      contentType: file.type || 'image/jpeg',
      upsert: false,
    })

    if (error) {
      console.error('[shop-erp] upload image produit:', error)
      return c.json({ error: 'Erreur upload image', details: error.message }, 500)
    }

    const { data } = db.storage.from(bucket).getPublicUrl(path)
    urls.push(data.publicUrl)
  }

  return c.json({ data: { urls } }, 201)
})

shopErpRouter.get('/devis-web', async (c) => {
  const { statut } = c.req.query()

  let query = db
    .from('demandes_devis_web')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(50)

  if (statut) {
    query = query.eq('statut', statut)
  }

  const { data, error } = await query

  if (error) return c.json({ error: 'Erreur DB', code: 'DB_ERROR' }, 500)

  return c.json({ data: data ?? [], total: (data ?? []).length })
})

// ══════════════════════════════════════════════════════════════════════════════
// POST /api/shop-erp/devis/:id/creer-erp
// Créer un devis ERP à partir d'une demande web
// ══════════════════════════════════════════════════════════════════════════════

shopErpRouter.patch('/devis-web/:id/statut',
  zValidator('json', z.object({ statut: z.enum(['nouvelle', 'en_cours', 'traitee', 'refusee']) })),
  async (c) => {
    const id = c.req.param('id')
    const { statut } = c.req.valid('json')

    const { data, error } = await db
      .from('demandes_devis_web')
      .update({ statut })
      .eq('id', id)
      .select('*')
      .single()

    if (error || !data) return c.json({ error: 'Demande introuvable', code: 'NOT_FOUND' }, 404)

    return c.json({ data })
  }
)

const creerErpSchema = z.object({
  montant_ht:              z.number().min(0).optional(),
  date_validite:           z.string().optional(),
  condition_paiement_code: z.string().optional(),
  notes_commerciales:      z.string().optional(),
})

shopErpRouter.post('/devis/:id/creer-erp',
  zValidator('json', creerErpSchema),
  async (c) => {
    const id   = c.req.param('id')
    const body = c.req.valid('json')

    const { data: devisWeb, error: errFetch } = await db
      .from('demandes_devis_web')
      .select('*')
      .eq('id', id)
      .single()

    if (errFetch || !devisWeb) {
      return c.json({ error: 'Demande introuvable', code: 'NOT_FOUND' }, 404)
    }

    if (devisWeb.erp_devis_id) {
      return c.json({ error: 'Devis ERP déjà créé', code: 'ALREADY_EXISTS', devis_id: devisWeb.erp_devis_id }, 409)
    }

    const TVA        = 0.1925
    const montant_ht = body.montant_ht ?? 0
    const tva_xaf    = Math.round(montant_ht * TVA)

    const today      = new Date().toISOString().split('T')[0]
    const dateVal    = body.date_validite ?? new Date(Date.now() + 30 * 86_400_000).toISOString().split('T')[0]
    const diffDays   = Math.ceil((new Date(dateVal).getTime() - Date.now()) / 86_400_000)
    const validite_jours = Math.max(0, diffDays)

    const condCode = body.condition_paiement_code ?? 'P100'
    const { data: condRow } = await db
      .from('conditions_paiement')
      .select('id')
      .eq('code', condCode)
      .single()

    const notesParts = [`[SOURCE WEB] ${devisWeb.description}`]
    if (body.notes_commerciales?.trim()) notesParts.push(`\n--- Notes commerciales ---\n${body.notes_commerciales.trim()}`)

    const numero = await genererNumeroDevis()

    const { data: erpDevis, error: errCreate } = await db
      .from('devis')
      .insert({
        numero,
        client_nom:            devisWeb.nom,
        statut:                'brouillon',
        date_emission:         today,
        date_validite:         dateVal,
        validite_jours,
        condition_paiement_id: condRow?.id ?? null,
        notes:                 notesParts.join(''),
        total_ht_xaf:        montant_ht,
        tva_xaf,
        total_ttc_xaf:       montant_ht + tva_xaf,
        sync_status:         'synced',
      })
      .select('id, numero')
      .single()

    if (errCreate || !erpDevis) {
      console.error('[shop-erp] create devis:', errCreate)
      return c.json({ error: 'Erreur création devis ERP', code: 'DB_ERROR' }, 500)
    }

    const { error: updateErr } = await db
      .from('demandes_devis_web')
      .update({ statut: 'traitee', erp_devis_id: erpDevis.id })
      .eq('id', id)
      .select('id, statut, erp_devis_id')
      .single()

    if (updateErr) {
      console.error('[shop-erp] update demande_devis_web:', JSON.stringify(updateErr))
    }

    return c.json({ data: erpDevis }, 201)
  }
)

// ══════════════════════════════════════════════════════════════════════════════
// PATCH /api/shop-erp/commandes/:id/annuler
// Annulation d'une commande web depuis le module ERP
// ══════════════════════════════════════════════════════════════════════════════

shopErpRouter.patch(
  '/commandes/:id/annuler',
  zValidator('json', z.object({ motif: z.string().min(1).max(200) })),
  async (c) => {
    const id            = c.req.param('id')
    const { motif }     = c.req.valid('json')
    const now           = new Date().toISOString()

    // 1. Charger la commande shop
    const { data: commande, error: fetchErr } = await db
      .from('commandes_shop')
      .select('id, ref, statut_commande, erp_commande_id, notes_client')
      .eq('id', id)
      .single()

    if (fetchErr || !commande) {
      return c.json({ error: 'Commande introuvable', code: 'NOT_FOUND' }, 404)
    }

    const cmd = commande as {
      id: string; ref: string; statut_commande: string
      erp_commande_id: string | null; notes_client: string | null
    }

    if (cmd.statut_commande === 'livree') {
      return c.json({ error: 'Impossible d\'annuler une commande déjà livrée', code: 'INVALID_TRANSITION' }, 422)
    }
    if (cmd.statut_commande === 'annulee') {
      return c.json({ error: 'Commande déjà annulée', code: 'ALREADY_CANCELLED' }, 409)
    }

    // 2. Mettre à jour commandes_shop
    const notesAvecMotif = [cmd.notes_client, `[ANNULATION] ${motif}`].filter(Boolean).join('\n')

    const { data: updated, error: updateErr } = await db
      .from('commandes_shop')
      .update({ statut_commande: 'annulee', notes_client: notesAvecMotif, updated_at: now })
      .eq('id', id)
      .select()
      .single()

    if (updateErr || !updated) {
      return c.json({ error: updateErr?.message ?? 'Erreur mise à jour', code: 'DB_ERROR' }, 500)
    }

    // 3. Annuler la commande ERP miroir + ses bons de sortie
    if (cmd.erp_commande_id) {
      await db
        .from('commandes')
        .update({ statut: 'cancelled', updated_at: now })
        .eq('id', cmd.erp_commande_id)

      // Annuler les bons de sortie liés non encore exécutés
      await db
        .from('bons_sortie')
        .update({ statut: 'annule', updated_at: now })
        .eq('commande_id', cmd.erp_commande_id)
        .in('statut', ['soumis', 'en_attente', 'valide'])
    }

    return c.json(updated)
  }
)
