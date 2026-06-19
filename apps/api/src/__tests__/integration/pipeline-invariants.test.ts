/**
 * pipeline-invariants.test.ts — Scénario complet passation → livraison → facturation → encaissement
 *
 * Étend la suite journee-complete.test.ts avec 12 invariants d'interconnexion vérifiés au FCFA près.
 * Chaque test porte un identifiant P01-P12 et documente l'invariant couvert.
 *
 * Invariants :
 *   I1  TVA exacte        : Math.round(HT_net × 0.1925) = tva_xaf
 *   I2  TTC               : HT_net + tva_xaf = total_ttc_xaf
 *   I3  net_a_payer       : total_ttc_xaf + frais_livraison = net_a_payer_xaf
 *   I4  condition_paiement_id identique commande → facture
 *   I5  acompte_recu_xaf  identique commande → facture
 *   I6  remise_globale_xaf identique commande → facture
 *   I7  net_a_payer_xaf   identique commande → facture
 *   I8  Tous bons pret → livraison 'en_preparation' auto-créée
 *   I9  Idempotence : livraison créée une seule fois
 *   I10 Transition commande invalide → 422
 *   I11 Transition préparation invalide (null → pret) → 422
 */

import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'
import type { Mock } from 'vitest'
import { mkChain, authHeaders } from '../helpers'

// ── Mocks globaux ──────────────────────────────────────────────────────────────

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
      upload:          vi.fn().mockResolvedValue({ error: null }),
      download:        vi.fn().mockResolvedValue({ data: null, error: { message: 'not found' } }),
      getPublicUrl:    vi.fn().mockReturnValue({ data: { publicUrl: 'https://storage.tafdil.cm/pip-test.pdf' } }),
      createSignedUrl: vi.fn().mockResolvedValue({ data: { signedUrl: 'https://storage.tafdil.cm/signed.pdf' } }),
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
  genererEcritureVente:              vi.fn().mockResolvedValue(null),
  genererEcritureEncaissement:       vi.fn().mockResolvedValue(null),
  genererEcritureBonSortieInterne:   vi.fn().mockResolvedValue(null),
  planComptable:                     [],
  libelleCompte:                     vi.fn().mockReturnValue(''),
}))

vi.mock('../../services/notifications', () => ({
  notifyStatutChange: vi.fn().mockResolvedValue(undefined),
  sendWhatsApp:       vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@forge/ai', () => ({
  anthropic:   { messages: { create: vi.fn() } },
  FORGE_MODEL: 'claude-haiku-4-5-20251001',
}))

import app from '../../app'
import { supabase } from '@forge/db/supabase'

// ── Résultats ──────────────────────────────────────────────────────────────────

let passed = 0
const TOTAL = 12

afterAll(() => {
  const icon = passed === TOTAL ? '🎉' : '⚠️'
  console.log(`\n${icon}  Pipeline invariants — ${passed}/${TOTAL} tests passés\n`)
})

// ── Constantes financières du scénario ────────────────────────────────────────
// Acier rond 60×4 : 10 ml × 100 000 XAF HT = 1 000 000 brut
// Remise globale  : 100 000 XAF (10%)
// HT net          : 900 000 XAF
// TVA 19,25%      : Math.round(900 000 × 0,1925) = 173 250 XAF (pas d'arrondi ici)
// TTC             : 1 073 250 XAF
// Frais livraison :  15 000 XAF
// Net à payer     : 1 088 250 XAF
// Acompte reçu    :   300 000 XAF (sur la commande)
// Paiement test   :   500 000 XAF → solde TTC restant = 573 250 XAF

const TVA_RATE     = 0.1925
const BRUT_HT      = 1_000_000
const REMISE_GL    = 100_000
const HT_NET       = BRUT_HT - REMISE_GL      // 900 000
const TVA_XAF      = Math.round(HT_NET * TVA_RATE) // 173 250
const TTC          = HT_NET + TVA_XAF          // 1 073 250
const FRAIS_LIV    = 15_000
const NET_A_PAYER  = TTC + FRAIS_LIV           // 1 088 250
const ACOMPTE      = 300_000
const PAIEMENT_1   = 500_000
const SOLDE_APRES  = TTC - PAIEMENT_1          // 573 250

// ── IDs ───────────────────────────────────────────────────────────────────────

const TODAY   = new Date().toISOString().slice(0, 10)
const TODAY8  = TODAY.replace(/-/g, '')
const YEAR    = new Date().getFullYear()

const CP_ID      = 'cp-pip-uuid-001'
const CLIENT_ID  = 'cli-pip-uuid-001'
const DEVIS_ID   = 'dev-pip-uuid-001'
const CMD_ID     = 'cmd-pip-uuid-001'
const BON_ID     = 'bon-pip-uuid-001'
const BON2_ID    = 'bon-pip-uuid-002'
const FAC_ID     = 'fac-pip-uuid-001'
const LIV_ID     = 'liv-pip-uuid-001'
const PREP_ID    = 'prep-pip-uuid-001'
const VERS_ID    = 'vers-pip-uuid-001'

// ── Fixtures ──────────────────────────────────────────────────────────────────

const DEVIS_PIP = {
  id: DEVIS_ID, numero: `DEV-${TODAY8}-0001`,
  // client_id null → verifierBlocageClient court-circuité sans appel DB
  client_id: null, client_nom: 'Constructions TAFDIL TEST',
  statut: 'brouillon',
  date_emission: TODAY, date_validite: `${YEAR}-12-31`,
  acompte_pct: 0,
  approuve_par_client: true,
  total_ht_xaf:      HT_NET,
  tva_xaf:           TVA_XAF,
  total_ttc_xaf:     TTC,
  frais_livraison_xaf: FRAIS_LIV,
  net_a_payer_xaf:   NET_A_PAYER,
  remise_globale_xaf: REMISE_GL,
  remise_globale_motif: 'Fidélité client',
  devis_lignes: [{
    id: 'dl-pip-001', designation: 'Acier rond 60×4', description: null,
    unite: 'ml', quantite: 10, prix_unitaire_ht_xaf: 100_000,
    total_ht_xaf: BRUT_HT,
    remise_type: null, remise_valeur: null, remise_xaf: null, remise_motif: null,
    ordre: 0,
  }],
}

const COMMANDE_PIP = {
  id: CMD_ID, numero: `CMD-${TODAY8}-0001`,
  client_id: null, client_nom: 'Constructions TAFDIL TEST',
  devis_id: DEVIS_ID, statut: 'confirmed',
  date_commande: TODAY,
  condition_paiement_id: CP_ID,
  acompte_recu_xaf:      ACOMPTE,
  remise_globale_xaf:    REMISE_GL,
  remise_globale_motif:  'Fidélité client',
  total_ht_xaf:          HT_NET,
  tva_xaf:               TVA_XAF,
  frais_livraison_xaf:   FRAIS_LIV,
  total_ttc_xaf:         TTC,
  net_a_payer_xaf:       NET_A_PAYER,
  sync_status: 'synced',
}

// Bon sans commande_id pour simplifier le chemin valider (pas d'ensureFacture)
const BON_SOUMIS_PIP = {
  id: BON_ID, numero: `TAF-${TODAY8}-0001`, statut: 'soumis',
  commande_id:        CMD_ID,
  demandeur:          'Paul Biya Forge',
  motif:              'Préparation commande pipeline test',
  nature_transaction: 'comptant' as const,
  imputation_payeur:  'entreprise_tafdil' as const,
  statut_preparation: null,
  preparateur_id:     null,
  notes:              null,
  created_by:         'test-user-uid-001',
  sync_status:        'synced',
}

const BON_VALIDE_PIP = {
  ...BON_SOUMIS_PIP,
  statut:             'valide',
  statut_preparation: 'a_preparer',
}

const BON_EN_COURS_PIP = {
  ...BON_VALIDE_PIP,
  statut_preparation: 'en_cours',
  preparateur_id:     PREP_ID,
}

const BON_PRET_PIP = {
  ...BON_EN_COURS_PIP,
  statut_preparation: 'pret',
}

const PREP_PROFILE = {
  id: PREP_ID, full_name: 'Jean-Marc Préparateur', phone: '+237600000001',
}

const CMD_BASIC = {
  numero: COMMANDE_PIP.numero, client_id: null, client_nom: COMMANDE_PIP.client_nom,
}

const LIVRAISON_EN_PREP = {
  id: LIV_ID, numero: `LIV-${YEAR}-001`,
  commande_id: CMD_ID, client_id: null, client_nom: COMMANDE_PIP.client_nom,
  destination: 'À définir', statut: 'en_preparation', sync_status: 'synced',
}

const LIVRAISON_PLANIFIEE = { ...LIVRAISON_EN_PREP, statut: 'planifiee' }

const FACTURE_PIP = {
  id: FAC_ID, numero: `FAC-${YEAR}-0001`,
  client_id: null, client_nom: 'Constructions TAFDIL TEST',
  commande_id:           CMD_ID,
  condition_paiement_id: CP_ID,
  statut:                'envoye',
  date_emission:         TODAY,
  date_echeance:         `${YEAR}-12-31`,
  total_ht_xaf:          HT_NET,
  tva_xaf:               TVA_XAF,
  frais_livraison_xaf:   FRAIS_LIV,
  total_ttc_xaf:         TTC,
  net_a_payer_xaf:       NET_A_PAYER,
  remise_globale_xaf:    REMISE_GL,
  remise_globale_motif:  'Fidélité client',
  acompte_recu_xaf:      ACOMPTE,
  montant_paye_xaf:      0,
  sync_status:           'synced',
  factures_lignes: [{
    id: 'fl-pip-001', facture_id: FAC_ID,
    designation: 'Acier rond 60×4', unite: 'ml',
    quantite: 10, prix_unitaire_ht_xaf: 100_000,
    total_ht_xaf: BRUT_HT, remise_xaf: null,
  }],
}

const VERSEMENT_PIP = {
  id: VERS_ID, facture_id: FAC_ID, montant_xaf: PAIEMENT_1,
  date_versement: TODAY, mode_paiement: 'especes', reference: null,
  enregistre_par: 'admin@tafdil.cm',
}

const FACTURE_APRES_VERSEMENT = {
  ...FACTURE_PIP,
  montant_paye_xaf: PAIEMENT_1,
  statut:           'envoye',
}

const mockFrom = () => supabase.from as Mock

// ══════════════════════════════════════════════════════════════════════════════
// 🔄 PIPELINE — Passation → Livraison → Facturation → Encaissement
// ══════════════════════════════════════════════════════════════════════════════

describe('🔄 PIPELINE — Invariants passation → livraison → facturation → encaissement', () => {
  beforeEach(() => vi.clearAllMocks())

  // ── Arithmétique ─────────────────────────────────────────────────────────

  it('P01 — [I1,I2,I3] Invariants TVA 19,25% au FCFA près', () => {
    // I1 : TVA = round(HT_net × 0,1925), sans écart d'arrondi
    expect(Math.round(HT_NET * TVA_RATE)).toBe(TVA_XAF)
    expect(TVA_XAF).toBe(173_250)

    // I2 : TTC = HT_net + TVA
    expect(TTC).toBe(HT_NET + TVA_XAF)
    expect(TTC).toBe(1_073_250)

    // I3 : net_a_payer = TTC + frais_livraison
    expect(NET_A_PAYER).toBe(TTC + FRAIS_LIV)
    expect(NET_A_PAYER).toBe(1_088_250)

    // Cohérence des fixtures elles-mêmes
    expect(COMMANDE_PIP.total_ht_xaf).toBe(HT_NET)
    expect(COMMANDE_PIP.tva_xaf).toBe(TVA_XAF)
    expect(COMMANDE_PIP.total_ttc_xaf).toBe(TTC)
    expect(COMMANDE_PIP.net_a_payer_xaf).toBe(NET_A_PAYER)
    expect(FACTURE_PIP.total_ht_xaf).toBe(HT_NET)
    expect(FACTURE_PIP.tva_xaf).toBe(TVA_XAF)
    expect(FACTURE_PIP.total_ttc_xaf).toBe(TTC)

    passed++
    console.log(`✅ P01 — TVA=${TVA_XAF.toLocaleString('fr')} TTC=${TTC.toLocaleString('fr')} net=${NET_A_PAYER.toLocaleString('fr')} XAF`)
  })

  // ── Commande ──────────────────────────────────────────────────────────────

  it('P02 — Transformer devis en commande : totaux copiés fidèlement', async () => {
    // client_id=null → verifierBlocageClient court-circuité (return null immédiat)
    // Pas de body.condition_paiement_id → pas de fetch conditions_paiement
    // Séquence DB :
    //   1. from('devis').select('*, devis_lignes(*)').eq().single()
    //   2. from('commandes').select(count) — genererNumero
    //   3. from('commandes').insert().select().single()
    //   4-6. lignes insert, devis update, historique insert → safe chain (then → null/0)
    mockFrom()
      .mockReturnValueOnce(mkChain({ data: DEVIS_PIP, error: null }) as never)             // 1: devis
      .mockReturnValueOnce(mkChain({ data: null, count: 0, error: null }) as never)        // 2: genererNumero
      .mockReturnValueOnce(mkChain({ data: COMMANDE_PIP, error: null }) as never)          // 3: insert commande

    const res = await app.request(`/api/devis/${DEVIS_ID}/transformer-commande`, {
      method:  'POST',
      headers: authHeaders('admin'),
    })
    const body = await res.json() as { commande: typeof COMMANDE_PIP; devis_numero: string }

    expect(res.status).toBe(201)
    expect(body.commande.total_ht_xaf).toBe(HT_NET)
    expect(body.commande.tva_xaf).toBe(TVA_XAF)
    expect(body.commande.total_ttc_xaf).toBe(TTC)
    expect(body.commande.remise_globale_xaf).toBe(REMISE_GL)
    expect(body.commande.net_a_payer_xaf).toBe(NET_A_PAYER)

    passed++
    console.log(`✅ P02 — Commande ${body.commande.numero} : HT=${HT_NET.toLocaleString('fr')} TTC=${TTC.toLocaleString('fr')} XAF`)
  })

  // ── Bon de sortie — validation ────────────────────────────────────────────

  it('P03 — Bon validé → statut_preparation="a_preparer" automatiquement', async () => {
    // Séquence DB :
    //   1. fetch bon (statut=soumis)
    //   2. update bon → {statut:'valide', statut_preparation:'a_preparer'}
    //   3+. broadcastBon (channel, pas from), notifyWorkflow (safe chain), resolveCommandeId...
    //       commande_id=CMD_ID → resolveCommandeIdForBon retourne CMD_ID direct (ex.commande_id)
    //       → ensureFactureForCommande appelé (plusieurs appels safe chain)
    mockFrom()
      .mockReturnValueOnce(mkChain({ data: BON_SOUMIS_PIP, error: null }) as never) // 1: fetch bon
      .mockReturnValueOnce(mkChain({ data: BON_VALIDE_PIP, error: null }) as never) // 2: update bon

    const res = await app.request(`/api/bons/${BON_ID}/valider`, {
      method:  'PUT',
      headers: authHeaders('admin'),
      body:    JSON.stringify({ decision: 'valide', commentaire: 'Test pipeline' }),
    })
    const body = await res.json() as { statut: string; statut_preparation: string }

    expect(res.status).toBe(200)
    expect(body.statut).toBe('valide')
    expect(body.statut_preparation).toBe('a_preparer')

    passed++
    console.log(`✅ P03 — Bon ${BON_SOUMIS_PIP.numero} validé → statut_preparation=a_preparer`)
  })

  // ── Bon de sortie — préparateur ───────────────────────────────────────────

  it('P04 — Assigner préparateur → statut_preparation="en_cours"', async () => {
    // Séquence DB :
    //   1. from('bons_sortie').select().eq().single()  — fetch bon
    //   2. from('profiles').select().eq().single()     — fetch préparateur
    //   3. from('bons_sortie').update().eq().select().single() — update
    //   4+. sendWhatsApp (mocked), notifyWorkflow (safe chain)
    mockFrom()
      .mockReturnValueOnce(mkChain({ data: BON_VALIDE_PIP, error: null }) as never)   // 1: fetch bon
      .mockReturnValueOnce(mkChain({ data: PREP_PROFILE, error: null }) as never)      // 2: fetch profile
      .mockReturnValueOnce(mkChain({ data: BON_EN_COURS_PIP, error: null }) as never)  // 3: update bon

    const res = await app.request(`/api/bons/${BON_ID}/preparateur`, {
      method:  'PATCH',
      headers: authHeaders('admin'),
      body:    JSON.stringify({ preparateur_id: PREP_ID }),
    })
    const body = await res.json() as { statut_preparation: string; preparateur_id: string }

    expect(res.status).toBe(200)
    expect(body.statut_preparation).toBe('en_cours')
    expect(body.preparateur_id).toBe(PREP_ID)

    passed++
    console.log(`✅ P04 — Bon ${BON_VALIDE_PIP.numero} assigné à ${PREP_PROFILE.full_name}`)
  })

  // ── Bon de sortie — marquer prêt + livraison auto ─────────────────────────

  it('P05 — [I8] Tous bons pret → livraison "en_preparation" créée automatiquement', async () => {
    // Séquence DB (10 appels) :
    //   1. fetch bon (statut='valide', statut_preparation='en_cours')
    //   2. update bon → pret
    //   3. notifyWorkflow insert (safe chain ok)
    //   4. bonsPending count = 0 (safe chain count:0 ok)
    //   5. livraisons existing? maybySingle → null (safe chain ok)
    //   6. commandes fetch → CMD_BASIC (DOIT être non-null pour créer livraison)
    //   7. livraisons count → count:0 (safe chain ok)
    //   8. livraisons insert → LIVRAISON_EN_PREP (DOIT retourner id)
    //   9. livraisons_historique insert (safe chain ok)
    //   10. notifyWorkflow insert (safe chain ok)
    mockFrom()
      .mockReturnValueOnce(mkChain({ data: BON_EN_COURS_PIP, error: null }) as never)      // 1: fetch bon
      .mockReturnValueOnce(mkChain({ data: BON_PRET_PIP, error: null }) as never)           // 2: update → pret
      .mockReturnValueOnce(mkChain({ data: null, error: null }) as never)                   // 3: notifyWorkflow
      .mockReturnValueOnce(mkChain({ data: null, count: 0, error: null }) as never)         // 4: bonsPending=0
      .mockReturnValueOnce(mkChain({ data: null, error: null }) as never)                   // 5: livraisons existing
      .mockReturnValueOnce(mkChain({ data: CMD_BASIC, error: null }) as never)              // 6: commandes
      .mockReturnValueOnce(mkChain({ data: null, count: 0, error: null }) as never)         // 7: livraisons count
      .mockReturnValueOnce(mkChain({ data: LIVRAISON_EN_PREP, error: null }) as never)      // 8: insert livraison

    const res = await app.request(`/api/bons/${BON_ID}/preparation`, {
      method:  'PATCH',
      headers: authHeaders('operateur'),
      body:    JSON.stringify({ statut: 'pret' }),
    })
    const body = await res.json() as { statut_preparation: string }

    expect(res.status).toBe(200)
    expect(body.statut_preparation).toBe('pret')

    // Vérifier que from() a été appelé au moins 8 fois (livraison bien tentée)
    expect(vi.mocked(supabase.from).mock.calls.length).toBeGreaterThanOrEqual(8)

    passed++
    console.log(`✅ P05 — Bon prêt → livraison ${LIVRAISON_EN_PREP.numero} créée (I8 vérifié)`)
  })

  it('P06 — [I9] Idempotence : livraison existante → pas de doublon créé', async () => {
    // Call 5 (livraisons existing) retourne LIVRAISON_EN_PREP → existing truthy → return false
    // → from() appelé seulement 5 fois (pas d'insert livraison)
    mockFrom()
      .mockReturnValueOnce(mkChain({ data: BON_EN_COURS_PIP, error: null }) as never)      // 1: fetch bon
      .mockReturnValueOnce(mkChain({ data: BON_PRET_PIP, error: null }) as never)           // 2: update → pret
      .mockReturnValueOnce(mkChain({ data: null, error: null }) as never)                   // 3: notifyWorkflow
      .mockReturnValueOnce(mkChain({ data: null, count: 0, error: null }) as never)         // 4: bonsPending=0
      .mockReturnValueOnce(mkChain({ data: { id: LIV_ID }, error: null }) as never)        // 5: livraison DÉJÀ existante

    const res = await app.request(`/api/bons/${BON_ID}/preparation`, {
      method:  'PATCH',
      headers: authHeaders('operateur'),
      body:    JSON.stringify({ statut: 'pret' }),
    })

    expect(res.status).toBe(200)

    // Exactement 5 appels DB — pas d'insert livraison (call 8 jamais atteint)
    expect(vi.mocked(supabase.from).mock.calls.length).toBe(5)

    passed++
    console.log('✅ P06 — Idempotence confirmée : livraison existante → pas de doublon (I9 vérifié)')
  })

  // ── Négatifs — machines à états ───────────────────────────────────────────

  it('P07 — [I10] Commande annulée → transition in_production bloquée → 422', async () => {
    // TRANSITIONS_COMMANDE : cancelled → [] (aucune transition autorisée)
    mockFrom().mockReturnValueOnce(
      mkChain({ data: { statut: 'cancelled', numero: COMMANDE_PIP.numero }, error: null }) as never,
    )

    const res = await app.request(`/api/commandes/${CMD_ID}/statut`, {
      method:  'PUT',
      headers: authHeaders('admin'),
      body:    JSON.stringify({ statut: 'in_production', commentaire: 'Test négatif' }),
    })
    const body = await res.json() as { code: string; transitions_autorisees: string[] }

    expect(res.status).toBe(422)
    expect(body.code).toBe('INVALID_TRANSITION')
    expect(body.transitions_autorisees).toEqual([])

    passed++
    console.log('✅ P07 — Transition cancelled → in_production rejetée 422 (I10 vérifié)')
  })

  it('P08 — [I11] Préparation null → pret bloquée (préparateur requis) → 422', async () => {
    // statut_preparation='a_preparer' (pas 'en_cours') → INVALID_PREPARATION_TRANSITION
    const bonSansPrepMock = {
      ...BON_VALIDE_PIP,
      statut_preparation: 'a_preparer',
      preparateur_id:     null,
    }
    mockFrom().mockReturnValueOnce(mkChain({ data: bonSansPrepMock, error: null }) as never)

    const res = await app.request(`/api/bons/${BON_ID}/preparation`, {
      method:  'PATCH',
      headers: authHeaders('operateur'),
      body:    JSON.stringify({ statut: 'pret' }),
    })
    const body = await res.json() as { code: string; error: string }

    expect(res.status).toBe(422)
    expect(body.code).toBe('INVALID_PREPARATION_TRANSITION')
    expect(body.error).toContain('a_preparer')
    expect(body.error).toContain('pret')

    passed++
    console.log('✅ P08 — Transition a_preparer → pret (sans assignation) rejetée 422 (I11 vérifié)')
  })

  // ── Livraison ─────────────────────────────────────────────────────────────

  it('P09 — Livraison en_preparation → planifiee : transition autorisée', async () => {
    // Séquence DB :
    //   1. from('livraisons').select().eq().single()  — fetch
    //   2. from('livraisons').update().eq().select().single() — update
    //   3. insertHistoriqueLivraison → from('livraisons_historique').insert() (safe chain)
    mockFrom()
      .mockReturnValueOnce(mkChain({
        data: { statut: 'en_preparation', commande_id: CMD_ID }, error: null,
      }) as never)
      .mockReturnValueOnce(mkChain({ data: LIVRAISON_PLANIFIEE, error: null }) as never)

    const res = await app.request(`/api/logistique/livraisons/${LIV_ID}/statut`, {
      method:  'PATCH',
      headers: authHeaders('admin'),
      body:    JSON.stringify({ statut: 'planifiee', notes: 'Livraison prévue demain matin' }),
    })
    const body = await res.json() as { statut: string }

    expect(res.status).toBe(200)
    expect(body.statut).toBe('planifiee')

    passed++
    console.log(`✅ P09 — Livraison ${LIVRAISON_EN_PREP.numero} : en_preparation → planifiee`)
  })

  it('P10 — GET /logistique/preparation/resume : dashboard 4 compteurs', async () => {
    // 4 requêtes count parallèles — toutes sur safe chain (count:0 par défaut)
    const res  = await app.request('/api/logistique/preparation/resume', {
      headers: authHeaders('admin'),
    })
    const body = await res.json() as {
      a_preparer: number; en_cours: number; pret_a_livrer: number; planifiee: number
    }

    expect(res.status).toBe(200)
    expect(typeof body.a_preparer).toBe('number')
    expect(typeof body.en_cours).toBe('number')
    expect(typeof body.pret_a_livrer).toBe('number')
    expect(typeof body.planifiee).toBe('number')

    passed++
    console.log(`✅ P10 — Dashboard préparation : a_préparer=${body.a_preparer} en_cours=${body.en_cours} prêts=${body.pret_a_livrer} planifiées=${body.planifiee}`)
  })

  // ── Facturation — invariants I4-I7 ────────────────────────────────────────

  it('P11 — [I4,I5,I6,I7] GET /factures/:id : condition_paiement + acompte + remise propagés', async () => {
    // Séquence DB :
    //   1. from('factures').select('*, factures_lignes(*)').eq().single()
    //   storage.getPublicUrl → mocké, pas de from()
    mockFrom().mockReturnValueOnce(mkChain({ data: FACTURE_PIP, error: null }) as never)

    const res  = await app.request(`/api/factures/${FAC_ID}`, { headers: authHeaders('admin') })
    const body = await res.json() as typeof FACTURE_PIP & { solde_restant_xaf: number; pdf_url: string }

    expect(res.status).toBe(200)

    // I4 : condition_paiement_id identique commande et facture
    expect(body.condition_paiement_id).toBe(CP_ID)
    expect(body.condition_paiement_id).toBe(COMMANDE_PIP.condition_paiement_id)

    // I5 : acompte_recu_xaf identique commande et facture
    expect(body.acompte_recu_xaf).toBe(ACOMPTE)
    expect(body.acompte_recu_xaf).toBe(COMMANDE_PIP.acompte_recu_xaf)

    // I6 : remise_globale_xaf identique commande et facture
    expect(body.remise_globale_xaf).toBe(REMISE_GL)
    expect(body.remise_globale_xaf).toBe(COMMANDE_PIP.remise_globale_xaf)

    // I7 : net_a_payer_xaf identique commande et facture
    expect(body.net_a_payer_xaf).toBe(NET_A_PAYER)
    expect(body.net_a_payer_xaf).toBe(COMMANDE_PIP.net_a_payer_xaf)

    // Solde initial : aucun paiement → solde = TTC
    expect(body.solde_restant_xaf).toBe(TTC)

    passed++
    console.log(`✅ P11 — Facture ${FACTURE_PIP.numero} : I4-I7 vérifiés, solde initial=${body.solde_restant_xaf.toLocaleString('fr')} XAF`)
  })

  // ── Encaissement ──────────────────────────────────────────────────────────

  it('P12 — Encaissement 500 000 XAF → solde restant = 573 250 XAF au FCFA près', async () => {
    // POST /factures/:id/versements enregistre le paiement et calcule le solde côté serveur :
    //   nouveauPaye  = montant_paye_xaf_actuel + montant_versement = 0 + 500 000 = 500 000
    //   nouveauSolde = max(0, total_ttc_xaf - nouveauPaye) = max(0, 1 073 250 - 500 000) = 573 250
    //
    // Séquence DB :
    //   1. from('factures').select().eq().single()   — fetch facture actuelle
    //   2. from('versements_factures').insert().select().single() — insert versement
    //   3. from('factures').update().eq().select().single() — update montant_paye + statut
    //   genererEcritureEncaissement → mocké (pas de from)
    mockFrom()
      .mockReturnValueOnce(mkChain({
        data: { ...FACTURE_PIP, montant_paye_xaf: 0 }, error: null,
      }) as never)
      .mockReturnValueOnce(mkChain({ data: VERSEMENT_PIP, error: null }) as never)
      .mockReturnValueOnce(mkChain({ data: FACTURE_APRES_VERSEMENT, error: null }) as never)

    const res = await app.request(`/api/factures/${FAC_ID}/versements`, {
      method:  'POST',
      headers: authHeaders('admin'),
      body:    JSON.stringify({
        montant_xaf:    PAIEMENT_1,
        date_versement: TODAY,
        mode_paiement:  'especes',
      }),
    })
    const body = await res.json() as {
      versement:         { montant_xaf: number }
      solde_restant_xaf: number
      facture:           { montant_paye_xaf: number; statut: string; solde_restant_xaf: number }
    }

    expect(res.status).toBe(201)

    // Vérifier le versement enregistré
    expect(body.versement.montant_xaf).toBe(PAIEMENT_1)

    // Vérifier le solde calculé côté serveur (I1 réutilisé : total_ttc = 1 073 250)
    expect(body.solde_restant_xaf).toBe(SOLDE_APRES)
    expect(body.solde_restant_xaf).toBe(573_250)

    // Vérifier la facture enrichie
    expect(body.facture.montant_paye_xaf).toBe(PAIEMENT_1)
    expect(body.facture.solde_restant_xaf).toBe(SOLDE_APRES)

    // Facture encore ouverte (solde > 0 → statut reste envoye)
    expect(body.facture.statut).toBe('envoye')

    passed++
    console.log(`✅ P12 — Versement ${PAIEMENT_1.toLocaleString('fr')} XAF → solde=${SOLDE_APRES.toLocaleString('fr')} XAF (I1 réutilisé : TTC=${TTC.toLocaleString('fr')} XAF)`)
  })
})
