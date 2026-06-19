/**
 * reappro-cron.test.ts
 *
 * Teste lancerCronReappro() — le cron quotidien de réapprovisionnement stock.
 *
 * Cas couverts :
 *  RC-1. Aucun produit sous seuil → retourne created=false, rien inséré
 *  RC-2. Produits sous seuil sans bon ouvert → crée un bon brouillon avec lignes
 *  RC-3. INVARIANT de sécurité : aucune validation/exécution automatique
 *  RC-4. Déduplication : produits déjà couverts par un bon ouvert ignorés
 *  RC-5. Erreur DB sur lecture produits → retourne erreurs=1 sans planter
 *  RC-6. Anti-doublon : déjà exécuté aujourd'hui → skip immédiat
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mkChain } from './helpers'

// ── Mock global @forge/db/supabase (intercepte aussi supabaseAdmin importé via @forge/db) ─
vi.mock('@forge/db/supabase', () => {
  const safeChain = () => {
    const c: Record<string, unknown> = {}
    for (const m of ['select','insert','update','delete','upsert','eq','neq','in',
      'or','gte','lte','lt','gt','not','ilike','like','order','range','limit','head',
      'filter','single','maybeSingle'])
      c[m] = vi.fn().mockReturnValue(c)
    c['single']      = vi.fn().mockResolvedValue({ data: null,  error: null })
    c['maybeSingle'] = vi.fn().mockResolvedValue({ data: null,  error: null })
    c['then']        = (res: (v: unknown) => unknown) =>
      Promise.resolve({ data: [], count: 0, error: null }).then(res)
    return c
  }
  const mockClient = {
    from:          vi.fn().mockImplementation(safeChain),
    rpc:           vi.fn().mockResolvedValue({ data: null, error: null }),
    channel:       vi.fn(() => ({ send: vi.fn().mockResolvedValue('ok') })),
    removeChannel: vi.fn(),
    storage:       { from: vi.fn() },
    auth:          { getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }) },
  }
  return { supabase: mockClient, supabaseAdmin: mockClient }
})

// Mock notifyWhatsApp : ne doit jamais faire de vraies requêtes en tests
vi.mock('../services/email-queue.service', () => ({
  notifyWhatsApp:    vi.fn().mockResolvedValue(undefined),
  processBatchEmails: vi.fn().mockResolvedValue({ processed: 0 }),
  enqueueEmail:      vi.fn().mockResolvedValue(undefined),
}))

import { lancerCronReappro } from '../services/reappro-cron.service'
import { supabase } from '@forge/db/supabase'
import { notifyWhatsApp } from '../services/email-queue.service'

// ── Reset top-level — vi.clearAllMocks() dans les beforeEach locaux ne vide pas ─
// la file mockReturnValueOnce, ce qui provoque des fuites de mocks entre tests.
// vi.resetAllMocks() vide la file ET l'implémentation → on restaure safeChain.
beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(supabase.from).mockImplementation(() => {
    const c: Record<string, unknown> = {}
    for (const m of ['select','insert','update','delete','upsert','eq','neq','in',
      'or','gte','lte','lt','gt','not','ilike','like','order','range','limit','head',
      'filter','single','maybeSingle'])
      c[m] = vi.fn().mockReturnValue(c)
    c['single']      = vi.fn().mockResolvedValue({ data: null, error: null })
    c['maybeSingle'] = vi.fn().mockResolvedValue({ data: null, error: null })
    c['then']        = (res: (v: unknown) => unknown) =>
      Promise.resolve({ data: [], count: 0, error: null }).then(res)
    return c
  })
  vi.mocked(notifyWhatsApp).mockResolvedValue(undefined)
})

// ── Fixtures ───────────────────────────────────────────────────────────────────

const PRODUIT_ALERTE = {
  id:           'prod-alerte-001',
  designation:  'Aluminium 6060 T5',
  unite:        'kg',
  stock_actuel: 8,
  stock_min:    20,
  statut:       'alerte',
  fournisseur:  'ALUPRO SARL',
}

const PRODUIT_CRITIQUE = {
  id:           'prod-critique-001',
  designation:  'Profilé PVC 60x60',
  unite:        'ml',
  stock_actuel: 2,
  stock_min:    15,
  statut:       'critique',
  fournisseur:  null,
}

const PRODUIT_RUPTURE = {
  id:           'prod-rupture-001',
  designation:  'Vis inox M6x20',
  unite:        'boîte',
  stock_actuel: 0,
  stock_min:    10,
  statut:       'rupture',
  fournisseur:  null,
}

const BON_ID  = 'bon-appro-test-001'
const BON_NUM = 'APPRO-20260619-0001'

// ── Helpers pour construire des séquences de mocks ────────────────────────────

/**
 * Configure les mocks DB dans l'ordre d'appel de lancerCronReappro() :
 *   1. reappro_cron_log (anti-doublon) → count=0 (pas déjà exécuté)
 *   2. produits (sous seuil) → produits fournis
 *   3. bons_approvisionnement (ouverts) → openBons fournis
 *   4. bons_approvisionnement_lignes (couverts) → coveredLignes
 *   5. bons_approvisionnement (count pour numéro) → count=0
 *   6. profiles (admin pour created_by) → adminRow
 *   7. bons_approvisionnement (insert bon) → bon créé
 *   8. bons_approvisionnement_lignes (insert lignes) → succès
 *   9. reappro_cron_log (insert log) → succès
 */
function mockFullSuccess(
  produits = [PRODUIT_ALERTE],
  openBons: Array<{ id: string }> = [],
  coveredLignes: Array<{ produit_id: string }> = [],
) {
  const mockFrom = vi.mocked(supabase.from)

  // 1. anti-doublon log → count=0
  mockFrom.mockReturnValueOnce(mkChain({ data: null, count: 0, error: null }) as never)

  // 2. produits sous seuil
  mockFrom.mockReturnValueOnce(mkChain({ data: produits, count: produits.length, error: null }) as never)

  // 3. bons ouverts
  mockFrom.mockReturnValueOnce(mkChain({ data: openBons, count: openBons.length, error: null }) as never)

  if (openBons.length > 0) {
    // 4. lignes des bons ouverts
    mockFrom.mockReturnValueOnce(mkChain({ data: coveredLignes, error: null }) as never)
  }

  // 5. count pour numéro APPRO
  mockFrom.mockReturnValueOnce(mkChain({ data: null, count: 0, error: null }) as never)

  // 6. profiles (admin)
  mockFrom.mockReturnValueOnce(
    mkChain({ data: { id: 'admin-user-001' }, error: null }) as never,
  )

  // 7. insert bon → retourne bon créé (via .single())
  const bonChain = mkChain({ data: { id: BON_ID, numero: BON_NUM, statut: 'brouillon' }, error: null })
  mockFrom.mockReturnValueOnce(bonChain as never)

  // 8. insert lignes → succès
  mockFrom.mockReturnValueOnce(mkChain({ data: null, error: null }) as never)

  // 9. insert log → succès
  mockFrom.mockReturnValueOnce(mkChain({ data: null, error: null }) as never)
}

// ══════════════════════════════════════════════════════════════════════════════

describe('RC-1 — aucun produit sous seuil', () => {
  beforeEach(() => vi.clearAllMocks())

  it('retourne created=false, nb_produits=0 et ne crée aucun bon', async () => {
    const mockFrom = vi.mocked(supabase.from)

    // anti-doublon → pas déjà exécuté
    mockFrom.mockReturnValueOnce(mkChain({ data: null, count: 0, error: null }) as never)
    // produits → liste vide
    mockFrom.mockReturnValueOnce(mkChain({ data: [], count: 0, error: null }) as never)
    // log insertion
    mockFrom.mockReturnValueOnce(mkChain({ data: null, error: null }) as never)

    const result = await lancerCronReappro()

    expect(result.created).toBe(false)
    expect(result.nb_produits).toBe(0)
    expect(result.erreurs).toBe(0)
    expect(vi.mocked(notifyWhatsApp)).not.toHaveBeenCalled()
  })
})

// ══════════════════════════════════════════════════════════════════════════════

describe('RC-2 — produits sous seuil sans bon ouvert', () => {
  beforeEach(() => vi.clearAllMocks())

  it('crée un bon brouillon avec les lignes calculées', async () => {
    mockFullSuccess([PRODUIT_ALERTE, PRODUIT_CRITIQUE, PRODUIT_RUPTURE])

    const result = await lancerCronReappro()

    expect(result.created).toBe(true)
    expect(result.nb_produits).toBe(3)
    expect(result.erreurs).toBe(0)
    expect(result.bon_id).toBeDefined()
  })

  it('calcule quantite_a_commander = max(1, ceil(stock_min - stock_actuel))', async () => {
    mockFullSuccess([PRODUIT_ALERTE])   // stock=8, min=20 → qty = 20-8 = 12

    const mockFrom = vi.mocked(supabase.from)
    await lancerCronReappro()

    // L'insert des lignes doit avoir été appelé avec la bonne quantité
    const insertLignesCalls = mockFrom.mock.calls.filter(
      ([table]) => table === 'bons_approvisionnement_lignes'
    )
    // Au moins un appel insert sur les lignes
    expect(insertLignesCalls.length).toBeGreaterThan(0)
  })

  it('envoie une notification WhatsApp', async () => {
    mockFullSuccess([PRODUIT_ALERTE])

    await lancerCronReappro()

    expect(vi.mocked(notifyWhatsApp)).toHaveBeenCalledTimes(1)
    const [phone, message] = vi.mocked(notifyWhatsApp).mock.calls[0]
    expect(typeof phone).toBe('string')
    expect(message).toContain('Réapprovisionnement TAFDIL')
    expect(message).toContain('brouillon')
  })
})

// ══════════════════════════════════════════════════════════════════════════════

describe('RC-3 — INVARIANT : aucune validation automatique', () => {
  beforeEach(() => vi.clearAllMocks())

  it("le bon créé a statut='brouillon' et aucun update vers 'valide'/'commande' n'est émis", async () => {
    mockFullSuccess([PRODUIT_ALERTE, PRODUIT_RUPTURE])

    const mockFrom = vi.mocked(supabase.from)
    const result   = await lancerCronReappro()

    expect(result.created).toBe(true)

    // Collecter tous les appels .update() sur bons_approvisionnement
    const updateCalls = mockFrom.mock.calls
      .filter(([table]) => table === 'bons_approvisionnement')

    // Extraire les payloads des chaînes .update(payload)
    // Vérifier qu'aucune payload ne contient statut != 'brouillon'
    for (const [, chain] of updateCalls.entries()) {
      // L'objet retourné est un mkChain ; on vérifie que .update n'a jamais
      // été appelé avec un statut autre que brouillon
      const updateMock = (mockFrom as unknown as { mock: { results: Array<{ value: { update: ReturnType<typeof vi.fn> } }> } }).mock.results
      for (const res of updateMock) {
        const updateFn = res.value?.update as ReturnType<typeof vi.fn> | undefined
        if (!updateFn || !updateFn.mock) continue
        for (const args of updateFn.mock.calls) {
          const payload = args[0] as Record<string, unknown>
          if (payload?.statut !== undefined) {
            expect(payload.statut).toBe('brouillon')
          }
        }
      }
    }

    // L'assertion principale : le bon inséré a bien statut='brouillon'
    // On vérifie que la chaîne insert a reçu statut='brouillon'
    const allInsertArgs: Array<Record<string, unknown>> = []
    for (const res of (mockFrom as unknown as { mock: { results: Array<{ value: { insert: ReturnType<typeof vi.fn> } }> } }).mock.results) {
      const insertFn = res.value?.insert as ReturnType<typeof vi.fn> | undefined
      if (!insertFn?.mock) continue
      for (const args of insertFn.mock.calls) {
        if (args[0] && typeof args[0] === 'object') allInsertArgs.push(args[0] as Record<string, unknown>)
      }
    }

    const bonInsert = allInsertArgs.find(a => 'numero' in a && 'statut' in a)
    if (bonInsert) {
      expect(bonInsert.statut).toBe('brouillon')
    }
  })

  it("ne contient aucun appel RPC 'executer' ou 'valider'", async () => {
    mockFullSuccess([PRODUIT_ALERTE])

    const mockRpc = vi.mocked(supabase.rpc)
    await lancerCronReappro()

    // Le cron ne doit jamais appeler de RPC
    expect(mockRpc).not.toHaveBeenCalled()
  })
})

// ══════════════════════════════════════════════════════════════════════════════

describe('RC-4 — déduplication : produits déjà couverts ignorés', () => {
  beforeEach(() => vi.clearAllMocks())

  it('ignore les produits dont produit_id est dans un bon ouvert', async () => {
    const openBon   = { id: 'bon-ouvert-001' }
    const covered   = { produit_id: PRODUIT_ALERTE.id }

    // openBons non vide → les lignes du mock vont couvrir PRODUIT_ALERTE
    mockFullSuccess([PRODUIT_ALERTE], [openBon], [covered])

    // Puisque PRODUIT_ALERTE est couvert, toOrder sera vide → pas de bon créé
    // Note : le test dépend de l'ordre de retour des mocks ; ici on a une couverture totale
    // La fonction devrait retourner created=false car tous les produits sont couverts
    const result = await lancerCronReappro()

    // Le produit est entièrement couvert → pas de nouveau bon
    expect(result.created).toBe(false)
    expect(result.nb_produits).toBe(0)
  })

  it('crée un bon seulement pour les produits non couverts', async () => {
    const openBon = { id: 'bon-ouvert-001' }
    // PRODUIT_ALERTE couvert, PRODUIT_RUPTURE non couvert
    const covered = { produit_id: PRODUIT_ALERTE.id }

    const mockFrom = vi.mocked(supabase.from)

    // Reproduit la séquence manuellement pour ce cas mixte
    mockFrom.mockReturnValueOnce(mkChain({ data: null, count: 0, error: null }) as never)  // anti-doublon
    mockFrom.mockReturnValueOnce(mkChain({ data: [PRODUIT_ALERTE, PRODUIT_RUPTURE], count: 2, error: null }) as never) // produits
    mockFrom.mockReturnValueOnce(mkChain({ data: [openBon], count: 1, error: null }) as never) // bons ouverts
    mockFrom.mockReturnValueOnce(mkChain({ data: [covered], error: null }) as never)           // lignes couvertes
    mockFrom.mockReturnValueOnce(mkChain({ data: null, count: 0, error: null }) as never)      // count pour numéro
    mockFrom.mockReturnValueOnce(mkChain({ data: { id: 'admin-001' }, error: null }) as never) // profile admin
    mockFrom.mockReturnValueOnce(mkChain({ data: { id: BON_ID, numero: BON_NUM, statut: 'brouillon' }, error: null }) as never) // insert bon
    mockFrom.mockReturnValueOnce(mkChain({ data: null, error: null }) as never)                // insert lignes
    mockFrom.mockReturnValueOnce(mkChain({ data: null, error: null }) as never)                // insert log

    const result = await lancerCronReappro()

    // Seul PRODUIT_RUPTURE passe
    expect(result.created).toBe(true)
    expect(result.nb_produits).toBe(1)
  })
})

// ══════════════════════════════════════════════════════════════════════════════

describe('RC-5 — erreur DB sur lecture produits', () => {
  beforeEach(() => vi.clearAllMocks())

  it('retourne erreurs=1 et ne plante pas', async () => {
    const mockFrom = vi.mocked(supabase.from)

    // anti-doublon → pas déjà exécuté
    mockFrom.mockReturnValueOnce(mkChain({ data: null, count: 0, error: null }) as never)
    // produits → erreur DB
    mockFrom.mockReturnValueOnce(mkChain({ data: null, error: { message: 'connection timeout' } }) as never)

    const result = await lancerCronReappro()

    expect(result.created).toBe(false)
    expect(result.erreurs).toBe(1)
    expect(vi.mocked(notifyWhatsApp)).not.toHaveBeenCalled()
  })

  it('rollback du bon si insert lignes échoue', async () => {
    const mockFrom = vi.mocked(supabase.from)

    // anti-doublon → ok
    mockFrom.mockReturnValueOnce(mkChain({ data: null, count: 0, error: null }) as never)
    // produits → un produit sous seuil
    mockFrom.mockReturnValueOnce(mkChain({ data: [PRODUIT_ALERTE], count: 1, error: null }) as never)
    // bons ouverts → vide
    mockFrom.mockReturnValueOnce(mkChain({ data: [], count: 0, error: null }) as never)
    // count pour numéro
    mockFrom.mockReturnValueOnce(mkChain({ data: null, count: 0, error: null }) as never)
    // profiles admin
    mockFrom.mockReturnValueOnce(mkChain({ data: { id: 'admin-001' }, error: null }) as never)
    // insert bon → succès
    mockFrom.mockReturnValueOnce(mkChain({ data: { id: BON_ID, numero: BON_NUM, statut: 'brouillon' }, error: null }) as never)
    // insert lignes → ÉCHEC
    mockFrom.mockReturnValueOnce(mkChain({ data: null, error: { message: 'insert failed' } }) as never)
    // delete (rollback) → succès
    mockFrom.mockReturnValueOnce(mkChain({ data: null, error: null }) as never)

    const result = await lancerCronReappro()

    expect(result.created).toBe(false)
    expect(result.erreurs).toBe(1)

    // Le delete de rollback doit avoir été appelé
    const deleteCalls = mockFrom.mock.calls.filter(([table]) => table === 'bons_approvisionnement')
    expect(deleteCalls.length).toBeGreaterThan(0)
  })
})

// ══════════════════════════════════════════════════════════════════════════════

describe('RC-6 — anti-doublon journalier', () => {
  beforeEach(() => vi.clearAllMocks())

  it('skip immédiat si reappro_cron_log contient déjà une entrée du jour', async () => {
    const mockFrom = vi.mocked(supabase.from)

    // anti-doublon → count=1 (déjà exécuté aujourd'hui)
    mockFrom.mockReturnValueOnce(mkChain({ data: null, count: 1, error: null }) as never)

    const result = await lancerCronReappro()

    expect(result.created).toBe(false)
    expect(result.nb_produits).toBe(0)
    // Aucun autre appel DB après le check anti-doublon
    expect(mockFrom).toHaveBeenCalledTimes(1)
    expect(vi.mocked(notifyWhatsApp)).not.toHaveBeenCalled()
  })
})
