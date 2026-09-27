import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { randomUUID, randomBytes } from 'crypto'
import { supabaseAdmin } from '@forge/db'
import { FRAIS_LIVRAISON, fraisLivraisonWeb, CommercialMode, resoudreModeCommercial, type TypeGamme } from '@forge/shared'
import { notifyCommandeSms } from '../services/sms.service'
import { verifierEligibiliteCredit } from '../services/credit-eligibility.service'
import { notifyWorkflow } from '../services/workflow-notifications.service'
import { ensureClient } from '../services/client-sync.service'
import { ensureFactureForCommande, solderCreditsForCommande, syncCreditForCommande } from '../services/finance-core.service'
import { requirePermission } from '../middleware/permission.middleware'
import { verifierBearer } from '../middleware/auth'
import { checkPermission, writeAuditLog } from '../services/rbacService'

const db = supabaseAdmin!
import type { HonoVariables } from '../types'

// ── Constantes ─────────────────────────────────────────────────────────────────

const TVA_RATE = 0.1925

const TARIFS_LIVRAISON: Record<string, { tarif: number; delaiJours: number }> = FRAIS_LIVRAISON
const SMS_RESEND_COOLDOWN_MS = 2 * 60 * 1000
const smsResendAttempts = new Map<string, number>()

// ── Helpers ────────────────────────────────────────────────────────────────────

// Sans 0/O/1/I : la référence est dictée au téléphone et recopiée depuis un SMS.
// 32 symboles → aucun biais modulo sur un octet ; 32^6 ≈ 1 milliard de valeurs.
// L'unicité reste garantie par la contrainte UNIQUE de commandes_shop.ref
// (nouvel essai à l'insertion en cas de collision, voir POST /commandes).
const ALPHABET_REF = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

function genRef(): string {
  const year = new Date().getFullYear()
  const seq  = Array.from(randomBytes(6), (b) => ALPHABET_REF[b % ALPHABET_REF.length]).join('')
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

type PromoActive = {
  campagne_id: string
  campagne_nom: string
  product_id: string
  remise_type: 'pct' | 'forfait'
  remise_valeur: number
  prix_promo_xaf: number | null
  date_fin: string
  priorite: number
}

function prixPromo(base: number | null | undefined, promo: PromoActive | undefined) {
  const prixBase = Math.round(Number(base ?? 0))
  if (!promo || prixBase <= 0) return null

  const prixForce = Math.round(Number(promo.prix_promo_xaf ?? 0))
  if (prixForce > 0 && prixForce < prixBase) return prixForce

  const valeur = Number(promo.remise_valeur ?? 0)
  const remise = promo.remise_type === 'pct'
    ? Math.round(prixBase * Math.min(100, valeur) / 100)
    : Math.round(valeur)
  const next = Math.max(0, prixBase - remise)
  return next > 0 && next < prixBase ? next : null
}

async function promotionsActives(productIds: string[]) {
  if (productIds.length === 0) return new Map<string, PromoActive>()
  const today = new Date().toISOString().slice(0, 10)

  try {
    const { data, error } = await db
      .from('campagnes_produits')
      .select(`
        campagne_id,
        product_id,
        remise_type,
        remise_valeur,
        prix_promo_xaf,
        priorite,
        campagnes_marketing!inner(nom, statut, date_debut, date_fin)
      `)
      .in('product_id', productIds)
      .eq('campagnes_marketing.statut', 'active')
      .lte('campagnes_marketing.date_debut', today)
      .gte('campagnes_marketing.date_fin', today)
      .order('priorite', { ascending: false })
      .order('created_at', { ascending: false })

    if (error) {
      console.warn('[shop/promotions] lecture ignoree:', error.message)
      return new Map<string, PromoActive>()
    }

    const map = new Map<string, PromoActive>()
    for (const row of (data ?? []) as Array<Record<string, any>>) {
      if (map.has(row.product_id)) continue
      map.set(row.product_id, {
        campagne_id: row.campagne_id,
        campagne_nom: row.campagnes_marketing?.nom ?? 'Promotion',
        product_id: row.product_id,
        remise_type: row.remise_type === 'forfait' ? 'forfait' : 'pct',
        remise_valeur: Number(row.remise_valeur ?? 0),
        prix_promo_xaf: row.prix_promo_xaf === null || row.prix_promo_xaf === undefined ? null : Number(row.prix_promo_xaf),
        date_fin: row.campagnes_marketing?.date_fin ?? today,
        priorite: Number(row.priorite ?? 0),
      })
    }
    return map
  } catch (e) {
    console.warn('[shop/promotions] indisponible:', e instanceof Error ? e.message : e)
    return new Map<string, PromoActive>()
  }
}

function enrichirProduitPromo(row: any, p: any, promo: PromoActive | undefined) {
  const promoPrice = prixPromo(row.prix_public, promo)
  return {
    id:                    row.product_id,
    type_article:          'produit' as const,
    ref:                   p.ref,
    nom:                   p.designation,
    description:           p.description,
    categorie:             p.categorie,
    unite:                 p.unite,
    stock_actuel:          p.stock_actuel,
    seuil_alerte:          p.stock_min,
    prix_public:           promoPrice ?? row.prix_public,
    prix_barre_xaf:        promoPrice ? row.prix_public : null,
    description_longue:    row.description_longue,
    images:                row.images ?? [],
    tags:                  row.tags ?? [],
    delai_fabrication_jours: row.delai_fabrication_jours,
    min_commande:          row.min_commande,
    disponibilite:         disponibilite(p.stock_actuel, p.stock_min),
    promotion: promoPrice && promo ? {
      campagne_id:        promo.campagne_id,
      nom:                promo.campagne_nom,
      remise_type:        promo.remise_type,
      remise_valeur:      promo.remise_valeur,
      prix_original_xaf:  row.prix_public,
      prix_promo_xaf:     promoPrice,
      date_fin:           promo.date_fin,
    } : null,
  }
}

async function creerBonSortieShop(args: {
  commandeId?: string | null
  ref: string
  clientNom: string
  clientTelephone: string
  montantTtc: number
  lignes: Array<{ product_id: string | null; designation: string; quantite: number }>
}) {
  // Seuls les articles de stock sortent du magasin ; un modèle fabriqué sur
  // commande passe par la production. Aucune ligne de stock → pas de bon.
  const lignesStock = args.lignes.filter((l): l is typeof l & { product_id: string } => Boolean(l.product_id))
  if (lignesStock.length === 0) return null
  args = { ...args, lignes: lignesStock }

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

// ── Tarification serveur des commandes shop ───────────────────────────────────
// Le prix envoyé par le navigateur n'est JAMAIS une source de vérité pour une
// commande anonyme : on repart du prix public de la vitrine — produits_shop
// (+ promotion active, même règle que l'affichage du catalogue) pour un article
// de stock, modeles_shop pour un produit fini STANDARD. Seul le personnel
// authentifié (vente en boutique) peut fixer un prix, et tout écart au prix de
// référence est tracé dans rbac_audit_logs.

type LigneDemandee = { product_id?: string; modele_id?: string; designation: string; quantite: number; prix_unitaire: number }

type LigneTarifee = {
  product_id:    string | null
  modele_id:     string | null
  designation:   string
  quantite:      number
  prix_unitaire: number
  unite:         string | null
}

type EcartPrix =
  | { product_id: string; prix_reference: number | null; prix_saisi: number }
  | { modele_id: string;  prix_reference: number | null; prix_saisi: number }

type ResultatTarification =
  | { ok: true; lignes: LigneTarifee[]; ecartsPrix: EcartPrix[] }
  | { ok: false; status: 422; error: string; code: string; details?: Record<string, unknown> }

interface ProduitShopTarifRow {
  product_id:   string
  prix_public:  number | null
  visible_shop: boolean
  min_commande: number | null
}

/** Colonnes de modeles_shop + modèle + famille (pour le mode commercial effectif). */
const SELECT_MODELE_VITRINE = `
  modele_id, prix_public, visible_shop, description_longue, images, tags,
  delai_fabrication_jours, min_commande,
  modeles!inner (
    id, reference, designation, description, unite_facturation, type_gamme, actif,
    familles ( nom, type_gamme )
  )
`

interface ModeleVitrineRow {
  modele_id:               string
  prix_public:             number | null
  visible_shop:            boolean
  description_longue:      string | null
  images:                  unknown
  tags:                    unknown
  delai_fabrication_jours: number | null
  min_commande:            number | null
  modeles: {
    id: string; reference: string; designation: string; description: string | null
    unite_facturation: string | null; type_gamme: TypeGamme | null; actif: boolean
    familles: { nom: string; type_gamme: TypeGamme } | null
  }
}

/** Vendable en ligne : modèle actif dont le mode commercial effectif est STANDARD. */
function modeleVendable(row: ModeleVitrineRow): boolean {
  return row.modeles.actif
    && resoudreModeCommercial(row.modeles, row.modeles.familles) === CommercialMode.STANDARD
}

/** Règles communes de vente en ligne anonyme : visible, prix public, minimum de commande. */
function verifierVitrine(
  vitrine: { visible: boolean; prixPublic: number; minCommande: number | null },
  quantite: number,
  designation: string,
  cle: Record<string, string>,
): Extract<ResultatTarification, { ok: false }> | null {
  if (!vitrine.visible) {
    return { ok: false, status: 422, code: 'PRODUIT_NON_EN_VENTE', error: `« ${designation} » n'est pas en vente en ligne`, details: cle }
  }
  if (vitrine.prixPublic <= 0) {
    return { ok: false, status: 422, code: 'PRIX_INDISPONIBLE', error: `« ${designation} » n'a pas de prix public`, details: cle }
  }
  const minimum = Number(vitrine.minCommande ?? 1)
  if (quantite < minimum) {
    return {
      ok: false, status: 422, code: 'QUANTITE_MINIMALE',
      error: `Quantité minimale pour « ${designation} » : ${minimum}`,
      details: { ...cle, minimum, demande: quantite },
    }
  }
  return null
}

async function tarifierLignesShop(
  lignes: LigneDemandee[],
  produits: Map<string, { designation: string; prix_unitaire_xaf: number | null }>,
  venteParPersonnel: boolean,
): Promise<ResultatTarification> {
  const idsProduits = [...new Set(lignes.flatMap((l) => l.product_id ? [l.product_id] : []))]
  const idsModeles  = [...new Set(lignes.flatMap((l) => l.modele_id ? [l.modele_id] : []))]

  let vitrineProduits = new Map<string, ProduitShopTarifRow>()
  let promos          = new Map<string, PromoActive>()
  if (idsProduits.length > 0) {
    const { data, error } = await db
      .from('produits_shop')
      .select('product_id, prix_public, visible_shop, min_commande')
      .in('product_id', idsProduits)

    if (error) {
      console.error('[shop] tarification produits_shop:', error.message)
      return { ok: false, status: 422, error: 'Tarification indisponible, réessayez', code: 'TARIFICATION_INDISPONIBLE' }
    }
    vitrineProduits = new Map(((data ?? []) as ProduitShopTarifRow[]).map((r) => [r.product_id, r]))
    if (!venteParPersonnel) promos = await promotionsActives(idsProduits)
  }

  let vitrineModeles = new Map<string, ModeleVitrineRow>()
  if (idsModeles.length > 0) {
    const { data, error } = await db
      .from('modeles_shop')
      .select(SELECT_MODELE_VITRINE)
      .in('modele_id', idsModeles)

    if (error) {
      console.error('[shop] tarification modeles_shop:', error.message)
      return { ok: false, status: 422, error: 'Tarification indisponible, réessayez', code: 'TARIFICATION_INDISPONIBLE' }
    }
    vitrineModeles = new Map(((data ?? []) as unknown as ModeleVitrineRow[]).map((r) => [r.modele_id, r]))
  }

  const tarifees: LigneTarifee[] = []
  const ecartsPrix: EcartPrix[] = []

  for (const ligne of lignes) {
    // ── Produit fini STANDARD (modèle) ─────────────────────────────────────
    if (ligne.modele_id) {
      const modeleId    = ligne.modele_id
      const row         = vitrineModeles.get(modeleId)
      const designation = row?.modeles.designation ?? ligne.designation
      const prixPublic  = Math.round(Number(row?.prix_public ?? 0))

      // Même pour le personnel : un modèle configurable ou sur devis ne se vend
      // jamais au panier, il passe par le configurateur ou par un devis.
      if (!row || !modeleVendable(row)) {
        return {
          ok: false, status: 422, code: 'MODE_NON_STANDARD',
          error: `« ${designation} » n'est pas un produit standard vendable au panier`,
          details: { modele_id: modeleId },
        }
      }

      if (venteParPersonnel) {
        const reference = prixPublic > 0 ? prixPublic : null
        if (reference === null || Math.round(ligne.prix_unitaire) !== reference) {
          ecartsPrix.push({ modele_id: modeleId, prix_reference: reference, prix_saisi: ligne.prix_unitaire })
        }
        tarifees.push({
          product_id: null, modele_id: modeleId, designation,
          quantite: ligne.quantite, prix_unitaire: ligne.prix_unitaire, unite: row.modeles.unite_facturation,
        })
        continue
      }

      const refus = verifierVitrine(
        { visible: row.visible_shop, prixPublic, minCommande: row.min_commande },
        ligne.quantite, designation, { modele_id: modeleId },
      )
      if (refus) return refus
      tarifees.push({
        product_id: null, modele_id: modeleId, designation,
        quantite: ligne.quantite, prix_unitaire: prixPublic, unite: row.modeles.unite_facturation,
      })
      continue
    }

    // ── Article de stock (produit) ─────────────────────────────────────────
    const productId   = ligne.product_id as string
    const produit     = produits.get(productId)
    const designation = produit?.designation ?? ligne.designation
    const row         = vitrineProduits.get(productId)
    const prixPublic  = Math.round(Number(row?.prix_public ?? 0))

    if (venteParPersonnel) {
      const reference = prixPublic > 0 ? prixPublic : (produit?.prix_unitaire_xaf ?? null)
      if (reference === null || Math.round(ligne.prix_unitaire) !== Math.round(reference)) {
        ecartsPrix.push({ product_id: productId, prix_reference: reference, prix_saisi: ligne.prix_unitaire })
      }
      tarifees.push({
        product_id: productId, modele_id: null, designation,
        quantite: ligne.quantite, prix_unitaire: ligne.prix_unitaire, unite: null,
      })
      continue
    }

    const refus = verifierVitrine(
      { visible: Boolean(row?.visible_shop), prixPublic, minCommande: row?.min_commande ?? null },
      ligne.quantite, designation, { product_id: productId },
    )
    if (refus) return refus

    const prix = prixPromo(prixPublic, promos.get(productId)) ?? prixPublic
    tarifees.push({
      product_id: productId, modele_id: null, designation,
      quantite: ligne.quantite, prix_unitaire: prix, unite: null,
    })
  }

  return { ok: true, lignes: tarifees, ecartsPrix }
}

/** Article de catalogue public pour un modèle STANDARD (même forme qu'un produit + type_article). */
function enrichirModeleVitrine(row: ModeleVitrineRow) {
  const m = row.modeles
  return {
    id:                      row.modele_id,
    type_article:            'modele' as const,
    commercial_mode:         CommercialMode.STANDARD,
    ref:                     m.reference,
    nom:                     m.designation,
    description:             m.description,
    categorie:               m.familles?.nom ?? 'Produits finis',
    unite:                   m.unite_facturation ?? 'unite',
    stock_actuel:            null,            // fabriqué sur commande : pas de plafond de stock
    seuil_alerte:            0,
    prix_public:             Math.round(Number(row.prix_public ?? 0)),
    prix_barre_xaf:          null,
    description_longue:      row.description_longue,
    images:                  Array.isArray(row.images) ? row.images : [],
    tags:                    Array.isArray(row.tags) ? row.tags : [],
    delai_fabrication_jours: row.delai_fabrication_jours,
    min_commande:            row.min_commande ?? 1,
    disponibilite:           'sur_commande' as const,
    promotion:               null,
  }
}

/**
 * Modèles STANDARD visibles en ligne, prêts pour le catalogue public.
 * Jamais bloquant : en cas d'erreur, le catalogue des articles de stock reste servi.
 */
async function chargerModelesVitrine(filtres: { id?: string; q?: string; categorie?: string } = {}) {
  try {
    let query = db.from('modeles_shop').select(SELECT_MODELE_VITRINE).eq('visible_shop', true)
    if (filtres.id) query = query.eq('modele_id', filtres.id)
    if (filtres.q)  query = query.ilike('modeles.designation', `%${filtres.q}%`)

    const { data, error } = await query
    if (error) {
      console.warn('[shop/modeles] lecture ignoree:', error.message)
      return []
    }
    return ((Array.isArray(data) ? data : []) as unknown as ModeleVitrineRow[])
      .filter((row) => row.modeles && modeleVendable(row) && Number(row.prix_public ?? 0) > 0)
      .filter((row) => !filtres.categorie || row.modeles.familles?.nom === filtres.categorie)
      .map(enrichirModeleVitrine)
  } catch (e) {
    console.warn('[shop/modeles] indisponible:', e instanceof Error ? e.message : e)
    return []
  }
}

/**
 * Authentification OPTIONNELLE de POST /commandes.
 * - pas d'en-tête Authorization → client anonyme du site (prix imposés)
 * - en-tête valide + droit de vente (COMMERCIAL:CREATE ou CAISSE:CREATE) → personnel
 * - en-tête présent mais invalide / sans droit → refus explicite, jamais de
 *   repli silencieux sur le prix catalogue (le vendeur croirait son prix appliqué)
 */
async function identifierVendeur(authHeader: string | undefined): Promise<
  | { ok: true; vendeur: HonoVariables['user'] | null }
  | { ok: false; status: 401 | 403 | 500; error: string; code: string }
> {
  if (!authHeader) return { ok: true, vendeur: null }

  const verification = await verifierBearer(authHeader)
  if (!verification.ok) return verification

  const { user } = verification
  const commercial = await checkPermission(user.id, 'COMMERCIAL', 'CREATE', user.role)
  if (commercial.allowed) return { ok: true, vendeur: user }
  const caisse = await checkPermission(user.id, 'CAISSE', 'CREATE', user.role)
  if (caisse.allowed) return { ok: true, vendeur: user }

  return { ok: false, status: 403, error: 'Droit de vente requis pour fixer un prix', code: 'FORBIDDEN' }
}

// ── Schémas Zod ────────────────────────────────────────────────────────────────

// Une ligne vise SOIT un article de stock (product_id), SOIT un produit fini
// STANDARD (modele_id, Catalogue Hybride Phase 2). prix_unitaire n'est retenu
// que pour le personnel authentifié — voir tarifierLignesShop.
const ligneCommandeSchema = z.object({
  product_id:      z.string().uuid().optional(),
  modele_id:       z.string().uuid().optional(),
  designation:     z.string().min(1),
  quantite:        z.number().positive(),
  prix_unitaire:   z.number().min(0),
}).refine((l) => Boolean(l.product_id) !== Boolean(l.modele_id), {
  message: 'Chaque ligne doit viser exactement un product_id ou un modele_id',
})

const commandeShopSchema = z.object({
  client_nom:              z.string().min(2).max(200),
  client_telephone:        z.string().min(8).max(20),
  client_email:            z.string().email().optional(),
  client_adresse:          z.string().min(5).optional(),
  client_ville:            z.string().optional(),
  lignes:                  z.array(ligneCommandeSchema).min(1),
  source:                  z.enum(['shop', 'boutique']).default('shop'),
  mode_paiement:           z.enum(['mtn_momo', 'orange_money', 'livraison', 'especes']),
  mode_livraison:          z.enum(['livraison', 'retrait_boutique']).default('livraison'),
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

  const promos = await promotionsActives((data ?? []).map((row: any) => row.product_id))
  const catalogue = (data ?? []).map((row: any) => {
    const p = row.produits
    return enrichirProduitPromo(row, p, promos.get(row.product_id))
  })

  // Produits finis STANDARD en tête (Catalogue Hybride Phase 2), puis articles de stock.
  const modeles = await chargerModelesVitrine({ q, categorie })
  const articles = [...modeles, ...catalogue]

  c.header('Cache-Control', 'public, max-age=60, stale-while-revalidate=30')
  return c.json({ data: articles, total: articles.length })
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
    // L'identifiant peut être celui d'un produit fini STANDARD (modèle).
    const [modele] = await chargerModelesVitrine({ id })
    if (modele) return c.json({ data: modele })
    return c.json({ error: 'Produit introuvable', code: 'NOT_FOUND' }, 404)
  }

  const p = (data as any).produits
  const promos = await promotionsActives([data.product_id])
  return c.json({
    data: enrichirProduitPromo(data, p, promos.get(data.product_id)),
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

  const modeles    = await chargerModelesVitrine()
  const categories = [...new Set([
    ...(data ?? []).map((r: any) => r.produits.categorie),
    ...modeles.map((m) => m.categorie),
  ])].sort()

  c.header('Cache-Control', 'public, max-age=300')
  return c.json({ data: categories })
})

// ══════════════════════════════════════════════════════════════════════════════
// POST /api/shop/commandes
// Créer une commande web (sans auth)
// ══════════════════════════════════════════════════════════════════════════════

shopRouter.post('/commandes', zValidator('json', commandeShopSchema), async (c) => {
  const body = c.req.valid('json')

  const identification = await identifierVendeur(c.req.header('Authorization'))
  if (!identification.ok) {
    return c.json({ error: identification.error, code: identification.code }, identification.status)
  }
  const vendeur = identification.vendeur

  // Une vente « boutique » saute la création de la commande ERP : réservée au personnel.
  if (body.source === 'boutique' && !vendeur) {
    return c.json({ error: 'Vente boutique réservée au personnel authentifié', code: 'FORBIDDEN' }, 403)
  }

  if (body.mode_livraison === 'livraison' && (!body.client_adresse || body.client_adresse.trim().length < 5)) {
    return c.json({
      error: 'L\'adresse de livraison est obligatoire pour une commande livrée',
      code: 'ADRESSE_LIVRAISON_REQUISE',
    }, 422)
  }

  if (body.mode_paiement === 'livraison' && !body.avance_livraison_pct) {
    return c.json({
      error: 'Le paiement à la livraison exige une avance de 30%, 50% ou 70%',
      code: 'ACOMPTE_LIVRAISON_REQUIS',
    }, 422)
  }

  // 1. Vérifier disponibilité stock pour chaque ligne
  const produitsLus = new Map<string, { designation: string; prix_unitaire_xaf: number | null }>()
  for (const ligne of body.lignes) {
    if (!ligne.product_id) continue // produit fini sur commande : pas de contrôle de stock
    const { data: produit } = await db
      .from('produits')
      .select('id, designation, stock_actuel, unite, prix_unitaire_xaf')
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

    produitsLus.set(ligne.product_id, {
      designation:       produit.designation,
      prix_unitaire_xaf: produit.prix_unitaire_xaf ?? null,
    })
  }

  // 1 bis. Prix et frais recalculés côté serveur — jamais ceux du navigateur
  const tarification = await tarifierLignesShop(body.lignes, produitsLus, Boolean(vendeur))
  if (!tarification.ok) {
    return c.json({ error: tarification.error, code: tarification.code, details: tarification.details }, tarification.status)
  }
  const lignes = tarification.lignes
  const fraisLivraisonServeur = body.mode_livraison === 'retrait_boutique'
    ? 0
    : vendeur
      ? body.frais_livraison
      : (fraisLivraisonWeb(body.client_ville) ?? 0) // null = zone « sur devis », facturée après contact

  // 2. Vérifier éligibilité crédit si condition ≠ P100
  const clientId = await ensureClient({
    nom:       body.client_nom,
    telephone: body.client_telephone,
    email:     body.client_email ?? null,
    adresse:   body.client_adresse,
    ville:     body.client_ville ?? null,
    type:      'particulier',
  })

  const condCode = body.condition_paiement_code ?? 'P100'
  const { data: conditionPaiement } = await db
    .from('conditions_paiement')
    .select('id, acompte_pct, delai_solde_jours')
    .eq('code', condCode)
    .maybeSingle()
  if (condCode !== 'P100') {
    const montantEstime = Math.round(lignes.reduce((s, l) => s + l.quantite * l.prix_unitaire, 0))
    const tvaEstimee    = Math.round(montantEstime * TVA_RATE)
    const ttcEstime     = Math.round(montantEstime + tvaEstimee + fraisLivraisonServeur)

    const eligibilite = await verifierEligibiliteCredit(clientId, ttcEstime, 'web', condCode)
    if (!eligibilite.eligible) {
      return c.json({
        error: eligibilite.raison ?? 'Condition de crédit non autorisée pour les commandes web',
        code: 'CREDIT_NON_ELIGIBLE',
      }, 422)
    }
  }

  // 4. Calculer montants : la livraison est ajoutee apres TVA.
  const montant_ht       = Math.round(lignes.reduce((s, l) => s + l.quantite * l.prix_unitaire, 0))
  const frais_livraison  = Math.round(fraisLivraisonServeur)
  const tva              = Math.round(montant_ht * TVA_RATE)
  const montant_ttc      = Math.round(montant_ht + tva + frais_livraison)
  const cp = conditionPaiement as { id?: string; acompte_pct?: number | null; delai_solde_jours?: number | null } | null
  const montantAcompte = Math.round(montant_ttc * (Number(cp?.acompte_pct ?? 100) / 100))
  const dateEcheanceSolde = cp?.delai_solde_jours !== undefined && cp?.delai_solde_jours !== null
    ? new Date(Date.now() + Number(cp.delai_solde_jours) * 86400_000).toISOString().slice(0, 10)
    : null

  // 5. Référence unique (voir genRef) — réessayée à l'insertion si collision
  let ref = genRef()

  // 6. Lignes JSONB
  const lignesJson = lignes.map((l) => ({
    product_id:     l.product_id,
    ...(l.modele_id ? { modele_id: l.modele_id, type_article: 'modele' } : {}),
    designation:    l.designation,
    quantite:       l.quantite,
    prix_unitaire:  l.prix_unitaire,
    total_ht:       Math.round(l.quantite * l.prix_unitaire),
  }))

  // 7. Insérer commande_shop
  const insererCommandeShop = () => db
    .from('commandes_shop')
    .insert({
      ref,
      source:           body.source,
      client_nom:       body.client_nom,
      client_telephone: body.client_telephone,
      client_email:     body.client_email ?? null,
      client_adresse:   body.client_adresse ?? 'Retrait en boutique',
      client_ville:     body.client_ville ?? (body.mode_livraison === 'retrait_boutique' ? 'Retrait en boutique' : null),
      lignes:           lignesJson,
      montant_ht,
      tva,
      montant_ttc,
      frais_livraison,
      mode_paiement:    body.mode_paiement,
      mode_livraison:   body.mode_livraison ?? 'livraison',
      notes_client:     body.notes_client ?? null,
      statut_commande:  'recue',
      statut_paiement:  'en_attente',
    })
    .select('id, ref')
    .single()

  let { data: commandeShop, error: errShop } = await insererCommandeShop()
  for (let essai = 1; essai < 3 && errShop?.code === '23505'; essai++) {
    ref = genRef()
    ;({ data: commandeShop, error: errShop } = await insererCommandeShop())
  }

  if (errShop || !commandeShop) {
    console.error('[shop] insert commandes_shop:', errShop)
    return c.json({ error: 'Erreur création commande', code: 'DB_ERROR' }, 500)
  }

  if (vendeur && tarification.ecartsPrix.length > 0) {
    writeAuditLog({
      userId:        vendeur.id,
      actionType:    'VENTE_PRIX_FORCE',
      module:        body.source === 'boutique' ? 'CAISSE' : 'COMMERCIAL',
      resourceType:  'commandes_shop',
      resourceId:    commandeShop.id,
      payloadAfter:  { ref, ecarts: tarification.ecartsPrix },
      ipAddress:     c.req.header('x-forwarded-for') ?? c.req.header('x-real-ip'),
      userAgent:     c.req.header('user-agent'),
    })
  }

  const isBoutiqueSale = body.source === 'boutique'

  if (!isBoutiqueSale) {
    // 8. Créer la commande ERP en miroir (source web)
    const today = new Date().toISOString().split('T')[0]
    const { data: erpCommande, error: errErpCommande } = await db
      .from('commandes')
      .insert({
        numero:              ref,
        client_id:           clientId,
        client_nom:          body.client_nom,
        statut:              'confirmed',
        date_commande:       today,
        total_ht_xaf:        montant_ht,
        tva_xaf:             tva,
        frais_livraison_xaf: frais_livraison,
        total_ttc_xaf:       montant_ttc,
        condition_paiement_id: cp?.id ?? null,
        montant_acompte:     montantAcompte,
        date_echeance_solde: dateEcheanceSolde,
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
      const lignesErp = lignes.map((l, i) => ({
        commande_id:          erpCommande.id,
        produit_id:           l.product_id,
        ...(l.modele_id ? { modele_id: l.modele_id } : {}),
        ...(l.unite ? { unite: l.unite } : {}),
        designation:          l.designation,
        quantite:             l.quantite,
        prix_unitaire_ht_xaf: l.prix_unitaire,
        total_ht_xaf:         Math.round(l.quantite * l.prix_unitaire),
        ordre:                i,
      }))
      await db.from('commandes_lignes').insert(lignesErp)

      // Produits finis STANDARD : fabriqués sur commande → l'atelier doit lancer la production.
      const lignesAFabriquer = lignes.filter((l) => l.modele_id)
      if (lignesAFabriquer.length > 0) {
        await notifyWorkflow({
          event:   'production.commande_standard_a_fabriquer',
          module:  'production',
          severite:'warning',
          titre:   'Produit standard a fabriquer',
          message: `Commande shop ${ref} : ${lignesAFabriquer.map((l) => `${l.quantite} × ${l.designation}`).join(', ')}.`,
          ref,
          url:     '/production',
          data:    { commande_id: erpCommande.id, modeles: lignesAFabriquer.map((l) => ({ modele_id: l.modele_id, quantite: l.quantite })) },
        })
      }
      await ensureFactureForCommande({
        commandeId: erpCommande.id,
        statut:    'brouillon',
        notes:     `Facture brouillon generee automatiquement a la creation de la commande shop ${ref}.`,
      })
      await syncCreditForCommande(erpCommande.id, null)

      let bonSortie: unknown = null
      try {
        bonSortie = await creerBonSortieShop({
          commandeId:      erpCommande.id,
          ref,
          clientNom:       body.client_nom,
          clientTelephone: body.client_telephone,
          montantTtc:      montant_ttc,
          lignes:          lignes,
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
            lignes:          lignes,
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
          lignes:          lignes,
        })
        if (bonSortie) {
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
        }
      } catch (e) {
        console.error('[shop] auto bon sortie fallback sans ERP:', e)
      }
    }
  } else {
    let bonSortie: unknown = null
    try {
      bonSortie = await creerBonSortieShop({
        commandeId:      null,
        ref,
        clientNom:       body.client_nom,
        clientTelephone: body.client_telephone,
        montantTtc:      montant_ttc,
        lignes:          lignes,
      })
    } catch (e) {
      console.error('[shop] auto bon sortie boutique:', e)
    }

    if (bonSortie) {
      await notifyWorkflow({
        event:   'stock.bon_sortie_a_preparer',
        module:  'stock',
        severite:'warning',
        titre:   'Bon de sortie a preparer',
        message: `Vente boutique ${ref} : verifier les articles et preparer la sortie stock.`,
        ref,
        url:     '/stocks/bons-sortie',
        data:    { commande_id: null, bon_id: (bonSortie as { id?: string }).id },
      })
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

shopRouter.get('/commandes', async (c) => {
  const { page, per_page, statut_commande, statut_paiement, search, source } = c.req.query()
  const pageNum = Math.max(1, Number(page ?? 1))
  const perPageNum = Math.min(50, Math.max(1, Number(per_page ?? 10)))

  let query = db
    .from('commandes_shop')
    .select(
      `id, ref, source, client_nom, client_telephone, client_adresse, client_ville, lignes, montant_ht, tva, montant_ttc, frais_livraison, mode_paiement, mode_livraison, avance_livraison_pct, statut_commande, statut_paiement, payment_reference, erp_commande_id, created_at, updated_at`,
      { count: 'exact' },
    )
    .order('created_at', { ascending: false })
    .range((pageNum - 1) * perPageNum, pageNum * perPageNum - 1)

  if (source) {
    query = query.eq('source', String(source))
  }

  if (statut_commande) {
    query = query.eq('statut_commande', String(statut_commande))
  }

  if (statut_paiement) {
    query = query.eq('statut_paiement', String(statut_paiement))
  }

  if (search && String(search).trim().length > 0) {
    const term = `%${String(search).trim().replace(/%/g, '\\%')}%`
    query = query.or(`ref.ilike.${term},client_nom.ilike.${term},client_telephone.ilike.${term}`)
  }

  const { data, count, error } = await query
  if (error) {
    return c.json({ error: 'Erreur lecture commandes boutique', code: 'DB_ERROR' }, 500)
  }

  const normalized = (data ?? []).map((row: any) => {
    const montantTtc = Number(row.montant_ttc ?? 0)
    const avancePct = row.avance_livraison_pct ? Number(row.avance_livraison_pct) : null
    const avanceMontant = row.mode_paiement === 'livraison' && avancePct
      ? Math.round(montantTtc * (avancePct / 100))
      : 0
    const resteMontant = row.statut_paiement === 'paye'
      ? 0
      : (row.mode_paiement === 'livraison' && avanceMontant > 0
        ? montantTtc - avanceMontant
        : montantTtc)

    return {
      id: row.id,
      ref: row.ref,
      source: row.source,
      client: {
        nom: row.client_nom,
        telephone: row.client_telephone ?? null,
      },
      client_adresse: row.client_adresse,
      client_ville: row.client_ville,
      lignes: row.lignes,
      montant_ht: Number(row.montant_ht ?? 0),
      tva: Number(row.tva ?? 0),
      montant_ttc: montantTtc,
      frais_livraison: Number(row.frais_livraison ?? 0),
      mode_paiement: row.mode_paiement,
      mode_livraison: row.mode_livraison,
      avance_livraison_pct: avancePct,
      avance_montant: avanceMontant,
      reste_montant: resteMontant,
      statut_commande: row.statut_commande,
      statut_paiement: row.statut_paiement,
      payment_reference: row.payment_reference ?? null,
      erp_commande_id: row.erp_commande_id ?? null,
      created_at: row.created_at,
      updated_at: row.updated_at,
    }
  })

  return c.json({
    data: normalized,
    total: count ?? 0,
    page: pageNum,
    per_page: perPageNum,
    total_pages: Math.ceil((count ?? 0) / perPageNum),
  })
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

  const clientId = await ensureClient({
    nom:       body.nom,
    telephone: body.telephone,
    email:     body.email ?? null,
    adresse:   null,
    ville:     null,
    type:      'particulier',
  })

  const { data: erpDevis, error: errDevis } = await db
    .from('devis')
    .insert({
      numero,
      client_id:             clientId,
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

const IMAGE_EXT_CONTENT_TYPE: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif',
  webp: 'image/webp', heic: 'image/heic', heif: 'image/heif', bmp: 'image/bmp',
}

// Certains navigateurs/OS (iPhone HEIC, copies Windows) envoient un File.type
// vide — on retombe alors sur l'extension avant de rejeter le fichier.
function resolveImageContentType(file: File): string | null {
  if (file.type.startsWith('image/')) return file.type
  if (file.type) return null
  const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
  return IMAGE_EXT_CONTENT_TYPE[ext] ?? null
}

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/shop-erp/analytics
// KPIs + CA mensuel comparé ERP vs Shop (6 derniers mois)
// ══════════════════════════════════════════════════════════════════════════════

shopErpRouter.get('/analytics', requirePermission('COMMERCIAL', 'READ'), async (c) => {
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

shopErpRouter.get('/produits', requirePermission('COMMERCIAL', 'READ'), async (c) => {
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
  requirePermission('COMMERCIAL', 'UPDATE'),
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

    // PGRST116 = aucune ligne ne correspond au .eq('product_id', id) : c'est un
    // 404 (produit introuvable), pas une panne DB — doit être vérifié avant le
    // cas d'erreur générique, sinon un produit inexistant renvoie 500.
    if (!data || error?.code === 'PGRST116') return c.json({ error: 'Produit introuvable', code: 'NOT_FOUND' }, 404)
    if (error) {
      console.error('[shop-erp] visibilite update:', error)
      return c.json({ error: 'Erreur base de donnees', code: 'DB_ERROR', details: error.message }, 500)
    }

    return c.json({ data })
  }
)

// ══════════════════════════════════════════════════════════════════════════════
// PUT /api/shop-erp/produits/:id/prix
// Mettre à jour le prix public d'un produit
// ══════════════════════════════════════════════════════════════════════════════

shopErpRouter.put('/produits/:id/prix',
  requirePermission('COMMERCIAL', 'UPDATE'),
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

    // PGRST116 = aucune ligne ne correspond (produit introuvable) — cf. note
    // identique sur PUT /visibilite ci-dessus.
    if (!data || error?.code === 'PGRST116') return c.json({ error: 'Produit introuvable', code: 'NOT_FOUND' }, 404)
    if (error) {
      console.error('[shop-erp] prix update:', error)
      return c.json({ error: 'Erreur base de donnees', code: 'DB_ERROR', details: error.message }, 500)
    }

    return c.json({ data })
  }
)

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/shop-erp/devis-web
// Demandes de devis web à traiter
// ══════════════════════════════════════════════════════════════════════════════

shopErpRouter.put('/produits/:id/vitrine',
  requirePermission('COMMERCIAL', 'UPDATE'),
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

    if (error) {
      console.error('[shop-erp] vitrine update:', error)
      return c.json({ error: 'Erreur base de donnees', code: 'DB_ERROR', details: error.message }, 500)
    }
    if (!data) return c.json({ error: 'Produit introuvable', code: 'NOT_FOUND' }, 404)

    return c.json({ data })
  }
)

// ══════════════════════════════════════════════════════════════════════════════
// Vitrine des produits finis STANDARD (Catalogue Hybride Phase 2)
// GET  /api/shop-erp/modeles              — modèles STANDARD actifs + leur vitrine
// PUT  /api/shop-erp/modeles/:id/vitrine  — visibilité, prix public, délai, minimum
// ══════════════════════════════════════════════════════════════════════════════

interface ModeleErpRow {
  id: string; reference: string; designation: string; unite_facturation: string | null
  type_gamme: TypeGamme | null; actif: boolean
  familles: { nom: string; type_gamme: TypeGamme } | null
  modeles_shop: Record<string, unknown> | Array<Record<string, unknown>> | null
}

shopErpRouter.get('/modeles', requirePermission('COMMERCIAL', 'READ'), async (c) => {
  const { data, error } = await db
    .from('modeles')
    .select('id, reference, designation, unite_facturation, type_gamme, actif, familles(nom, type_gamme), modeles_shop(*)')
    .eq('actif', true)
    .order('designation')

  if (error) {
    console.error('[shop-erp] modeles:', error)
    return c.json({ error: 'Erreur base de donnees', code: 'DB_ERROR', details: error.message }, 500)
  }

  const modeles = ((data ?? []) as unknown as ModeleErpRow[])
    .filter((m) => resoudreModeCommercial(m, m.familles) === CommercialMode.STANDARD)
    .map((m) => {
      const vitrine = Array.isArray(m.modeles_shop) ? (m.modeles_shop[0] ?? null) : m.modeles_shop
      return {
        id:                m.id,
        reference:         m.reference,
        designation:       m.designation,
        famille:           m.familles?.nom ?? null,
        unite_facturation: m.unite_facturation,
        commercial_mode:   CommercialMode.STANDARD,
        vitrine,
      }
    })

  return c.json({ data: modeles, total: modeles.length })
})

const vitrineModeleSchema = z.object({
  visible_shop:            z.boolean().optional(),
  prix_public:             z.number().int().min(0).optional(),
  description_longue:      z.string().max(5000).nullable().optional(),
  images:                  z.array(z.string().url()).max(12).optional(),
  tags:                    z.array(z.string().max(50)).max(20).optional(),
  delai_fabrication_jours: z.number().int().min(0).nullable().optional(),
  min_commande:            z.number().int().min(1).optional(),
})

shopErpRouter.put(
  '/modeles/:id/vitrine',
  requirePermission('COMMERCIAL', 'UPDATE'),
  zValidator('json', vitrineModeleSchema),
  async (c) => {
    const id   = c.req.param('id')
    const body = c.req.valid('json')
    const user = c.get('user')

    const { data: modele, error: modeleError } = await db
      .from('modeles')
      .select('id, designation, type_gamme, actif, familles(nom, type_gamme), modeles_shop(prix_public, visible_shop)')
      .eq('id', id)
      .maybeSingle()

    if (modeleError) {
      console.error('[shop-erp] vitrine modele lookup:', modeleError)
      return c.json({ error: 'Erreur base de donnees', code: 'DB_ERROR', details: modeleError.message }, 500)
    }
    if (!modele) return c.json({ error: 'Modèle introuvable', code: 'NOT_FOUND' }, 404)

    type VitrineActuelle = { prix_public: number; visible_shop: boolean }
    const m = modele as unknown as Omit<ModeleErpRow, 'modeles_shop'> & { modeles_shop: VitrineActuelle | VitrineActuelle[] | null }
    if (resoudreModeCommercial(m, m.familles) !== CommercialMode.STANDARD) {
      return c.json({
        error: 'Seul un modèle STANDARD peut être vendu au panier (configurable → configurateur, sur devis → demande de devis)',
        code:  'MODE_NON_STANDARD',
      }, 422)
    }

    const actuel: VitrineActuelle | null = Array.isArray(m.modeles_shop) ? (m.modeles_shop[0] ?? null) : m.modeles_shop
    const prixFinal    = body.prix_public ?? actuel?.prix_public ?? 0
    const visibleFinal = body.visible_shop ?? actuel?.visible_shop ?? false
    if (visibleFinal && prixFinal <= 0) {
      return c.json({ error: 'Un prix public est requis pour mettre le modèle en vente', code: 'PRIX_REQUIS' }, 422)
    }

    const { data, error } = await db
      .from('modeles_shop')
      .upsert({ modele_id: id, ...body }, { onConflict: 'modele_id' })
      .select()
      .single()

    if (error || !data) {
      console.error('[shop-erp] vitrine modele upsert:', error)
      return c.json({ error: 'Erreur base de donnees', code: 'DB_ERROR', details: error?.message }, 500)
    }

    // §42 — toute modification de prix de vente est tracée
    if (body.prix_public !== undefined && body.prix_public !== (actuel?.prix_public ?? null)) {
      writeAuditLog({
        userId:        user?.id,
        actionType:    'PRIX_VITRINE_MODIFIE',
        module:        'COMMERCIAL',
        resourceType:  'modeles_shop',
        resourceId:    id,
        payloadBefore: { prix_public: actuel?.prix_public ?? null },
        payloadAfter:  { prix_public: body.prix_public },
        ipAddress:     c.req.header('x-forwarded-for') ?? c.req.header('x-real-ip'),
        userAgent:     c.req.header('user-agent'),
      })
    }

    return c.json({ data })
  },
)

shopErpRouter.post('/produits/:id/images', requirePermission('COMMERCIAL', 'UPDATE'), async (c) => {
  const id = c.req.param('id')
  const form = await c.req.formData()
  const files = form.getAll('images').filter(item => item instanceof File) as unknown as File[]

  if (files.length === 0) {
    return c.json({ error: 'Aucune image fournie', code: 'NO_FILE' }, 400)
  }

  const { data: produit, error: produitError } = await db
    .from('produits')
    .select('id')
    .eq('id', id)
    .single()

  if (produitError) {
    console.error('[shop-erp] images produit lookup:', produitError)
    return c.json({ error: 'Erreur base de donnees', code: 'DB_ERROR', details: produitError.message }, 500)
  }
  if (!produit) return c.json({ error: 'Produit introuvable', code: 'NOT_FOUND' }, 404)

  const bucket = 'produits-shop'
  await db.storage.createBucket(bucket, { public: true }).catch(() => {})

  const urls: string[] = []
  const errors: Array<{ file: string; error: string }> = []

  for (const file of files.slice(0, 12)) {
    const contentType = resolveImageContentType(file)
    if (!contentType) {
      errors.push({ file: file.name, error: 'Seuls les fichiers image sont acceptes' })
      continue
    }
    if (file.size > 5 * 1024 * 1024) {
      errors.push({ file: file.name, error: 'Image trop lourde, maximum 5 Mo' })
      continue
    }

    const ext = extFromFile(file)
    const path = `${id}/${Date.now()}-${randomUUID()}.${ext}`
    const buffer = Buffer.from(await file.arrayBuffer())
    const { error } = await db.storage.from(bucket).upload(path, buffer, {
      contentType,
      upsert: false,
    })

    if (error) {
      console.error('[shop-erp] upload image produit:', error)
      errors.push({ file: file.name, error: error.message })
      continue
    }

    const { data } = db.storage.from(bucket).getPublicUrl(path)
    urls.push(data.publicUrl)
  }

  if (urls.length === 0) {
    return c.json({ error: 'Aucune image n\'a pu etre televersee', code: 'ALL_FAILED', errors }, 400)
  }

  return c.json({ data: { urls, errors } }, 201)
})

shopErpRouter.get('/devis-web', requirePermission('COMMERCIAL', 'READ'), async (c) => {
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
  requirePermission('COMMERCIAL', 'UPDATE'),
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
  requirePermission('COMMERCIAL', 'CREATE'),
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

    const clientId = await ensureClient({
      nom:       devisWeb.nom,
      telephone: devisWeb.telephone,
      email:     devisWeb.email ?? null,
      adresse:   null,
      ville:     null,
      type:      'particulier',
    })

    const { data: erpDevis, error: errCreate } = await db
      .from('devis')
      .insert({
        numero,
        client_id:             clientId,
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
  requirePermission('COMMERCIAL', 'VALIDATE'),
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

      await solderCreditsForCommande(cmd.erp_commande_id, null)

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
