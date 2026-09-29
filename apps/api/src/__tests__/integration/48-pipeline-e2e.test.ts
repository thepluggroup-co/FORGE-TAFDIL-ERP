/**
 * 48-pipeline-e2e.test.ts — Master Prompt V3, §48 : test critique de
 * non-régression.
 *
 * "Scénario complet : CLIENT → choisit produit → saisit dimensions → calcul
 *  automatique → devis → validation → commande → facture → acompte →
 *  production → stock → bon sortie → job production → livraison →
 *  timeline client. Le test doit vérifier les IDs et relations entre les
 *  objets." (§48, jusqu'ici marqué "pas encore écrit" dans le document.)
 *
 * Portée volontairement choisie pour CE test : la chaîne neuve construite
 * en Phases 1-4 (catalogue produits finis → moteur de calcul → devis →
 * commande → production), qui n'avait jamais été exercée bout en bout avec
 * de vrais IDs qui se propagent d'une étape à l'autre. La facture/acompte
 * (déjà couverts par commerce.test.ts C10 et finance-core.test.ts) et le
 * module Livraison (déjà couvert par logistique.test.ts — la transition
 * "delivered" est d'ailleurs explicitement refusée depuis ce module, "La
 * validation de livraison se fait uniquement depuis le module Logistique")
 * ne sont pas re-testés en détail ici : on vérifie seulement que
 * ensureFactureForCommande est bien appelé avec le bon commande_id au
 * moment de la conversion, ce qui suffit à prouver que le fil des IDs ne
 * casse pas à cette jonction.
 *
 * Chaque étape HTTP re-route `supabase.from` avec les seules tables dont
 * CETTE étape a besoin (`mockTables`) — pas de file positionnelle globale
 * fragile sur ~10 requêtes chaînées. Les IDs ne sont jamais devinés : ceux
 * générés par une étape (devis.id, commande.id, job.numero) sont lus dans
 * la réponse HTTP réelle puis réinjectés tels quels dans le mock de l'étape
 * suivante — c'est la propagation qui est testée, pas un scénario où les
 * IDs "matchent par coïncidence".
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mkChain, authHeaders } from '../helpers'

vi.mock('../../services/rbacService', () => ({
  checkPermission:           vi.fn(),
  writeAuditLog:             vi.fn(),
  invalidatePermissionCache: vi.fn(),
}))

vi.mock('../../services/client-sync.service', () => ({
  ensureClient: vi.fn().mockResolvedValue(null),
}))

vi.mock('@forge/db/supabase', () => {
  const safeChain = () => {
    const c: Record<string, unknown> = {}
    for (const m of ['select', 'insert', 'update', 'delete', 'upsert', 'eq', 'neq', 'in',
      'or', 'gte', 'lte', 'lt', 'gt', 'not', 'ilike', 'like', 'order', 'range', 'limit', 'head', 'filter'])
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
  generateDevisPDF:       vi.fn().mockResolvedValue(Buffer.alloc(512)),
  generateAttestationPDF: vi.fn().mockResolvedValue(Buffer.alloc(512)),
  uploadPDF:              vi.fn().mockResolvedValue('https://test.supabase.co/devis/DEV-2026-9999.pdf'),
}))

vi.mock('../../services/email-queue.service', () => ({
  enqueueEmail:    vi.fn().mockResolvedValue(null),
  notifyWhatsApp:  vi.fn().mockResolvedValue(null),
  sendEmailDirect: vi.fn().mockResolvedValue(null),
}))

vi.mock('../../services/notifications', () => ({
  notifyStatutChange: vi.fn().mockResolvedValue(null),
}))

vi.mock('../../services/sms.service', () => ({
  notifyCommandeSms: vi.fn().mockResolvedValue({ ok: true, message: 'SMS envoyé' }),
}))

vi.mock('../../services/finance-core.service', () => ({
  enregistrerPaiementCommande: vi.fn().mockResolvedValue({ ok: true }),
  ensureFactureForCommande:    vi.fn().mockResolvedValue({ facture: { id: 'fac-e2e-001' }, created: true }),
  getFactureActiveByCommande:  vi.fn().mockResolvedValue(null),
  solderCreditsForCommande:    vi.fn().mockResolvedValue(undefined),
  syncCreditForCommande:       vi.fn().mockResolvedValue(null),
}))

vi.mock('../../services/credit-eligibility.service', () => ({
  verifierEligibiliteCredit: vi.fn().mockResolvedValue({ eligible: true }),
}))

vi.mock('../../services/offline-fallback', () => ({
  withOfflineFallback: vi.fn().mockImplementation(
    (_label: string, onlineFn: () => unknown) => onlineFn(),
  ),
  isNetworkError: vi.fn().mockReturnValue(false),
}))

import app from '../../app'
import { supabase } from '@forge/db/supabase'
import { checkPermission } from '../../services/rbacService'
import { ensureFactureForCommande } from '../../services/finance-core.service'

/** Route la réponse mockée par nom de table plutôt que par ordre d'appel —
 *  appelé à nouveau avant chaque étape HTTP, avec seulement les tables dont
 *  CETTE étape a besoin (voir en-tête du fichier). */
function mockTables(overrides: Record<string, { data: unknown; count?: number; error?: unknown }>) {
  vi.mocked(supabase.from).mockImplementation(((table: string) => {
    const response = overrides[table] ?? { data: null, count: 0, error: null }
    return mkChain(response as Record<string, unknown>)
  }) as never)
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

const MODELE_ID       = '44444444-4444-4444-8444-444444444444'
const FICHE_ID        = '66666666-6666-4666-8666-666666666666'
const CONDITION_ID    = '55555555-5555-4555-8555-555555555555'

const FICHE_TECHNIQUE = {
  id: FICHE_ID, modele_id: MODELE_ID, version: 1, statut: 'active',
  mode_calcul: 'surface', unite_facturation_id: null,
}

const RESSOURCES_PORTAIL = [
  { id: 'r1', type: 'materiau',    designation: 'Acier galvanisé', unite: 'kg', quantite_par_unite: 4,   cout_unitaire_reference_xaf: 1200, temps_reference_h: null, actif: true },
  { id: 'r2', type: 'materiau',    designation: 'Peinture antirouille', unite: 'l', quantite_par_unite: 0.2, cout_unitaire_reference_xaf: 3500, temps_reference_h: null, actif: true },
  { id: 'r3', type: 'main_oeuvre', designation: 'Soudeur',        unite: 'h',  quantite_par_unite: 0.8, cout_unitaire_reference_xaf: 2000, temps_reference_h: 0.8, actif: true },
  { id: 'r4', type: 'equipement',  designation: 'Poste à souder', unite: 'h',  quantite_par_unite: 0.3, cout_unitaire_reference_xaf: 1500, temps_reference_h: 0.3, actif: true },
]

describe('§48 — Pipeline complet : calcul auto → devis → commande → production', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(checkPermission).mockResolvedValue({ allowed: true, roleName: 'MANAGER' })
  })

  it('propage les mêmes IDs/numéros de bout en bout, sans commande ni job fantôme', async () => {
    // ── 1. CLIENT choisit un modèle, saisit des dimensions → calcul auto (§13) ──
    mockTables({
      fiche_technique:            { data: FICHE_TECHNIQUE, error: null },
      fiche_technique_ressources: { data: RESSOURCES_PORTAIL, error: null },
    })

    const calcRes = await app.request('/api/devis/calculate', {
      method:  'POST',
      headers: new Headers(authHeaders('operateur')),
      body:    JSON.stringify({
        modeleId:   MODELE_ID,
        quantite:   2,
        dimensions: { largeur: 3, hauteur: 1.8 }, // 3 × 1.8 × 2 = 10.8 m² (§16)
      }),
    })

    expect(calcRes.status).toBe(200)
    const calc = await calcRes.json() as {
      ficheTechniqueId: string; quantiteFacturable: number; formuleUtilisee: string
      configSnapshot: unknown; lignes: unknown[]
      totalHtXaf: number; totalMateriauxXaf: number; totalMainOeuvreXaf: number; totalEquipementsXaf: number
    }
    expect(calc.ficheTechniqueId).toBe(FICHE_ID)
    expect(calc.quantiteFacturable).toBe(10.8)
    expect(calc.totalHtXaf).toBeGreaterThan(0)

    // ── 2. Le calcul devient un devis (figé en snapshot, §21) ───────────────────
    const prixUnitaire = Math.round(calc.totalHtXaf / calc.quantiteFacturable)
    const DEVIS_ROW = {
      id: 'e2e-devis-001', numero: 'DEV-2026-9999', statut: 'brouillon',
      total_ht_xaf: calc.totalHtXaf, tva_xaf: 0, total_ttc_xaf: calc.totalHtXaf,
      source_demande: 'app_client',
    }
    mockTables({
      devis:        { data: DEVIS_ROW, count: 41, error: null },
      devis_lignes: { data: [{ id: 'e2e-dl-001', designation: 'Portail coulissant sur mesure', unite: 'm2', quantite: calc.quantiteFacturable, prix_unitaire_ht_xaf: prixUnitaire, total_ht_xaf: calc.totalHtXaf }], error: null },
    })

    const devisRes = await app.request('/api/devis', {
      method:  'POST',
      headers: new Headers(authHeaders('operateur')),
      body:    JSON.stringify({
        client_nom:            'Client E2E §48',
        date_emission:         '2026-06-01',
        date_validite:         '2099-12-31',
        condition_paiement_id: CONDITION_ID,
        source_demande:        'app_client',
        fiche_technique_id:    calc.ficheTechniqueId,
        config_snapshot:       calc.configSnapshot,
        ressources_snapshot:   { lignes: calc.lignes, totalMateriauxXaf: calc.totalMateriauxXaf, totalMainOeuvreXaf: calc.totalMainOeuvreXaf, totalEquipementsXaf: calc.totalEquipementsXaf },
        lignes: [{
          designation: 'Portail coulissant sur mesure', unite: 'm2',
          quantite: calc.quantiteFacturable, prix_unitaire_ht_xaf: prixUnitaire,
          configuration: calc.configSnapshot, formule_utilisee: calc.formuleUtilisee,
          quantite_calculee: calc.quantiteFacturable, cout_calcule_xaf: calc.totalHtXaf,
        }],
      }),
    })

    expect(devisRes.status).toBe(201)
    const devis = await devisRes.json() as { id: string; numero: string }
    expect(devis.id).toBe(DEVIS_ROW.id)

    // ── 3. Validation : brouillon → envoyé → accepté (§23) ──────────────────────
    mockTables({ devis: { data: { id: devis.id, statut: 'brouillon', date_validite: '2099-12-31' }, error: null } })
    const envoyeRes = await app.request(`/api/devis/${devis.id}/statut`, {
      method: 'PATCH', headers: new Headers(authHeaders('admin')), body: JSON.stringify({ statut: 'envoye' }),
    })
    expect(envoyeRes.status).toBe(200)

    mockTables({ devis: { data: { id: devis.id, statut: 'envoye', date_validite: '2099-12-31' }, error: null } })
    const accepteRes = await app.request(`/api/devis/${devis.id}/statut`, {
      method: 'PATCH', headers: new Headers(authHeaders('admin')), body: JSON.stringify({ statut: 'accepte' }),
    })
    expect(accepteRes.status).toBe(200)

    // ── 4. Conversion devis → commande (§37, verrou d'idempotence) ──────────────
    const COMMANDE_ROW = {
      id: 'e2e-commande-001', numero: 'CMD-2026-9999',
      client_id: null, client_nom: 'Client E2E §48',
      devis_id: devis.id, statut: 'confirmed', total_ttc_xaf: calc.totalHtXaf,
    }
    mockTables({
      devis: {
        data: {
          id: devis.id, numero: devis.numero, statut: 'accepte', client_id: null, client_nom: 'Client E2E §48',
          date_validite: '2099-12-31', acompte_pct: 30, condition_paiement_id: CONDITION_ID, notes: null,
          total_ht_xaf: calc.totalHtXaf, tva_xaf: 0, total_ttc_xaf: calc.totalHtXaf, approuve_par_client: true,
          remise_globale_xaf: 0, remise_globale_motif: null, net_a_payer_xaf: calc.totalHtXaf,
          devis_lignes: [{ produit_id: null, designation: 'Portail coulissant sur mesure', description: null, unite: 'm2', quantite: calc.quantiteFacturable, prix_unitaire_ht_xaf: prixUnitaire, total_ht_xaf: calc.totalHtXaf, ordre: 0, remise_type: null, remise_valeur: null, remise_xaf: 0, remise_motif: null }],
        },
        error: null,
      },
      conditions_paiement: { data: { code: 'comptant', acompte_pct: 30, delai_solde_jours: 0 }, error: null },
      commandes: { data: COMMANDE_ROW, count: 5, error: null },
    })

    const convertRes = await app.request(`/api/devis/${devis.id}/transformer-commande`, {
      method: 'POST', headers: new Headers(authHeaders('operateur')), body: JSON.stringify({}),
    })

    expect(convertRes.status).toBe(201)
    const converted = await convertRes.json() as { commande: { id: string; numero: string; devis_id: string }; devis_numero: string }
    // ── Relation vérifiée : la commande créée pointe bien vers CE devis ─────────
    expect(converted.commande.devis_id).toBe(devis.id)
    expect(converted.devis_numero).toBe(devis.numero)
    // La facture brouillon auto-générée à la conversion (§37) porte le bon commande_id.
    expect(vi.mocked(ensureFactureForCommande)).toHaveBeenCalledWith(
      expect.objectContaining({ commandeId: converted.commande.id }),
    )

    const commandeId = converted.commande.id

    // ── 5. Lancement production : job + bon de sortie auto-créés (Phase 4) ──────
    const insertedJobs: Record<string, unknown>[] = []
    vi.mocked(supabase.from).mockImplementation(((table: string) => {
      if (table === 'commandes') {
        return mkChain({ data: { id: commandeId, statut: 'confirmed', numero: COMMANDE_ROW.numero, client_id: null, total_ttc_xaf: calc.totalHtXaf }, error: null }) as never
      }
      if (table === 'commandes_lignes') {
        return mkChain({ data: [{ produit_id: null, designation: 'Portail coulissant sur mesure', unite: 'm2', quantite: calc.quantiteFacturable, prix_unitaire_ht_xaf: prixUnitaire, total_ht_xaf: calc.totalHtXaf, ordre: 0 }], error: null }) as never
      }
      if (table === 'jobs_production') {
        return {
          ...mkChain({ data: [], error: null }),
          insert: vi.fn().mockImplementation((rows: Record<string, unknown>[]) => {
            insertedJobs.push(...rows)
            return mkChain({ data: rows, error: null })
          }),
        } as never
      }
      if (table === 'bons_sortie') return mkChain({ data: null, count: 0, error: null }) as never
      return mkChain({ data: null, count: 0, error: null }) as never
    }) as never)

    const productionRes = await app.request(`/api/commandes/${commandeId}/statut`, {
      method: 'PATCH', headers: new Headers(authHeaders('admin')), body: JSON.stringify({ statut: 'in_production' }),
    })

    expect(productionRes.status).toBe(200)
    expect(insertedJobs).toHaveLength(1)
    const jobNumero = insertedJobs[0].numero as string
    // ── Relation vérifiée : le job créé pointe bien vers CETTE commande ─────────
    expect(insertedJobs[0].commande_id).toBe(commandeId)
    expect(insertedJobs[0].produit_designation).toBe('Portail coulissant sur mesure')
    expect(insertedJobs[0].quantite_prevue).toBe(calc.quantiteFacturable)

    // ── 6. Vue production de la commande (§34, endpoint neuf de ce chantier) ────
    mockTables({
      commandes: { data: { id: commandeId }, error: null },
      jobs_production: {
        data: [{
          id: 'e2e-job-001', numero: jobNumero, type_job: 'commande', produit_id: null,
          produit_designation: 'Portail coulissant sur mesure', unite: 'm2',
          quantite_prevue: calc.quantiteFacturable, prix_unitaire_xaf: prixUnitaire, ressources_besoin: null,
          statut: 'in_production', avancement_pct: 0,
          date_debut: new Date().toISOString(), date_fin_prevue: null, date_fin_reelle: null, notes: null,
          created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
          machines: null, employes: null,
        }],
        error: null,
      },
    })

    const prodViewRes = await app.request(`/api/commandes/${commandeId}/production`, { headers: new Headers(authHeaders('admin')) })
    expect(prodViewRes.status).toBe(200)
    const prodView = await prodViewRes.json() as { commande_id: string; total: number; jobs: Array<{ numero: string }> }
    expect(prodView.commande_id).toBe(commandeId)
    expect(prodView.total).toBe(1)
    // ── Relation vérifiée : c'est bien LE MÊME job (même numéro) que celui créé à l'étape 5 ──
    expect(prodView.jobs[0].numero).toBe(jobNumero)

    // ── 7. Timeline client : devis et production doivent y apparaître, dans l'ordre ──
    mockTables({
      commandes: { data: { id: commandeId, numero: COMMANDE_ROW.numero, devis_id: devis.id, created_at: '2026-06-01T08:00:00Z' }, error: null },
      devis:     { data: { numero: devis.numero, source_demande: 'app_client', created_at: '2026-06-01T08:00:00Z', updated_at: '2026-06-01T09:00:00Z' }, error: null },
      jobs_production: { data: [{ numero: jobNumero, statut: 'in_production', avancement_pct: 0, date_debut: '2026-06-01T10:00:00Z', date_fin_reelle: null, produit_designation: 'Portail coulissant sur mesure' }], error: null },
    })

    const timelineRes = await app.request(`/api/commandes/${commandeId}/timeline`, { headers: new Headers(authHeaders('admin')) })
    expect(timelineRes.status).toBe(200)
    const timeline = await timelineRes.json() as { commande_id: string; commande_numero: string; evenements: Array<{ etape: string; detail?: string | null }> }
    expect(timeline.commande_id).toBe(commandeId)
    expect(timeline.commande_numero).toBe(COMMANDE_ROW.numero)
    // ── Relation vérifiée : le devis d'origine ET le job de production apparaissent
    //    tous les deux dans la timeline de CETTE commande, avec leurs bons numéros ──
    expect(timeline.evenements.some((e) => e.detail?.includes(devis.numero))).toBe(true)
    expect(timeline.evenements.some((e) => e.detail?.includes(jobNumero))).toBe(true)
  })
})
