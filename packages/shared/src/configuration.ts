// FORGE — Produits CONFIGURABLES : schéma de configuration, validation, estimation
// (Catalogue Hybride Phase 3 — pilote Portail P003)
//
// Fonctions PURES, sans accès DB ni I/O : la couche API charge le schéma du
// modèle, la fiche technique active et la règle de marge, puis appelle ce module.
//
// Principes :
// - §12 : une configuration est VALIDE, INVALIDE, À VALIDER (humain) ou HORS
//   LIMITES. Hors limites → aucun prix automatique, bascule en SUR DEVIS.
// - §13 : le COÛT DE REVIENT (moteur existant devis-calcul.ts + options) et le
//   PRIX DE VENTE (coût × (1 + marge)) ne sont jamais confondus. La marge est un
//   taux saisi par l'utilisateur (décision D4) : sans taux, pas de prix auto.
// - §44 : unités de longueur converties explicitement vers le mètre, unité du
//   moteur de calcul. Jamais de 3 m / 3000 mm mélangés implicitement.
// - §45 : montants XAF arrondis à l'entier (arrondirXaf), règle unique.

import {
  arrondirXaf, arrondirQuantite, calculerDevisBrut,
  type Dimensions, type ModeCalcul, type RessourceTechnique, type RessourceCalculee,
} from './devis-calcul'

// ── Unités de longueur (§44) ────────────────────────────────────────────

export const UNITES_LONGUEUR = { mm: 0.001, cm: 0.01, m: 1 } as const
export type UniteLongueur = keyof typeof UNITES_LONGUEUR

export function convertirLongueur(valeur: number, de: UniteLongueur, vers: UniteLongueur): number {
  return arrondirQuantite((valeur * UNITES_LONGUEUR[de]) / UNITES_LONGUEUR[vers])
}

// ── Schéma de configuration d'un modèle ─────────────────────────────────

export type TypeParametre = 'nombre' | 'choix' | 'booleen'

/** Dimension du moteur de calcul alimentée par un paramètre numérique. */
export type RoleCalcul = 'largeur' | 'hauteur' | 'longueur' | 'epaisseur' | 'diametre' | 'poids'

/** Nature d'un coût porté par un paramètre de configuration (Catalogue Hybride Phase 4). */
export type CategorieCout = 'option' | 'transport' | 'installation'

export interface ValeurParametre {
  code: string
  libelle: string
  /** Coût de revient ajouté PAR UNITÉ commandée (interne, jamais exposé au client). */
  coutSupplementaireXaf: number
  /** Ce choix exige une validation humaine (ex. couleur « autre »). */
  validationRequise: boolean
  /** Nature du coût : option produit (défaut), transport ou installation (Phase 4). */
  categorieCout?: CategorieCout
  /** true : coût forfaitaire par commande ; false (défaut) : coût par unité commandée. */
  coutParCommande?: boolean
}

export interface ParametreConfiguration {
  code: string
  libelle: string
  type: TypeParametre
  obligatoire: boolean
  /** nombre : unité de SAISIE (mm, cm, m) pour une longueur ; null pour un nombre sans unité de longueur. */
  unite?: UniteLongueur | null
  /** nombre : limites fabricables, exprimées dans `unite`. Hors de ces bornes → HORS LIMITES. */
  min?: number | null
  max?: number | null
  pas?: number | null
  roleCalcul?: RoleCalcul | null
  /** choix : valeurs autorisées. */
  valeurs?: ValeurParametre[]
  /** booleen : coût de revient ajouté par unité si l'option est cochée. */
  coutSiOuiXaf?: number | null
  /** booleen : nature et assiette du coût si coché (Phase 4). */
  categorieCout?: CategorieCout
  coutParCommande?: boolean
}

export type StatutConfiguration = 'valide' | 'invalide' | 'a_valider' | 'hors_limites'

export type CodeErreurConfiguration =
  | 'OBLIGATOIRE' | 'TYPE_INVALIDE' | 'VALEUR_INCONNUE' | 'PAS_INVALIDE' | 'QUANTITE_INVALIDE' | 'PARAMETRE_INCONNU'

export interface ErreurConfiguration { parametre: string; code: CodeErreurConfiguration; message: string }
export interface DepassementLimite { parametre: string; valeur: number; min: number | null; max: number | null; unite: string | null }
export interface ValidationRequise { parametre: string; raison: string }
export interface Supplement {
  parametre: string
  libelle: string
  coutUnitaireXaf: number
  categorie: CategorieCout
  /** Coût forfaitaire compté une seule fois, quelle que soit la quantité. */
  parCommande: boolean
}

export interface ResultatValidation {
  statut: StatutConfiguration
  erreurs: ErreurConfiguration[]
  horsLimites: DepassementLimite[]
  validationsRequises: ValidationRequise[]
  /** Valeurs retenues, telles que saisies (unité de saisie), pour l'affichage et le snapshot. */
  valeurs: Record<string, number | string | boolean>
  /** Dimensions converties en mètres (kg pour le poids) pour le moteur de calcul. */
  dimensions: Dimensions
  supplements: Supplement[]
  quantite: number
}

const EPSILON = 1e-9

/**
 * Valide une saisie client contre le schéma du modèle.
 * Priorité du statut : invalide > hors_limites > a_valider > valide.
 */
export function validerConfiguration(
  parametres: ParametreConfiguration[],
  saisie: Record<string, unknown>,
  quantite: number,
): ResultatValidation {
  const erreurs: ErreurConfiguration[] = []
  const horsLimites: DepassementLimite[] = []
  const validationsRequises: ValidationRequise[] = []
  const valeurs: Record<string, number | string | boolean> = {}
  const dimensions: Dimensions = {}
  const supplements: Supplement[] = []

  if (!Number.isInteger(quantite) || quantite <= 0) {
    erreurs.push({ parametre: 'quantite', code: 'QUANTITE_INVALIDE', message: 'La quantité doit être un entier strictement positif.' })
  }

  const codesConnus = new Set(parametres.map((p) => p.code))
  for (const cle of Object.keys(saisie)) {
    if (!codesConnus.has(cle)) {
      erreurs.push({ parametre: cle, code: 'PARAMETRE_INCONNU', message: `Paramètre « ${cle} » inconnu pour ce modèle.` })
    }
  }

  for (const p of parametres) {
    const brut = saisie[p.code]
    const absent = brut === undefined || brut === null || brut === ''

    if (absent) {
      if (p.type === 'booleen') { valeurs[p.code] = false; continue }
      if (p.obligatoire) erreurs.push({ parametre: p.code, code: 'OBLIGATOIRE', message: `« ${p.libelle} » est obligatoire.` })
      continue
    }

    if (p.type === 'nombre') {
      const n = typeof brut === 'number' ? brut : typeof brut === 'string' ? Number(brut.replace(',', '.')) : Number.NaN
      if (!Number.isFinite(n) || n <= 0) {
        erreurs.push({ parametre: p.code, code: 'TYPE_INVALIDE', message: `« ${p.libelle} » doit être un nombre strictement positif.` })
        continue
      }
      valeurs[p.code] = n
      const min = p.min ?? null
      const max = p.max ?? null
      if ((min !== null && n < min - EPSILON) || (max !== null && n > max + EPSILON)) {
        horsLimites.push({ parametre: p.code, valeur: n, min, max, unite: p.unite ?? null })
      } else if (p.pas && p.pas > 0) {
        const base = min ?? 0
        const ecart = (n - base) / p.pas
        if (Math.abs(ecart - Math.round(ecart)) > 1e-6) {
          erreurs.push({ parametre: p.code, code: 'PAS_INVALIDE', message: `« ${p.libelle} » doit être un multiple de ${p.pas}${p.unite ? ` ${p.unite}` : ''}.` })
        }
      }
      if (p.roleCalcul) {
        dimensions[p.roleCalcul] = p.roleCalcul !== 'poids' && p.unite
          ? convertirLongueur(n, p.unite, 'm')
          : n
      }
      continue
    }

    if (p.type === 'choix') {
      const code = String(brut)
      const choix = (p.valeurs ?? []).find((v) => v.code === code)
      if (!choix) {
        erreurs.push({ parametre: p.code, code: 'VALEUR_INCONNUE', message: `Valeur « ${code} » non proposée pour « ${p.libelle} ».` })
        continue
      }
      valeurs[p.code] = code
      if (choix.coutSupplementaireXaf > 0) {
        supplements.push({
          parametre: p.code, libelle: `${p.libelle} : ${choix.libelle}`, coutUnitaireXaf: choix.coutSupplementaireXaf,
          categorie: choix.categorieCout ?? 'option', parCommande: choix.coutParCommande ?? false,
        })
      }
      if (choix.validationRequise) {
        validationsRequises.push({ parametre: p.code, raison: `« ${p.libelle} : ${choix.libelle} » nécessite une validation technique.` })
      }
      continue
    }

    // booleen
    if (typeof brut !== 'boolean') {
      erreurs.push({ parametre: p.code, code: 'TYPE_INVALIDE', message: `« ${p.libelle} » doit valoir oui ou non.` })
      continue
    }
    valeurs[p.code] = brut
    if (brut && (p.coutSiOuiXaf ?? 0) > 0) {
      supplements.push({
        parametre: p.code, libelle: p.libelle, coutUnitaireXaf: p.coutSiOuiXaf ?? 0,
        categorie: p.categorieCout ?? 'option', parCommande: p.coutParCommande ?? false,
      })
    }
  }

  const statut: StatutConfiguration =
    erreurs.length > 0 ? 'invalide'
    : horsLimites.length > 0 ? 'hors_limites'
    : validationsRequises.length > 0 ? 'a_valider'
    : 'valide'

  return { statut, erreurs, horsLimites, validationsRequises, valeurs, dimensions, supplements, quantite }
}

// ── Estimation indisponible : jamais de prix inventé ─────────────────────

export type RaisonEstimationIndisponible =
  | 'CONFIGURATION_INVALIDE'
  | 'HORS_LIMITES'
  | 'FICHE_TECHNIQUE_MANQUANTE'
  | 'CALCUL_IMPOSSIBLE'
  | 'MARGE_NON_DEFINIE'

// ── Frais indirects paramétrables (§19, Phase 4) ─────────────────────────
// Jamais codés en dur : chaque règle est saisie dans l'ERP (taux ou montant,
// assiette, centre de coût, période, portée). Contrairement à la marge, les
// règles applicables S'ADDITIONNENT (ex. atelier 12 % de la main-d'œuvre +
// administration 5 % du coût direct).

export type ModeFraisIndirects = 'pourcentage' | 'fixe_par_unite' | 'fixe_par_commande'

/** Assiette d'un frais en pourcentage. */
export type BaseFraisIndirects = 'cout_direct' | 'main_oeuvre' | 'materiaux'

export interface RegleFraisIndirects {
  id: string
  libelle: string
  centreCout?: string | null
  mode: ModeFraisIndirects
  valeur: number
  base?: BaseFraisIndirects | null
  portee: 'global' | 'famille' | 'modele'
  familleId?: string | null
  modeleId?: string | null
  dateDebut?: string | null   // AAAA-MM-JJ inclus
  dateFin?: string | null     // AAAA-MM-JJ inclus
  actif: boolean
}

export interface LigneFraisIndirects {
  regleId: string
  libelle: string
  centreCout: string | null
  mode: ModeFraisIndirects
  base: BaseFraisIndirects | null
  valeur: number
  montantXaf: number
}

/**
 * Règles de frais indirects qui s'appliquent à un modèle à une date donnée :
 * actives, dans leur période, et de portée globale, de la famille (ou d'une
 * famille ascendante) ou du modèle lui-même. Elles se cumulent.
 */
export function selectionnerFraisIndirects(
  regles: RegleFraisIndirects[],
  modeleId: string,
  famillesAscendantes: string[],
  dateIso: string,
): RegleFraisIndirects[] {
  const familles = new Set(famillesAscendantes)
  return regles.filter((r) =>
    r.actif
    && (!r.dateDebut || r.dateDebut <= dateIso)
    && (!r.dateFin || r.dateFin >= dateIso)
    && (r.portee === 'global'
      || (r.portee === 'famille' && !!r.familleId && familles.has(r.familleId))
      || (r.portee === 'modele' && r.modeleId === modeleId)))
}

/** Montant de chaque frais indirect, arrondi à l'entier XAF, dans l'ordre des règles. */
export function calculerFraisIndirects(
  regles: RegleFraisIndirects[],
  bases: Record<BaseFraisIndirects, number>,
  quantite: number,
): LigneFraisIndirects[] {
  return regles.map((r) => {
    const montantXaf =
      r.mode === 'pourcentage'      ? arrondirXaf((bases[r.base ?? 'cout_direct'] * r.valeur) / 100)
      : r.mode === 'fixe_par_unite' ? arrondirXaf(r.valeur * quantite)
      : arrondirXaf(r.valeur)
    return {
      regleId: r.id, libelle: r.libelle, centreCout: r.centreCout ?? null,
      mode: r.mode, base: r.mode === 'pourcentage' ? (r.base ?? 'cout_direct') : null,
      valeur: r.valeur, montantXaf,
    }
  })
}

// ── Estimation : coût de revient complet puis prix de vente (§13) ────────

export interface EstimationInterne {
  // Coût direct de fabrication (fiche technique)
  coutMateriauxXaf: number
  coutConsommablesXaf: number
  coutMainOeuvreXaf: number
  coutEquipementsXaf: number
  coutSousTraitanceXaf: number
  /** Options produit choisies (catégorie « option »). */
  coutOptionsXaf: number
  // Hors fabrication
  fraisIndirectsXaf: number
  coutTransportXaf: number
  coutInstallationXaf: number
  /**
   * COÛT DE REVIENT = matières + consommables + main-d'œuvre + équipements
   * + sous-traitance + options + frais indirects + transport + installation
   */
  coutRevientXaf: number
  tauxMargePct: number
  margeXaf: number
  prixUnitaireHtXaf: number
  prixVenteHtXaf: number
  quantiteFacturable: number
  formuleUtilisee: string
  delaiSousTraitanceJours: number | null
  lignesRessources: RessourceCalculee[]
  lignesFraisIndirects: LigneFraisIndirects[]
  supplements: Supplement[]
}

export type ResultatEstimation =
  | { disponible: true; estimation: EstimationInterne }
  | { disponible: false; raison: RaisonEstimationIndisponible; message: string; coutRevientXaf?: number }

/** Coût total d'une catégorie de suppléments : par unité × quantité, ou une fois par commande. */
function totalSupplements(supplements: Supplement[], categorie: CategorieCout, quantite: number): number {
  return arrondirXaf(supplements
    .filter((s) => s.categorie === categorie)
    .reduce((total, s) => total + s.coutUnitaireXaf * (s.parCommande ? 1 : quantite), 0))
}

/**
 * Estime le prix de vente d'une configuration VALIDE ou À VALIDER.
 *
 * - coût direct = fiche technique active (matières, consommables, main-d'œuvre,
 *   équipements, sous-traitance) + options
 * - frais indirects = règles applicables, sur leur assiette (le coût direct ne
 *   comprend ni transport ni installation)
 * - coût de revient = coût direct + frais indirects + transport + installation
 * - prix unitaire HT = arrondi(coût de revient unitaire × (1 + marge / 100))
 * - prix de vente HT = prix unitaire × quantité (cohérent avec une ligne de devis)
 */
export function estimerConfiguration(args: {
  modeleId: string
  validation: ResultatValidation
  modeCalcul: ModeCalcul | null
  ressources: RessourceTechnique[]
  tauxMargePct: number | null
  /** Règles déjà filtrées par selectionnerFraisIndirects (Phase 4). */
  fraisIndirects?: RegleFraisIndirects[]
}): ResultatEstimation {
  const { validation } = args
  if (validation.statut === 'invalide') {
    return { disponible: false, raison: 'CONFIGURATION_INVALIDE', message: 'La configuration contient des erreurs.' }
  }
  if (validation.statut === 'hors_limites') {
    return { disponible: false, raison: 'HORS_LIMITES', message: 'Cette configuration sort des dimensions standard : elle sera chiffrée sur devis.' }
  }
  if (!args.modeCalcul) {
    return { disponible: false, raison: 'FICHE_TECHNIQUE_MANQUANTE', message: 'Aucune fiche technique active : le prix sera établi par nos équipes.' }
  }

  const brut = calculerDevisBrut(
    { modeleId: args.modeleId, modeCalcul: args.modeCalcul, quantite: validation.quantite, dimensions: validation.dimensions },
    args.ressources,
  )
  if (!brut.ok) {
    const manque = brut.erreurs.some((e) => e.code === 'RESSOURCES_MANQUANTES')
    return {
      disponible: false,
      raison: manque ? 'FICHE_TECHNIQUE_MANQUANTE' : 'CALCUL_IMPOSSIBLE',
      message: brut.erreurs.map((e) => e.message).join(' '),
    }
  }

  const p = brut.proposition
  const q = validation.quantite
  const coutOptionsXaf      = totalSupplements(validation.supplements, 'option', q)
  const coutTransportXaf    = totalSupplements(validation.supplements, 'transport', q)
  const coutInstallationXaf = totalSupplements(validation.supplements, 'installation', q)
  const coutDirectXaf       = arrondirXaf(p.totalHtXaf + coutOptionsXaf)

  const lignesFraisIndirects = calculerFraisIndirects(args.fraisIndirects ?? [], {
    cout_direct: coutDirectXaf,
    main_oeuvre: p.totalMainOeuvreXaf,
    materiaux:   p.totalMateriauxXaf + p.totalConsommablesXaf,
  }, q)
  const fraisIndirectsXaf = arrondirXaf(lignesFraisIndirects.reduce((s, l) => s + l.montantXaf, 0))

  const coutRevientXaf = arrondirXaf(coutDirectXaf + fraisIndirectsXaf + coutTransportXaf + coutInstallationXaf)

  if (args.tauxMargePct === null || !Number.isFinite(args.tauxMargePct)) {
    return {
      disponible: false, raison: 'MARGE_NON_DEFINIE', coutRevientXaf,
      message: 'Aucune règle de marge applicable : le prix sera établi par nos équipes.',
    }
  }

  const prixUnitaireHtXaf = arrondirXaf((coutRevientXaf / q) * (1 + args.tauxMargePct / 100))
  const prixVenteHtXaf = prixUnitaireHtXaf * q

  return {
    disponible: true,
    estimation: {
      coutMateriauxXaf:     p.totalMateriauxXaf,
      coutConsommablesXaf:  p.totalConsommablesXaf,
      coutMainOeuvreXaf:    p.totalMainOeuvreXaf,
      coutEquipementsXaf:   p.totalEquipementsXaf,
      coutSousTraitanceXaf: p.totalSousTraitanceXaf,
      coutOptionsXaf,
      fraisIndirectsXaf,
      coutTransportXaf,
      coutInstallationXaf,
      coutRevientXaf,
      tauxMargePct:         args.tauxMargePct,
      margeXaf:             prixVenteHtXaf - coutRevientXaf,
      prixUnitaireHtXaf,
      prixVenteHtXaf,
      quantiteFacturable:   p.quantiteFacturable,
      formuleUtilisee:      p.formuleUtilisee,
      delaiSousTraitanceJours: p.delaiSousTraitanceJours,
      lignesRessources:     p.lignes,
      lignesFraisIndirects,
      supplements:          validation.supplements,
    },
  }
}

// ── Règle de marge applicable (D4 : taux saisi par l'utilisateur) ───────

export interface RegleMarge {
  portee: 'global' | 'famille' | 'modele'
  familleId?: string | null
  modeleId?: string | null
  tauxPct: number
  actif: boolean
}

/** Priorité : modèle > famille (la plus proche en remontant l'arbre) > global. `null` si aucune. */
export function resoudreTauxMarge(
  regles: RegleMarge[],
  modeleId: string,
  famillesAscendantes: string[],
): number | null {
  const actives = regles.filter((r) => r.actif)
  const duModele = actives.find((r) => r.portee === 'modele' && r.modeleId === modeleId)
  if (duModele) return duModele.tauxPct
  for (const familleId of famillesAscendantes) {
    const deLaFamille = actives.find((r) => r.portee === 'famille' && r.familleId === familleId)
    if (deLaFamille) return deLaFamille.tauxPct
  }
  return actives.find((r) => r.portee === 'global')?.tauxPct ?? null
}

/** Libellé lisible d'une configuration, pour une ligne de devis (ex. « 3000 × 2200 mm, battant, motorisation »). */
export function resumerConfiguration(parametres: ParametreConfiguration[], valeurs: ResultatValidation['valeurs']): string {
  return parametres
    .map((p) => {
      const v = valeurs[p.code]
      if (v === undefined || v === false) return null
      if (p.type === 'booleen') return p.libelle
      if (p.type === 'choix') return `${p.libelle} : ${p.valeurs?.find((x) => x.code === v)?.libelle ?? v}`
      return `${p.libelle} ${v}${p.unite ? ` ${p.unite}` : ''}`
    })
    .filter(Boolean)
    .join(', ')
}
