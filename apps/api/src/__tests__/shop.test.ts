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
    storage: { createBucket: vi.fn().mockResolvedValue({ data: null, error: null }), from: vi.fn().mockReturnValue({
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
  // Auth optionnelle de POST /api/shop/commandes : 'Bearer invalide' simule un jeton rejeté.
  verifierBearer: async (authHeader: string | undefined) => {
    if (!authHeader?.startsWith('Bearer ') || authHeader === 'Bearer invalide') {
      return { ok: false, status: 401, error: 'Token invalide', code: 'INVALID_TOKEN' }
    }
    return { ok: true, user: { id: 'vendeur-1', email: 'vendeur@tafdil.cm', role: 'operateur' } }
  },
}))
// RBAC mocké directement (plutôt que de laisser tourner le vrai checkPermission
// contre la DB mockée) : shopErpRouter fait désormais un appel DB dans
// requirePermission avant la logique métier des routes, ce qui décale la
// consommation des mockReturnValueOnce destinés aux requêtes des handlers
// (même cause dominante que dans operations.test.ts, cf. docs/DETTE-TESTS-2026-09-26.md).
vi.mock('../services/rbacService', () => ({
  checkPermission:           vi.fn(),
  writeAuditLog:             vi.fn(),
  invalidatePermissionCache: vi.fn(),
}))

import app from '../app'
import { supabase } from '@forge/db/supabase'
import { checkPermission, writeAuditLog } from '../services/rbacService'
import { notifyWorkflow } from '../services/workflow-notifications.service'

/** Autorise la requête suivante — à appeler juste avant chaque app.request() protégé. */
function allow(roleName = 'SUPER_ADMIN') {
  vi.mocked(checkPermission).mockResolvedValueOnce({ allowed: true, roleName })
}

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
const PID = '11111111-1111-1111-1111-111111111111'

/** Séquence DB commune d'une commande anonyme jusqu'à la tarification incluse. */
function mockProduitEtVitrine(opts: {
  prixPublic?: number; visible?: boolean; minCommande?: number; promo?: Record<string, unknown> | null
} = {}) {
  // 1. produits (existence + stock)
  vi.mocked(supabase.from).mockReturnValueOnce(mkChain({
    data: { id: PID, designation: 'Profilé', stock_actuel: 100, unite: 'm', prix_unitaire_xaf: 3000 }, error: null,
  }) as never)
  // 2. produits_shop (prix public, visibilité, minimum)
  vi.mocked(supabase.from).mockReturnValueOnce(mkChain({
    data: [{ product_id: PID, prix_public: opts.prixPublic ?? 5000, visible_shop: opts.visible ?? true, min_commande: opts.minCommande ?? 1 }],
    error: null,
  }) as never)
  // 3. campagnes_produits (promotions actives)
  vi.mocked(supabase.from).mockReturnValueOnce(mkChain({
    data: opts.promo ? [opts.promo] : [], error: null,
  }) as never)
}

/** Suite de la séquence : condition de paiement puis insert commandes_shop (chaîne renvoyée pour inspection). */
function mockConditionEtInsert() {
  vi.mocked(supabase.from).mockReturnValueOnce(mkChain({
    data: { id: 'cp1', acompte_pct: 100, delai_solde_jours: 0 }, error: null,
  }) as never)
  const insertShop = mkChain({ data: { id: 'cs1', ref: 'WEB-2026-ABCDEF' }, error: null })
  vi.mocked(supabase.from).mockReturnValueOnce(insertShop as never)
  // commande ERP : échec volontaire → le reste du workflow est court-circuité
  vi.mocked(supabase.from).mockReturnValueOnce(mkChain({ data: null, error: { message: 'erp skip' } }) as never)
  return insertShop as unknown as { insert: ReturnType<typeof vi.fn> }
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
    mockProduitEtVitrine()
    mockConditionEtInsert()

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
    // 1-3. produit, vitrine, promotions
    mockProduitEtVitrine()
    // 4. lecture condition de paiement
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
    expect(body.ref).toMatch(/^WEB-\d{4}-[A-HJ-NP-Z2-9]{6}$/)
  })
})

// ── Phase 0 bis (D7) : le prix d'une commande web est fixé par le serveur ────

describe('POST /api/shop/commandes — tarification serveur', () => {
  it('ignore un prix falsifié et applique prix_public', async () => {
    mockProduitEtVitrine({ prixPublic: 5000 })
    const insertShop = mockConditionEtInsert()

    const res = await app.request('/api/shop/commandes', {
      method: 'POST', headers: JSON_HEADERS,
      body: JSON.stringify({ ...VALID_COMMANDE, lignes: [{ ...VALID_COMMANDE.lignes[0], prix_unitaire: 1 }] }),
    })

    expect(res.status).toBe(201)
    const body = await res.json() as { montant_ttc: number }
    // 2 × 5000 = 10 000 HT + TVA 19,25 % (1 925), pas de ville → livraison sur devis (0)
    expect(body.montant_ttc).toBe(11925)
    const payload = insertShop.insert.mock.calls[0][0] as { lignes: Array<{ prix_unitaire: number }>; montant_ht: number }
    expect(payload.lignes[0].prix_unitaire).toBe(5000)
    expect(payload.montant_ht).toBe(10000)
  })

  it('applique la promotion active, comme le catalogue affiché', async () => {
    mockProduitEtVitrine({
      prixPublic: 5000,
      promo: {
        campagne_id: 'camp-1', product_id: PID, remise_type: 'pct', remise_valeur: 10,
        prix_promo_xaf: null, priorite: 1, campagnes_marketing: { nom: 'Rentrée', date_fin: '2099-12-31' },
      },
    })
    const insertShop = mockConditionEtInsert()

    const res = await app.request('/api/shop/commandes', {
      method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(VALID_COMMANDE),
    })

    expect(res.status).toBe(201)
    const payload = insertShop.insert.mock.calls[0][0] as { lignes: Array<{ prix_unitaire: number }> }
    expect(payload.lignes[0].prix_unitaire).toBe(4500)
  })

  it('recalcule les frais de livraison depuis la ville (frais envoyés ignorés)', async () => {
    mockProduitEtVitrine({ prixPublic: 5000 })
    const insertShop = mockConditionEtInsert()

    const res = await app.request('/api/shop/commandes', {
      method: 'POST', headers: JSON_HEADERS,
      body: JSON.stringify({ ...VALID_COMMANDE, client_ville: 'Douala', frais_livraison: 0 }),
    })

    expect(res.status).toBe(201)
    const payload = insertShop.insert.mock.calls[0][0] as { frais_livraison: number; montant_ttc: number }
    expect(payload.frais_livraison).toBe(2000)
    expect(payload.montant_ttc).toBe(13925)
  })

  it('refuse un produit non visible en ligne (422 PRODUIT_NON_EN_VENTE)', async () => {
    mockProduitEtVitrine({ visible: false })
    const res = await app.request('/api/shop/commandes', {
      method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(VALID_COMMANDE),
    })
    expect(res.status).toBe(422)
    expect((await res.json() as { code: string }).code).toBe('PRODUIT_NON_EN_VENTE')
  })

  it('refuse un produit sans prix public (422 PRIX_INDISPONIBLE)', async () => {
    mockProduitEtVitrine({ prixPublic: 0 })
    const res = await app.request('/api/shop/commandes', {
      method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(VALID_COMMANDE),
    })
    expect(res.status).toBe(422)
    expect((await res.json() as { code: string }).code).toBe('PRIX_INDISPONIBLE')
  })

  it('refuse une quantité sous le minimum de commande (422 QUANTITE_MINIMALE)', async () => {
    mockProduitEtVitrine({ minCommande: 5 })
    const res = await app.request('/api/shop/commandes', {
      method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(VALID_COMMANDE),
    })
    expect(res.status).toBe(422)
    expect((await res.json() as { code: string }).code).toBe('QUANTITE_MINIMALE')
  })

  it('refuse une vente « boutique » anonyme (403)', async () => {
    const res = await app.request('/api/shop/commandes', {
      method: 'POST', headers: JSON_HEADERS,
      body: JSON.stringify({ ...VALID_COMMANDE, source: 'boutique', mode_livraison: 'retrait_boutique' }),
    })
    expect(res.status).toBe(403)
  })

  it('refuse un jeton présent mais invalide, sans repli silencieux sur le prix catalogue (401)', async () => {
    const res = await app.request('/api/shop/commandes', {
      method: 'POST', headers: { ...JSON_HEADERS, Authorization: 'Bearer invalide' },
      body: JSON.stringify(VALID_COMMANDE),
    })
    expect(res.status).toBe(401)
  })

  it('refuse un membre du personnel sans droit de vente (403)', async () => {
    vi.mocked(checkPermission)
      .mockResolvedValueOnce({ allowed: false, roleName: 'READONLY' })
      .mockResolvedValueOnce({ allowed: false, roleName: 'READONLY' })
    const res = await app.request('/api/shop/commandes', {
      method: 'POST', headers: { ...JSON_HEADERS, Authorization: 'Bearer valide' },
      body: JSON.stringify(VALID_COMMANDE),
    })
    expect(res.status).toBe(403)
  })

  it('laisse le personnel autorisé fixer un prix, et trace l’écart (VENTE_PRIX_FORCE)', async () => {
    allow('COMMERCIAL')
    // personnel : pas de lecture des promotions
    vi.mocked(supabase.from).mockReturnValueOnce(mkChain({
      data: { id: PID, designation: 'Profilé', stock_actuel: 100, unite: 'm', prix_unitaire_xaf: 3000 }, error: null,
    }) as never)
    vi.mocked(supabase.from).mockReturnValueOnce(mkChain({
      data: [{ product_id: PID, prix_public: 5000, visible_shop: true, min_commande: 1 }], error: null,
    }) as never)
    const insertShop = mockConditionEtInsert()

    const res = await app.request('/api/shop/commandes', {
      method: 'POST', headers: { ...JSON_HEADERS, Authorization: 'Bearer valide' },
      body: JSON.stringify({ ...VALID_COMMANDE, lignes: [{ ...VALID_COMMANDE.lignes[0], prix_unitaire: 4000 }] }),
    })

    expect(res.status).toBe(201)
    const payload = insertShop.insert.mock.calls[0][0] as { lignes: Array<{ prix_unitaire: number }> }
    expect(payload.lignes[0].prix_unitaire).toBe(4000)
    expect(writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      actionType: 'VENTE_PRIX_FORCE',
      userId:     'vendeur-1',
      payloadAfter: expect.objectContaining({
        ecarts: [{ product_id: PID, prix_reference: 5000, prix_saisi: 4000 }],
      }),
    }))
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

    allow()
    const res = await app.request('/api/shop-erp/produits', { headers: new Headers(authHeaders('admin')) })
    expect(res.status).toBe(200)
    const body = await res.json() as { data: unknown[]; total: number }
    expect(body.total).toBe(1)
  })
})

describe('PUT /api/shop-erp/produits/:id/visibilite', () => {
  it('retourne 400 si payload invalide (Zod)', async () => {
    allow()
    const res = await app.request('/api/shop-erp/produits/p1/visibilite', {
      method: 'PUT', headers: new Headers(authHeaders('admin')),
      body: JSON.stringify({ visible: 'oui' }),
    })
    expect(res.status).toBe(400)
  })

  it('retourne 404 si produit introuvable', async () => {
    allow()
    vi.mocked(supabase.from).mockReturnValueOnce(mkChain({ data: null, error: { message: 'not found' } }) as never)
    const res = await app.request('/api/shop-erp/produits/p1/visibilite', {
      method: 'PUT', headers: new Headers(authHeaders('admin')),
      body: JSON.stringify({ visible: true }),
    })
    expect(res.status).toBe(404)
  })

  it('met à jour la visibilité (happy path)', async () => {
    allow()
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
    allow()
    const res = await app.request('/api/shop-erp/produits/p1/prix', {
      method: 'PUT', headers: new Headers(authHeaders('admin')),
      body: JSON.stringify({ prix: -10 }),
    })
    expect(res.status).toBe(400)
  })

  it('met à jour le prix (happy path)', async () => {
    allow()
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

// ══════════════════════════════════════════════════════════════════════════════
// Catalogue Hybride — Phase 2 : produits finis STANDARD vendus en ligne
// ══════════════════════════════════════════════════════════════════════════════

const MID = '22222222-2222-4222-8222-222222222222'

/** Ligne modeles_shop + modèle + famille, telle que renvoyée par SELECT_MODELE_VITRINE. */
function rowModele(opts: {
  typeGamme?: 'catalogue' | 'configuration' | 'sur_mesure' | null
  typeGammeFamille?: 'catalogue' | 'configuration' | 'sur_mesure'
  visible?: boolean; prix?: number; min?: number; actif?: boolean
} = {}) {
  return {
    modele_id: MID, prix_public: opts.prix ?? 350000, visible_shop: opts.visible ?? true,
    description_longue: 'Portail battant acier', images: [], tags: [],
    delai_fabrication_jours: 10, min_commande: opts.min ?? 1,
    modeles: {
      id: MID, reference: 'P001', designation: 'Portail P001', description: null,
      unite_facturation: 'unite', type_gamme: opts.typeGamme === undefined ? 'catalogue' : opts.typeGamme,
      actif: opts.actif ?? true,
      familles: { nom: 'Portail', type_gamme: opts.typeGammeFamille ?? 'configuration' },
    },
  }
}

const COMMANDE_MODELE = {
  client_nom:       'Awa Test',
  client_telephone: '690123456',
  client_adresse:   'Kotto, Douala',
  lignes: [{ modele_id: MID, designation: 'Portail P001', quantite: 1, prix_unitaire: 350000 }],
  mode_paiement:    'mtn_momo',
}

describe('GET /api/shop/catalogue — produits finis STANDARD', () => {
  it('liste un modèle STANDARD visible, sur commande, avant les articles de stock', async () => {
    vi.mocked(supabase.from).mockReturnValueOnce(mkChain({ data: [], error: null }) as never)          // produits_shop (vide → pas de lecture des promotions)
    vi.mocked(supabase.from).mockReturnValueOnce(mkChain({                                              // modeles_shop
      data: [rowModele(), rowModele({ typeGamme: 'configuration' })], error: null,
    }) as never)

    const res = await app.request('/api/shop/catalogue')
    expect(res.status).toBe(200)
    const body = await res.json() as { data: Array<Record<string, unknown>>; total: number }
    expect(body.total).toBe(2)
    expect(body.data[0]).toMatchObject({
      id: MID, type_article: 'modele', commercial_mode: 'STANDARD', nom: 'Portail P001',
      prix_public: 350000, disponibilite: 'sur_commande', stock_actuel: null, categorie: 'Portail',
    })
    // Phase 3 : le modèle configurable est affiché SANS prix (il passe par le configurateur, pas par le panier)
    expect(body.data[1]).toMatchObject({ commercial_mode: 'CONFIGURABLE', prix_public: null, promotion: null })
  })

  it('n’affiche jamais un modèle SUR DEVIS au catalogue produit', async () => {
    vi.mocked(supabase.from).mockReturnValueOnce(mkChain({ data: [], error: null }) as never)
    vi.mocked(supabase.from).mockReturnValueOnce(mkChain({ data: [rowModele({ typeGamme: 'sur_mesure' })], error: null }) as never)
    const res = await app.request('/api/shop/catalogue')
    expect((await res.json() as { total: number }).total).toBe(0)
  })

  it('résout le détail d un modèle quand l id n est pas un article de stock', async () => {
    vi.mocked(supabase.from).mockReturnValueOnce(mkChain({ data: null, error: { code: 'PGRST116' } }) as never) // produits_shop
    vi.mocked(supabase.from).mockReturnValueOnce(mkChain({ data: [rowModele()], error: null }) as never)       // modeles_shop

    const res = await app.request(`/api/shop/catalogue/${MID}`)
    expect(res.status).toBe(200)
    const body = await res.json() as { data: { type_article: string; ref: string } }
    expect(body.data).toMatchObject({ type_article: 'modele', ref: 'P001' })
  })
})

describe('POST /api/shop/commandes — produit fini STANDARD (CAS 1 pilote)', () => {
  it('CAS 1 — Portail P001 à 350 000 FCFA × 1 : commande directe, prix serveur, ligne ERP liée au modèle', async () => {
    vi.mocked(supabase.from).mockReturnValueOnce(mkChain({ data: [rowModele()], error: null }) as never)  // modeles_shop (pas de contrôle de stock)
    vi.mocked(supabase.from).mockReturnValueOnce(mkChain({ data: [], error: null }) as never)             // campagnes_produits (aucune promotion)
    vi.mocked(supabase.from).mockReturnValueOnce(mkChain({                                                 // conditions_paiement
      data: { id: 'cp1', acompte_pct: 100, delai_solde_jours: 0 }, error: null,
    }) as never)
    const insertShop = mkChain({ data: { id: 'cs1', ref: 'WEB-2026-ABCDEF' }, error: null })
    vi.mocked(supabase.from).mockReturnValueOnce(insertShop as never)                                      // commandes_shop
    vi.mocked(supabase.from).mockReturnValueOnce(mkChain({ data: { id: 'erp-1' }, error: null }) as never) // commandes
    vi.mocked(supabase.from).mockReturnValueOnce(mkChain({ data: null, error: null }) as never)            // liaison commandes_shop
    const insertLignes = mkChain({ data: [{ id: 'l1' }], error: null })
    vi.mocked(supabase.from).mockReturnValueOnce(insertLignes as never)                                    // commandes_lignes

    const res = await app.request('/api/shop/commandes', {
      method: 'POST', headers: JSON_HEADERS,
      body: JSON.stringify({ ...COMMANDE_MODELE, lignes: [{ ...COMMANDE_MODELE.lignes[0], prix_unitaire: 1 }] }),
    })

    expect(res.status).toBe(201)
    const body = await res.json() as { montant_ttc: number }
    // 350 000 HT + TVA 19,25 % (67 375) ; pas de ville → livraison sur devis (0)
    expect(body.montant_ttc).toBe(417375)

    const shopPayload = (insertShop.insert as ReturnType<typeof vi.fn>).mock.calls[0][0] as { lignes: Array<Record<string, unknown>> }
    expect(shopPayload.lignes[0]).toMatchObject({ modele_id: MID, product_id: null, prix_unitaire: 350000, type_article: 'modele' })

    const lignesErp = (insertLignes.insert as ReturnType<typeof vi.fn>).mock.calls[0][0] as Array<Record<string, unknown>>
    expect(lignesErp[0]).toMatchObject({ commande_id: 'erp-1', produit_id: null, modele_id: MID, prix_unitaire_ht_xaf: 350000, unite: 'unite' })

    expect(notifyWorkflow).toHaveBeenCalledWith(expect.objectContaining({ event: 'production.commande_standard_a_fabriquer' }))
    expect(notifyWorkflow).not.toHaveBeenCalledWith(expect.objectContaining({ event: 'stock.bon_sortie_a_preparer' }))
  })

  it('refuse un modèle CONFIGURABLE au panier (422 MODE_NON_STANDARD)', async () => {
    vi.mocked(supabase.from).mockReturnValueOnce(mkChain({ data: [rowModele({ typeGamme: null })], error: null }) as never) // hérite de la famille configurable
    const res = await app.request('/api/shop/commandes', {
      method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(COMMANDE_MODELE),
    })
    expect(res.status).toBe(422)
    expect((await res.json() as { code: string }).code).toBe('MODE_NON_STANDARD')
  })

  it('refuse un modèle STANDARD retiré de la vitrine (422 PRODUIT_NON_EN_VENTE)', async () => {
    vi.mocked(supabase.from).mockReturnValueOnce(mkChain({ data: [rowModele({ visible: false })], error: null }) as never)
    const res = await app.request('/api/shop/commandes', {
      method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(COMMANDE_MODELE),
    })
    expect(res.status).toBe(422)
    expect((await res.json() as { code: string }).code).toBe('PRODUIT_NON_EN_VENTE')
  })

  it('refuse un modèle inactif (422 MODE_NON_STANDARD)', async () => {
    vi.mocked(supabase.from).mockReturnValueOnce(mkChain({ data: [rowModele({ actif: false })], error: null }) as never)
    const res = await app.request('/api/shop/commandes', {
      method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(COMMANDE_MODELE),
    })
    expect(res.status).toBe(422)
  })

  it('refuse une ligne qui vise à la fois un produit et un modèle (400)', async () => {
    const res = await app.request('/api/shop/commandes', {
      method: 'POST', headers: JSON_HEADERS,
      body: JSON.stringify({ ...COMMANDE_MODELE, lignes: [{ ...COMMANDE_MODELE.lignes[0], product_id: PID }] }),
    })
    expect(res.status).toBe(400)
  })
})

describe('Vitrine ERP des produits finis — /api/shop-erp/modeles', () => {
  const HEADERS = { ...authHeaders('admin'), 'Content-Type': 'application/json' }

  it('GET liste les modèles STANDARD et CONFIGURABLE, jamais SUR DEVIS', async () => {
    allow()
    vi.mocked(supabase.from).mockReturnValueOnce(mkChain({
      data: [
        { id: MID, reference: 'P001', designation: 'Portail P001', unite_facturation: 'unite', type_gamme: 'catalogue', actif: true, familles: { nom: 'Portail', type_gamme: 'configuration' }, modeles_shop: null },
        { id: 'm3', reference: 'P003', designation: 'Portail P003', unite_facturation: 'unite', type_gamme: null, actif: true, familles: { nom: 'Portail', type_gamme: 'configuration' }, modeles_shop: null },
        { id: 'm9', reference: 'PX', designation: 'Portail personnalisé', unite_facturation: 'forfait', type_gamme: 'sur_mesure', actif: true, familles: { nom: 'Portail', type_gamme: 'configuration' }, modeles_shop: null },
      ],
      error: null,
    }) as never)

    const res = await app.request('/api/shop-erp/modeles', { headers: HEADERS })
    expect(res.status).toBe(200)
    const body = await res.json() as { data: Array<{ reference: string; commercial_mode: string }> }
    expect(body.data.map((m) => `${m.reference}:${m.commercial_mode}`)).toEqual(['P001:STANDARD', 'P003:CONFIGURABLE'])
  })

  it('PUT refuse une vitrine pour un modèle SUR DEVIS (422)', async () => {
    allow()
    vi.mocked(supabase.from).mockReturnValueOnce(mkChain({
      data: { id: MID, designation: 'Portail personnalisé', type_gamme: 'sur_mesure', actif: true, familles: { nom: 'Portail', type_gamme: 'configuration' }, modeles_shop: null },
      error: null,
    }) as never)
    const res = await app.request(`/api/shop-erp/modeles/${MID}/vitrine`, {
      method: 'PUT', headers: HEADERS, body: JSON.stringify({ visible_shop: true, prix_public: 500000 }),
    })
    expect(res.status).toBe(422)
    expect((await res.json() as { code: string }).code).toBe('MODE_NON_VITRINE')
  })

  it('PUT met en ligne un modèle CONFIGURABLE sans prix public (prix calculé par le configurateur)', async () => {
    allow()
    vi.mocked(supabase.from).mockReturnValueOnce(mkChain({
      data: { id: MID, designation: 'Portail P003', type_gamme: null, actif: true, familles: { nom: 'Portail', type_gamme: 'configuration' }, modeles_shop: null },
      error: null,
    }) as never)
    vi.mocked(supabase.from).mockReturnValueOnce(mkChain({ data: { modele_id: MID, visible_shop: true }, error: null }) as never)
    const res = await app.request(`/api/shop-erp/modeles/${MID}/vitrine`, {
      method: 'PUT', headers: HEADERS, body: JSON.stringify({ visible_shop: true }),
    })
    expect(res.status).toBe(200)
  })

  it('PUT refuse une mise en vente sans prix (422 PRIX_REQUIS)', async () => {
    allow()
    vi.mocked(supabase.from).mockReturnValueOnce(mkChain({
      data: { id: MID, designation: 'Portail P001', type_gamme: 'catalogue', actif: true, familles: { nom: 'Portail', type_gamme: 'configuration' }, modeles_shop: null },
      error: null,
    }) as never)
    const res = await app.request(`/api/shop-erp/modeles/${MID}/vitrine`, {
      method: 'PUT', headers: HEADERS, body: JSON.stringify({ visible_shop: true }),
    })
    expect(res.status).toBe(422)
    expect((await res.json() as { code: string }).code).toBe('PRIX_REQUIS')
  })

  it('PUT met en vente P001 à 350 000 et trace le changement de prix', async () => {
    allow()
    vi.mocked(supabase.from).mockReturnValueOnce(mkChain({
      data: { id: MID, designation: 'Portail P001', type_gamme: 'catalogue', actif: true, familles: { nom: 'Portail', type_gamme: 'configuration' }, modeles_shop: [{ prix_public: 300000, visible_shop: false }] },
      error: null,
    }) as never)
    const upsert = mkChain({ data: { modele_id: MID, visible_shop: true, prix_public: 350000 }, error: null })
    vi.mocked(supabase.from).mockReturnValueOnce(upsert as never)

    const res = await app.request(`/api/shop-erp/modeles/${MID}/vitrine`, {
      method: 'PUT', headers: HEADERS, body: JSON.stringify({ visible_shop: true, prix_public: 350000 }),
    })
    expect(res.status).toBe(200)
    expect((upsert.upsert as ReturnType<typeof vi.fn>).mock.calls[0][0]).toEqual({ modele_id: MID, visible_shop: true, prix_public: 350000 })
    expect(writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      actionType: 'PRIX_VITRINE_MODIFIE',
      payloadBefore: { prix_public: 300000 },
      payloadAfter:  { prix_public: 350000 },
    }))
  })
})

// ── Promotions et images des produits finis ─────────────────────────────────

const PROMO_MODELE_10PCT = {
  campagne_id: 'camp-1', modele_id: MID, remise_type: 'pct', remise_valeur: 10,
  prix_promo_xaf: null, priorite: 1, campagnes_marketing: { nom: 'Fête des portails', date_fin: '2099-12-31' },
}

describe('Promotions sur les produits finis STANDARD', () => {
  it('le catalogue affiche le prix remisé et le prix barré', async () => {
    vi.mocked(supabase.from).mockReturnValueOnce(mkChain({ data: [], error: null }) as never)                  // produits_shop
    vi.mocked(supabase.from).mockReturnValueOnce(mkChain({ data: [rowModele()], error: null }) as never)       // modeles_shop
    vi.mocked(supabase.from).mockReturnValueOnce(mkChain({ data: [PROMO_MODELE_10PCT], error: null }) as never) // campagnes_produits

    const res = await app.request('/api/shop/catalogue')
    const body = await res.json() as { data: Array<Record<string, unknown>> }
    expect(body.data[0]).toMatchObject({
      prix_public: 315000, prix_barre_xaf: 350000,
      promotion: expect.objectContaining({ nom: 'Fête des portails', prix_promo_xaf: 315000 }),
    })
  })

  it('la commande applique la même promotion côté serveur', async () => {
    vi.mocked(supabase.from).mockReturnValueOnce(mkChain({ data: [rowModele()], error: null }) as never)       // modeles_shop
    vi.mocked(supabase.from).mockReturnValueOnce(mkChain({ data: [PROMO_MODELE_10PCT], error: null }) as never) // campagnes_produits
    const insertShop = mockConditionEtInsert()

    const res = await app.request('/api/shop/commandes', {
      method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(COMMANDE_MODELE),
    })
    expect(res.status).toBe(201)
    const payload = (insertShop.insert as ReturnType<typeof vi.fn>).mock.calls[0][0] as { lignes: Array<{ prix_unitaire: number }> }
    expect(payload.lignes[0].prix_unitaire).toBe(315000)
  })
})

describe('Campagnes : promotion ciblant un produit fini', () => {
  const HEADERS = { ...authHeaders('admin'), 'Content-Type': 'application/json' }
  const CAMPAGNE_ID = '33333333-3333-4333-8333-333333333333'

  it('POST accepte un modele_id et arbitre les doublons sur (campagne, modèle)', async () => {
    allow()
    vi.mocked(supabase.from).mockReturnValueOnce(mkChain({ data: { id: CAMPAGNE_ID }, error: null }) as never)
    const upsert = mkChain({ data: { id: 'cp1', modele_id: MID }, error: null })
    vi.mocked(supabase.from).mockReturnValueOnce(upsert as never)

    const res = await app.request(`/api/marketing/campagnes/${CAMPAGNE_ID}/produits`, {
      method: 'POST', headers: HEADERS, body: JSON.stringify({ modele_id: MID, remise_type: 'pct', remise_valeur: 10 }),
    })
    expect(res.status).toBe(201)
    const [ligne, options] = (upsert.upsert as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(ligne).toMatchObject({ campagne_id: CAMPAGNE_ID, modele_id: MID })
    expect(ligne).not.toHaveProperty('product_id')
    expect(options).toEqual({ onConflict: 'campagne_id,modele_id' })
  })

  it('POST refuse une ligne sans cible ou avec deux cibles (400)', async () => {
    allow()
    const res = await app.request(`/api/marketing/campagnes/${CAMPAGNE_ID}/produits`, {
      method: 'POST', headers: HEADERS, body: JSON.stringify({ modele_id: MID, product_id: PID, remise_valeur: 5 }),
    })
    expect(res.status).toBe(400)
  })

  it('DELETE refuse un identifiant d’article non UUID (400)', async () => {
    allow()
    const res = await app.request(`/api/marketing/campagnes/${CAMPAGNE_ID}/produits/x),id.neq.0`, {
      method: 'DELETE', headers: HEADERS,
    })
    expect(res.status).toBe(400)
  })
})

describe('POST /api/shop-erp/modeles/:id/images', () => {
  const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...new Array(24).fill(0)])

  it('enregistre les vraies images et refuse un fichier déguisé en .jpg', async () => {
    allow()
    vi.mocked(supabase.from).mockReturnValueOnce(mkChain({ data: { id: MID, modeles_shop: { images: ['https://old/1.png'] } }, error: null }) as never)
    const save = mkChain({ data: null, error: null })
    vi.mocked(supabase.from).mockReturnValueOnce(save as never)

    const form = new FormData()
    form.append('images', new File([PNG], 'portail.png', { type: 'image/png' }))
    form.append('images', new File(['<?php echo 1; ?> pas une image'], 'piege.jpg', { type: 'image/jpeg' }))

    const res = await app.request(`/api/shop-erp/modeles/${MID}/images`, {
      method: 'POST', headers: { Authorization: authHeaders('admin').Authorization }, body: form,
    })

    expect(res.status).toBe(201)
    const body = await res.json() as { data: { urls: string[]; images: string[]; errors: Array<{ file: string }> } }
    expect(body.data.urls).toHaveLength(1)
    expect(body.data.errors.map((e) => e.file)).toEqual(['piege.jpg'])
    expect(body.data.images).toHaveLength(2)
    expect((save.upsert as ReturnType<typeof vi.fn>).mock.calls[0][0]).toMatchObject({ modele_id: MID, images: body.data.images })
  })

  it('retourne 404 pour un modèle inconnu', async () => {
    allow()
    vi.mocked(supabase.from).mockReturnValueOnce(mkChain({ data: null, error: null }) as never)
    const form = new FormData()
    form.append('images', new File([PNG], 'portail.png', { type: 'image/png' }))
    const res = await app.request(`/api/shop-erp/modeles/${MID}/images`, {
      method: 'POST', headers: { Authorization: authHeaders('admin').Authorization }, body: form,
    })
    expect(res.status).toBe(404)
  })
})
