/**
 * gamme.test.ts — Catalogue Hybride Phase 5 : gamme opératoire et taux horaires
 *
 * Cas connu calculé à la main (valeurs DE TEST) : portail 3 m × 2,2 m,
 * quantité 2 → 13,2 m² facturables.
 *   Op 10 Découpe  : 0,2 h/m² + 0,5 h de préparation = 3,14 h
 *                    poste Découpeur 2 000/h → 6 280 ; plasma 3 000/h → 9 420
 *   Op 20 Soudage  : 1,5 h/m² = 19,8 h ; soudeur 2 500/h → 49 500 ; MIG 1 500/h → 29 700
 *   Op 30 Peinture : 0,3 h/m² + 1 h = 4,96 h ; peintre 2 000/h → 9 920
 */

import { describe, it, expect } from 'vitest'
import { calculerDevisBrut, ressourcesDepuisGamme, type OperationGamme, type RessourceTechnique } from '@forge/shared'

const GAMME: OperationGamme[] = [
  // volontairement dans le désordre : la gamme est triée par numéro
  { id: 'o30', numero: 30, libelle: 'Peinture', tempsUnitaireH: 0.3, tempsFixeH: 1,
    poste: { code: 'PEINT', libelle: 'Peintre', coutHoraireXaf: 2000 } },
  { id: 'o10', numero: 10, libelle: 'Découpe', tempsUnitaireH: 0.2, tempsFixeH: 0.5,
    poste: { code: 'DECOUP', libelle: 'Découpeur', coutHoraireXaf: 2000 },
    equipement: { code: 'EQ-PLASMA', designation: 'Découpe plasma', coutHoraireXaf: 3000 } },
  { id: 'o20', numero: 20, libelle: 'Soudage', tempsUnitaireH: 1.5, tempsFixeH: 0,
    poste: { code: 'SOUD', libelle: 'Soudeur', coutHoraireXaf: 2500 },
    equipement: { code: 'EQ-MIG', designation: 'Poste MIG', coutHoraireXaf: 1500 } },
]

const ACIER: RessourceTechnique = { id: 'r1', type: 'materiau', designation: 'Acier', unite: 'kg', quantiteParUnite: 20, coutUnitaireReferenceXaf: 800 }
const PORTAIL = { modeleId: 'p003', modeCalcul: 'surface' as const, quantite: 2, dimensions: { largeur: 3, hauteur: 2.2 } }

describe('gamme opératoire → ressources chiffrées', () => {
  const { ressources, tauxManquants } = ressourcesDepuisGamme(GAMME)

  it('produit une ligne main-d’œuvre et une ligne machine par opération, dans l’ordre de la gamme', () => {
    expect(tauxManquants).toEqual([])
    expect(ressources.map((r) => r.designation)).toEqual([
      'Op 10 — Découpe (Découpeur)', 'Op 10 — Découpe (Découpe plasma)',
      'Op 20 — Soudage (Soudeur)', 'Op 20 — Soudage (Poste MIG)',
      'Op 30 — Peinture (Peintre)',
    ])
    expect(ressources.map((r) => r.type)).toEqual(['main_oeuvre', 'equipement', 'main_oeuvre', 'equipement', 'main_oeuvre'])
  })

  it('cas connu : temps unitaire × quantité facturable + temps de préparation compté une fois', () => {
    const r = calculerDevisBrut(PORTAIL, [ACIER, ...ressources])
    if (!r.ok) throw new Error('calcul impossible')
    const parLigne = Object.fromEntries(r.proposition.lignes.map((l) => [l.designation, [l.quantiteCalculee, l.totalXaf]]))
    expect(parLigne['Op 10 — Découpe (Découpeur)']).toEqual([3.14, 6280])
    expect(parLigne['Op 10 — Découpe (Découpe plasma)']).toEqual([3.14, 9420])
    expect(parLigne['Op 20 — Soudage (Soudeur)']).toEqual([19.8, 49500])
    expect(parLigne['Op 20 — Soudage (Poste MIG)']).toEqual([19.8, 29700])
    expect(parLigne['Op 30 — Peinture (Peintre)']).toEqual([4.96, 9920])
    expect(r.proposition).toMatchObject({
      totalMateriauxXaf: 211200, totalMainOeuvreXaf: 65700, totalEquipementsXaf: 39120, totalHtXaf: 316020,
    })
  })

  it('le temps de préparation ne double pas avec la quantité', () => {
    const q1 = calculerDevisBrut({ ...PORTAIL, quantite: 1 }, ressources)
    const q2 = calculerDevisBrut(PORTAIL, ressources)
    if (!q1.ok || !q2.ok) throw new Error('calcul impossible')
    const peinture = (p: typeof q1) => p.ok ? p.proposition.lignes.find((l) => l.designation.startsWith('Op 30'))!.quantiteCalculee : 0
    expect(peinture(q1)).toBe(2.98)   // 0,3 × 6,6 + 1
    expect(peinture(q2)).toBe(4.96)   // 0,3 × 13,2 + 1 — préparation toujours 1 h
  })

  it('signale un coût horaire manquant au lieu de le compter à 0', () => {
    const { ressources: r, tauxManquants: manquants } = ressourcesDepuisGamme([
      { ...GAMME[2], equipement: { code: 'EQ-MIG', designation: 'Poste MIG', coutHoraireXaf: null } },
    ])
    expect(manquants).toEqual([{ operation: 20, libelle: 'Soudage', ressource: 'équipement Poste MIG' }])
    expect(r.map((x) => x.type)).toEqual(['main_oeuvre'])
  })

  it('rétrocompatible : une ressource sans quantité fixe garde le même calcul', () => {
    const r = calculerDevisBrut(PORTAIL, [ACIER])
    if (!r.ok) throw new Error('calcul impossible')
    expect(r.proposition.totalHtXaf).toBe(211200)
  })
})
