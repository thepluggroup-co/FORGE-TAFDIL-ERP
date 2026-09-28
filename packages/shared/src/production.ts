// FORGE — Fabrication d'un OF (Catalogue Hybride Phase 7, §24/§25)
//
// Un ordre de fabrication reprend la gamme de la fiche technique FIGÉE au devis :
//   - étapes (opérations 10, 20, 30…) avec poste, équipement et temps prévu
//     = temps unitaire × quantité facturable + temps fixe ;
//   - consommations prévues (matières, consommables)
//     = quantité par unité × quantité facturable + quantité fixe.
// On y saisit ensuite le réel (temps passé par étape, quantités consommées).
// Fonctions PURES : l'API les utilise pour planifier et contrôler, l'ERP pour afficher.

import { arrondirQuantite } from './devis-calcul'

export const STATUTS_OPERATION_OF = ['a_faire', 'en_cours', 'terminee', 'sautee'] as const
export type StatutOperationOF = typeof STATUTS_OPERATION_OF[number]

const TRANSITIONS_OPERATION: Record<StatutOperationOF, StatutOperationOF[]> = {
  a_faire:  ['en_cours', 'sautee'],
  en_cours: ['terminee', 'a_faire'],
  terminee: ['en_cours'],            // réouverture pour correction, tracée par l'horodatage
  sautee:   ['a_faire'],
}

export function transitionsOperationOF(statut: string): StatutOperationOF[] {
  return (TRANSITIONS_OPERATION as Record<string, StatutOperationOF[]>)[statut] ?? []
}

export function transitionOperationAutorisee(de: string, vers: StatutOperationOF): boolean {
  return transitionsOperationOF(de).includes(vers)
}

export const LIBELLES_STATUT_OPERATION: Record<StatutOperationOF, string> = {
  a_faire:  'À faire',
  en_cours: 'En cours',
  terminee: 'Terminée',
  sautee:   'Sautée',
}

// ── Planification ─────────────────────────────────────────────────────────────

export interface OperationGammeSource {
  id: string
  numero: number
  libelle: string
  tempsUnitaireH: number
  tempsFixeH: number
  poste?: { id: string; libelle: string; coutHoraireXaf: number | null } | null
  equipement?: { id: string; designation: string; coutHoraireXaf: number | null } | null
}

export interface RessourceMatiereSource {
  id: string
  type: 'materiau' | 'consommable'
  designation: string
  unite: string
  produitId: string | null
  quantiteParUnite: number
  quantiteFixe?: number | null
  coutUnitaireReferenceXaf: number
}

export interface OperationPlanifiee {
  gammeOperationId: string
  numero: number
  libelle: string
  posteId: string | null
  posteLibelle: string | null
  equipementId: string | null
  equipementDesignation: string | null
  tempsPrevuH: number
  /** Taux horaires figés au lancement (contrôle des coûts, Phase 8). */
  coutHorairePosteXaf: number | null
  coutHoraireEquipementXaf: number | null
}

export interface ConsommationPlanifiee {
  ressourceId: string
  type: 'materiau' | 'consommable'
  designation: string
  unite: string
  produitId: string | null
  quantitePrevue: number
  coutUnitaireReferenceXaf: number
}

export type ResultatPlanification =
  | { ok: true; operations: OperationPlanifiee[]; consommations: ConsommationPlanifiee[] }
  | { ok: false; code: 'QUANTITE_INVALIDE' | 'GAMME_VIDE'; message: string }

/**
 * Plan de fabrication d'un OF : étapes et consommations prévues pour une
 * quantité facturable donnée (m², ml, pièces… selon la fiche).
 */
export function planifierOF(
  quantiteFacturable: number,
  operations: OperationGammeSource[],
  ressources: RessourceMatiereSource[],
): ResultatPlanification {
  if (!Number.isFinite(quantiteFacturable) || quantiteFacturable <= 0) {
    return { ok: false, code: 'QUANTITE_INVALIDE', message: 'La quantité facturable doit être strictement positive.' }
  }
  if (operations.length === 0 && ressources.length === 0) {
    return { ok: false, code: 'GAMME_VIDE', message: 'La fiche technique ne définit ni opération ni matière.' }
  }

  const ops: OperationPlanifiee[] = [...operations]
    .sort((a, b) => a.numero - b.numero)
    .map((o) => ({
      gammeOperationId:         o.id,
      numero:                   o.numero,
      libelle:                  o.libelle,
      posteId:                  o.poste?.id ?? null,
      posteLibelle:             o.poste?.libelle ?? null,
      equipementId:             o.equipement?.id ?? null,
      equipementDesignation:    o.equipement?.designation ?? null,
      tempsPrevuH:              arrondirQuantite(o.tempsUnitaireH * quantiteFacturable + o.tempsFixeH),
      coutHorairePosteXaf:      o.poste?.coutHoraireXaf ?? null,
      coutHoraireEquipementXaf: o.equipement?.coutHoraireXaf ?? null,
    }))

  const consommations: ConsommationPlanifiee[] = ressources.map((r) => ({
    ressourceId:              r.id,
    type:                     r.type,
    designation:              r.designation,
    unite:                    r.unite,
    produitId:                r.produitId,
    quantitePrevue:           arrondirQuantite(r.quantiteParUnite * quantiteFacturable + (r.quantiteFixe ?? 0)),
    coutUnitaireReferenceXaf: r.coutUnitaireReferenceXaf,
  }))

  return { ok: true, operations: ops, consommations }
}

// ── Suivi ─────────────────────────────────────────────────────────────────────

export interface EtatOperationOF {
  statut: string
  temps_prevu_h: number | null
  temps_reel_h: number | null
}

/**
 * Avancement de l'OF (0–100) pondéré par les temps prévus : une étape de 6 h
 * pèse plus qu'une étape de 30 min. Les étapes sautées sont retirées du calcul.
 * Sans temps prévus, chaque étape compte pour une part égale.
 */
export function avancementDepuisOperations(operations: EtatOperationOF[]): number {
  const retenues = operations.filter((o) => o.statut !== 'sautee')
  if (retenues.length === 0) return operations.length > 0 ? 100 : 0

  const poids = (o: EtatOperationOF) => Number(o.temps_prevu_h ?? 0)
  const total = retenues.reduce((s, o) => s + poids(o), 0)
  const faites = retenues.filter((o) => o.statut === 'terminee')
  const pct = total > 0
    ? faites.reduce((s, o) => s + poids(o), 0) / total
    : faites.length / retenues.length
  return Math.round(pct * 100)
}

export interface ResumeFabrication {
  tempsPrevuH: number
  tempsReelH: number
  operationsTerminees: number
  operationsTotal: number
  consommationsSaisies: number
  consommationsTotal: number
}

export function resumerFabrication(
  operations: EtatOperationOF[],
  consommations: Array<{ quantite_reelle: number | null }>,
): ResumeFabrication {
  const retenues = operations.filter((o) => o.statut !== 'sautee')
  return {
    tempsPrevuH:          arrondirQuantite(retenues.reduce((s, o) => s + Number(o.temps_prevu_h ?? 0), 0)),
    tempsReelH:           arrondirQuantite(operations.reduce((s, o) => s + Number(o.temps_reel_h ?? 0), 0)),
    operationsTerminees:  operations.filter((o) => o.statut === 'terminee').length,
    operationsTotal:      retenues.length,
    consommationsSaisies: consommations.filter((c) => c.quantite_reelle !== null).length,
    consommationsTotal:   consommations.length,
  }
}
