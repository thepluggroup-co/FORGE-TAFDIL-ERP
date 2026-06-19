/**
 * journee-complete.test.ts — Scénario journée complète TAFDIL
 *
 * Simule une journée de travail de 8h à 18h :
 *   🌅 MATIN     — Ouverture système & alertes stocks         (T01-T03)
 *   🔧 ATELIER   — Workflow bon de sortie : créer→valider→exécuter  (T04-T08)
 *   💼 COMMERCE  — Devis → commande → suivi production        (T09-T13)
 *   💰 FINANCE   — Facture + crédit client                    (T14-T16)
 *   🤖 IA        — Chat assistant & recommandations stock     (T17-T18)
 *   🌇 SOIR      — Inventaire journalier & clôture système    (T19-T20)
 */

import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'
import type { Mock } from 'vitest'
import { mkChain, authHeaders } from '../helpers'

// ── Mocks globaux ──────────────────────────────────────────────────────────────

vi.mock('@forge/db/supabase', () => {
  // Chaîne sûre par défaut — ne crashe jamais, retourne data=[] sans erreur
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
      upload:          vi.fn().mockResolvedValue({ error: null }),
      download:        vi.fn().mockResolvedValue({ data: null, error: { message: 'not found' } }),
      getPublicUrl:    vi.fn().mockReturnValue({ data: { publicUrl: 'https://test.supabase.co/test.pdf' } }),
      createSignedUrl: vi.fn().mockResolvedValue({ data: { signedUrl: 'https://test.supabase.co/signed.pdf' } }),
    }) },
  }
  return { supabase: mockClient, supabaseAdmin: mockClient }
})

vi.mock('../../services/pdf.service', () => ({
  generateDevisPDF:   vi.fn().mockResolvedValue(Buffer.alloc(512)),
  generateFacturePDF: vi.fn().mockResolvedValue(Buffer.alloc(512)),
  uploadPDF:          vi.fn().mockResolvedValue('https://storage.tafdil.cm/doc.pdf'),
}))

vi.mock('../../services/comptabilite.service', () => ({
  genererEcritureVente:            vi.fn().mockResolvedValue(null),
  genererEcritureEncaissement:     vi.fn().mockResolvedValue(null),
  genererEcritureBonSortieInterne: vi.fn().mockResolvedValue(null),
  planComptable:                   [],
  libelleCompte:                   vi.fn().mockReturnValue(''),
}))

vi.mock('../../services/notifications', () => ({
  notifyStatutChange: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@forge/ai', () => ({
  anthropic: {
    messages: { create: vi.fn() },
  },
  FORGE_MODEL: 'claude-haiku-4-5-20251001',
}))

import app from '../../app'
import { supabase } from '@forge/db/supabase'
import { anthropic } from '@forge/ai'

// ── Compteur de résultats ──────────────────────────────────────────────────────

let passed = 0
const TOTAL = 20

afterAll(() => {
  const icon = passed === TOTAL ? '🎉' : '⚠️'
  console.log(`\n${icon}  Journée complète TAFDIL — ${passed}/${TOTAL} tests passés\n`)
})

// ── État partagé entre les phases ──────────────────────────────────────────────

const state = {
  bonId:      '',
  bonNumero:  '',
  clientId:   '',
  devisId:    '',
  commandeId: '',
  factureId:  '',
  creditId:   '',
}

// ── Fixtures ───────────────────────────────────────────────────────────────────

const TODAY    = new Date().toISOString().slice(0, 10)
const TODAY8   = TODAY.replace(/-/g, '')
const YEAR     = new Date().getFullYear()

const BON_ID  = 'bon-jc-uuid-001'
const BON_NUM = `TAF-${TODAY8}-0001`

const BON_SOUMIS = {
  id: BON_ID, numero: BON_NUM, statut: 'soumis',
  demandeur: 'Paul Atangana', motif: 'Maintenance machine soudure',
  notes: null, created_by: 'test-user-uid-001', sync_status: 'synced',
}

const BON_VALIDE = { ...BON_SOUMIS, statut: 'valide' }

const BON_LIGNES = [
  { id: 'lig-001', bon_id: BON_ID, produit_id: 'prod-001',
    designation: 'Fil de soudure', unite: 'kg',
    quantite_demandee: 5, quantite_servie: 0 },
]

const CLIENT_ID = 'client-jc-uuid-001'
const CLIENT = {
  id: CLIENT_ID, nom: 'SOGEA Cameroun', type: 'entreprise',
  telephone: '+237 677 001 001', email: 'sogea@sogea.cm',
  pays: 'Cameroun', statut: 'actif', score_fiabilite: 75, sync_status: 'synced',
}

const DEVIS_ID  = 'devis-jc-uuid-001'
const DEVIS_NUM = `DEV-${TODAY8}-0001`
const DEVIS = {
  id: DEVIS_ID, numero: DEVIS_NUM, client_id: CLIENT_ID,
  client_nom: 'SOGEA Cameroun', statut: 'brouillon',
  date_emission: TODAY, date_validite: `${YEAR}-12-31`,
  validite_jours: 30, acompte_pct: 30,
  total_ht_xaf: 1_000_000, tva_xaf: 192_500, total_ttc_xaf: 1_192_500,
  sync_status: 'synced',
}

const DEVIS_WITH_LIGNES = {
  ...DEVIS,
  devis_lignes: [
    { id: 'dl-001', designation: 'Poutre HEB 200', description: null,
      unite: 'ml', quantite: 10, prix_unitaire_ht_xaf: 100_000,
      total_ht_xaf: 1_000_000, ordre: 0 },
  ],
}

const CMD_ID  = 'cmd-jc-uuid-001'
const CMD_NUM = `CMD-${TODAY8}-0001`
const COMMANDE = {
  id: CMD_ID, numero: CMD_NUM, client_id: CLIENT_ID,
  client_nom: 'SOGEA Cameroun', devis_id: DEVIS_ID,
  statut: 'confirmed', date_commande: TODAY,
  total_ht_xaf: 1_000_000, tva_xaf: 192_500, total_ttc_xaf: 1_192_500,
  acompte_recu_xaf: 357_750, sync_status: 'synced',
}

const FACTURE_ID  = 'fac-jc-uuid-001'
const FACTURE_NUM = `FAC-${YEAR}-0001`
const FACTURE = {
  id: FACTURE_ID, numero: FACTURE_NUM, client_id: CLIENT_ID,
  client_nom: 'SOGEA Cameroun', commande_id: CMD_ID,
  statut: 'brouillon', date_emission: TODAY, date_echeance: `${YEAR}-12-31`,
  total_ht_xaf: 1_000_000, tva_xaf: 192_500, total_ttc_xaf: 1_192_500,
  sync_status: 'synced',
}

const CREDIT_ID  = 'crd-jc-uuid-001'
const CREDIT = {
  id: CREDIT_ID, numero: `CRD-${YEAR}-0001`, client_nom: 'SOGEA Cameroun',
  montant_xaf: 500_000, solde_restant_xaf: 500_000,
  date_debut: TODAY, echeance: `${YEAR}-12-31`,
  statut: 'en_cours', sync_status: 'synced',
}

const mockFrom = () => supabase.from as Mock

// ══════════════════════════════════════════════════════════════════════════════
// 🌅 PHASE 1 — MATIN : Ouverture système
// ══════════════════════════════════════════════════════════════════════════════

describe('🌅 MATIN — Ouverture système', () => {
  beforeEach(() => vi.clearAllMocks())

  it('T01 — GET /health retourne le statut opérationnel', async () => {
    const res = await app.request('/health')
    const body = await res.json() as { status: string; app: string }

    expect(res.status).toBe(200)
    expect(body.status).toBe('ok')
    expect(body.app).toBe('FORGE ERP API')

    passed++
    console.log('✅ T01 — Système opérationnel')
  })

  it('T02 — GET /api/stocks/alertes retourne le tableau des urgences', async () => {
    mockFrom().mockReturnValueOnce(
      mkChain({
        data: [
          { id: 'p1', designation: 'Fil de soudure',  statut: 'rupture',  stock_actuel: 0 },
          { id: 'p2', designation: 'Disque abrasif',  statut: 'critique', stock_actuel: 1 },
          { id: 'p3', designation: 'Huile de coupe',  statut: 'alerte',   stock_actuel: 3 },
        ],
        error: null,
      }) as never,
    )

    const res  = await app.request('/api/stocks/alertes', { headers: authHeaders('admin') })
    const body = await res.json() as { total: number; urgence: { rupture: number; critique: number; alerte: number } }

    expect(res.status).toBe(200)
    expect(body.total).toBe(3)
    expect(body.urgence.rupture).toBe(1)
    expect(body.urgence.critique).toBe(1)
    expect(body.urgence.alerte).toBe(1)

    passed++
    console.log('✅ T02 — Alertes stocks récupérées (3 produits en alerte)')
  })

  it('T03 — GET /api/stocks/inventaire/journalier retourne le rapport complet', async () => {
    // Promise.all : produits en premier, mouvements_stock en second
    mockFrom().mockReturnValueOnce(
      mkChain({
        data: [
          { id: 'p1', designation: 'Fil de soudure', categorie: 'consommable',
            stock_actuel: 50, prix_unitaire_xaf: 5_000, statut: 'normal' },
        ],
        error: null,
      }) as never,
    )
    mockFrom().mockReturnValueOnce(
      mkChain({ data: [], error: null }) as never,
    )

    const res  = await app.request('/api/stocks/inventaire/journalier', { headers: authHeaders('admin') })
    const body = await res.json() as {
      date: string; total_references: number; valeur_totale_xaf: number
      mouvements_du_jour: number; produits: unknown[]; categories: unknown[]
    }

    expect(res.status).toBe(200)
    expect(body.date).toBe(TODAY)
    expect(body.total_references).toBe(1)
    expect(body.valeur_totale_xaf).toBe(250_000)
    expect(body.mouvements_du_jour).toBe(0)
    expect(Array.isArray(body.produits)).toBe(true)

    passed++
    console.log('✅ T03 — Inventaire journalier d\'ouverture récupéré')
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// 🔧 PHASE 2 — ATELIER : Workflow bon de sortie
// ══════════════════════════════════════════════════════════════════════════════

describe('🔧 ATELIER — Workflow bon de sortie', () => {
  beforeEach(() => vi.clearAllMocks())

  it('T04 — POST /api/bons crée un bon avec statut=soumis', async () => {
    // genererNumeroBon : count bons du jour → 0
    mockFrom().mockReturnValueOnce(mkChain({ data: null, count: 0, error: null }) as never)
    // insert bon
    mockFrom().mockReturnValueOnce(mkChain({ data: BON_SOUMIS, error: null }) as never)
    // insert lignes
    mockFrom().mockReturnValueOnce(mkChain({ data: BON_LIGNES, error: null }) as never)

    const res = await app.request('/api/bons', {
      method:  'POST',
      headers: authHeaders('operateur'),
      body:    JSON.stringify({
        demandeur: 'Paul Atangana',
        motif:     'Maintenance machine soudure',
        lignes:    [{ designation: 'Fil de soudure', unite: 'kg', quantite_demandee: 5 }],
      }),
    })
    const body = await res.json() as { id: string; numero: string; statut: string }

    expect(res.status).toBe(201)
    expect(body.statut).toBe('soumis')
    expect(body.numero).toMatch(/^TAF-\d{8}-\d{4}$/)

    state.bonId     = body.id
    state.bonNumero = body.numero

    passed++
    console.log(`✅ T04 — Bon créé : ${body.numero}`)
  })

  it('T05 — GET /api/bons/:id retourne le bon avec ses lignes', async () => {
    mockFrom().mockReturnValueOnce(
      mkChain({
        data:  { ...BON_SOUMIS, bons_sortie_lignes: BON_LIGNES },
        error: null,
      }) as never,
    )

    const res  = await app.request(`/api/bons/${BON_ID}`, { headers: authHeaders('admin') })
    const body = await res.json() as { id: string; bons_sortie_lignes: unknown[] }

    expect(res.status).toBe(200)
    expect(body.id).toBe(BON_ID)
    expect(Array.isArray(body.bons_sortie_lignes)).toBe(true)
    expect(body.bons_sortie_lignes).toHaveLength(1)

    passed++
    console.log('✅ T05 — Bon récupéré avec ses lignes')
  })

  it('T06 — PUT /api/bons/:id/valider approuve le bon', async () => {
    // fetch bon pour vérifier statut=soumis
    mockFrom().mockReturnValueOnce(mkChain({ data: BON_SOUMIS, error: null }) as never)
    // update statut → 'valide'
    mockFrom().mockReturnValueOnce(mkChain({ data: BON_VALIDE, error: null }) as never)

    const res = await app.request(`/api/bons/${BON_ID}/valider`, {
      method:  'PUT',
      headers: authHeaders('admin'),
      body:    JSON.stringify({ decision: 'valide', commentaire: 'Matériel disponible en magasin' }),
    })
    const body = await res.json() as { statut: string }

    expect(res.status).toBe(200)
    expect(body.statut).toBe('valide')

    passed++
    console.log('✅ T06 — Bon validé par le responsable')
  })

  it('T07 — PUT /api/bons/:id/executer avec bon code_unique → succès RPC', async () => {
    // fetch bon (statut=valide)
    mockFrom().mockReturnValueOnce(
      mkChain({
        data:  { ...BON_VALIDE, bons_sortie_lignes: BON_LIGNES },
        error: null,
      }) as never,
    )
    // rpc fn_executer_bon → succès
    vi.mocked(supabase.rpc as Mock).mockResolvedValueOnce({
      data:  { success: true, bon_id: BON_ID },
      error: null,
    })

    const res = await app.request(`/api/bons/${BON_ID}/executer`, {
      method:  'PUT',
      headers: authHeaders('operateur'),
      body:    JSON.stringify({ code_unique: BON_NUM }),
    })
    const body = await res.json() as { success: boolean }

    expect(res.status).toBe(200)
    expect(body.success).toBe(true)

    passed++
    console.log('✅ T07 — Bon exécuté via RPC atomique (stocks déduits)')
  })

  it('T08 — PUT /api/bons/:id/executer avec mauvais code_unique → 422', async () => {
    // fetch bon (statut=valide)
    mockFrom().mockReturnValueOnce(
      mkChain({
        data:  { ...BON_VALIDE, bons_sortie_lignes: BON_LIGNES },
        error: null,
      }) as never,
    )

    const res = await app.request(`/api/bons/${BON_ID}/executer`, {
      method:  'PUT',
      headers: authHeaders('operateur'),
      body:    JSON.stringify({ code_unique: 'MAUVAIS-CODE' }),
    })
    const body = await res.json() as { code: string }

    expect(res.status).toBe(422)
    expect(body.code).toBe('INVALID_CODE')

    passed++
    console.log('✅ T08 — Code unique invalide rejeté (422 INVALID_CODE)')
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// 💼 PHASE 3 — COMMERCE : Devis et commandes
// ══════════════════════════════════════════════════════════════════════════════

describe('💼 COMMERCE — Devis et commandes', () => {
  beforeEach(() => vi.clearAllMocks())

  it('T09 — POST /api/clients crée un nouveau client entreprise', async () => {
    mockFrom().mockReturnValueOnce(mkChain({ data: CLIENT, error: null }) as never)

    const res = await app.request('/api/clients', {
      method:  'POST',
      headers: authHeaders('admin'),
      body:    JSON.stringify({
        nom:       'SOGEA Cameroun',
        type:      'entreprise',
        email:     'sogea@sogea.cm',
        telephone: '+237 677 001 001',
      }),
    })
    const body = await res.json() as { id: string; nom: string }

    expect(res.status).toBe(201)
    expect(body.nom).toBe('SOGEA Cameroun')

    state.clientId = body.id

    passed++
    console.log(`✅ T09 — Client créé : ${body.nom}`)
  })

  it('T10 — POST /api/devis crée un devis avec PDF généré', async () => {
    // genererNumero : count devis du jour → 0
    mockFrom().mockReturnValueOnce(mkChain({ data: null, count: 0, error: null }) as never)
    // insert devis
    mockFrom().mockReturnValueOnce(mkChain({ data: DEVIS, error: null }) as never)
    // insert devis_lignes
    mockFrom().mockReturnValueOnce(
      mkChain({
        data: [{
          id: 'dl-001', devis_id: DEVIS_ID, designation: 'Poutre HEB 200',
          unite: 'ml', quantite: 10, prix_unitaire_ht_xaf: 100_000, total_ht_xaf: 1_000_000,
        }],
        error: null,
      }) as never,
    )

    const res = await app.request('/api/devis', {
      method:  'POST',
      headers: authHeaders('admin'),
      body:    JSON.stringify({
        client_id:           CLIENT_ID,
        client_nom:          'SOGEA Cameroun',
        date_emission:       TODAY,
        date_validite:       `${YEAR}-12-31`,
        conditions_paiement: 'Virement bancaire',
        lignes: [{
          designation: 'Poutre HEB 200', categorie: 'materiaux',
          unite: 'ml', quantite: 10, prix_unitaire_ht_xaf: 100_000,
        }],
      }),
    })
    const body = await res.json() as { id: string; numero: string; total_ttc_xaf: number; pdf_url: string | null }

    expect(res.status).toBe(201)
    expect(body.numero).toMatch(/^DEV-\d{8}-\d{4}$/)
    expect(body.total_ttc_xaf).toBeGreaterThan(0)
    expect(body.pdf_url).toBe('https://storage.tafdil.cm/doc.pdf')

    state.devisId = body.id

    passed++
    console.log(`✅ T10 — Devis créé : ${body.numero} (${body.total_ttc_xaf.toLocaleString()} XAF TTC)`)
  })

  it('T11 — POST /api/devis/:id/transformer-commande crée la commande', async () => {
    // 1 : fetch devis avec lignes
    mockFrom().mockReturnValueOnce(mkChain({ data: DEVIS_WITH_LIGNES, error: null }) as never)
    // 2 : genererNumero pour CMD — count commandes du jour
    mockFrom().mockReturnValueOnce(mkChain({ data: null, count: 0, error: null }) as never)
    // 3 : insert commande
    mockFrom().mockReturnValueOnce(mkChain({ data: COMMANDE, error: null }) as never)
    // 4 : insert commandes_lignes
    mockFrom().mockReturnValueOnce(mkChain({ data: null, error: null }) as never)
    // 5 : update devis → statut='transforme'
    mockFrom().mockReturnValueOnce(mkChain({ data: null, error: null }) as never)
    // 6 : insert historique_commandes
    mockFrom().mockReturnValueOnce(mkChain({ data: null, error: null }) as never)

    const res = await app.request(`/api/devis/${DEVIS_ID}/transformer-commande`, {
      method:  'POST',
      headers: authHeaders('admin'),
    })
    const body = await res.json() as {
      commande: { id: string; numero: string }
      devis_numero:    string
      commande_numero: string
    }

    expect(res.status).toBe(201)
    expect(body.commande).toBeDefined()
    expect(body.devis_numero).toBe(DEVIS_NUM)
    expect(body.commande_numero).toMatch(/^CMD-/)

    state.commandeId = body.commande.id

    passed++
    console.log(`✅ T11 — Commande créée depuis devis ${body.devis_numero} → ${body.commande_numero}`)
  })

  it('T12 — PUT /api/commandes/:id/statut passe en in_production', async () => {
    // fetch commande (statut actuel = confirmed)
    mockFrom().mockReturnValueOnce(
      mkChain({ data: { statut: 'confirmed', numero: CMD_NUM }, error: null }) as never,
    )
    // update statut
    mockFrom().mockReturnValueOnce(
      mkChain({ data: { ...COMMANDE, statut: 'in_production' }, error: null }) as never,
    )
    // insert historique
    mockFrom().mockReturnValueOnce(mkChain({ data: null, error: null }) as never)

    const res = await app.request(`/api/commandes/${CMD_ID}/statut`, {
      method:  'PUT',
      headers: authHeaders('admin'),
      body:    JSON.stringify({ statut: 'in_production', commentaire: 'Début de fabrication atelier' }),
    })
    const body = await res.json() as { statut: string }

    expect(res.status).toBe(200)
    expect(body.statut).toBe('in_production')

    passed++
    console.log('✅ T12 — Commande passée en production')
  })

  it('T13 — PUT /api/commandes/:id/statut passe en pret pour livraison', async () => {
    // fetch commande (statut actuel = in_production)
    mockFrom().mockReturnValueOnce(
      mkChain({ data: { statut: 'in_production', numero: CMD_NUM }, error: null }) as never,
    )
    // update statut
    mockFrom().mockReturnValueOnce(
      mkChain({ data: { ...COMMANDE, statut: 'pret' }, error: null }) as never,
    )
    // insert historique
    mockFrom().mockReturnValueOnce(mkChain({ data: null, error: null }) as never)

    const res = await app.request(`/api/commandes/${CMD_ID}/statut`, {
      method:  'PUT',
      headers: authHeaders('admin'),
      body:    JSON.stringify({ statut: 'pret', commentaire: 'Prête pour enlèvement client' }),
    })
    const body = await res.json() as { statut: string }

    expect(res.status).toBe(200)
    expect(body.statut).toBe('pret')

    passed++
    console.log('✅ T13 — Commande prête pour livraison')
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// 💰 PHASE 4 — FINANCE : Facturation et crédits
// ══════════════════════════════════════════════════════════════════════════════

describe('💰 FINANCE — Facturation et crédits', () => {
  beforeEach(() => vi.clearAllMocks())

  it('T14 — POST /api/factures génère la facture et le PDF', async () => {
    // count factures cette année (pour numéro FAC-YYYY-XXXX)
    mockFrom().mockReturnValueOnce(mkChain({ data: null, count: 0, error: null }) as never)
    // insert facture
    mockFrom().mockReturnValueOnce(mkChain({ data: FACTURE, error: null }) as never)
    // insert factures_lignes
    mockFrom().mockReturnValueOnce(
      mkChain({
        data: [{
          facture_id: FACTURE_ID, designation: 'Poutre HEB 200',
          unite: 'ml', quantite: 10, prix_unitaire_ht_xaf: 100_000, total_ht_xaf: 1_000_000,
        }],
        error: null,
      }) as never,
    )

    const res = await app.request('/api/factures', {
      method:  'POST',
      headers: authHeaders('admin'),
      body:    JSON.stringify({
        client_id:     CLIENT_ID,
        client_nom:    'SOGEA Cameroun',
        commande_id:   CMD_ID,
        date_emission: TODAY,
        date_echeance: `${YEAR}-12-31`,
        lignes: [{
          designation: 'Poutre HEB 200', unite: 'ml',
          quantite: 10, prix_unitaire_ht_xaf: 100_000,
        }],
      }),
    })
    const body = await res.json() as { id: string; numero: string; total_ttc_xaf: number; pdf_url: string | null }

    expect(res.status).toBe(201)
    expect(body.numero).toMatch(/^FAC-\d{4}-\d{4}$/)
    expect(body.total_ttc_xaf).toBeGreaterThan(0)
    expect(body.pdf_url).toBe('https://storage.tafdil.cm/doc.pdf')

    state.factureId = body.id

    passed++
    console.log(`✅ T14 — Facture émise : ${body.numero} (${body.total_ttc_xaf.toLocaleString()} XAF TTC)`)
  })

  it('T15 — POST /api/credits enregistre un crédit client', async () => {
    // count crédits cette année
    mockFrom().mockReturnValueOnce(mkChain({ data: null, count: 0, error: null }) as never)
    // insert credit
    mockFrom().mockReturnValueOnce(mkChain({ data: CREDIT, error: null }) as never)

    const res = await app.request('/api/credits', {
      method:  'POST',
      headers: authHeaders('admin'),
      body:    JSON.stringify({
        client_nom:  'SOGEA Cameroun',
        montant_xaf: 500_000,
        date_debut:  TODAY,
        echeance:    `${YEAR}-12-31`,
      }),
    })
    const body = await res.json() as { id: string; numero: string; statut: string; solde_restant_xaf: number }

    expect(res.status).toBe(201)
    expect(body.numero).toMatch(/^CRD-\d{4}-\d{4}$/)
    expect(body.statut).toBe('en_cours')
    expect(body.solde_restant_xaf).toBe(500_000)

    state.creditId = body.id

    passed++
    console.log(`✅ T15 — Crédit enregistré : ${body.numero} (500 000 XAF)`)
  })

  it('T16 — GET /api/credits/alertes retourne les crédits échus et proches', async () => {
    mockFrom().mockReturnValueOnce(
      mkChain({
        data: [
          { id: 'old-cr-001', numero: 'CRD-2025-0003', client_nom: 'Client ABC',
            statut: 'echu', echeance: '2025-10-31', solde_restant_xaf: 200_000 },
          { id: 'old-cr-002', numero: 'CRD-2025-0007', client_nom: 'Client XYZ',
            statut: 'en_cours', echeance: TODAY, solde_restant_xaf: 150_000 },
        ],
        error: null,
      }) as never,
    )

    const res  = await app.request('/api/credits/alertes', { headers: authHeaders('admin') })
    const body = await res.json() as {
      total: number; echus: number; montant_total_xaf: number
    }

    expect(res.status).toBe(200)
    expect(body.total).toBe(2)
    expect(body.echus).toBe(1)
    expect(body.montant_total_xaf).toBe(350_000)

    passed++
    console.log(`✅ T16 — Alertes crédits : ${body.echus} échu(s), total ${body.montant_total_xaf.toLocaleString()} XAF`)
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// 🤖 PHASE 5 — IA : Assistant et recommandations
// ══════════════════════════════════════════════════════════════════════════════

describe('🤖 IA — Assistant et recommandations stock', () => {
  beforeEach(() => vi.clearAllMocks())

  it('T17 — POST /api/ai/chat répond à une question métier avec contexte live', async () => {
    // fetchForgeContext utilise Promise.allSettled avec 5 requêtes parallèles
    // Ordre : produits critiques → crédits échus → commandes en cours → CA mois → CA mois préc.
    mockFrom().mockReturnValueOnce(mkChain({ data: [], error: null }) as never) // produits critiques
    mockFrom().mockReturnValueOnce(mkChain({ data: [], error: null }) as never) // crédits échus
    mockFrom().mockReturnValueOnce(mkChain({ data: [], error: null }) as never) // commandes en cours
    mockFrom().mockReturnValueOnce(mkChain({ data: [], error: null }) as never) // factures CA mois
    mockFrom().mockReturnValueOnce(mkChain({ data: [], error: null }) as never) // factures CA préc.

    vi.mocked(anthropic.messages.create as Mock).mockResolvedValueOnce({
      content: [{ type: 'text', text: 'Bonjour ! Tous les stocks sont à niveau normal ce matin.' }],
      usage:   { input_tokens: 180, output_tokens: 22 },
    })

    const res = await app.request('/api/ai/chat', {
      method:  'POST',
      headers: authHeaders('admin'),
      body:    JSON.stringify({ message: 'Donne-moi un résumé de la situation du jour.' }),
    })
    const body = await res.json() as { reply: string; contexte_charge: boolean; usage: { input_tokens: number; output_tokens: number } }

    expect(res.status).toBe(200)
    expect(body.reply).toBeTruthy()
    expect(body.contexte_charge).toBe(true)
    expect(body.usage.input_tokens).toBeGreaterThan(0)

    passed++
    console.log('✅ T17 — Assistant IA a répondu avec contexte live chargé')
  })

  it('T18 — GET /ai/recommandations/stock retourne des recommandations parsées', async () => {
    // Deux appels parallèles : produits puis mouvements_stock (90j)
    mockFrom().mockReturnValueOnce(
      mkChain({
        data: [
          { id: 'p1', ref: 'ALU-001', designation: 'Aluminium 6060', categorie: 'matiere_premiere',
            stock_actuel: 0, stock_min: 50, stock_critique: 10,
            prix_unitaire_xaf: 2_500, statut: 'rupture' },
        ],
        error: null,
      }) as never,
    )
    mockFrom().mockReturnValueOnce(
      mkChain({
        data: [
          { produit_id: 'p1', type: 'sortie', quantite: 100, created_at: TODAY },
        ],
        error: null,
      }) as never,
    )

    vi.mocked(anthropic.messages.create as Mock).mockResolvedValueOnce({
      content: [{
        type: 'text',
        text: '[{"produit_id":"p1","nom":"Aluminium 6060","quantite_suggeree":200,"urgence":"critique","raison":"Rupture de stock — consommation mensuelle ~34 kg"}]',
      }],
      usage: { input_tokens: 500, output_tokens: 80 },
    })

    const res = await app.request('/api/ai/recommandations/stock', {
      headers: authHeaders('admin'),
    })
    const body = await res.json() as {
      recommandations: Array<{ produit_id: string; urgence: string; quantite_suggeree: number }>
      nb_produits_analyses: number
      periode_analyse: string
    }

    expect(res.status).toBe(200)
    expect(Array.isArray(body.recommandations)).toBe(true)
    expect(body.recommandations).toHaveLength(1)
    expect(body.recommandations[0].urgence).toBe('critique')
    expect(body.recommandations[0].quantite_suggeree).toBe(200)
    expect(body.nb_produits_analyses).toBe(1)
    expect(body.periode_analyse).toBe('90 derniers jours')

    passed++
    console.log(`✅ T18 — ${body.recommandations.length} recommandation(s) IA générée(s)`)
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// 🌇 PHASE 6 — SOIR : Inventaire journalier de clôture
// ══════════════════════════════════════════════════════════════════════════════

describe('🌇 SOIR — Inventaire journalier et clôture', () => {
  beforeEach(() => vi.clearAllMocks())

  it('T19 — GET /api/stocks/inventaire/journalier enregistre les mouvements du jour', async () => {
    // produits en fin de journée
    mockFrom().mockReturnValueOnce(
      mkChain({
        data: [
          { id: 'p1', designation: 'Fil de soudure', categorie: 'consommable',
            stock_actuel: 45, prix_unitaire_xaf: 5_000, statut: 'normal' },
        ],
        error: null,
      }) as never,
    )
    // mouvements du jour (le bon exécuté en T07 = 1 sortie)
    mockFrom().mockReturnValueOnce(
      mkChain({
        data: [
          { id: 'mv-001', type: 'sortie', quantite: 5, produit_id: 'p1',
            created_at: new Date().toISOString() },
        ],
        error: null,
      }) as never,
    )

    const res  = await app.request('/api/stocks/inventaire/journalier', { headers: authHeaders('admin') })
    const body = await res.json() as {
      date: string; total_references: number; valeur_totale_xaf: number; mouvements_du_jour: number
    }

    expect(res.status).toBe(200)
    expect(body.date).toBe(TODAY)
    expect(body.mouvements_du_jour).toBe(1)
    expect(body.valeur_totale_xaf).toBe(225_000) // 45 × 5 000

    passed++
    console.log(`✅ T19 — Inventaire de clôture : ${body.mouvements_du_jour} mouvement(s) du jour`)
  })

  it('T20 — GET /health confirme la fermeture système en bonne santé', async () => {
    const res  = await app.request('/health')
    const body = await res.json() as { status: string; app: string; version: string }

    expect(res.status).toBe(200)
    expect(body.status).toBe('ok')
    expect(body.version).toBe('1.0.0')

    passed++
    console.log('✅ T20 — Système fermé correctement — journée terminée')
  })
})
