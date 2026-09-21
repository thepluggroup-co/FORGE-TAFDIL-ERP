/**
 * shop.test.ts — Couverture de apps/api/src/routes/shop.ts
 *
 * Deux routeurs :
 *  - shopRouter    (public, monté sur /api/shop, sans auth)
 *  - shopErpRouter (monté sur /api/shop-erp, derrière authMiddleware)
 *
 * Endpoints couverts :
 *  PUBLIC :
 *   - GET  /api/shop/catalogue           (liste + filtres)
 *   - GET  /api/shop/catalogue/:id       (détail / 404)
 *   - GET  /api/shop/categories
 *   - POST /api/shop/commandes           (Zod, stock insuffisant, acompte livraison, happy path)
 *   - GET  /api/shop/commandes/:ref      (404)
 *   - GET  /api/shop/livraison/tarifs
 *  ERP (auth) :
 *   - GET  /api/shop-erp/produits        (401 sans token, 200 avec)
 *   - PUT  /api/shop-erp/produits/:id/visibilite (Zod, 404, happy path)
 *   - PUT  /api/shop-erp/produits/:id/prix       (Zod, happy path)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mkChain, authHeaders } from './helpers'

const testEnv = vi.hoisted(() => {
  process.env.NODE_ENV = 'test'
  process.env.SUPABASE_JWT_SECRET = 'forge-test-jwt-secret-x0x0x0x0x0x0x0x0x0x0'
  process.env.SUPABASE_URL = 'http://localhost:54321'
  process.env.SUPABASE_ANON_KEY = 'test-anon-key'
  process.env.SUPABASE_SERVICE_ROLE_KEY = ''
  return {}
})

vi.mock('@forge/db/supabase', () => {
  const safeChain = () => {
    const c: Record<string, unknown> = {}
    for (const m of ['select','insert','update','delete','upsert','eq','neq','in',
      'or','gte','lte','lt','gt','not','ilike','like','order','range','limit','head','filter'])
      c[m] = vi.fn().mockReturnValue(c)
    c['single']      = vi.fn().mockResolvedValue({ data: null, error: null })
    c['maybeSingle'] = vi.fn().mockResolvedValue({ data: null, error: null })
    c['then']        = (res: (v: unknown) => unknown) =>
      Promise.resolve({ data: [], count: 0, error: null }).then(res)
    return c
  }
  const mockClient = {
    from:          vi.fn().mockImplementation(safeChain),
    rpc:           vi.fn().mockResolvedValue({ data: null, error: null }),
    channel:       vi.fn(() => ({ send: vi.fn().mockResolvedValue('ok') })),
    removeChannel: vi.fn(),
    storage: { from: vi.fn().mockReturnValue({
      list:            vi.fn().mockResolvedValue({ data: [], error: null }),
      upload:          vi.fn().mockResolvedValue({ error: null }),
      download:        vi.fn().mockResolvedValue({ data: null, error: { message: 'not found' } }),
      getPublicUrl:    vi.fn().mockReturnValue({ data: { publicUrl: 'https://test.supabase.co/test.pdf' } }),
      createSignedUrl: vi.fn().mockResolvedValue({ data: { signedUrl: 'https://test.supabase.co/signed.pdf' } }),
    }) },
  }
  return { supabase: mockClient, supabaseAdmin: mockClient }
})

vi.mock('../services/credit-eligibility.service', () => ({
  verifierEligibiliteCredit: vi.fn().mockResolvedValue({ eligible: true, raison: null }),
}))
vi.mock('../services/client-sync.service', () => ({
  ensureClient: vi.fn().mockResolvedValue('client-123'),
}))
vi.mock('../services/sms.service', () => ({
  notifyCommandeSms: vi.fn().mockResolvedValue({ ok: true, skipped: false }),
}))
vi.mock('../services/workflow-notifications.service', () => ({
  notifyWorkflow: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('../services/finance-core.service', () => ({
  ensureFactureForCommande: vi.fn().mockResolvedValue(undefined),
  solderCreditsForCommande: vi.fn().mockResolvedValue(undefined),
  syncCreditForCommande: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('../middleware/auth', () => ({
  authMiddleware: async (c: any, next: () => Promise<void>) => {
    const authHeader = c.req.header('Authorization')
    if (!authHeader?.startsWith('Bearer ')) {
      return c.json({ error: 'Token manquant', code: 'MISSING_TOKEN' }, 401)
    }
    c.set('user', { id: 'test-user', email: 'test@tafdil.cm', role: 'admin' })
    c.set('requestId', 'test-request')
    await next()
  },
}))

import app from '../app'
import { supabase } from '@forge/db/supabase'

function resetFromDefault() {
  const safeChain = () => {
    const c: Record<string, unknown> = {}
    for (const m of ['select','insert','update','delete','upsert','eq','neq','in',
      'or','gte','lte','lt','gt','not','ilike','like','order','range','limit','head','filter'])
      c[m] = vi.fn().mockReturnValue(c)
    c['single']      = vi.fn().mockResolvedValue({ data: null, error: null })
    c['maybeSingle'] = vi.fn().mockResolvedValue({ data: null, error: null })
    c['then']        = (res: (v: unknown) => unknown) =>
      Promise.resolve({ data: [], count: 0, error: null }).then(res)
    return c
  }
  vi.mocked(supabase.from).mockReset()
  vi.mocked(supabase.from).mockImplementation(safeChain as never)
}

const JSON_HEADERS = { 'Content-Type': 'application/json' }

beforeEach(() => { vi.clearAllMocks(); resetFromDefault() })

// ── PUBLIC : catalogue ───────────────────────────────────────────────────────

describe('GET /api/shop/catalogue', () => {
  it('retourne la liste mappée des produits visibles', async () => {
    vi.mocked(supabase.from).mockReturnValueOnce(mkChain({
      data: [{
        product_id: 'p1', prix_public: 5000, description_longue: 'desc', images: ['img.jpg'], tags: ['alu'],
        delai_fabrication_jours: 3, min_commande: 1,
        produits: { ref: 'REF1', designation: 'Profilé Alu', categorie: 'aluminium', stock_actuel: 20, stock_min: 5, unite: 'm', statut: 'actif' },
      }],
      error: null,
    }) as never)

    const res = await app.request('/api/shop/catalogue')
    expect(res.status).toBe(200)
    const body = await res.json() as { data: Array<{ nom: string; disponibilite: string }>; total: number }
    expect(body.total).toBe(1)
    expect(body.data[0].nom).toBe('Profilé Alu')
    expect(body.data[0].disponibilite).toBe('disponible')
  })

  it('retourne 500 DB_ERROR si erreur DB', async () => {
    vi.mocked(supabase.from).mockReturnValueOnce(mkChain({ data: null, error: { message: 'boom' } }) as never)
    const res = await app.request('/api/shop/catalogue')
    expect(res.status).toBe(500)
    const body = await res.json() as { code: string }
    expect(body.code).toBe('DB_ERROR')
  })

  it('filtre par categorie et q (recherche texte)', async () => {
    vi.mocked(supabase.from).mockReturnValueOnce(mkChain({ data: [], error: null }) as never)
    const res = await app.request('/api/shop/catalogue?categorie=aluminium&q=profilé')
    expect(res.status).toBe(200)
  })
})

describe('GET /api/shop/catalogue/:id', () => {
  it('retourne 404 si produit introuvable', async () => {
    vi.mocked(supabase.from).mockReturnValueOnce(mkChain({ data: null, error: { message: 'not found' } }) as never)
    const res = await app.request('/api/shop/catalogue/unknown-id')
    expect(res.status).toBe(404)
  })

  it('retourne le détail du produit', async () => {
    vi.mocked(supabase.from).mockReturnValueOnce(mkChain({
      data: {
        product_id: 'p1', prix_public: 5000, description_longue: 'd', images: [], tags: [],
        delai_fabrication_jours: 3, min_commande: 1,
        produits: { ref: 'REF1', designation: 'Profilé', description: 'x', categorie: 'alu', stock_actuel: 0, stock_min: 5, stock_critique: 2, unite: 'm', statut: 'actif', fournisseur: null },
      },
      error: null,
    }) as never)
    const res = await app.request('/api/shop/catalogue/p1')
    expect(res.status).toBe(200)
    const body = await res.json() as { data: { disponibilite: string } }
    expect(body.data.disponibilite).toBe('indisponible')
  })
})

describe('GET /api/shop/categories', () => {
  it('retourne les catégories distinctes triées', async () => {
    vi.mocked(supabase.from).mockReturnValueOnce(mkChain({
      data: [{ produits: { categorie: 'verre' } }, { produits: { categorie: 'aluminium' } }, { produits: { categorie: 'verre' } }],
      error: null,
    }) as never)
    const res = await app.request('/api/shop/categories')
    expect(res.status).toBe(200)
    const body = await res.json() as { data: string[] }
    expect(body.data).toEqual(['aluminium', 'verre'])
  })
})

// ── PUBLIC : POST /commandes ─────────────────────────────────────────────────

const VALID_COMMANDE = {
  client_nom:       'Jean Test',
  client_telephone: '690123456',
  client_adresse:   'Rue de la Forge, Douala',
  lignes: [{ product_id: '11111111-1111-1111-1111-111111111111', designation: 'Profilé', quantite: 2, prix_unitaire: 5000 }],
  mode_paiement:    'mtn_momo',
}

describe('POST /api/shop/commandes', () => {
  it('retourne 400 si payload invalide (Zod : téléphone trop court)', async () => {
    const res = await app.request('/api/shop/commandes', {
      method: 'POST', headers: JSON_HEADERS,
      body: JSON.stringify({ ...VALID_COMMANDE, client_telephone: '12' }),
    })
    expect(res.status).toBe(400)
  })

  it('retourne 422 ACOMPTE_LIVRAISON_REQUIS si mode=livraison sans avance', async () => {
    const res = await app.request('/api/shop/commandes', {
      method: 'POST', headers: JSON_HEADERS,
      body: JSON.stringify({ ...VALID_COMMANDE, mode_paiement: 'livraison' }),
    })
    expect(res.status).toBe(422)
    const body = await res.json() as { code: string }
    expect(body.code).toBe('ACOMPTE_LIVRAISON_REQUIS')
  })

  it('accepte un retrait en boutique sans adresse de livraison', async () => {
    vi.mocked(supabase.from).mockReturnValueOnce(mkChain({
      data: { id: 'p1', designation: 'Profilé', stock_actuel: 100, unite: 'm' }, error: null,
    }) as never)
    vi.mocked(supabase.from).mockReturnValueOnce(mkChain({
      data: { id: 'p1', designation: 'Profilé', stock_actuel: 100, unite: 'm' }, error: null,
    }) as never)
    vi.mocked(supabase.from).mockReturnValueOnce(mkChain({
      data: [{ id: 'cs1', ref: 'WEB-2026-1234' }], error: null,
    }) as never)
    vi.mocked(supabase.from).mockReturnValueOnce(mkChain({
      data: null, error: { message: 'erp skip' },
    }) as never)

    const res = await app.request('/api/shop/commandes', {
      method: 'POST', headers: JSON_HEADERS,
      body: JSON.stringify({
        ...VALID_COMMANDE,
        client_adresse: undefined,
        mode_livraison: 'retrait_boutique',
      }),
    })

    expect(res.status).toBe(201)
  })

  it('retourne 404 PRODUCT_NOT_FOUND si produit inexistant', async () => {
    // fetch produit → null
    vi.mocked(supabase.from).mockReturnValueOnce(mkChain({ data: null, error: null }) as never)
    const res = await app.request('/api/shop/commandes', {
      method: 'POST', headers: JSON_HEADERS,
      body: JSON.stringify(VALID_COMMANDE),
    })
    expect(res.status).toBe(404)
    const body = await res.json() as { code: string }
    expect(body.code).toBe('PRODUCT_NOT_FOUND')
  })

  it('retourne 409 STOCK_INSUFFISANT si stock < quantité', async () => {
    vi.mocked(supabase.from).mockReturnValueOnce(mkChain({
      data: { id: 'p1', designation: 'Profilé', stock_actuel: 1, unite: 'm' }, error: null,
    }) as never)
    const res = await app.request('/api/shop/commandes', {
      method: 'POST', headers: JSON_HEADERS,
      body: JSON.stringify(VALID_COMMANDE),
    })
    expect(res.status).toBe(409)
    const body = await res.json() as { code: string }
    expect(body.code).toBe('STOCK_INSUFFISANT')
  })

  it('crée la commande et retourne ref (happy path)', async () => {
    // 1. fetch produit (stock ok)
    vi.mocked(supabase.from).mockReturnValueOnce(mkChain({
      data: { id: 'p1', designation: 'Profilé', stock_actuel: 100, unite: 'm' }, error: null,
    }) as never)
    // 2. lecture condition de paiement
    vi.mocked(supabase.from).mockReturnValueOnce(mkChain({
      data: { id: 'cp1', acompte_pct: 50, delai_solde_jours: 14 }, error: null,
    }) as never)
    // 3. insert commandes_shop
    vi.mocked(supabase.from).mockReturnValueOnce(mkChain({
      data: [{ id: 'cs1', ref: 'WEB-2026-1234' }], error: null,
    }) as never)
    // 4. insert commande ERP
    vi.mocked(supabase.from).mockReturnValueOnce(mkChain({
      data: { id: 'erp-1' }, error: null,
    }) as never)
    // 5. update commande_shop (liaison ERP)
    vi.mocked(supabase.from).mockReturnValueOnce(mkChain({
      data: [{ id: 'cs1', ref: 'WEB-2026-1234' }], error: null,
    }) as never)
    // 6. insert lignes ERP
    vi.mocked(supabase.from).mockReturnValueOnce(mkChain({
      data: [{ id: 'line-1' }], error: null,
    }) as never)
    // Les appels suivants retombent sur safeChain par défaut

    const res = await app.request('/api/shop/commandes', {
      method: 'POST', headers: JSON_HEADERS,
      body: JSON.stringify(VALID_COMMANDE),
    })
    expect(res.status).toBe(201)
    const body = await res.json() as { ref: string; montant_ttc: number }
    expect(body.ref).toMatch(/^WEB-\d{4}-\d{4}$/)
  })
})

describe('GET /api/shop/commandes/:ref', () => {
  it('retourne 404 si commande introuvable', async () => {
    vi.mocked(supabase.from).mockReturnValueOnce(mkChain({ data: null, error: { message: 'not found' } }) as never)
    const res = await app.request('/api/shop/commandes/WEB-0000-0000')
    expect(res.status).toBe(404)
  })
})

// ── PUBLIC : livraison/tarifs (statique) ─────────────────────────────────────

describe('GET /api/shop/livraison/tarifs', () => {
  it('retourne le tarif et le délai pour une ville', async () => {
    const res = await app.request('/api/shop/livraison/tarifs?ville=douala')
    expect(res.status).toBe(200)
    const body = await res.json() as { data: { tarif_xaf: number; delai_jours: number; zones_connues: string[] } }
    expect(typeof body.data.tarif_xaf).toBe('number')
    expect(Array.isArray(body.data.zones_connues)).toBe(true)
  })
})

// ── ERP : auth requise ───────────────────────────────────────────────────────

describe('GET /api/shop-erp/produits', () => {
  it('retourne 401 sans token', async () => {
    const res = await app.request('/api/shop-erp/produits')
    expect(res.status).toBe(401)
  })

  it('retourne la liste des produits avec un token valide', async () => {
    // syncProduitsShopManquants : Promise.all [produits, produits_shop]
    vi.mocked(supabase.from).mockReturnValueOnce(mkChain({ data: [], error: null }) as never)
    vi.mocked(supabase.from).mockReturnValueOnce(mkChain({ data: [], error: null }) as never)
    // select produits_shop principal
    vi.mocked(supabase.from).mockReturnValueOnce(mkChain({
      data: [{
        product_id: 'p1', visible_shop: true, prix_public: 5000, description_longue: '', images: [], tags: [],
        delai_fabrication_jours: 3, min_commande: 1, updated_at: '2026-01-01',
        produits: { ref: 'R1', designation: 'P1', description: '', categorie: 'alu', stock_actuel: 10, stock_min: 2, stock_critique: 1, unite: 'm', statut: 'actif' },
      }],
      error: null,
    }) as never)

    const res = await app.request('/api/shop-erp/produits', { headers: new Headers(authHeaders('admin')) })
    expect(res.status).toBe(200)
    const body = await res.json() as { data: unknown[]; total: number }
    expect(body.total).toBe(1)
  })
})

describe('PUT /api/shop-erp/produits/:id/visibilite', () => {
  it('retourne 400 si payload invalide (Zod)', async () => {
    const res = await app.request('/api/shop-erp/produits/p1/visibilite', {
      method: 'PUT', headers: new Headers(authHeaders('admin')),
      body: JSON.stringify({ visible: 'oui' }),
    })
    expect(res.status).toBe(400)
  })

  it('retourne 404 si produit introuvable', async () => {
    vi.mocked(supabase.from).mockReturnValueOnce(mkChain({ data: null, error: { message: 'not found' } }) as never)
    const res = await app.request('/api/shop-erp/produits/p1/visibilite', {
      method: 'PUT', headers: new Headers(authHeaders('admin')),
      body: JSON.stringify({ visible: true }),
    })
    expect(res.status).toBe(404)
  })

  it('met à jour la visibilité (happy path)', async () => {
    vi.mocked(supabase.from).mockReturnValueOnce(mkChain({
      data: { product_id: 'p1', visible_shop: false }, error: null,
    }) as never)
    const res = await app.request('/api/shop-erp/produits/p1/visibilite', {
      method: 'PUT', headers: new Headers(authHeaders('admin')),
      body: JSON.stringify({ visible: false }),
    })
    expect(res.status).toBe(200)
    const body = await res.json() as { data: { visible_shop: boolean } }
    expect(body.data.visible_shop).toBe(false)
  })
})

describe('PUT /api/shop-erp/produits/:id/prix', () => {
  it('retourne 400 si prix négatif (Zod)', async () => {
    const res = await app.request('/api/shop-erp/produits/p1/prix', {
      method: 'PUT', headers: new Headers(authHeaders('admin')),
      body: JSON.stringify({ prix: -10 }),
    })
    expect(res.status).toBe(400)
  })

  it('met à jour le prix (happy path)', async () => {
    vi.mocked(supabase.from).mockReturnValueOnce(mkChain({
      data: { product_id: 'p1', prix_public: 7500 }, error: null,
    }) as never)
    const res = await app.request('/api/shop-erp/produits/p1/prix', {
      method: 'PUT', headers: new Headers(authHeaders('admin')),
      body: JSON.stringify({ prix: 7500 }),
    })
    expect(res.status).toBe(200)
    const body = await res.json() as { data: { prix_public: number } }
    expect(body.data.prix_public).toBe(7500)
  })
})
