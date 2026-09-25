// FORGE — Moteur de calcul de devis (MASTER PROMPT V3 §12/§13)
//
// Fonctions PURES, déterministes, sans accès DB ni I/O. Le service DB
// (apps/api/src/services/devis-calculation.service.ts) charge la fiche
// technique et les ressources, puis appelle uniquement ce module.
//
// §19 — Le devis produit ici est un DEVIS BRUT : aucune TVA, aucune remise.
// Ces éléments n'interviennent qu'au stade facture, hors périmètre de ce
// module.
//
// §44 — Règle d'arrondi explicite (aucune n'existait avant ce module) :
//   - montants XAF  : arrondis à l'entier le plus proche (le FCFA n'a pas
//     de sous-unité utilisée en pratique — convention déjà suivie ailleurs
//     dans le dépôt, ex. commerce.ts:calculerTotaux)
//   - quantités techniques (m², kg, h...) : arrondies à 3 décimales pour
//     éliminer le bruit de virgule flottante, jamais pour "faire joli"

import { z } from 'zod'

// ── Types ────────────────────────────────────────────────────────────────

export const ModeCalculSchema = z.enum([
  'quantitatif', 'surface', 'lineaire', 'volume', 'poids', 'forfait', 'qualitatif',
])
export type ModeCalcul = z.infer<typeof ModeCalculSchema>

export const DimensionsSchema = z.object({
  largeur:   z.number().positive().optional(),
  hauteur:   z.number().positive().optional(),
  longueur:  z.number().positive().optional(),
  epaisseur: z.number().positive().optional(),
  diametre:  z.number().positive().optional(),
  poids:     z.number().positive().optional(),
  surface:   z.number().positive().optional(), // saisie directe, si l'utilisateur connaît déjà la surface
  volume:    z.number().positive().optional(), // saisie directe
}).partial()
export type Dimensions = z.infer<typeof DimensionsSchema>

export const TypeRessourceSchema = z.enum(['materiau', 'main_oeuvre', 'equipement'])
export type TypeRessource = z.infer<typeof TypeRessourceSchema>

/** Une ligne de fiche_technique_ressources, telle que chargée depuis la DB. */
export interface RessourceTechnique {
  id: string
  type: TypeRessource
  designation: string
  unite: string
  quantiteParUnite: number          // ex : 4 (kg d'acier) par unité de quantité facturable
  coutUnitaireReferenceXaf: number
  tempsReferenceH?: number | null
}

export interface DevisCalculInput {
  produitId: string
  modeCalcul: ModeCalcul
  quantite: number                  // nombre de pièces/forfaits demandés (ex : 2 barrières identiques)
  dimensions?: Dimensions
  options?: Record<string, unknown>
}

export interface RessourceCalculee {
  ressourceId: string
  type: TypeRessource
  designation: string
  unite: string
  quantiteCalculee: number
  coutUnitaireXaf: number
  totalXaf: number
  tempsCalculeH?: number
}

export interface PropositionDevis {
  produitId: string
  modeCalcul: ModeCalcul
  quantiteFacturable: number
  formuleUtilisee: string
  configSnapshot: { dimensions?: Dimensions; quantite: number; options?: Record<string, unknown> }
  lignes: RessourceCalculee[]
  totalMateriauxXaf: number
  totalMainOeuvreXaf: number
  totalEquipementsXaf: number
  totalHtXaf: number   // §19 : devis brut, HT, sans TVA ni remise
}

export type CodeErreurDevis =
  | 'QUANTITE_INVALIDE'
  | 'DIMENSIONS_MANQUANTES'
  | 'DIMENSIONS_INVALIDES'
  | 'RESSOURCES_MANQUANTES'

export interface ErreurDevis {
  code: CodeErreurDevis
  message: string
}

export type ResultatDevis =
  | { ok: true; proposition: PropositionDevis }
  | { ok: false; erreurs: ErreurDevis[] }

// ── Arrondis (§44) ──────────────────────────────────────────────────────

export function arrondirXaf(montant: number): number {
  return Math.round(montant)
}

export function arrondirQuantite(quantite: number): number {
  return Math.round(quantite * 1000) / 1000
}

// ── Étape 1 : quantité facturable selon le mode de calcul (§12) ─────────

export function calculerQuantiteFacturable(
  modeCalcul: ModeCalcul,
  dimensions: Dimensions | undefined,
  quantite: number,
): { ok: true; quantiteFacturable: number; formule: string } | { ok: false; erreurs: ErreurDevis[] } {
  if (!Number.isFinite(quantite) || quantite <= 0) {
    return { ok: false, erreurs: [{ code: 'QUANTITE_INVALIDE', message: 'La quantité doit être un nombre strictement positif.' }] }
  }

  const d = dimensions ?? {}

  switch (modeCalcul) {
    case 'quantitatif':
      return { ok: true, quantiteFacturable: arrondirQuantite(quantite), formule: 'quantité saisie' }

    case 'forfait':
      return { ok: true, quantiteFacturable: arrondirQuantite(quantite), formule: 'forfait × quantité' }

    case 'surface': {
      const surfaceUnitaire = d.surface ?? (d.largeur && d.hauteur ? d.largeur * d.hauteur : undefined)
      if (surfaceUnitaire === undefined) {
        return { ok: false, erreurs: [{ code: 'DIMENSIONS_MANQUANTES', message: 'Surface : fournir « surface », ou « largeur » et « hauteur ».' }] }
      }
      if (surfaceUnitaire <= 0) {
        return { ok: false, erreurs: [{ code: 'DIMENSIONS_INVALIDES', message: 'La surface calculée doit être positive.' }] }
      }
      return {
        ok: true,
        quantiteFacturable: arrondirQuantite(surfaceUnitaire * quantite),
        formule: `${d.surface ? 'surface saisie' : `largeur(${d.largeur}) × hauteur(${d.hauteur})`} × quantité(${quantite})`,
      }
    }

    case 'lineaire': {
      if (d.longueur === undefined) {
        return { ok: false, erreurs: [{ code: 'DIMENSIONS_MANQUANTES', message: 'Linéaire : fournir « longueur ».' }] }
      }
      return { ok: true, quantiteFacturable: arrondirQuantite(d.longueur * quantite), formule: `longueur(${d.longueur}) × quantité(${quantite})` }
    }

    case 'volume': {
      const volumeUnitaire = d.volume ?? (d.longueur && d.largeur && d.hauteur ? d.longueur * d.largeur * d.hauteur : undefined)
      if (volumeUnitaire === undefined) {
        return { ok: false, erreurs: [{ code: 'DIMENSIONS_MANQUANTES', message: 'Volume : fournir « volume », ou « longueur », « largeur » et « hauteur ».' }] }
      }
      if (volumeUnitaire <= 0) {
        return { ok: false, erreurs: [{ code: 'DIMENSIONS_INVALIDES', message: 'Le volume calculé doit être positif.' }] }
      }
      return {
        ok: true,
        quantiteFacturable: arrondirQuantite(volumeUnitaire * quantite),
        formule: `${d.volume ? 'volume saisi' : `longueur(${d.longueur}) × largeur(${d.largeur}) × hauteur(${d.hauteur})`} × quantité(${quantite})`,
      }
    }

    case 'poids': {
      if (d.poids === undefined) {
        return { ok: false, erreurs: [{ code: 'DIMENSIONS_MANQUANTES', message: 'Poids : fournir « poids » (kg). Le calcul depuis un volume × densité n\'est pas pris en charge dans ce moteur — donnée non définie dans le dépôt.' }] }
      }
      return { ok: true, quantiteFacturable: arrondirQuantite(d.poids * quantite), formule: `poids(${d.poids}) × quantité(${quantite})` }

    }

    case 'qualitatif':
      // §12 : « évalué selon une configuration spécifique, sans formule géométrique imposée ».
      // Aucun barème de coefficients (standard/premium...) n'existe dans le schéma actuel —
      // on traite donc la quantité comme une saisie directe, sans inventer de coefficient.
      return { ok: true, quantiteFacturable: arrondirQuantite(quantite), formule: 'quantité saisie (mode qualitatif — pas de formule géométrique)' }

    default: {
      // Exhaustivité : si un 8e mode est ajouté à ModeCalculSchema sans être traité
      // ici, cette ligne casse la compilation au lieu de planter silencieusement en prod.
      const modeNonTraite: never = modeCalcul
      return { ok: false, erreurs: [{ code: 'DIMENSIONS_INVALIDES', message: `Mode de calcul non pris en charge : ${String(modeNonTraite)}` }] }
    }
  }
}

// ── Étape 2 : application de la fiche technique aux ressources (§16) ────

export function calculerRessources(
  quantiteFacturable: number,
  ressources: RessourceTechnique[],
): RessourceCalculee[] {
  return ressources.map((r) => {
    const quantiteCalculee = arrondirQuantite(r.quantiteParUnite * quantiteFacturable)
    const totalXaf = arrondirXaf(quantiteCalculee * r.coutUnitaireReferenceXaf)
    const ligne: RessourceCalculee = {
      ressourceId: r.id,
      type: r.type,
      designation: r.designation,
      unite: r.unite,
      quantiteCalculee,
      coutUnitaireXaf: r.coutUnitaireReferenceXaf,
      totalXaf,
    }
    if (r.tempsReferenceH != null) {
      ligne.tempsCalculeH = arrondirQuantite(r.tempsReferenceH * quantiteFacturable)
    }
    return ligne
  })
}

// ── Étape 3 : assemblage de la proposition de devis brut ────────────────

export function calculerDevisBrut(
  input: DevisCalculInput,
  ressourcesDisponibles: RessourceTechnique[],
): ResultatDevis {
  const etape1 = calculerQuantiteFacturable(input.modeCalcul, input.dimensions, input.quantite)
  if (!etape1.ok) return { ok: false, erreurs: etape1.erreurs }

  if (ressourcesDisponibles.length === 0) {
    return {
      ok: false,
      erreurs: [{ code: 'RESSOURCES_MANQUANTES', message: 'Aucune ressource définie sur la fiche technique active de ce produit — impossible de chiffrer.' }],
    }
  }

  const lignes = calculerRessources(etape1.quantiteFacturable, ressourcesDisponibles)

  const totalMateriauxXaf   = arrondirXaf(lignes.filter((l) => l.type === 'materiau').reduce((s, l) => s + l.totalXaf, 0))
  const totalMainOeuvreXaf  = arrondirXaf(lignes.filter((l) => l.type === 'main_oeuvre').reduce((s, l) => s + l.totalXaf, 0))
  const totalEquipementsXaf = arrondirXaf(lignes.filter((l) => l.type === 'equipement').reduce((s, l) => s + l.totalXaf, 0))

  return {
    ok: true,
    proposition: {
      produitId: input.produitId,
      modeCalcul: input.modeCalcul,
      quantiteFacturable: etape1.quantiteFacturable,
      formuleUtilisee: etape1.formule,
      configSnapshot: { dimensions: input.dimensions, quantite: input.quantite, options: input.options },
      lignes,
      totalMateriauxXaf,
      totalMainOeuvreXaf,
      totalEquipementsXaf,
      // §19 : total HT brut du travail, sans TVA ni remise (appliquées plus tard, à la facture)
      totalHtXaf: arrondirXaf(totalMateriauxXaf + totalMainOeuvreXaf + totalEquipementsXaf),
    },
  }
}
