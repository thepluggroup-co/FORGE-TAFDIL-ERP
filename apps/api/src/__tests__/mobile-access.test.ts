import { describe, it, expect } from 'vitest'
import {
  canAccessMobileScreen, dashboardSectionsFor, dashboardSourcesFor,
  hasMobilePermission, legacyPermissionsForRole, type MobilePermission,
} from '@forge/shared'

const p = (module: MobilePermission['module'], ...actions: MobilePermission['action'][]): MobilePermission[] =>
  actions.map((action) => ({ module, action }))

describe('Accès mobile piloté par les permissions de la base', () => {
  it('hasMobilePermission : READ par défaut, action exacte sinon', () => {
    const perms = p('STOCK', 'READ')
    expect(hasMobilePermission(perms, 'STOCK')).toBe(true)
    expect(hasMobilePermission(perms, 'STOCK', 'VALIDATE')).toBe(false)
    expect(hasMobilePermission(perms, 'CAISSE')).toBe(false)
  })

  it('dashboard et profil sont toujours accessibles, même sans permission', () => {
    expect(canAccessMobileScreen([], 'dashboard')).toBe(true)
    expect(canAccessMobileScreen([], 'profile')).toBe(true)
    expect(canAccessMobileScreen([], 'stocks')).toBe(false)
  })

  it("l'écran approbation exige STOCK:VALIDATE (comme PUT /bons/:id/valider), pas seulement STOCK:READ", () => {
    expect(canAccessMobileScreen(p('STOCK', 'READ'), 'approbation')).toBe(false)
    expect(canAccessMobileScreen(p('STOCK', 'READ', 'VALIDATE'), 'approbation')).toBe(true)
  })

  it('un rôle défini en base avec LOGISTICS:READ voit les livraisons sans être « livreur »', () => {
    expect(canAccessMobileScreen(p('LOGISTICS', 'READ'), 'livraisons')).toBe(true)
  })

  it('repli legacy : jamais plus large que les anciennes règles par rôle', () => {
    const livreur = legacyPermissionsForRole('livreur')
    expect(canAccessMobileScreen(livreur, 'livraisons')).toBe(true)
    expect(canAccessMobileScreen(livreur, 'orders')).toBe(false)
    expect(canAccessMobileScreen(livreur, 'stocks')).toBe(false)

    const caissier = legacyPermissionsForRole('caissier')
    expect(canAccessMobileScreen(caissier, 'caisse')).toBe(true)
    expect(canAccessMobileScreen(caissier, 'approbation')).toBe(false)

    const manager = legacyPermissionsForRole('manager')
    expect(canAccessMobileScreen(manager, 'approbation')).toBe(true)
    expect(canAccessMobileScreen(manager, 'caisse')).toBe(true)

    expect(legacyPermissionsForRole('role-inconnu')).toEqual([])
    expect(legacyPermissionsForRole(null)).toEqual([])
  })

  it('tableau de bord : sections et sources suivent les permissions, aucune requête inutile', () => {
    const livreur = dashboardSectionsFor(p('LOGISTICS', 'READ'))
    expect(livreur).toEqual(['livraisons'])
    expect(dashboardSourcesFor(livreur)).toEqual(['livraisons'])

    const direction = dashboardSectionsFor([
      ...p('COMMERCIAL', 'READ'), ...p('FINANCE', 'READ'), ...p('STOCK', 'READ', 'VALIDATE'),
    ])
    expect(direction).toEqual(['ventes', 'approbation', 'commandes', 'stock'])
    expect(dashboardSourcesFor(direction).sort()).toEqual(['bons', 'commandes', 'stocks'])

    expect(dashboardSectionsFor([])).toEqual([])
  })
})
