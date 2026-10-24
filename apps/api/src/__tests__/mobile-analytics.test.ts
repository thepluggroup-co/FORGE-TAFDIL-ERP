import { describe, it, expect } from 'vitest'
import { analyticsFromFactures, factureEtat, type AnalyticsFacture } from '@forge/shared'

const f = (statut: AnalyticsFacture['statut'], date_emission: string, total: number, date_echeance = '2026-12-31'): AnalyticsFacture =>
  ({ statut, date_emission, date_echeance, total_ttc_xaf: total })

const TODAY = '2026-10-21'

describe('Analytique mobile — agrégation des factures', () => {
  it('factureEtat : payée / en attente / en retard / annulée / brouillon', () => {
    expect(factureEtat({ statut: 'paye', date_echeance: '2026-01-01' }, TODAY)).toBe('payee')
    expect(factureEtat({ statut: 'envoye', date_echeance: '2026-12-01' }, TODAY)).toBe('attente')
    expect(factureEtat({ statut: 'valide', date_echeance: '2026-09-01' }, TODAY)).toBe('retard')
    expect(factureEtat({ statut: 'annule', date_echeance: '2026-01-01' }, TODAY)).toBe('annulee')
    expect(factureEtat({ statut: 'brouillon', date_echeance: '2026-01-01' }, TODAY)).toBe('brouillon')
  })

  it('mois : 6 points, brouillons et annulées exclus, variation vs mois précédent', () => {
    const r = analyticsFromFactures([
      f('paye', '2026-10-05', 1_200_000),
      f('envoye', '2026-10-12', 300_000),
      f('paye', '2026-09-20', 1_000_000),
      f('brouillon', '2026-10-02', 9_999_999),
      f('annule', '2026-10-03', 9_999_999),
      f('paye', '2025-01-10', 5_000_000), // hors fenêtre
    ], 'mois', TODAY)
    expect(r.labels).toEqual(['Mai', 'Juin', 'Juil', 'Août', 'Sep', 'Oct'])
    expect(r.values).toEqual([0, 0, 0, 0, 1_000_000, 1_500_000])
    expect(r.current).toBe(1_500_000)
    expect(r.previous).toBe(1_000_000)
    expect(r.trend).toBe(50)
  })

  it('variation null (jamais inventée) quand la période précédente est vide', () => {
    const r = analyticsFromFactures([f('paye', '2026-10-05', 800_000)], 'mois', TODAY)
    expect(r.trend).toBeNull()
  })

  it('répartition de la période en cours : payée / en attente / en retard', () => {
    const r = analyticsFromFactures([
      f('paye', '2026-10-01', 500_000),
      f('envoye', '2026-10-02', 200_000, '2026-12-01'),
      f('valide', '2026-10-03', 100_000, '2026-10-10'),
    ], 'mois', TODAY)
    expect(r.breakdown).toEqual({ payee: 500_000, attente: 200_000, retard: 100_000 })
  })

  it('trimestre et année : fenêtres de 4 trimestres et 3 années', () => {
    const t = analyticsFromFactures([f('paye', '2026-10-05', 100), f('paye', '2026-07-05', 50)], 'trimestre', TODAY)
    expect(t.labels).toHaveLength(4)
    expect(t.values.slice(-2)).toEqual([50, 100])
    const y = analyticsFromFactures([f('paye', '2026-10-05', 100), f('paye', '2025-03-05', 40)], 'annee', TODAY)
    expect(y.labels).toEqual(['2024', '2025', '2026'])
    expect(y.values).toEqual([0, 40, 100])
  })

  it('aucune facture : zéros, pas de plantage', () => {
    const r = analyticsFromFactures([], 'mois', TODAY)
    expect(r.values.every((v) => v === 0)).toBe(true)
    expect(r.trend).toBeNull()
  })
})
