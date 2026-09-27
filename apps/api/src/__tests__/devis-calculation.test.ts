/**
 * devis-calculation.test.ts — Moteur de calcul de devis (@forge/shared)
 * Couverture : Tests 1 à 9 du §47 (Master Prompt V3). Le devis n'avait
 * aucun test avant cette Phase 2.
 */
import { describe, it, expect, vi } from 'vitest'
import {
  calculerQuantiteFacturable,
  calculerDevisBrut,
  type RessourceTechnique,
} from '@forge/shared'

vi.mock('@forge/db', () => ({ supabaseAdmin: { from: vi.fn() } }))

import { supabaseAdmin } from '@forge/db'
import { proposerDevis } from '../services/devis-calculation.service'

function mkChain(response: Record<string, unknown>) {
  const chain: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'order'] as const) chain[m] = vi.fn().mockReturnValue(chain)
  chain['maybeSingle'] = vi.fn().mockResolvedValue(response)
  chain['then'] = (cb: (v: unknown) => unknown) => Promise.resolve(response).then(cb)
  return chain
}

const RESSOURCES_BARRIERE: RessourceTechnique[] = [
  { id: 'r1', type: 'materiau',    designation: 'Acier',    unite: 'kg', quantiteParUnite: 4,   coutUnitaireReferenceXaf: 1200 },
  { id: 'r2', type: 'materiau',    designation: 'Peinture', unite: 'l',  quantiteParUnite: 0.2, coutUnitaireReferenceXaf: 3500 },
  { id: 'r3', type: 'main_oeuvre', designation: 'Soudeur',  unite: 'h',  quantiteParUnite: 0.8, coutUnitaireReferenceXaf: 2000, tempsReferenceH: 0.8 },
  { id: 'r4', type: 'equipement',  designation: 'Poste soudure', unite: 'h', quantiteParUnite: 0.3, coutUnitaireReferenceXaf: 1500, tempsReferenceH: 0.3 },
]

describe('calculerQuantiteFacturable', () => {
  it('Test 1 — quantitatif : quantité facturable = quantité saisie', () => {
    const r = calculerQuantiteFacturable('quantitatif', undefined, 5)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.quantiteFacturable).toBe(5)
  })

  it('Test 2 — m² (surface) : reproduit l\'exemple du §16 (3 × 1,8 × 2 = 10,8)', () => {
    const r = calculerQuantiteFacturable('surface', { largeur: 3, hauteur: 1.8 }, 2)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.quantiteFacturable).toBe(10.8)
  })

  it('Test 2bis — surface saisie directement', () => {
    const r = calculerQuantiteFacturable('surface', { surface: 5.4 }, 2)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.quantiteFacturable).toBe(10.8)
  })

  it('Test 3 — mètre linéaire', () => {
    const r = calculerQuantiteFacturable('lineaire', { longueur: 12 }, 3)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.quantiteFacturable).toBe(36)
  })

  it('Test 4 — m³ (volume)', () => {
    const r = calculerQuantiteFacturable('volume', { longueur: 2, largeur: 1.5, hauteur: 1 }, 1)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.quantiteFacturable).toBe(3)
  })

  it('Test 5 — poids', () => {
    const r = calculerQuantiteFacturable('poids', { poids: 25 }, 4)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.quantiteFacturable).toBe(100)
  })

  it('forfait : quantité = 1 × quantité demandée', () => {
    const r = calculerQuantiteFacturable('forfait', undefined, 1)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.quantiteFacturable).toBe(1)
  })

  it('qualitatif : traité comme une saisie directe, sans coefficient inventé', () => {
    const r = calculerQuantiteFacturable('qualitatif', undefined, 1)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.quantiteFacturable).toBe(1)
  })

  it('Test 6 — dimensions invalides : surface sans largeur/hauteur/surface → erreur explicite', () => {
    const r = calculerQuantiteFacturable('surface', {}, 1)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.erreurs[0].code).toBe('DIMENSIONS_MANQUANTES')
  })

  it('Test 6bis — volume sans aucune dimension → erreur', () => {
    const r = calculerQuantiteFacturable('volume', { longueur: 2 }, 1)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.erreurs[0].code).toBe('DIMENSIONS_MANQUANTES')
  })

  it('Test 7 — quantité = 0 → erreur', () => {
    const r = calculerQuantiteFacturable('quantitatif', undefined, 0)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.erreurs[0].code).toBe('QUANTITE_INVALIDE')
  })

  it('Test 7bis — quantité négative → erreur', () => {
    const r = calculerQuantiteFacturable('forfait', undefined, -1)
    expect(r.ok).toBe(false)
  })
})

describe('calculerDevisBrut', () => {
  it('Test 8 — ressource manquante : fiche technique sans ressources → erreur, pas un devis à 0 silencieux', () => {
    const r = calculerDevisBrut({ modeleId: 'p1', modeCalcul: 'quantitatif', quantite: 1 }, [])
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.erreurs[0].code).toBe('RESSOURCES_MANQUANTES')
  })

  it('reproduit intégralement l\'exemple chiffré du §16 (Barrière B-01)', () => {
    const r = calculerDevisBrut(
      { modeleId: 'barriere-b01', modeCalcul: 'surface', dimensions: { largeur: 3, hauteur: 1.8 }, quantite: 2 },
      RESSOURCES_BARRIERE,
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return

    expect(r.proposition.quantiteFacturable).toBe(10.8)

    const acier    = r.proposition.lignes.find((l) => l.ressourceId === 'r1')!
    const peinture = r.proposition.lignes.find((l) => l.ressourceId === 'r2')!
    const soudeur  = r.proposition.lignes.find((l) => l.ressourceId === 'r3')!
    const machine  = r.proposition.lignes.find((l) => l.ressourceId === 'r4')!

    expect(acier.quantiteCalculee).toBe(43.2)     // 4 kg/m² × 10,8
    expect(peinture.quantiteCalculee).toBe(2.16)  // 0,2 L/m² × 10,8
    expect(soudeur.quantiteCalculee).toBe(8.64)   // 0,8 h/m² × 10,8
    expect(machine.quantiteCalculee).toBe(3.24)   // 0,3 h/m² × 10,8
  })

  it('§19 — le devis brut ne contient ni TVA ni remise, uniquement le total HT', () => {
    const r = calculerDevisBrut(
      { modeleId: 'p1', modeCalcul: 'quantitatif', quantite: 1 },
      [{ id: 'r1', type: 'materiau', designation: 'Vis', unite: 'unité', quantiteParUnite: 10, coutUnitaireReferenceXaf: 50 }],
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.proposition.totalHtXaf).toBe(500)
    expect(r.proposition).not.toHaveProperty('tvaXaf')
    expect(r.proposition).not.toHaveProperty('remiseXaf')
  })

  it('Test 9 — le total HT est la somme exacte des 3 sous-totaux par type de ressource', () => {
    const r = calculerDevisBrut(
      { modeleId: 'barriere-b01', modeCalcul: 'surface', dimensions: { largeur: 3, hauteur: 1.8 }, quantite: 2 },
      RESSOURCES_BARRIERE,
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.proposition.totalHtXaf).toBe(
      r.proposition.totalMateriauxXaf + r.proposition.totalMainOeuvreXaf + r.proposition.totalEquipementsXaf,
    )
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// proposerDevis — couche DB (Phase 2 : fiche_technique repointée sur modeles)
// Scénario bout en bout famille pilote : Menuiserie métallique, modèle PM-01.
// ═══════════════════════════════════════════════════════════════════════════════

describe('proposerDevis — modele_id (famille pilote Menuiserie métallique)', () => {
  const MODELE_PM01_ID = '33333333-3333-4333-8333-333333333333'
  const FICHE_ID        = 'fiche-pm01-active-001'

  it('charge la fiche technique ACTIVE par modele_id (plus produit_id) et calcule le devis brut', async () => {
    const ficheChain = mkChain({
      data: {
        id: FICHE_ID, modele_id: MODELE_PM01_ID, version: 1, statut: 'active',
        mode_calcul: 'surface', unite_facturation_id: null,
      },
      error: null,
    })
    const ressourcesChain = mkChain({
      data: [
        { id: 'r1', type: 'materiau', designation: 'Acier', unite: 'kg', quantite_par_unite: 4, cout_unitaire_reference_xaf: 1200, temps_reference_h: null, actif: true },
      ],
      error: null,
    })

    vi.mocked(supabaseAdmin!.from).mockImplementation(((table: string) =>
      table === 'fiche_technique' ? ficheChain : ressourcesChain) as never)

    const resultat = await proposerDevis({ modeleId: MODELE_PM01_ID, quantite: 2, dimensions: { largeur: 3, hauteur: 1.8 } })

    expect(resultat.ok).toBe(true)
    if (!resultat.ok) return
    expect(resultat.ficheTechniqueId).toBe(FICHE_ID)
    expect(resultat.resultat.proposition.modeleId).toBe(MODELE_PM01_ID)
    expect(resultat.resultat.proposition.quantiteFacturable).toBe(10.8)
    expect(resultat.resultat.proposition.totalHtXaf).toBe(51_840) // 4 kg × 10,8 × 1200 XAF

    // La requête interroge bien modele_id, plus produit_id (régression Phase 2)
    expect(ficheChain.eq).toHaveBeenCalledWith('modele_id', MODELE_PM01_ID)
  })

  it('FICHE_TECHNIQUE_INTROUVABLE si aucune fiche active pour ce modele_id', async () => {
    const ficheChain = mkChain({ data: null, error: null })
    vi.mocked(supabaseAdmin!.from).mockImplementation((() => ficheChain) as never)

    const resultat = await proposerDevis({ modeleId: MODELE_PM01_ID, quantite: 1 })

    expect(resultat.ok).toBe(false)
    if (resultat.ok) return
    expect(resultat.erreurs[0].code).toBe('FICHE_TECHNIQUE_INTROUVABLE')
  })
})
