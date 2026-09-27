/**
 * catalogue-commercial.test.ts — Catalogue Hybride, Phase 1
 * (packages/shared/src/catalogue-commercial.ts, fonctions pures)
 *
 * - correspondance type_gamme (base) ↔ mode commercial STANDARD/CONFIGURABLE/QUOTE
 * - mode porté par le MODÈLE, la famille ne donnant qu'un défaut (P001 standard
 *   et P003 configurable dans la même famille « Portail »)
 * - hiérarchie Catégorie → Famille → Sous-famille : profondeur max 3, pas de cycle
 */

import { describe, it, expect } from 'vitest'
import {
  CommercialMode, TYPES_GAMME, LIBELLES_MODE_COMMERCIAL,
  modeCommercialDepuisTypeGamme, typeGammeDepuisModeCommercial,
  resoudreModeCommercial, resoudreTypeGamme,
  profondeurFamille, hauteurSousArbre, verifierPlacementFamille, libelleNiveauFamille,
  type ArbreFamilles,
} from '@forge/shared'

describe('mode commercial ↔ type_gamme', () => {
  it('associe chaque valeur historique à un mode', () => {
    expect(modeCommercialDepuisTypeGamme('catalogue')).toBe(CommercialMode.STANDARD)
    expect(modeCommercialDepuisTypeGamme('configuration')).toBe(CommercialMode.CONFIGURABLE)
    expect(modeCommercialDepuisTypeGamme('sur_mesure')).toBe(CommercialMode.QUOTE)
  })

  it('est une bijection (aller-retour sans perte)', () => {
    for (const t of TYPES_GAMME) {
      expect(typeGammeDepuisModeCommercial(modeCommercialDepuisTypeGamme(t))).toBe(t)
    }
  })

  it('donne l’action client de chaque parcours', () => {
    expect(LIBELLES_MODE_COMMERCIAL.STANDARD.actionClient).toBe('Acheter')
    expect(LIBELLES_MODE_COMMERCIAL.CONFIGURABLE.actionClient).toBe('Personnaliser')
    expect(LIBELLES_MODE_COMMERCIAL.QUOTE.actionClient).toBe('Demander un devis')
  })
})

describe('résolution du mode au niveau du modèle', () => {
  const famillePortail = { type_gamme: 'configuration' as const }

  it('un modèle sans mode hérite de sa famille (P003 configurable)', () => {
    expect(resoudreModeCommercial({ type_gamme: null }, famillePortail)).toBe('CONFIGURABLE')
  })

  it('le mode du modèle l’emporte (P001 standard dans une famille configurable)', () => {
    expect(resoudreModeCommercial({ type_gamme: 'catalogue' }, famillePortail)).toBe('STANDARD')
  })

  it('renvoie null si ni le modèle ni la famille ne le renseignent', () => {
    expect(resoudreTypeGamme({ type_gamme: null }, null)).toBeNull()
    expect(resoudreModeCommercial({ type_gamme: undefined }, undefined)).toBeNull()
  })
})

describe('hiérarchie des familles', () => {
  // CAT (catégorie) → FAM (famille) → SF (sous-famille) ; AUTRE = racine isolée
  const arbre: ArbreFamilles = new Map([
    ['CAT', null], ['FAM', 'CAT'], ['SF', 'FAM'], ['AUTRE', null],
  ])

  it('calcule la profondeur et le libellé de niveau', () => {
    expect(profondeurFamille('CAT', arbre)).toBe(1)
    expect(profondeurFamille('SF', arbre)).toBe(3)
    expect(libelleNiveauFamille(1)).toBe('Catégorie')
    expect(libelleNiveauFamille(3)).toBe('Sous-famille')
  })

  it('renvoie null pour une famille inconnue ou une chaîne cyclique', () => {
    expect(profondeurFamille('INCONNUE', arbre)).toBeNull()
    expect(profondeurFamille('A', new Map([['A', 'B'], ['B', 'A']]))).toBeNull()
  })

  it('calcule la hauteur d’un sous-arbre', () => {
    expect(hauteurSousArbre('CAT', arbre)).toBe(3)
    expect(hauteurSousArbre('SF', arbre)).toBe(1)
  })

  it('accepte une sous-famille sous une famille (niveau 3)', () => {
    expect(verifierPlacementFamille(null, 'FAM', arbre)).toEqual({ ok: true })
  })

  it('refuse un 4ᵉ niveau', () => {
    const r = verifierPlacementFamille(null, 'SF', arbre)
    expect(r).toMatchObject({ ok: false, code: 'PROFONDEUR_MAX_DEPASSEE' })
  })

  it('refuse de déplacer une branche si elle dépasse 3 niveaux au total', () => {
    // FAM (2 niveaux avec SF) sous SF… interdit aussi comme cycle ; sous AUTRE → 1 + 2 = 3, accepté
    expect(verifierPlacementFamille('FAM', 'AUTRE', arbre)).toEqual({ ok: true })
    // CAT (3 niveaux) sous AUTRE → 4 niveaux
    expect(verifierPlacementFamille('CAT', 'AUTRE', arbre)).toMatchObject({ ok: false, code: 'PROFONDEUR_MAX_DEPASSEE' })
  })

  it('refuse un cycle (famille sous elle-même ou sous un descendant)', () => {
    expect(verifierPlacementFamille('FAM', 'FAM', arbre)).toMatchObject({ ok: false, code: 'CYCLE_HIERARCHIE' })
    expect(verifierPlacementFamille('CAT', 'SF', arbre)).toMatchObject({ ok: false, code: 'CYCLE_HIERARCHIE' })
  })

  it('laisse la base trancher sur un parent inconnu (contrainte FK)', () => {
    expect(verifierPlacementFamille(null, 'INCONNUE', arbre)).toEqual({ ok: true })
  })

  it('accepte de remonter une famille en racine', () => {
    expect(verifierPlacementFamille('FAM', null, arbre)).toEqual({ ok: true })
  })
})
