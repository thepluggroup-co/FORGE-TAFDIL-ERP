/**
 * cost-engine.test.ts — Catalogue Hybride Phase 4 : coût de revient complet
 *
 * COÛT DE REVIENT = matières + consommables + main-d'œuvre + équipements
 *                 + sous-traitance + options + frais indirects + transport + installation
 * PRIX DE VENTE   = coût de revient × (1 + marge)
 *
 * Cas connu calculé à la main (valeurs DE TEST, pas des coûts TAFDIL réels) :
 * Portail P003 3 m × 2,2 m, quantité 2 → 13,2 m² facturables.
 */

import { describe, it, expect } from 'vitest'
import {
  calculerDevisBrut, validerConfiguration, estimerConfiguration,
  selectionnerFraisIndirects, calculerFraisIndirects,
  type ParametreConfiguration, type RessourceTechnique, type RegleFraisIndirects,
} from '@forge/shared'

const PARAMETRES: ParametreConfiguration[] = [
  { code: 'largeur', libelle: 'Largeur', type: 'nombre', obligatoire: true, unite: 'mm', min: 2000, max: 6000, roleCalcul: 'largeur' },
  { code: 'hauteur', libelle: 'Hauteur', type: 'nombre', obligatoire: true, unite: 'mm', min: 1500, max: 2500, roleCalcul: 'hauteur' },
  { code: 'motorisation', libelle: 'Motorisation', type: 'booleen', obligatoire: false, coutSiOuiXaf: 250000 },
  { code: 'pose', libelle: 'Pose sur site', type: 'booleen', obligatoire: false, coutSiOuiXaf: 40000, categorieCout: 'installation' },
  { code: 'zone', libelle: 'Zone de livraison', type: 'choix', obligatoire: true, valeurs: [
    { code: 'retrait', libelle: 'Retrait atelier', coutSupplementaireXaf: 0, validationRequise: false, categorieCout: 'transport', coutParCommande: true },
    { code: 'douala', libelle: 'Douala', coutSupplementaireXaf: 25000, validationRequise: false, categorieCout: 'transport', coutParCommande: true },
  ] },
]

const RESSOURCES: RessourceTechnique[] = [
  { id: 'r1', type: 'materiau',       designation: 'Acier',            unite: 'kg', quantiteParUnite: 20,  coutUnitaireReferenceXaf: 800 },
  { id: 'r2', type: 'consommable',    designation: 'Électrodes',       unite: 'kg', quantiteParUnite: 0.1, coutUnitaireReferenceXaf: 3000 },
  { id: 'r3', type: 'main_oeuvre',    designation: 'Soudage',          unite: 'h',  quantiteParUnite: 1.5, coutUnitaireReferenceXaf: 2500 },
  { id: 'r4', type: 'equipement',     designation: 'Poste à souder',   unite: 'h',  quantiteParUnite: 0.5, coutUnitaireReferenceXaf: 1500 },
  { id: 'r5', type: 'sous_traitance', designation: 'Galvanisation',    unite: 'm²', quantiteParUnite: 1,   coutUnitaireReferenceXaf: 2000, delaiJours: 5 },
]

const FRAIS: RegleFraisIndirects[] = [
  { id: 'f1', libelle: 'Frais atelier',        centreCout: 'ATELIER', mode: 'pourcentage',       valeur: 12, base: 'main_oeuvre', portee: 'global', actif: true },
  { id: 'f2', libelle: 'Administration',       centreCout: 'ADMIN',   mode: 'pourcentage',       valeur: 5,  base: 'cout_direct', portee: 'global', actif: true },
  { id: 'f3', libelle: 'Dossier de commande',  centreCout: 'ADMIN',   mode: 'fixe_par_commande', valeur: 10000,                   portee: 'global', actif: true },
]

describe('moteur de coût direct (fiche technique)', () => {
  it('sépare matières, consommables, main-d’œuvre, équipements et sous-traitance', () => {
    const r = calculerDevisBrut({ modeleId: 'p003', modeCalcul: 'surface', quantite: 2, dimensions: { largeur: 3, hauteur: 2.2 } }, RESSOURCES)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.proposition).toMatchObject({
      quantiteFacturable:    13.2,
      totalMateriauxXaf:     211200,  // 264 kg × 800
      totalConsommablesXaf:  3960,    // 1,32 kg × 3 000
      totalMainOeuvreXaf:    49500,   // 19,8 h × 2 500
      totalEquipementsXaf:   9900,    // 6,6 h × 1 500
      totalSousTraitanceXaf: 26400,   // 13,2 m² × 2 000
      delaiSousTraitanceJours: 5,
      totalHtXaf:            300960,
    })
  })

  it('rétrocompatible : une fiche sans consommable ni sous-traitance garde exactement le même total', () => {
    const anciens = RESSOURCES.filter((r) => ['materiau', 'main_oeuvre', 'equipement'].includes(r.type))
    const r = calculerDevisBrut({ modeleId: 'p003', modeCalcul: 'surface', quantite: 2, dimensions: { largeur: 3, hauteur: 2.2 } }, anciens)
    if (!r.ok) throw new Error('calcul impossible')
    expect(r.proposition.totalHtXaf).toBe(270600)
    expect(r.proposition).toMatchObject({ totalConsommablesXaf: 0, totalSousTraitanceXaf: 0, delaiSousTraitanceJours: null })
  })
})

describe('coût de revient complet et prix de vente — cas connu', () => {
  const validation = validerConfiguration(PARAMETRES, { largeur: 3000, hauteur: 2200, motorisation: true, pose: true, zone: 'douala' }, 2)
  const r = estimerConfiguration({ modeleId: 'p003', validation, modeCalcul: 'surface', ressources: RESSOURCES, tauxMargePct: 25, fraisIndirects: FRAIS })

  it('ventile chaque poste de coût', () => {
    expect(validation.statut).toBe('valide')
    expect(r.disponible).toBe(true)
    if (!r.disponible) return
    expect(r.estimation).toMatchObject({
      coutMateriauxXaf:     211200,
      coutConsommablesXaf:  3960,
      coutMainOeuvreXaf:    49500,
      coutEquipementsXaf:   9900,
      coutSousTraitanceXaf: 26400,
      coutOptionsXaf:       500000,  // motorisation 250 000 × 2 (par unité)
      coutInstallationXaf:  80000,   // pose 40 000 × 2 (par unité)
      coutTransportXaf:     25000,   // Douala, une fois par commande
      fraisIndirectsXaf:    55988,   // 5 940 + 40 048 + 10 000
      delaiSousTraitanceJours: 5,
    })
  })

  it('applique chaque frais indirect sur son assiette (le coût direct exclut transport et installation)', () => {
    if (!r.disponible) throw new Error('estimation indisponible')
    expect(r.estimation.lignesFraisIndirects.map((l) => [l.libelle, l.montantXaf])).toEqual([
      ['Frais atelier', 5940],        // 12 % de 49 500
      ['Administration', 40048],      // 5 % de 800 960 (300 960 + 500 000)
      ['Dossier de commande', 10000],
    ])
  })

  it('coût de revient 961 948, prix de vente 1 202 436 (marge 25 %)', () => {
    if (!r.disponible) throw new Error('estimation indisponible')
    expect(r.estimation.coutRevientXaf).toBe(961948)
    expect(r.estimation.prixUnitaireHtXaf).toBe(601218)  // arrondi(480 974 × 1,25 = 601 217,5)
    expect(r.estimation.prixVenteHtXaf).toBe(1202436)
    expect(r.estimation.margeXaf).toBe(240488)
  })

  it('le transport forfaitaire ne double pas avec la quantité', () => {
    const v4 = validerConfiguration(PARAMETRES, { largeur: 3000, hauteur: 2200, zone: 'douala' }, 4)
    const r4 = estimerConfiguration({ modeleId: 'p003', validation: v4, modeCalcul: 'surface', ressources: RESSOURCES, tauxMargePct: 25 })
    if (!r4.disponible) throw new Error('estimation indisponible')
    expect(r4.estimation.coutTransportXaf).toBe(25000)
  })

  it('sans frais indirects : Phase 3 inchangée (même calcul qu’avant la Phase 4)', () => {
    const v = validerConfiguration(PARAMETRES, { largeur: 3000, hauteur: 2200, motorisation: true, zone: 'retrait' }, 2)
    const anciens = RESSOURCES.filter((x) => ['materiau', 'main_oeuvre', 'equipement'].includes(x.type))
    const e = estimerConfiguration({ modeleId: 'p003', validation: v, modeCalcul: 'surface', ressources: anciens, tauxMargePct: 25 })
    if (!e.disponible) throw new Error('estimation indisponible')
    expect(e.estimation.coutRevientXaf).toBe(770600)
    expect(e.estimation.prixVenteHtXaf).toBe(963250)
  })
})

describe('frais indirects : sélection et calcul', () => {
  const REGLES: RegleFraisIndirects[] = [
    { id: 'g',  libelle: 'Global',         mode: 'pourcentage', valeur: 5, base: 'cout_direct', portee: 'global', actif: true },
    { id: 'f',  libelle: 'Ferronnerie',    mode: 'pourcentage', valeur: 3, base: 'main_oeuvre', portee: 'famille', familleId: 'ferronnerie', actif: true },
    { id: 'm',  libelle: 'P003',           mode: 'fixe_par_unite', valeur: 1000, portee: 'modele', modeleId: 'p003', actif: true },
    { id: 'x',  libelle: 'Autre modèle',   mode: 'fixe_par_unite', valeur: 9999, portee: 'modele', modeleId: 'p001', actif: true },
    { id: 'o',  libelle: 'Inactif',        mode: 'fixe_par_commande', valeur: 9999, portee: 'global', actif: false },
    { id: 'p',  libelle: 'Expiré',         mode: 'fixe_par_commande', valeur: 9999, portee: 'global', actif: true, dateFin: '2026-06-30' },
    { id: 'fu', libelle: 'Futur',          mode: 'fixe_par_commande', valeur: 9999, portee: 'global', actif: true, dateDebut: '2027-01-01' },
  ]

  it('cumule global + famille ascendante + modèle, dans la période, règles inactives ignorées', () => {
    const ids = selectionnerFraisIndirects(REGLES, 'p003', ['portails', 'ferronnerie'], '2026-10-01').map((r) => r.id)
    expect(ids).toEqual(['g', 'f', 'm'])
  })

  it('calcule pourcentage, fixe par unité et fixe par commande', () => {
    const lignes = calculerFraisIndirects([
      { id: 'a', libelle: 'a', mode: 'pourcentage', valeur: 10, base: 'materiaux', portee: 'global', actif: true },
      { id: 'b', libelle: 'b', mode: 'fixe_par_unite', valeur: 1500, portee: 'global', actif: true },
      { id: 'c', libelle: 'c', mode: 'fixe_par_commande', valeur: 7000, portee: 'global', actif: true },
    ], { cout_direct: 100000, main_oeuvre: 20000, materiaux: 55555 }, 3)
    expect(lignes.map((l) => l.montantXaf)).toEqual([5556, 4500, 7000])  // 10 % de 55 555 arrondi
  })
})
