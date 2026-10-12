/**
 * Tableau de bord par rôle : le rôle choisit les widgets, les permissions
 * réelles les filtrent — aucun widget d'un module non lisible ne doit sortir.
 */
import { describe, it, expect } from 'vitest'
import {
  resolveDashboardLayout, ROLE_LAYOUTS, KPI_REQUIREMENTS, PANEL_REQUIREMENTS,
} from '@/features/dashboard/layouts'
import type { Can } from '@/features/dashboard/layouts'

/** Permissions sous la forme 'MODULE:ACTION'. */
function can(...grants: string[]): Can {
  return (module, action = 'READ') => grants.includes(`${module}:${action}`)
}
const tout: Can = () => true
const rien: Can = () => false

describe('resolveDashboardLayout', () => {
  it('caissier : caisse et créances, rien qui dépende de REPORTS / FINANCE / HR', () => {
    const layout = resolveDashboardLayout('CAISSIER', 'caissier', can('CAISSE:READ', 'RECEIVABLES:READ', 'STOCK:READ'))
    expect(layout.kpis).toEqual(['caisse.session', 'caisse.mes_ventes', 'caisse.ticket_moyen', 'creances.retards'])
    expect(layout.panels).toEqual(['caisse_ventes', 'creances_retard', 'stock_alertes'])
    expect(layout.actions.map((a) => a.path)).toEqual(['/caisse', '/stocks'])
  })

  it('retire les widgets dont la permission a été retirée au rôle', () => {
    const layout = resolveDashboardLayout('CAISSIER', 'caissier', can('CAISSE:READ'))
    expect(layout.kpis).toEqual(['caisse.session', 'caisse.mes_ventes', 'caisse.ticket_moyen'])
    expect(layout.panels).toEqual(['caisse_ventes'])
  })

  it('magasinier : fonctionne sans REPORTS:READ', () => {
    const layout = resolveDashboardLayout('MAGASINIER', null, can('STOCK:READ', 'LOGISTICS:READ'))
    expect(layout.kpis).toHaveLength(5)
    expect(layout.panels).toEqual(['stock_alertes', 'mouvements', 'livraisons'])
  })

  it('une action d\'écriture exige la permission correspondante', () => {
    const lecture = resolveDashboardLayout('COMMERCIAL', 'operateur', can('COMMERCIAL:READ'))
    expect(lecture.actions.map((a) => a.label)).not.toContain('Nouveau devis')
    const ecriture = resolveDashboardLayout('COMMERCIAL', 'operateur', can('COMMERCIAL:READ', 'COMMERCIAL:CREATE'))
    expect(ecriture.actions[0].label).toBe('Nouveau devis')
  })

  it('technicien : son parcours personnel, réservé au rôle legacy technicien', () => {
    const technicien = resolveDashboardLayout('READONLY', 'technicien', can('PRODUCTION:READ', 'STOCK:READ'))
    expect(technicien.kpis).toContain('parcours.niveau')
    expect(technicien.panels).toContain('mon_parcours')
    const autre = resolveDashboardLayout('READONLY', 'operateur', can('PRODUCTION:READ', 'STOCK:READ'))
    expect(autre.kpis).not.toContain('parcours.niveau')
    expect(autre.panels).not.toContain('mon_parcours')
  })

  it('sans rôle RBAC : retombe sur le rôle legacy', () => {
    expect(resolveDashboardLayout(null, 'superviseur', tout).label).toBe(ROLE_LAYOUTS.MANAGER.label)
    expect(resolveDashboardLayout(undefined, 'admin', tout).label).toBe(ROLE_LAYOUTS.SUPER_ADMIN.label)
  })

  it('rôle inconnu : mise en page générique filtrée par permissions', () => {
    const layout = resolveDashboardLayout('ROLE_SUR_MESURE', null, can('STOCK:READ'))
    expect(layout.kpis).toEqual(['stock.alertes', 'stock.bons_attente'])
    expect(layout.panels).toEqual(['stock_alertes'])
  })

  it('aucune permission : tableau de bord vide, quel que soit le rôle', () => {
    for (const role of Object.keys(ROLE_LAYOUTS)) {
      const layout = resolveDashboardLayout(role, null, rien)
      expect(layout.kpis).toEqual([])
      expect(layout.panels).toEqual([])
      expect(layout.actions).toEqual([])
    }
  })

  it('chaque rôle référence des widgets déclarés et reste dans les limites d\'affichage', () => {
    for (const [role, base] of Object.entries(ROLE_LAYOUTS)) {
      for (const id of base.kpis) expect(KPI_REQUIREMENTS, role).toHaveProperty([id])
      for (const id of base.panels) expect(PANEL_REQUIREMENTS, role).toHaveProperty([id])
      const layout = resolveDashboardLayout(role, 'technicien', tout)
      expect(layout.kpis, role).toEqual(base.kpis)
      expect(layout.panels, role).toEqual(base.panels)
    }
  })
})
