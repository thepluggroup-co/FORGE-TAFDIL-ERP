/**
 * TEST-05 : Inventaire journalier automatique
 *
 * Simule 20 mouvements de stock en BDD.
 * GET /api/stocks/inventaire/journalier
 * Assert : rapport JSON contient tous les produits avec écarts
 * Assert : produits sous seuil_critique identifiés
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mkChain, authHeaders } from './helpers'

vi.mock('@forge/db/supabase', () => ({
  supabase: {
    from:          vi.fn(),
    rpc:           vi.fn(),
    channel:       vi.fn(() => ({ send: vi.fn().mockResolvedValue('ok') })),
    removeChannel: vi.fn(),
  },
  supabaseAdmin: null,
}))

import app from '../app'
import { supabase } from '@forge/db/supabase'

// ── Fixtures : 20 produits avec statuts variés ─────────────────────────────────

const PRODUITS = [
  // 5 ruptures (stock=0)
  { id: 'p01', ref: 'VIS-M6',   designation: 'Vis M6',             categorie: 'Visserie',     stock_actuel: 0,   stock_min: 10, stock_critique: 5,  prix_unitaire_xaf: 500,   statut: 'rupture' },
  { id: 'p02', ref: 'VIS-M8',   designation: 'Vis M8',             categorie: 'Visserie',     stock_actuel: 0,   stock_min: 8,  stock_critique: 3,  prix_unitaire_xaf: 700,   statut: 'rupture' },
  { id: 'p03', ref: 'ECR-M6',   designation: 'Écrou M6',           categorie: 'Visserie',     stock_actuel: 0,   stock_min: 10, stock_critique: 5,  prix_unitaire_xaf: 400,   statut: 'rupture' },
  { id: 'p04', ref: 'RND-10',   designation: 'Rond 10mm',          categorie: 'Acier',        stock_actuel: 0,   stock_min: 50, stock_critique: 20, prix_unitaire_xaf: 2000,  statut: 'rupture' },
  { id: 'p05', ref: 'TOL-3MM',  designation: 'Tôle 3mm',           categorie: 'Acier',        stock_actuel: 0,   stock_min: 20, stock_critique: 8,  prix_unitaire_xaf: 15000, statut: 'rupture' },
  // 5 critiques (0 < stock <= stock_critique)
  { id: 'p06', ref: 'FIL-SOU',  designation: 'Fil de soudure',     categorie: 'Consommables', stock_actuel: 2,   stock_min: 20, stock_critique: 5,  prix_unitaire_xaf: 5000,  statut: 'critique' },
  { id: 'p07', ref: 'DIS-125',  designation: 'Disque 125mm',       categorie: 'Abrasifs',     stock_actuel: 3,   stock_min: 15, stock_critique: 5,  prix_unitaire_xaf: 1500,  statut: 'critique' },
  { id: 'p08', ref: 'PEIN-01',  designation: 'Peinture anti-rouille', categorie: 'Peinture',  stock_actuel: 1,   stock_min: 10, stock_critique: 3,  prix_unitaire_xaf: 8000,  statut: 'critique' },
  { id: 'p09', ref: 'HUI-MAC',  designation: 'Huile machine',      categorie: 'Lubrifiants',  stock_actuel: 4,   stock_min: 20, stock_critique: 8,  prix_unitaire_xaf: 3000,  statut: 'critique' },
  { id: 'p10', ref: 'MAS-P3',   designation: 'Masque P3',          categorie: 'EPI',          stock_actuel: 3,   stock_min: 20, stock_critique: 8,  prix_unitaire_xaf: 2500,  statut: 'critique' },
  // 5 alertes (stock_critique < stock <= stock_min)
  { id: 'p11', ref: 'GAL-50',   designation: 'Galvanisé 50mm',     categorie: 'Acier',        stock_actuel: 15,  stock_min: 30, stock_critique: 10, prix_unitaire_xaf: 1200,  statut: 'alerte' },
  { id: 'p12', ref: 'BOL-M10',  designation: 'Boulon M10',         categorie: 'Visserie',     stock_actuel: 8,   stock_min: 20, stock_critique: 5,  prix_unitaire_xaf: 600,   statut: 'alerte' },
  { id: 'p13', ref: 'GAN-NIR',  designation: 'Gants nitrile',      categorie: 'EPI',          stock_actuel: 6,   stock_min: 20, stock_critique: 5,  prix_unitaire_xaf: 3500,  statut: 'alerte' },
  { id: 'p14', ref: 'PLA-ALU',  designation: 'Plaque aluminium',   categorie: 'Aluminium',    stock_actuel: 12,  stock_min: 25, stock_critique: 8,  prix_unitaire_xaf: 12000, statut: 'alerte' },
  { id: 'p15', ref: 'CHA-50',   designation: 'Cheville 50mm',      categorie: 'Visserie',     stock_actuel: 18,  stock_min: 40, stock_critique: 15, prix_unitaire_xaf: 300,   statut: 'alerte' },
  // 5 normaux
  { id: 'p16', ref: 'TUB-40',   designation: 'Tube carré 40x40',   categorie: 'Acier',        stock_actuel: 100, stock_min: 30, stock_critique: 10, prix_unitaire_xaf: 8000,  statut: 'normal' },
  { id: 'p17', ref: 'TUB-50',   designation: 'Tube rond 50mm',     categorie: 'Acier',        stock_actuel: 80,  stock_min: 20, stock_critique: 8,  prix_unitaire_xaf: 5000,  statut: 'normal' },
  { id: 'p18', ref: 'FER-PLT',  designation: 'Fer plat 30mm',      categorie: 'Acier',        stock_actuel: 200, stock_min: 50, stock_critique: 20, prix_unitaire_xaf: 2500,  statut: 'normal' },
  { id: 'p19', ref: 'BAR-RD',   designation: 'Barre ronde 12mm',   categorie: 'Acier',        stock_actuel: 150, stock_min: 40, stock_critique: 15, prix_unitaire_xaf: 3500,  statut: 'normal' },
  { id: 'p20', ref: 'FIL-EL',   designation: 'Fil électrique',     categorie: 'Électricité',  stock_actuel: 300, stock_min: 100, stock_critique: 50, prix_unitaire_xaf: 1000, statut: 'normal' },
]

// 20 mouvements du jour (sortie/entrée alternés)
const today = new Date().toISOString()
const MOUVEMENTS = Array.from({ length: 20 }, (_, i) => ({
  id:         `mvt-jour-${String(i + 1).padStart(3, '0')}`,
  produit_id: PRODUITS[i % PRODUITS.length].id,
  type:       i % 2 === 0 ? 'sortie' : 'entree',
  quantite:   (i + 1) * 2,
  reference:  null,
  created_at: today,
}))

describe('TEST-05 : Inventaire journalier automatique', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('retourne un rapport complet avec tous les produits et les produits sous seuil identifiés', async () => {
    const mockFrom = vi.mocked(supabase.from)

    // 1. from('produits').select('*').order().order()
    mockFrom.mockReturnValueOnce(mkChain({ data: PRODUITS, error: null }) as never)
    // 2. from('mouvements_stock').select('*').gte('created_at', ...)
    mockFrom.mockReturnValueOnce(mkChain({ data: MOUVEMENTS, error: null }) as never)

    const res = await app.request('/api/stocks/inventaire/journalier', {
      method:  'GET',
      headers: new Headers(authHeaders('directeur')),
    })

    expect(res.status).toBe(200)

    const rapport = await res.json() as {
      date:               string
      total_references:   number
      valeur_totale_xaf:  number
      alertes_count:      number
      critiques_count:    number
      ruptures_count:     number
      mouvements_du_jour: number
      categories:         Array<{ categorie: string; count: number; valeur_xaf: number; stock_total: number }>
      produits:           typeof PRODUITS
    }

    // ── Structure ──────────────────────────────────────────────────────────────
    expect(rapport.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(rapport).toHaveProperty('valeur_totale_xaf')
    expect(rapport).toHaveProperty('categories')
    expect(Array.isArray(rapport.produits)).toBe(true)

    // ── Toutes les références présentes ───────────────────────────────────────
    expect(rapport.total_references).toBe(PRODUITS.length) // 20

    // ── Mouvements du jour ────────────────────────────────────────────────────
    expect(rapport.mouvements_du_jour).toBe(MOUVEMENTS.length) // 20

    // ── Produits sous seuil critique identifiés ───────────────────────────────
    expect(rapport.ruptures_count).toBe(5)   // p01–p05
    expect(rapport.critiques_count).toBe(5)  // p06–p10
    expect(rapport.alertes_count).toBe(5)    // p11–p15

    // ── Valeur totale non nulle (contient du stock normal) ───────────────────
    expect(rapport.valeur_totale_xaf).toBeGreaterThan(0)

    // ── Catégories : toutes les catégories représentées ───────────────────────
    const categoriesNames = rapport.categories.map((c) => c.categorie)
    expect(categoriesNames).toContain('Acier')
    expect(categoriesNames).toContain('Visserie')
    expect(categoriesNames).toContain('EPI')

    // ── Chaque catégorie a une valeur et un count cohérents ───────────────────
    for (const cat of rapport.categories) {
      expect(cat.count).toBeGreaterThan(0)
      expect(cat.valeur_xaf).toBeGreaterThanOrEqual(0)
      expect(cat.stock_total).toBeGreaterThanOrEqual(0)
    }

    // ── Produits en rupture ou critique tous présents dans la liste ───────────
    const sousSeuilIds = PRODUITS
      .filter((p) => p.statut === 'rupture' || p.statut === 'critique')
      .map((p) => p.id)

    const retournedIds = rapport.produits.map((p) => p.id)
    for (const id of sousSeuilIds) {
      expect(retournedIds).toContain(id)
    }
  })

  it('retourne 403 pour un rôle operateur (accès réservé directeur/admin)', async () => {
    const res = await app.request('/api/stocks/inventaire/journalier', {
      method:  'GET',
      headers: new Headers(authHeaders('operateur')),
    })
    expect(res.status).toBe(403)
  })

  it('retourne 401 sans token', async () => {
    const res = await app.request('/api/stocks/inventaire/journalier', {
      method: 'GET',
    })
    expect(res.status).toBe(401)
  })
})
