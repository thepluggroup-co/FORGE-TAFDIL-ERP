/**
 * configuration.test.ts — Catalogue Hybride Phase 3 (packages/shared/src/configuration.ts)
 *
 * Produit pilote : PORTAIL P003 configurable. Les coûts ci-dessous sont des
 * valeurs DE TEST (fiche technique fictive), pas des coûts réels TAFDIL.
 *
 * Cas pilotes du brief §36 :
 *  - CAS 2 : P003 3 m × 2,2 m, acier, peinture, motorisation, quantité 2 → valide → estimation
 *  - CAS 3 : P003 10 m × 5 m → hors limites → pas de prix automatique (sur devis)
 */

import { describe, it, expect } from 'vitest'
import {
  validerConfiguration, estimerConfiguration, convertirLongueur, resoudreTauxMarge, resumerConfiguration,
  type ParametreConfiguration, type RessourceTechnique,
} from '@forge/shared'

const P003: ParametreConfiguration[] = [
  { code: 'largeur', libelle: 'Largeur', type: 'nombre', obligatoire: true, unite: 'mm', min: 2000, max: 6000, roleCalcul: 'largeur' },
  { code: 'hauteur', libelle: 'Hauteur', type: 'nombre', obligatoire: true, unite: 'mm', min: 1500, max: 2500, roleCalcul: 'hauteur' },
  { code: 'type', libelle: 'Type', type: 'choix', obligatoire: true, valeurs: [
    { code: 'battant', libelle: 'Battant', coutSupplementaireXaf: 0, validationRequise: false },
    { code: 'coulissant', libelle: 'Coulissant', coutSupplementaireXaf: 45000, validationRequise: false },
  ] },
  { code: 'materiau', libelle: 'Matériau', type: 'choix', obligatoire: true, valeurs: [
    { code: 'acier', libelle: 'Acier', coutSupplementaireXaf: 0, validationRequise: false },
  ] },
  { code: 'finition', libelle: 'Finition', type: 'choix', obligatoire: true, valeurs: [
    { code: 'peinture', libelle: 'Peinture', coutSupplementaireXaf: 0, validationRequise: false },
  ] },
  { code: 'couleur', libelle: 'Couleur', type: 'choix', obligatoire: true, valeurs: [
    { code: 'noir', libelle: 'Noir', coutSupplementaireXaf: 0, validationRequise: false },
    { code: 'blanc', libelle: 'Blanc', coutSupplementaireXaf: 0, validationRequise: false },
    { code: 'autre', libelle: 'Autre (à préciser)', coutSupplementaireXaf: 0, validationRequise: true },
  ] },
  { code: 'motorisation', libelle: 'Motorisation', type: 'booleen', obligatoire: false, coutSiOuiXaf: 250000 },
  { code: 'serrure', libelle: 'Serrure', type: 'booleen', obligatoire: false, coutSiOuiXaf: 15000 },
]

// Fiche technique de TEST en mode surface (par m² facturable)
const RESSOURCES: RessourceTechnique[] = [
  { id: 'r1', type: 'materiau',    designation: 'Acier',          unite: 'kg', quantiteParUnite: 20,  coutUnitaireReferenceXaf: 800 },
  { id: 'r2', type: 'main_oeuvre', designation: 'Soudage',        unite: 'h',  quantiteParUnite: 1.5, coutUnitaireReferenceXaf: 2500 },
  { id: 'r3', type: 'equipement',  designation: 'Poste à souder', unite: 'h',  quantiteParUnite: 0.5, coutUnitaireReferenceXaf: 1500 },
]

const CAS_2 = { largeur: 3000, hauteur: 2200, type: 'battant', materiau: 'acier', finition: 'peinture', couleur: 'noir', motorisation: true }

describe('conversion d’unités (§44)', () => {
  it('convertit mm, cm et m explicitement', () => {
    expect(convertirLongueur(3000, 'mm', 'm')).toBe(3)
    expect(convertirLongueur(2.2, 'm', 'mm')).toBe(2200)
    expect(convertirLongueur(250, 'cm', 'm')).toBe(2.5)
  })
})

describe('CAS 2 — P003 3 m × 2,2 m, acier, peinture, motorisation, quantité 2', () => {
  const validation = validerConfiguration(P003, CAS_2, 2)

  it('la configuration est valide et les dimensions sont converties en mètres', () => {
    expect(validation.statut).toBe('valide')
    expect(validation.dimensions).toEqual({ largeur: 3, hauteur: 2.2 })
    expect(validation.valeurs).toMatchObject({ largeur: 3000, motorisation: true, serrure: false })
  })

  it('sépare coût de revient et prix de vente (marge 25 %)', () => {
    const r = estimerConfiguration({ modeleId: 'p003', validation, modeCalcul: 'surface', ressources: RESSOURCES, tauxMargePct: 25 })
    expect(r.disponible).toBe(true)
    if (!r.disponible) return
    const e = r.estimation
    // 3 × 2,2 = 6,6 m² × 2 = 13,2 m² facturables
    expect(e.quantiteFacturable).toBe(13.2)
    expect(e.coutMateriauxXaf).toBe(211200)   // 264 kg × 800
    expect(e.coutMainOeuvreXaf).toBe(49500)   // 19,8 h × 2 500
    expect(e.coutEquipementsXaf).toBe(9900)   // 6,6 h × 1 500
    expect(e.coutOptionsXaf).toBe(500000)     // motorisation 250 000 × 2
    expect(e.coutRevientXaf).toBe(770600)
    expect(e.prixUnitaireHtXaf).toBe(481625)  // 385 300 × 1,25
    expect(e.prixVenteHtXaf).toBe(963250)
    expect(e.margeXaf).toBe(192650)
  })

  it('résume la configuration pour la ligne de devis', () => {
    expect(resumerConfiguration(P003, validation.valeurs)).toBe(
      'Largeur 3000 mm, Hauteur 2200 mm, Type : Battant, Matériau : Acier, Finition : Peinture, Couleur : Noir, Motorisation',
    )
  })
})

describe('CAS 3 — P003 10 m × 5 m', () => {
  it('est hors limites et n’a PAS de prix automatique', () => {
    const validation = validerConfiguration(P003, { ...CAS_2, largeur: 10000, hauteur: 5000 }, 1)
    expect(validation.statut).toBe('hors_limites')
    expect(validation.horsLimites.map((h) => h.parametre)).toEqual(['largeur', 'hauteur'])
    const r = estimerConfiguration({ modeleId: 'p003', validation, modeCalcul: 'surface', ressources: RESSOURCES, tauxMargePct: 25 })
    expect(r).toMatchObject({ disponible: false, raison: 'HORS_LIMITES' })
  })
})

describe('autres statuts de configuration', () => {
  it('invalide : champ obligatoire manquant, valeur inconnue, paramètre inconnu, quantité', () => {
    const v = validerConfiguration(P003, { largeur: 3000, type: 'pivotant', couleur: 'noir', materiau: 'acier', finition: 'peinture', vitrage: true }, 0)
    expect(v.statut).toBe('invalide')
    expect(v.erreurs.map((e) => `${e.parametre}:${e.code}`).sort()).toEqual([
      'hauteur:OBLIGATOIRE', 'quantite:QUANTITE_INVALIDE', 'type:VALEUR_INCONNUE', 'vitrage:PARAMETRE_INCONNU',
    ])
  })

  it('invalide l’emporte sur hors limites', () => {
    const v = validerConfiguration(P003, { ...CAS_2, largeur: 10000, type: 'pivotant' }, 1)
    expect(v.statut).toBe('invalide')
  })

  it('à valider : un choix exige une validation humaine, mais l’estimation reste calculable', () => {
    const v = validerConfiguration(P003, { ...CAS_2, couleur: 'autre' }, 1)
    expect(v.statut).toBe('a_valider')
    expect(v.validationsRequises).toHaveLength(1)
    const r = estimerConfiguration({ modeleId: 'p003', validation: v, modeCalcul: 'surface', ressources: RESSOURCES, tauxMargePct: 25 })
    expect(r.disponible).toBe(true)
  })

  it('refuse un pas non respecté', () => {
    const avecPas = P003.map((p) => p.code === 'largeur' ? { ...p, pas: 100 } : p)
    expect(validerConfiguration(avecPas, { ...CAS_2, largeur: 3050 }, 1).statut).toBe('invalide')
    expect(validerConfiguration(avecPas, { ...CAS_2, largeur: 3100 }, 1).statut).toBe('valide')
  })

  it('accepte une saisie texte avec virgule décimale', () => {
    const avecMetres = P003.map((p) => p.code === 'largeur' ? { ...p, unite: 'm' as const, min: 2, max: 6 } : p)
    const v = validerConfiguration(avecMetres, { ...CAS_2, largeur: '3,5' }, 1)
    expect(v.statut).toBe('valide')
    expect(v.dimensions.largeur).toBe(3.5)
  })
})

describe('estimation indisponible : jamais de prix inventé', () => {
  const validation = validerConfiguration(P003, CAS_2, 1)

  it('sans règle de marge → MARGE_NON_DEFINIE (le coût reste connu en interne)', () => {
    const r = estimerConfiguration({ modeleId: 'p003', validation, modeCalcul: 'surface', ressources: RESSOURCES, tauxMargePct: null })
    expect(r).toMatchObject({ disponible: false, raison: 'MARGE_NON_DEFINIE', coutRevientXaf: 385300 })
  })

  it('sans fiche technique active → FICHE_TECHNIQUE_MANQUANTE', () => {
    expect(estimerConfiguration({ modeleId: 'p003', validation, modeCalcul: null, ressources: [], tauxMargePct: 25 }))
      .toMatchObject({ disponible: false, raison: 'FICHE_TECHNIQUE_MANQUANTE' })
    expect(estimerConfiguration({ modeleId: 'p003', validation, modeCalcul: 'surface', ressources: [], tauxMargePct: 25 }))
      .toMatchObject({ disponible: false, raison: 'FICHE_TECHNIQUE_MANQUANTE' })
  })
})

describe('règle de marge applicable (D4)', () => {
  const regles = [
    { portee: 'global' as const, tauxPct: 20, actif: true },
    { portee: 'famille' as const, familleId: 'portails', tauxPct: 25, actif: true },
    { portee: 'famille' as const, familleId: 'ferronnerie', tauxPct: 30, actif: true },
    { portee: 'modele' as const, modeleId: 'p001', tauxPct: 15, actif: true },
    { portee: 'modele' as const, modeleId: 'p003', tauxPct: 40, actif: false },
  ]

  it('modèle > famille la plus proche > global, règles inactives ignorées', () => {
    expect(resoudreTauxMarge(regles, 'p001', ['portails', 'ferronnerie'])).toBe(15)
    expect(resoudreTauxMarge(regles, 'p003', ['portails', 'ferronnerie'])).toBe(25)
    expect(resoudreTauxMarge(regles, 'p009', ['battants', 'ferronnerie'])).toBe(30)
    expect(resoudreTauxMarge(regles, 'p009', ['autre'])).toBe(20)
    expect(resoudreTauxMarge([], 'p009', [])).toBeNull()
  })
})
