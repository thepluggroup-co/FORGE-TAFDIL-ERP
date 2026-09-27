import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { supabaseAdmin } from '@forge/db'
import {
  champsDimensionsPourMode, ModeCalculSchema, TypeRessourceSchema, type ModeCalcul,
  TypeGammeSchema, modeCommercialDepuisTypeGamme, resoudreTypeGamme, verifierPlacementFamille,
  type TypeGamme, type ArbreFamilles,
} from '@forge/shared'
import { requirePermission } from '../middleware/permission.middleware'
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

export { router as catalogueRouter }
