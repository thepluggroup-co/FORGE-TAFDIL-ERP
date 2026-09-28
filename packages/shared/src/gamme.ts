// FORGE — Gamme opératoire (Catalogue Hybride Phase 5, §15/§16/§21)
//
// Fonction PURE : transforme les opérations ordonnées d'une fiche technique
// (10 Découpe, 20 Soudage…) en lignes de ressources chiffrées, consommées par
// le moteur existant (devis-calcul.ts) comme n'importe quelle ressource :
//   - main-d'œuvre : temps × coût horaire du poste de travail
//   - machine      : temps × coût horaire de l'équipement
// avec temps = temps unitaire × quantité facturable + temps fixe (préparation,
// compté une seule fois par commande).
//
// Un coût horaire manquant n'est JAMAIS remplacé par 0 : il est signalé, et
// l'appelant refuse le prix automatique plutôt que de sous-chiffrer (§43).

import type { RessourceTechnique } from './devis-calcul'

export interface OperationGamme {
  id: string
  numero: number
  libelle: string
  tempsUnitaireH: number
  tempsFixeH: number
  poste?: { code: string; libelle: string; coutHoraireXaf: number | null } | null
  equipement?: { code: string; designation: string; coutHoraireXaf: number | null } | null
}

export interface TauxHoraireManquant {
  operation: number
  libelle: string
  ressource: string
}

export function ressourcesDepuisGamme(operations: OperationGamme[]): {
  ressources: RessourceTechnique[]
  tauxManquants: TauxHoraireManquant[]
} {
  const ressources: RessourceTechnique[] = []
  const tauxManquants: TauxHoraireManquant[] = []

  for (const op of [...operations].sort((a, b) => a.numero - b.numero)) {
    const intitule = `Op ${op.numero} — ${op.libelle}`

    if (op.poste) {
      if (op.poste.coutHoraireXaf === null || !Number.isFinite(op.poste.coutHoraireXaf)) {
        tauxManquants.push({ operation: op.numero, libelle: op.libelle, ressource: `poste ${op.poste.libelle}` })
      } else {
        ressources.push({
          id: `gamme-${op.id}-mo`,
          type: 'main_oeuvre',
          designation: `${intitule} (${op.poste.libelle})`,
          unite: 'h',
          quantiteParUnite: op.tempsUnitaireH,
          quantiteFixe: op.tempsFixeH,
          coutUnitaireReferenceXaf: op.poste.coutHoraireXaf,
          tempsReferenceH: op.tempsUnitaireH,
        })
      }
    }

    if (op.equipement) {
      if (op.equipement.coutHoraireXaf === null || !Number.isFinite(op.equipement.coutHoraireXaf)) {
        tauxManquants.push({ operation: op.numero, libelle: op.libelle, ressource: `équipement ${op.equipement.designation}` })
      } else {
        ressources.push({
          id: `gamme-${op.id}-machine`,
          type: 'equipement',
          designation: `${intitule} (${op.equipement.designation})`,
          unite: 'h',
          quantiteParUnite: op.tempsUnitaireH,
          quantiteFixe: op.tempsFixeH,
          coutUnitaireReferenceXaf: op.equipement.coutHoraireXaf,
          tempsReferenceH: op.tempsUnitaireH,
        })
      }
    }
  }

  return { ressources, tauxManquants }
}
