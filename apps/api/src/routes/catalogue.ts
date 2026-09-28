import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { supabaseAdmin } from '@forge/db'
import {
  champsDimensionsPourMode, ModeCalculSchema, TypeRessourceSchema, type ModeCalcul,
  TypeGammeSchema, modeCommercialDepuisTypeGamme, resoudreTypeGamme, verifierPlacementFamille, CommercialMode,
  type TypeGamme, type ArbreFamilles,
} from '@forge/shared'
import { requirePermission } from '../middleware/permission.middleware'
import { writeAuditLog } from '../services/rbacService'
import { chargerModele, chargerParametres, evaluerConfiguration } from '../services/configuration.service'
import type { HonoVariables } from '../types'

// auth middleware already rejects requests when supabaseAdmin is null
const db = supabaseAdmin!

const router = new Hono<{ Variables: HonoVariables }>()

// ── Types ──────────────────────────────────────────────────────────────────────

// Type et règles de mode commercial : source unique dans @forge/shared
// (catalogue-commercial.ts). Réexporté ici pour les imports existants.
export type { TypeGamme }

interface ModeleTypeGammeRow {
  type_gamme: TypeGamme | null
}

interface FamilleTypeGammeRow {
  type_gamme: TypeGamme
}

/**
 * Résout le type_gamme effectif d'un modèle : celui du modèle s'il est
 * renseigné, sinon celui de sa famille (héritage).
 */
export function resolveTypeGamme(modele: ModeleTypeGammeRow, famille: FamilleTypeGammeRow): TypeGamme {
  return resoudreTypeGamme(modele, famille) ?? famille.type_gamme
}

/** Champs de mode ajoutés aux réponses : type_gamme (historique) + commercial_mode (Catalogue Hybride). */
function avecModeCommercial(typeGamme: TypeGamme | null) {
  return typeGamme ? modeCommercialDepuisTypeGamme(typeGamme) : null
}

/**
 * Charge l'arbre id → parent_id de toutes les familles (table de référence
 * courte) pour vérifier profondeur et cycles avant écriture. Réponse
 * inattendue → arbre vide : le contrôle est alors ignoré, jamais bloquant à tort.
 */
async function chargerArbreFamilles(): Promise<ArbreFamilles> {
  const { data } = await db.from('familles').select('id, parent_id')
  const lignes = Array.isArray(data) ? data as Array<{ id: string; parent_id: string | null }> : []
  return new Map(lignes.map((f) => [f.id, f.parent_id ?? null]))
}

// ── Schémas Zod ────────────────────────────────────────────────────────────────

const typeGammeSchema = TypeGammeSchema

const createFamilleSchema = z.object({
  nom:        z.string().min(1).max(200),
  parent_id:  z.string().uuid().nullable().optional(),
  type_gamme: typeGammeSchema,
  ordre:      z.number().int().min(0).default(0),
  actif:      z.boolean().default(true),
})

const updateFamilleSchema = createFamilleSchema.partial()

const createModeleSchema = z.object({
  famille_id:         z.string().uuid(),
  reference:          z.string().min(1).max(50),
  designation:        z.string().min(1).max(200),
  description:        z.string().optional(),
  // 'unite' correspond au code réel seedé dans unites_facturation (§9/10) —
  // voir 20260928_modeles_unite_facturation_fk.sql pour l'historique du bug
  // d'accent ('unité') qui empêchait tout rattachement automatique.
  unite_facturation:  z.string().min(1).default('unite'),
  type_gamme:         typeGammeSchema.optional(),
  actif:              z.boolean().default(true),
})

const updateModeleSchema = createModeleSchema.partial()

const createSpecificationSchema = z.object({
  cle:    z.string().min(1).max(100),
  valeur: z.string().min(1),
  unite:  z.string().optional(),
  ordre:  z.number().int().min(0).default(0),
})

// ── Helpers ────────────────────────────────────────────────────────────────────

function pagination(c: { req: { query: (key?: string) => string | Record<string, string> } }) {
  const page    = Math.max(1, parseInt(String(c.req.query('page') ?? '1')))
  const perPage = Math.min(100, Math.max(1, parseInt(String(c.req.query('per_page') ?? '20'))))
  const from    = (page - 1) * perPage
  const to      = from + perPage - 1
  return { page, perPage, from, to }
}

/**
 * Rattache un modèle au référentiel centralisé unites_facturation (§9/10) à
 * partir de son texte libre, sans changer le contrat de la route (le front
 * continue d'envoyer `unite_facturation` en texte) : `null` si le texte ne
 * correspond à aucun code connu — le modèle reste alors valide, juste sans
 * mode de calcul dérivable automatiquement de son unité.
 */
async function resolveUniteFacturationId(uniteFacturation: string | undefined): Promise<string | null> {
  if (!uniteFacturation) return null
  const { data } = await db
    .from('unites_facturation')
    .select('id')
    .eq('code', uniteFacturation)
    .maybeSingle()
  return (data as { id: string } | null)?.id ?? null
}

// ══════════════════════════════════════════════════════════════════════════════
// FAMILLES
// ══════════════════════════════════════════════════════════════════════════════

/** Liste plate des familles — le front reconstruit l'arbre depuis parent_id */
router.get('/familles', requirePermission('PRODUCTION', 'READ'), async (c) => {
  const { actif } = c.req.query()
  const { page, perPage, from, to } = pagination(c)

  let query = db.from('familles').select('*', { count: 'exact' })
  if (actif !== undefined) query = query.eq('actif', actif === 'true')

  const { data, count, error } = await query
    .order('ordre')
    .order('nom')
    .range(from, to)

  if (error) return c.json({ error: error.message }, 500)

  const familles = ((data ?? []) as Array<Record<string, unknown> & { type_gamme: TypeGamme }>).map((f) => ({
    ...f,
    commercial_mode: avecModeCommercial(f.type_gamme),
  }))

  return c.json({
    data:        familles,
    total:       count ?? 0,
    page,
    per_page:    perPage,
    total_pages: Math.ceil((count ?? 0) / perPage),
  })
})

router.post(
  '/familles',
  requirePermission('PRODUCTION', 'CREATE'),
  zValidator('json', createFamilleSchema),
  async (c) => {
    const body = c.req.valid('json')

    if (body.parent_id) {
      const placement = verifierPlacementFamille(null, body.parent_id, await chargerArbreFamilles())
      if (!placement.ok) return c.json({ error: placement.message, code: placement.code }, 422)
    }

    const { data, error } = await db
      .from('familles')
      .insert(body)
      .select()
      .single()

    if (error) return c.json({ error: error.message, code: error.code }, 400)
    return c.json(data, 201)
  },
)

router.put(
  '/familles/:id',
  requirePermission('PRODUCTION', 'UPDATE'),
  zValidator('json', updateFamilleSchema),
  async (c) => {
    const { id } = c.req.param()
    const body = c.req.valid('json')

    // Seul un changement de parent peut rendre l'arbre trop profond ou cyclique.
    if (body.parent_id !== undefined) {
      const placement = verifierPlacementFamille(id, body.parent_id ?? null, await chargerArbreFamilles())
      if (!placement.ok) return c.json({ error: placement.message, code: placement.code }, 422)
    }

    const { data, error } = await db
      .from('familles')
      .update(body)
      .eq('id', id)
      .select()
      .single()

    if (error) return c.json({ error: error.message, code: error.code }, 400)
    if (!data) return c.json({ error: 'Famille introuvable', code: 'NOT_FOUND' }, 404)
    return c.json(data)
  },
)

// ══════════════════════════════════════════════════════════════════════════════
// MODÈLES
// ══════════════════════════════════════════════════════════════════════════════

router.get('/modeles', requirePermission('PRODUCTION', 'READ'), async (c) => {
  const { famille_id, actif } = c.req.query()
  const { page, perPage, from, to } = pagination(c)

  let query = db.from('modeles').select('*, familles(type_gamme)', { count: 'exact' })
  if (famille_id) query = query.eq('famille_id', famille_id)
  if (actif !== undefined) query = query.eq('actif', actif === 'true')

  const { data, count, error } = await query
    .order('designation')
    .range(from, to)

  if (error) return c.json({ error: error.message }, 500)

  const enriched = (data ?? []).map((m: Record<string, unknown>) => {
    const famille = (m.familles ?? { type_gamme: null }) as FamilleTypeGammeRow
    const typeGammeEffectif = resolveTypeGamme({ type_gamme: (m.type_gamme ?? null) as TypeGamme | null }, famille)
    return {
      ...m,
      type_gamme_effectif:      typeGammeEffectif,
      commercial_mode_effectif: avecModeCommercial(typeGammeEffectif),
    }
  })

  return c.json({
    data:        enriched,
    total:       count ?? 0,
    page,
    per_page:    perPage,
    total_pages: Math.ceil((count ?? 0) / perPage),
  })
})

router.post(
  '/modeles',
  requirePermission('PRODUCTION', 'CREATE'),
  zValidator('json', createModeleSchema),
  async (c) => {
    const body = c.req.valid('json')
    const unite_facturation_id = await resolveUniteFacturationId(body.unite_facturation)

    const { data, error } = await db
      .from('modeles')
      .insert({ ...body, unite_facturation_id })
      .select()
      .single()

    if (error) return c.json({ error: error.message, code: error.code }, 400)
    return c.json(data, 201)
  },
)

router.put(
  '/modeles/:id',
  requirePermission('PRODUCTION', 'UPDATE'),
  zValidator('json', updateModeleSchema),
  async (c) => {
    const { id } = c.req.param()
    const body = c.req.valid('json')
    // Ne recalcule la FK que si l'unité change réellement — un PUT partiel
    // qui ne touche pas unite_facturation ne doit pas écraser le rattachement
    // existant avec `null`.
    const patch = body.unite_facturation !== undefined
      ? { ...body, unite_facturation_id: await resolveUniteFacturationId(body.unite_facturation) }
      : body

    const { data, error } = await db
      .from('modeles')
      .update(patch)
      .eq('id', id)
      .select()
      .single()

    if (error) return c.json({ error: error.message, code: error.code }, 400)
    if (!data) return c.json({ error: 'Modèle introuvable', code: 'NOT_FOUND' }, 404)
    return c.json(data)
  },
)

// ══════════════════════════════════════════════════════════════════════════════
// CONFIGURATION (§34 Master Prompt V3 — GET /products/:id/configuration)
// Ce que le Configurateur (§40, apps/web/src/components/devis/Configurateur.tsx)
// a besoin de savoir AVANT que l'opérateur ne saisisse des dimensions : si une
// fiche technique active existe, quel mode de calcul elle utilise, et donc
// quels champs de dimension sont pertinents pour CE modèle (ex. un mode
// "lineaire" n'a besoin que de la longueur — pas des 6 champs affichés sans
// distinction jusqu'ici). Route de lecture pure, ne déclenche aucun calcul —
// POST /devis/calculate (commerce.ts) reste l'unique endpoint qui chiffre.
// ══════════════════════════════════════════════════════════════════════════════

router.get('/modeles/:id/configuration', requirePermission('PRODUCTION', 'READ'), async (c) => {
  const { id } = c.req.param()

  const { data: modele, error: modeleErr } = await db
    .from('modeles')
    .select('*, familles(type_gamme)')
    .eq('id', id)
    .single()

  if (modeleErr || !modele) return c.json({ error: 'Modèle introuvable', code: 'NOT_FOUND' }, 404)

  const m = modele as Record<string, unknown> & {
    type_gamme?: TypeGamme | null
    familles?: FamilleTypeGammeRow | null
  }
  const famille = m.familles ?? { type_gamme: 'sur_mesure' as TypeGamme }
  const { familles: _familles, ...modeleSansJointure } = m

  const { data: fiche } = await db
    .from('fiche_technique')
    .select('id, version, mode_calcul, unite_facturation_id')
    .eq('modele_id', id)
    .eq('statut', 'active')
    .maybeSingle()

  const ficheTechnique = fiche as { id: string; version: number; mode_calcul: string; unite_facturation_id: string | null } | null
  // Défense en profondeur : mode_calcul est un CHECK constraint en DB, mais on
  // ne fait jamais confiance à une valeur lue en DB sans la revalider ici —
  // une valeur inattendue doit produire une erreur claire, pas un plantage
  // silencieux de champsDimensionsPourMode() sur son switch exhaustif.
  const modeCalculParsed = ficheTechnique ? ModeCalculSchema.safeParse(ficheTechnique.mode_calcul) : null
  const modeCalcul: ModeCalcul | null = modeCalculParsed?.success ? modeCalculParsed.data : null

  const { data: specifications } = await db
    .from('modele_specifications')
    .select('*')
    .eq('modele_id', id)
    .order('ordre')

  const typeGammeEffectif = resolveTypeGamme({ type_gamme: m.type_gamme ?? null }, famille)

  return c.json({
    modele: {
      ...modeleSansJointure,
      type_gamme_effectif:      typeGammeEffectif,
      commercial_mode_effectif: avecModeCommercial(typeGammeEffectif),
    },
    fiche_technique_disponible: Boolean(ficheTechnique),
    mode_calcul:       modeCalcul,
    champs_dimensions: modeCalcul ? champsDimensionsPourMode(modeCalcul) : [],
    specifications:    specifications ?? [],
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// SPÉCIFICATIONS TECHNIQUES
// ══════════════════════════════════════════════════════════════════════════════

router.get('/modeles/:id/specifications', requirePermission('PRODUCTION', 'READ'), async (c) => {
  const { id } = c.req.param()

  const { data, error } = await db
    .from('modele_specifications')
    .select('*')
    .eq('modele_id', id)
    .order('ordre')

  if (error) return c.json({ error: error.message }, 500)
  return c.json({ data, total: data?.length ?? 0 })
})

router.post(
  '/modeles/:id/specifications',
  requirePermission('PRODUCTION', 'CREATE'),
  zValidator('json', createSpecificationSchema),
  async (c) => {
    const { id } = c.req.param()
    const body = c.req.valid('json')

    const { data, error } = await db
      .from('modele_specifications')
      .insert({ ...body, modele_id: id })
      .select()
      .single()

    if (error) return c.json({ error: error.message, code: error.code }, 400)
    return c.json(data, 201)
  },
)

router.delete(
  '/modele-specifications/:id',
  requirePermission('PRODUCTION', 'DELETE'),
  async (c) => {
    const { id } = c.req.param()

    const { error } = await db
      .from('modele_specifications')
      .delete()
      .eq('id', id)

    if (error) return c.json({ error: error.message, code: error.code }, 400)
    return c.body(null, 204)
  },
)

// ══════════════════════════════════════════════════════════════════════════════
// FICHE TECHNIQUE (§14/§15 Master Prompt V3) — recette de fabrication d'un modèle
// ══════════════════════════════════════════════════════════════════════════════

const createFicheTechniqueSchema = z.object({
  mode_calcul: ModeCalculSchema,
  notes:       z.string().optional(),
})

const updateFicheTechniqueSchema = createFicheTechniqueSchema.partial()

const createRessourceSchema = z.object({
  type:                        TypeRessourceSchema,
  // uniquement pour type = materiau — relie la ressource à un vrai article du
  // stock (produits). main_oeuvre/equipement restent en désignation libre
  // (pas de rattachement à la table equipements dans cette première version).
  ressource_produit_id:        z.string().uuid().optional(),
  designation:                 z.string().min(1).max(200),
  unite:                       z.string().min(1).max(30),
  quantite_par_unite:          z.number().positive(),
  cout_unitaire_reference_xaf: z.number().min(0).default(0),
  temps_reference_h:           z.number().min(0).optional(),
  ordre:                       z.number().int().min(0).default(0),
  actif:                       z.boolean().default(true),
}).refine(
  (data) => data.type === 'materiau' || data.ressource_produit_id === undefined,
  { message: 'ressource_produit_id est réservé au type "materiau"', path: ['ressource_produit_id'] },
)

const updateRessourceSchema = z.object({
  ressource_produit_id:        z.string().uuid().nullable().optional(),
  designation:                 z.string().min(1).max(200).optional(),
  unite:                       z.string().min(1).max(30).optional(),
  quantite_par_unite:          z.number().positive().optional(),
  cout_unitaire_reference_xaf: z.number().min(0).optional(),
  temps_reference_h:           z.number().min(0).nullable().optional(),
  ordre:                       z.number().int().min(0).optional(),
  actif:                       z.boolean().optional(),
  // `type` volontairement absent : le changer remettrait en cause la cohérence
  // ressource_produit_id/ressource_equipement_id (contrainte DB) — supprimer
  // puis recréer la ligne est plus sûr qu'une validation partielle ici.
})

router.get('/modeles/:id/fiche-technique', requirePermission('PRODUCTION', 'READ'), async (c) => {
  const { id } = c.req.param()

  const { data, error } = await db
    .from('fiche_technique')
    .select('*')
    .eq('modele_id', id)
    .order('version', { ascending: false })

  if (error) return c.json({ error: error.message }, 500)
  return c.json({ data, total: data?.length ?? 0 })
})

router.post(
  '/modeles/:id/fiche-technique',
  requirePermission('PRODUCTION', 'CREATE'),
  zValidator('json', createFicheTechniqueSchema),
  async (c) => {
    const { id } = c.req.param()
    const body = c.req.valid('json')
    const user = c.get('user')

    const { data: modele, error: modeleErr } = await db.from('modeles').select('id').eq('id', id).maybeSingle()
    if (modeleErr) return c.json({ error: modeleErr.message }, 500)
    if (!modele) return c.json({ error: 'Modèle introuvable', code: 'NOT_FOUND' }, 404)

    // Nouvelle version toujours créée en brouillon — voir POST .../activer pour
    // la faire remplacer l'éventuelle version active (jamais deux à la fois,
    // contrainte imposée en DB par un index unique partiel).
    const { data: derniere } = await db
      .from('fiche_technique')
      .select('version')
      .eq('modele_id', id)
      .order('version', { ascending: false })
      .limit(1)
      .maybeSingle()

    const prochaineVersion = ((derniere as { version: number } | null)?.version ?? 0) + 1

    const { data, error } = await db
      .from('fiche_technique')
      .insert({ modele_id: id, version: prochaineVersion, statut: 'brouillon', ...body, created_by: user.id })
      .select()
      .single()

    if (error) return c.json({ error: error.message, code: error.code }, 400)
    return c.json(data, 201)
  },
)

router.put(
  '/fiche-technique/:id',
  requirePermission('PRODUCTION', 'UPDATE'),
  zValidator('json', updateFicheTechniqueSchema),
  async (c) => {
    const { id } = c.req.param()
    const body = c.req.valid('json')

    const { data, error } = await db
      .from('fiche_technique')
      .update(body)
      .eq('id', id)
      .select()
      .single()

    if (error) return c.json({ error: error.message, code: error.code }, 400)
    if (!data) return c.json({ error: 'Fiche technique introuvable', code: 'NOT_FOUND' }, 404)
    return c.json(data)
  },
)

/**
 * Active une version brouillon : archive l'éventuelle version déjà active du
 * même modèle, puis active celle-ci. Deux écritures séquentielles, pas une
 * vraie transaction (Supabase-js ne le permet pas across-statements sans RPC
 * dédiée — même limitation déjà documentée ailleurs dans ce dépôt, ex.
 * transformer-commande dans commerce.ts) : fenêtre théorique si deux
 * activations concurrentes visaient le même modèle, scénario opérationnel
 * très improbable ici (un seul auteur à la fois sur une fiche technique).
 */
router.post(
  '/fiche-technique/:id/activer',
  requirePermission('PRODUCTION', 'VALIDATE'),
  async (c) => {
    const { id } = c.req.param()

    const { data: cible, error: cibleErr } = await db
      .from('fiche_technique')
      .select('id, modele_id, statut')
      .eq('id', id)
      .maybeSingle()

    if (cibleErr) return c.json({ error: cibleErr.message }, 500)
    if (!cible) return c.json({ error: 'Fiche technique introuvable', code: 'NOT_FOUND' }, 404)

    const c2 = cible as { id: string; modele_id: string; statut: string }
    if (c2.statut === 'active') return c.json({ error: 'Cette fiche technique est déjà active', code: 'DEJA_ACTIVE' }, 409)

    const { count: ressourcesCount } = await db
      .from('fiche_technique_ressources')
      .select('*', { count: 'exact', head: true })
      .eq('fiche_technique_id', id)
      .eq('actif', true)

    if (!ressourcesCount) {
      return c.json({
        error: "Impossible d'activer une fiche technique sans ressource — ajoutez au moins une ligne matériau/main-d'œuvre/équipement.",
        code: 'RESSOURCES_MANQUANTES',
      }, 422)
    }

    const { error: archiveErr } = await db
      .from('fiche_technique')
      .update({ statut: 'archivee' })
      .eq('modele_id', c2.modele_id)
      .eq('statut', 'active')

    if (archiveErr) return c.json({ error: archiveErr.message, code: archiveErr.code }, 400)

    const { data, error } = await db
      .from('fiche_technique')
      .update({ statut: 'active' })
      .eq('id', id)
      .select()
      .single()

    if (error) return c.json({ error: error.message, code: error.code }, 400)
    return c.json(data)
  },
)

router.delete(
  '/fiche-technique/:id',
  requirePermission('PRODUCTION', 'DELETE'),
  async (c) => {
    const { id } = c.req.param()

    const { data: cible } = await db.from('fiche_technique').select('statut').eq('id', id).maybeSingle()
    if (!cible) return c.json({ error: 'Fiche technique introuvable', code: 'NOT_FOUND' }, 404)
    if ((cible as { statut: string }).statut === 'active') {
      return c.json({
        error: "Impossible de supprimer une fiche technique active — activez-en une autre ou archivez-la d'abord.",
        code: 'FICHE_ACTIVE',
      }, 422)
    }

    const { error } = await db.from('fiche_technique').delete().eq('id', id)
    if (error) return c.json({ error: error.message, code: error.code }, 400)
    return c.body(null, 204)
  },
)

// ══════════════════════════════════════════════════════════════════════════════
// RESSOURCES DE LA FICHE TECHNIQUE (matériaux / main-d'œuvre / équipements)
// ══════════════════════════════════════════════════════════════════════════════

router.get('/fiche-technique/:id/ressources', requirePermission('PRODUCTION', 'READ'), async (c) => {
  const { id } = c.req.param()

  const { data, error } = await db
    .from('fiche_technique_ressources')
    .select('*, produits(designation, unite, prix_unitaire_xaf)')
    .eq('fiche_technique_id', id)
    .order('ordre')

  if (error) return c.json({ error: error.message }, 500)
  return c.json({ data, total: data?.length ?? 0 })
})

router.post(
  '/fiche-technique/:id/ressources',
  requirePermission('PRODUCTION', 'CREATE'),
  zValidator('json', createRessourceSchema),
  async (c) => {
    const { id } = c.req.param()
    const body = c.req.valid('json')

    const { data, error } = await db
      .from('fiche_technique_ressources')
      .insert({ ...body, fiche_technique_id: id })
      .select()
      .single()

    if (error) return c.json({ error: error.message, code: error.code }, 400)
    return c.json(data, 201)
  },
)

router.put(
  '/ressources/:id',
  requirePermission('PRODUCTION', 'UPDATE'),
  zValidator('json', updateRessourceSchema),
  async (c) => {
    const { id } = c.req.param()
    const body = c.req.valid('json')

    const { data, error } = await db
      .from('fiche_technique_ressources')
      .update(body)
      .eq('id', id)
      .select()
      .single()

    if (error) return c.json({ error: error.message, code: error.code }, 400)
    if (!data) return c.json({ error: 'Ressource introuvable', code: 'NOT_FOUND' }, 404)
    return c.json(data)
  },
)

router.delete(
  '/ressources/:id',
  requirePermission('PRODUCTION', 'DELETE'),
  async (c) => {
    const { id } = c.req.param()

    const { error } = await db.from('fiche_technique_ressources').delete().eq('id', id)
    if (error) return c.json({ error: error.message, code: error.code }, 400)
    return c.body(null, 204)
  },
)


// ══════════════════════════════════════════════════════════════════════════════
// CONFIGURATEUR — vue INTERNE (Catalogue Hybride Phase 3)
// Coûts d'options, marges et coût de revient : jamais exposés par les routes
// publiques (routes/configurateur.ts) — uniquement ici, derrière RBAC.
// ══════════════════════════════════════════════════════════════════════════════

const valeurParametreSchema = z.object({
  code:                    z.string().regex(/^[a-z0-9][a-z0-9_]{0,39}$/),
  libelle:                 z.string().min(1).max(100),
  cout_supplementaire_xaf: z.number().min(0).default(0),
  validation_requise:      z.boolean().default(false),
})

const parametreSchema = z.object({
  code:            z.string().regex(/^[a-z][a-z0-9_]{0,39}$/, 'code : minuscules, chiffres, _ (ex. largeur)'),
  libelle:         z.string().min(1).max(100),
  type:            z.enum(['nombre', 'choix', 'booleen']),
  obligatoire:     z.boolean().default(true),
  unite:           z.enum(['mm', 'cm', 'm']).nullable().optional(),
  min:             z.number().nullable().optional(),
  max:             z.number().nullable().optional(),
  pas:             z.number().positive().nullable().optional(),
  role_calcul:     z.enum(['largeur', 'hauteur', 'longueur', 'epaisseur', 'diametre', 'poids']).nullable().optional(),
  cout_si_oui_xaf: z.number().min(0).default(0),
  valeurs:         z.array(valeurParametreSchema).max(50).default([]),
}).superRefine((p, ctx) => {
  if (p.min != null && p.max != null && p.min > p.max) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${p.code} : min doit être ≤ max`, path: ['min'] })
  }
  if (p.type === 'choix' && p.valeurs.length === 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${p.code} : un paramètre « choix » doit proposer au moins une valeur`, path: ['valeurs'] })
  }
  if (p.type !== 'nombre' && p.role_calcul) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${p.code} : seul un paramètre « nombre » peut alimenter une dimension de calcul`, path: ['role_calcul'] })
  }
})

const schemaConfigurationBody = z.object({
  parametres: z.array(parametreSchema).max(40).refine(
    (ps) => new Set(ps.map((p) => p.code)).size === ps.length,
    'Chaque paramètre doit avoir un code unique',
  ),
})

/** Schéma complet (coûts inclus) d'un modèle — vue ERP. */
router.get('/modeles/:id/parametres', requirePermission('PRODUCTION', 'READ'), async (c) => {
  const { id } = c.req.param()
  const modele = await chargerModele(id)
  if (!modele) return c.json({ error: 'Modèle introuvable', code: 'NOT_FOUND' }, 404)
  return c.json({ data: await chargerParametres(id), commercial_mode: modele.commercialMode })
})

/**
 * Remplace le schéma de configuration d'un modèle. Les configurations déjà
 * enregistrées n'en dépendent pas (schema_snapshot figé) : l'historique reste intact.
 */
router.put(
  '/modeles/:id/parametres',
  requirePermission('PRODUCTION', 'UPDATE'),
  zValidator('json', schemaConfigurationBody),
  async (c) => {
    const { id } = c.req.param()
    const { parametres } = c.req.valid('json')
    const user = c.get('user')

    const modele = await chargerModele(id)
    if (!modele) return c.json({ error: 'Modèle introuvable', code: 'NOT_FOUND' }, 404)
    if (modele.commercialMode !== CommercialMode.CONFIGURABLE) {
      return c.json({ error: 'Seul un modèle CONFIGURABLE a un schéma de configuration', code: 'MODE_NON_CONFIGURABLE' }, 422)
    }

    const avant = await chargerParametres(id)

    const { error: errDelete } = await db.from('modele_parametres').delete().eq('modele_id', id)
    if (errDelete) return c.json({ error: errDelete.message, code: 'DB_ERROR' }, 500)

    for (const [ordre, p] of parametres.entries()) {
      const { data: cree, error } = await db
        .from('modele_parametres')
        .insert({
          modele_id: id, code: p.code, libelle: p.libelle, type: p.type, obligatoire: p.obligatoire,
          unite: p.type === 'nombre' ? (p.unite ?? null) : null,
          min: p.type === 'nombre' ? (p.min ?? null) : null,
          max: p.type === 'nombre' ? (p.max ?? null) : null,
          pas: p.type === 'nombre' ? (p.pas ?? null) : null,
          role_calcul: p.type === 'nombre' ? (p.role_calcul ?? null) : null,
          cout_si_oui_xaf: p.type === 'booleen' ? p.cout_si_oui_xaf : 0,
          ordre,
        })
        .select('id')
        .single()
      if (error || !cree) return c.json({ error: error?.message ?? 'Insertion impossible', code: 'DB_ERROR' }, 500)

      if (p.type === 'choix' && p.valeurs.length > 0) {
        const { error: errValeurs } = await db.from('modele_parametre_valeurs').insert(
          p.valeurs.map((v, i) => ({ parametre_id: (cree as { id: string }).id, ...v, ordre: i })),
        )
        if (errValeurs) return c.json({ error: errValeurs.message, code: 'DB_ERROR' }, 500)
      }
    }

    // Les coûts d'options influencent les prix : modification tracée.
    writeAuditLog({
      userId: user?.id, actionType: 'SETTINGS_CHANGED', module: 'PRODUCTION',
      resourceType: 'modele_parametres', resourceId: id,
      payloadBefore: avant, payloadAfter: parametres,
    })

    return c.json({ data: await chargerParametres(id) })
  },
)

/** Estimation INTERNE : même calcul que le site, avec coût de revient, marge et détail des ressources. */
router.post(
  '/modeles/:id/estimer',
  requirePermission('PRODUCTION', 'READ'),
  zValidator('json', z.object({
    valeurs:  z.record(z.union([z.string().max(100), z.number(), z.boolean(), z.null()])),
    quantite: z.number().int().positive().max(1000),
  })),
  async (c) => {
    const { id } = c.req.param()
    const body = c.req.valid('json')
    const modele = await chargerModele(id)
    if (!modele) return c.json({ error: 'Modèle introuvable', code: 'NOT_FOUND' }, 404)

    const { validation, estimation, ficheTechniqueId, tauxMargePct } = await evaluerConfiguration(modele, body.valeurs, body.quantite)
    return c.json({ data: { validation, estimation, fiche_technique_id: ficheTechniqueId, taux_marge_pct: tauxMargePct } })
  },
)

// ── Règles de marge (D4 : taux saisi par l'utilisateur) ─────────────────────

const regleMargeSchema = z.object({
  portee:     z.enum(['global', 'famille', 'modele']),
  famille_id: z.string().uuid().nullable().optional(),
  modele_id:  z.string().uuid().nullable().optional(),
  taux_pct:   z.number().min(0).max(500),
  notes:      z.string().max(500).optional(),
}).refine((r) =>
  (r.portee === 'global'  && !r.famille_id && !r.modele_id) ||
  (r.portee === 'famille' && !!r.famille_id && !r.modele_id) ||
  (r.portee === 'modele'  && !!r.modele_id && !r.famille_id),
  { message: 'Cible incohérente : global sans cible, famille avec famille_id, modèle avec modele_id' },
)

router.get('/regles-marge', requirePermission('COMMERCIAL', 'CONFIGURE'), async (c) => {
  const { data, error } = await db
    .from('regles_marge')
    .select('*, familles(nom), modeles(reference, designation)')
    .order('actif', { ascending: false })
    .order('created_at', { ascending: false })
  if (error) return c.json({ error: error.message, code: 'DB_ERROR' }, 500)
  return c.json({ data: data ?? [] })
})

/** Nouvelle règle : remplace (désactive) la règle active de la même cible — l'historique est conservé. */
router.post('/regles-marge', requirePermission('COMMERCIAL', 'CONFIGURE'), zValidator('json', regleMargeSchema), async (c) => {
  const body = c.req.valid('json')
  const user = c.get('user')

  let actuelle = db.from('regles_marge').select('id, taux_pct').eq('portee', body.portee).eq('actif', true)
  actuelle = body.portee === 'famille' ? actuelle.eq('famille_id', body.famille_id!)
    : body.portee === 'modele' ? actuelle.eq('modele_id', body.modele_id!)
    : actuelle
  const { data: precedente } = await actuelle.maybeSingle()

  if (precedente) {
    const { error: errOff } = await db.from('regles_marge').update({ actif: false }).eq('id', (precedente as { id: string }).id)
    if (errOff) return c.json({ error: errOff.message, code: 'DB_ERROR' }, 500)
  }

  const { data, error } = await db
    .from('regles_marge')
    .insert({
      portee: body.portee, famille_id: body.famille_id ?? null, modele_id: body.modele_id ?? null,
      taux_pct: body.taux_pct, notes: body.notes ?? null, actif: true, created_by: user?.id ?? null,
    })
    .select()
    .single()
  if (error) return c.json({ error: error.message, code: error.code }, 400)

  writeAuditLog({
    userId: user?.id, actionType: 'MARGE_MODIFIEE', module: 'COMMERCIAL',
    resourceType: 'regles_marge', resourceId: (data as { id: string }).id,
    payloadBefore: precedente ? { taux_pct: (precedente as { taux_pct: number }).taux_pct } : null,
    payloadAfter: { portee: body.portee, famille_id: body.famille_id ?? null, modele_id: body.modele_id ?? null, taux_pct: body.taux_pct },
  })

  return c.json(data, 201)
})

router.delete('/regles-marge/:id', requirePermission('COMMERCIAL', 'CONFIGURE'), async (c) => {
  const { id } = c.req.param()
  const user = c.get('user')
  const { data, error } = await db.from('regles_marge').update({ actif: false }).eq('id', id).select('id, taux_pct').maybeSingle()
  if (error) return c.json({ error: error.message, code: 'DB_ERROR' }, 500)
  if (!data) return c.json({ error: 'Règle introuvable', code: 'NOT_FOUND' }, 404)
  writeAuditLog({
    userId: user?.id, actionType: 'MARGE_MODIFIEE', module: 'COMMERCIAL',
    resourceType: 'regles_marge', resourceId: id,
    payloadBefore: { taux_pct: (data as { taux_pct: number }).taux_pct, actif: true }, payloadAfter: { actif: false },
  })
  return c.body(null, 204)
})

// ── Configurations enregistrées (vue interne) ───────────────────────────────

router.get('/configurations', requirePermission('COMMERCIAL', 'READ'), async (c) => {
  const { statut } = c.req.query()
  const { page, perPage, from, to } = pagination(c)
  let query = db
    .from('configurations')
    .select('*, modeles(reference, designation), devis(numero, statut)', { count: 'exact' })
  if (statut) query = query.eq('statut', statut)
  const { data, count, error } = await query.order('created_at', { ascending: false }).range(from, to)
  if (error) return c.json({ error: error.message, code: 'DB_ERROR' }, 500)
  return c.json({ data: data ?? [], total: count ?? 0, page, per_page: perPage, total_pages: Math.ceil((count ?? 0) / perPage) })
})

export { router as catalogueRouter }
