// FORGE — Mode commercial et hiérarchie du catalogue (Catalogue Hybride, Phase 1)
//
// Source UNIQUE pour :
//   - les trois parcours client : STANDARD (acheter), CONFIGURABLE
//     (personnaliser), QUOTE (demander un devis) ;
//   - leur correspondance avec la colonne existante `type_gamme`
//     ('catalogue' | 'configuration' | 'sur_mesure'), conservée telle quelle en
//     base (décision D3 : aucune migration de données) ;
//   - la hiérarchie Catégorie → Famille → Sous-famille portée par l'arbre
//     `familles.parent_id` (décision D2).
//
// Fonctions PURES, sans accès DB — voir ARCHITECTURE/COMMERCIAL_MODES.md.

import { z } from 'zod'

// ── Mode commercial ─────────────────────────────────────────────────────

export const CommercialMode = {
  STANDARD:     'STANDARD',
  CONFIGURABLE: 'CONFIGURABLE',
  QUOTE:        'QUOTE',
} as const
export type CommercialMode = typeof CommercialMode[keyof typeof CommercialMode]

export const CommercialModeSchema = z.enum([
  CommercialMode.STANDARD, CommercialMode.CONFIGURABLE, CommercialMode.QUOTE,
])

/** Valeurs historiques stockées en base (familles.type_gamme, modeles.type_gamme). */
export const TYPES_GAMME = ['catalogue', 'configuration', 'sur_mesure'] as const
export const TypeGammeSchema = z.enum(TYPES_GAMME)
export type TypeGamme = z.infer<typeof TypeGammeSchema>

const TYPE_GAMME_VERS_MODE: Record<TypeGamme, CommercialMode> = {
  catalogue:     CommercialMode.STANDARD,
  configuration: CommercialMode.CONFIGURABLE,
  sur_mesure:    CommercialMode.QUOTE,
}

const MODE_VERS_TYPE_GAMME: Record<CommercialMode, TypeGamme> = {
  STANDARD:     'catalogue',
  CONFIGURABLE: 'configuration',
  QUOTE:        'sur_mesure',
}

export function modeCommercialDepuisTypeGamme(typeGamme: TypeGamme): CommercialMode {
  return TYPE_GAMME_VERS_MODE[typeGamme]
}

export function typeGammeDepuisModeCommercial(mode: CommercialMode): TypeGamme {
  return MODE_VERS_TYPE_GAMME[mode]
}

/**
 * type_gamme effectif d'un modèle : le sien s'il est renseigné, sinon celui
 * de sa famille. Le mode vit au niveau du MODÈLE (P001 standard et P003
 * configurable peuvent cohabiter dans la famille « Portail ») ; la famille ne
 * fournit qu'une valeur par défaut.
 *
 * `null` si ni le modèle ni la famille ne le renseignent (famille non jointe).
 */
export function resoudreTypeGamme(
  modele:  { type_gamme: TypeGamme | null | undefined },
  famille: { type_gamme: TypeGamme | null | undefined } | null | undefined,
): TypeGamme | null {
  return modele.type_gamme ?? famille?.type_gamme ?? null
}

export function resoudreModeCommercial(
  modele:  { type_gamme: TypeGamme | null | undefined },
  famille: { type_gamme: TypeGamme | null | undefined } | null | undefined,
): CommercialMode | null {
  const typeGamme = resoudreTypeGamme(modele, famille)
  return typeGamme ? modeCommercialDepuisTypeGamme(typeGamme) : null
}

/** Libellés affichés — interne (ERP) et action proposée au client (site TAFDIL). */
export const LIBELLES_MODE_COMMERCIAL: Record<CommercialMode, { libelle: string; actionClient: string }> = {
  STANDARD:     { libelle: 'Standard',     actionClient: 'Acheter' },
  CONFIGURABLE: { libelle: 'Configurable', actionClient: 'Personnaliser' },
  QUOTE:        { libelle: 'Sur devis',    actionClient: 'Demander un devis' },
}

// ── Hiérarchie : Catégorie → Famille → Sous-famille ─────────────────────
// Profondeur 1 = racine (catégorie). Au-delà de 3 niveaux, l'arbre est refusé
// à l'écriture par l'API ; les modèles peuvent se rattacher à n'importe quel niveau.

export const PROFONDEUR_MAX_FAMILLES = 3
export const LIBELLES_NIVEAU_FAMILLE = ['Catégorie', 'Famille', 'Sous-famille'] as const

export function libelleNiveauFamille(profondeur: number): string {
  return LIBELLES_NIVEAU_FAMILLE[profondeur - 1] ?? `Niveau ${profondeur}`
}

/** id → parent_id de toutes les familles connues. */
export type ArbreFamilles = ReadonlyMap<string, string | null>

/**
 * Profondeur d'une famille (1 pour une racine). `null` si la famille est
 * inconnue, si un ancêtre manque, ou si la chaîne des parents boucle.
 */
export function profondeurFamille(id: string, arbre: ArbreFamilles): number | null {
  const vus = new Set<string>()
  let courant: string | null = id
  let profondeur = 0
  while (courant !== null) {
    if (vus.has(courant) || !arbre.has(courant)) return null
    vus.add(courant)
    profondeur++
    courant = arbre.get(courant) ?? null
  }
  return profondeur
}

/** Nombre de niveaux du sous-arbre enraciné en `id` (1 = feuille). */
export function hauteurSousArbre(id: string, arbre: ArbreFamilles): number {
  const enfants = new Map<string, string[]>()
  for (const [enfant, parent] of arbre) {
    if (parent !== null) enfants.set(parent, [...(enfants.get(parent) ?? []), enfant])
  }
  const vus = new Set<string>()
  const hauteur = (noeud: string): number => {
    if (vus.has(noeud)) return 0 // cycle déjà présent en base : on ne boucle pas
    vus.add(noeud)
    return 1 + Math.max(0, ...(enfants.get(noeud) ?? []).map(hauteur))
  }
  return hauteur(id)
}

export type ErreurHierarchie = 'PROFONDEUR_MAX_DEPASSEE' | 'CYCLE_HIERARCHIE'

/**
 * Vérifie qu'on peut placer la famille `id` (ou une nouvelle famille si `id`
 * est null) sous `parentId`. Un parent absent de l'arbre n'est pas jugé ici :
 * la contrainte FK de la base tranche (erreur 23503 déjà gérée par l'API).
 */
export function verifierPlacementFamille(
  id: string | null,
  parentId: string | null,
  arbre: ArbreFamilles,
): { ok: true } | { ok: false; code: ErreurHierarchie; message: string } {
  if (parentId === null) {
    // Une racine : seule la hauteur du sous-arbre déplacé compte.
    const hauteur = id ? hauteurSousArbre(id, arbre) : 1
    return hauteur <= PROFONDEUR_MAX_FAMILLES
      ? { ok: true }
      : { ok: false, code: 'PROFONDEUR_MAX_DEPASSEE', message: `La hiérarchie est limitée à ${PROFONDEUR_MAX_FAMILLES} niveaux (${LIBELLES_NIVEAU_FAMILLE.join(' → ')}).` }
  }

  if (id !== null) {
    // Le nouveau parent ne doit être ni la famille elle-même ni un de ses descendants.
    let courant: string | null = parentId
    const vus = new Set<string>()
    while (courant !== null && !vus.has(courant)) {
      if (courant === id) {
        return { ok: false, code: 'CYCLE_HIERARCHIE', message: 'Une famille ne peut pas être placée sous elle-même ou sous une de ses sous-familles.' }
      }
      vus.add(courant)
      courant = arbre.get(courant) ?? null
    }
  }

  const profondeurParent = profondeurFamille(parentId, arbre)
  if (profondeurParent === null) return { ok: true }

  const hauteur = id ? hauteurSousArbre(id, arbre) : 1
  if (profondeurParent + hauteur > PROFONDEUR_MAX_FAMILLES) {
    return {
      ok: false,
      code: 'PROFONDEUR_MAX_DEPASSEE',
      message: `La hiérarchie est limitée à ${PROFONDEUR_MAX_FAMILLES} niveaux (${LIBELLES_NIVEAU_FAMILLE.join(' → ')}).`,
    }
  }
  return { ok: true }
}
