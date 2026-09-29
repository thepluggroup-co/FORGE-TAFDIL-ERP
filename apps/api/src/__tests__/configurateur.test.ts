/**
 * configurateur.test.ts — Catalogue Hybride Phase 3 : configurateur Portail P003
 *
 * Routes publiques (/api/shop/configurateur) et internes (/api/catalogue/...).
 * Les coûts de la fiche technique et des options sont des valeurs DE TEST.
 *
 * Vérifie en particulier :
 *  - CAS 2 (3 m × 2,2 m, motorisation, × 2) : estimation, configuration figée CFG, devis brouillon
 *  - CAS 3 (10 m × 5 m) : aucun prix automatique, demande de devis
 *  - §27 : aucun coût / marge dans les réponses publiques
 *  - D4 : sans règle de marge, pas de prix automatique
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mkChain, authHeaders } from './helpers'

vi.mock('../services/rbacService', () => ({
  checkPermission:           vi.fn(),
  writeAuditLog:             vi.fn(),
  invalidatePermissionCache: vi.fn(),
}))
vi.mock('../services/client-sync.service', () => ({ ensureClient: vi.fn().mockResolvedValue('client-1') }))
vi.mock('../services/workflow-notifications.service', () => ({ notifyWorkflow: vi.fn().mockResolvedValue(undefined) }))

vi.mock('@forge/db/supabase', () => {
  const mockClient = {
    from:          vi.fn(),
    rpc:           vi.fn().mockResolvedValue({ data: null, error: null }),
    channel:       vi.fn(() => ({ send: vi.fn().mockResolvedValue('ok') })),
    removeChannel: vi.fn(),
    storage: { from: vi.fn() },
  }
  return { supabase: mockClient, supabaseAdmin: mockClient }
})

import app from '../app'
import { supabase } from '@forge/db/supabase'
import { checkPermission, writeAuditLog } from '../services/rbacService'

// ── Base de données simulée, routée par table ─────────────────────────────────

type Reponse = { data: unknown; error?: unknown; count?: number }
let tables: Record<string, Reponse> = {}
let appels: Record<string, Array<Record<string, ReturnType<typeof vi.fn>>>> = {}

function installerDb(overrides: Record<string, Reponse>) {
  tables = overrides
  appels = {}
  vi.mocked(supabase.from).mockImplementation(((table: string) => {
    const chain = mkChain((tables[table] ?? { data: null, error: null }) as Record<string, unknown>)
    ;(appels[table] ??= []).push(chain as never)
    return chain
  }) as never)
}

/** Premier payload passé à `methode` sur `table` (insert / update / upsert). */
function payload(table: string, methode: 'insert' | 'update' | 'upsert') {
  const chaine = (appels[table] ?? []).find((c) => c[methode].mock.calls.length > 0)
  return chaine?.[methode].mock.calls[0][0] as Record<string, unknown> | undefined
}

// ── Données P003 ───────────────────────────────────────────────────────────────

const MID = '44444444-4444-4444-8444-444444444444'

const MODELE_P003 = {
  id: MID, reference: 'P003', designation: 'Portail P003', description: 'Portail configurable',
  unite_facturation: 'm2', type_gamme: null, actif: true, famille_id: 'fam-portail',
  familles: { type_gamme: 'configuration' },
}

const valeur = (code: string, libelle: string, cout = 0, validation = false, ordre = 0) =>
  ({ code, libelle, cout_supplementaire_xaf: cout, validation_requise: validation, ordre, actif: true })

const PARAMETRES_DB = [
  { id: 'pa1', code: 'largeur', libelle: 'Largeur', type: 'nombre', obligatoire: true, unite: 'mm', min: 2000, max: 6000, pas: null, role_calcul: 'largeur', cout_si_oui_xaf: 0, ordre: 0, actif: true, modele_parametre_valeurs: [] },
  { id: 'pa2', code: 'hauteur', libelle: 'Hauteur', type: 'nombre', obligatoire: true, unite: 'mm', min: 1500, max: 2500, pas: null, role_calcul: 'hauteur', cout_si_oui_xaf: 0, ordre: 1, actif: true, modele_parametre_valeurs: [] },
  { id: 'pa3', code: 'type', libelle: 'Type', type: 'choix', obligatoire: true, unite: null, min: null, max: null, pas: null, role_calcul: null, cout_si_oui_xaf: 0, ordre: 2, actif: true,
    modele_parametre_valeurs: [valeur('battant', 'Battant'), valeur('coulissant', 'Coulissant', 45000, false, 1)] },
  { id: 'pa4', code: 'couleur', libelle: 'Couleur', type: 'choix', obligatoire: true, unite: null, min: null, max: null, pas: null, role_calcul: null, cout_si_oui_xaf: 0, ordre: 3, actif: true,
    modele_parametre_valeurs: [valeur('noir', 'Noir'), valeur('autre', 'Autre', 0, true, 1)] },
  { id: 'pa5', code: 'motorisation', libelle: 'Motorisation', type: 'booleen', obligatoire: false, unite: null, min: null, max: null, pas: null, role_calcul: null, cout_si_oui_xaf: 250000, ordre: 4, actif: true, modele_parametre_valeurs: [] },
]

const FICHE = { id: 'ft-1', modele_id: MID, version: 1, statut: 'active', mode_calcul: 'surface', unite_facturation_id: null }
const RESSOURCES = [
  { id: 'r1', type: 'materiau',    designation: 'Acier',          unite: 'kg', quantite_par_unite: 20,  cout_unitaire_reference_xaf: 800,  temps_reference_h: null, actif: true },
  { id: 'r2', type: 'main_oeuvre', designation: 'Soudage',        unite: 'h',  quantite_par_unite: 1.5, cout_unitaire_reference_xaf: 2500, temps_reference_h: null, actif: true },
  { id: 'r3', type: 'equipement',  designation: 'Poste à souder', unite: 'h',  quantite_par_unite: 0.5, cout_unitaire_reference_xaf: 1500, temps_reference_h: null, actif: true },
]

function dbP003(overrides: Record<string, Reponse> = {}) {
  installerDb({
    modeles:                    { data: MODELE_P003 },
    modeles_shop:               { data: { visible_shop: true, images: [], description_longue: null, delai_fabrication_jours: 21 } },
    modele_parametres:          { data: PARAMETRES_DB },
    fiche_technique:            { data: FICHE },
    fiche_technique_ressources: { data: RESSOURCES },
    regles_marge:               { data: [{ portee: 'global', famille_id: null, modele_id: null, taux_pct: 25, actif: true }] },
    familles:                   { data: [{ id: 'fam-portail', parent_id: null }] },
    conditions_paiement:        { data: { id: 'cp-p100' } },
    configurations:             { data: { id: 'cfg-1', numero: 'CFG-00001' } },
    devis:                      { data: { id: 'devis-1', numero: 'DEV-20261001-0001' }, count: 0 },
    devis_lignes:               { data: null },
    demandes_devis_web:         { data: { id: 'ddw-1' } },
    ...overrides,
  })
}

const CAS_2 = { valeurs: { largeur: 3000, hauteur: 2200, type: 'battant', couleur: 'noir', motorisation: true }, quantite: 2 }
const CAS_3 = { valeurs: { ...CAS_2.valeurs, largeur: 10000, hauteur: 5000 }, quantite: 1 }
const CLIENT = { client: { nom: 'Awa Test', telephone: '690123456' } }
const JSON_HEADERS = { 'Content-Type': 'application/json' }
const MOTS_INTERDITS = /cout|marge|ressource|revient/i

beforeEach(() => { vi.clearAllMocks() })

// ── Public ─────────────────────────────────────────────────────────────────────

describe('GET /api/shop/configurateur/:modeleId', () => {
  it('renvoie le schéma public sans aucun coût d’option', async () => {
    dbP003()
    const res = await app.request(`/api/shop/configurateur/${MID}`)
    expect(res.status).toBe(200)
    const texte = await res.text()
    expect(texte).not.toMatch(MOTS_INTERDITS)
    const body = JSON.parse(texte) as { data: { parametres: Array<{ code: string; min: number | null }> } }
    expect(body.data.parametres.map((p) => p.code)).toEqual(['largeur', 'hauteur', 'type', 'couleur', 'motorisation'])
    expect(body.data.parametres[0].min).toBe(2000)
  })

  it('404 si le modèle n’est pas configurable', async () => {
    dbP003({ modeles: { data: { ...MODELE_P003, type_gamme: 'catalogue' } } })
    expect((await app.request(`/api/shop/configurateur/${MID}`)).status).toBe(404)
  })

  it('404 si le modèle n’est pas mis en ligne', async () => {
    dbP003({ modeles_shop: { data: { visible_shop: false } } })
    expect((await app.request(`/api/shop/configurateur/${MID}`)).status).toBe(404)
  })

  it('404 sur un identifiant non UUID', async () => {
    dbP003()
    expect((await app.request('/api/shop/configurateur/pas-un-uuid')).status).toBe(404)
  })
})

describe('POST /api/shop/configurateur/:modeleId/estimer', () => {
  it('CAS 2 : estimation du prix de VENTE, jamais du coût', async () => {
    dbP003()
    const res = await app.request(`/api/shop/configurateur/${MID}/estimer`, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(CAS_2) })
    expect(res.status).toBe(200)
    const texte = await res.text()
    expect(texte).not.toMatch(MOTS_INTERDITS)
    const { data } = JSON.parse(texte) as { data: { statut: string; estimation: Record<string, unknown> } }
    expect(data.statut).toBe('valide')
    expect(data.estimation).toMatchObject({
      disponible: true, quantite: 2, prix_unitaire_ht_xaf: 481625, prix_ht_xaf: 963250, delai_fabrication_jours: 21, non_contractuel: true,
    })
  })

  it('CAS 3 : hors limites → aucun prix automatique', async () => {
    dbP003()
    const res = await app.request(`/api/shop/configurateur/${MID}/estimer`, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(CAS_3) })
    const { data } = await res.json() as { data: { statut: string; estimation: Record<string, unknown>; hors_limites: unknown[] } }
    expect(data.statut).toBe('hors_limites')
    expect(data.hors_limites).toHaveLength(2)
    expect(data.estimation).toMatchObject({ disponible: false, raison: 'HORS_LIMITES' })
    expect(appels['fiche_technique']).toBeUndefined() // aucun calcul lancé
  })

  it('sans règle de marge (D4) : pas de prix, même si le coût est calculable', async () => {
    dbP003({ regles_marge: { data: [] } })
    const res = await app.request(`/api/shop/configurateur/${MID}/estimer`, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(CAS_2) })
    const texte = await res.text()
    expect(texte).not.toMatch(/385300|770600/) // le coût de revient ne fuit jamais
    expect(JSON.parse(texte).data.estimation).toMatchObject({ disponible: false, raison: 'MARGE_NON_DEFINIE' })
  })
})

describe('POST /api/shop/configurateur/:modeleId/demande', () => {
  it('CAS 2 : configuration figée CFG + devis brouillon au prix estimé', async () => {
    dbP003()
    const res = await app.request(`/api/shop/configurateur/${MID}/demande`, {
      method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ ...CAS_2, ...CLIENT, prix_unitaire: 1 }),
    })
    expect(res.status).toBe(201)
    const texte = await res.text()
    expect(texte).not.toMatch(MOTS_INTERDITS)
    expect(JSON.parse(texte).data).toMatchObject({ numero: 'CFG-00001', statut: 'valide', devis_numero: 'DEV-20261001-0001' })

    expect(payload('configurations', 'insert')).toMatchObject({
      modele_id: MID, statut: 'valide', quantite: 2, fiche_technique_id: 'ft-1',
      cout_revient_xaf: 770600, taux_marge_pct: 25, prix_estime_ht_xaf: 963250, source: 'web',
      valeurs: { largeur: 3000, hauteur: 2200, type: 'battant', couleur: 'noir', motorisation: true },
    })
    expect(payload('devis', 'insert')).toMatchObject({ statut: 'brouillon', source_demande: 'web', total_ht_xaf: 963250, tva_xaf: 0 })
    expect(payload('devis_lignes', 'insert')).toMatchObject({ quantite: 2, prix_unitaire_ht_xaf: 481625, total_ht_xaf: 963250, cout_calcule_xaf: 770600 })
    expect(payload('configurations', 'update')).toEqual({ devis_id: 'devis-1', demande_devis_web_id: null })
    expect(payload('demandes_devis_web', 'insert')).toBeUndefined()
    expect(writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({ actionType: 'CONFIGURATION_CREEE' }))
  })

  it('CAS 3 : hors limites → demande de devis, aucune ligne chiffrée', async () => {
    dbP003()
    const res = await app.request(`/api/shop/configurateur/${MID}/demande`, {
      method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ ...CAS_3, ...CLIENT }),
    })
    expect(res.status).toBe(201)
    expect((await res.json() as { data: { statut: string } }).data.statut).toBe('hors_limites')
    expect(payload('configurations', 'insert')).toMatchObject({ statut: 'hors_limites', prix_estime_ht_xaf: null })
    expect(payload('demandes_devis_web', 'insert')).toMatchObject({ produit_ref: 'P003', erp_devis_id: 'devis-1', statut: 'en_cours' })
    expect(payload('devis', 'insert')).toMatchObject({ total_ht_xaf: 0 })
    expect(payload('devis_lignes', 'insert')).toBeUndefined()
  })

  it('couleur « autre » : configuration à valider, devis créé pour validation humaine', async () => {
    dbP003()
    const res = await app.request(`/api/shop/configurateur/${MID}/demande`, {
      method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ ...CAS_2, valeurs: { ...CAS_2.valeurs, couleur: 'autre' }, ...CLIENT }),
    })
    expect((await res.json() as { data: { statut: string } }).data.statut).toBe('a_valider')
    expect(String(payload('devis', 'insert')?.notes)).toContain('Validation requise')
  })

  it('configuration invalide → 422, rien n’est enregistré', async () => {
    dbP003()
    const res = await app.request(`/api/shop/configurateur/${MID}/demande`, {
      method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ valeurs: { largeur: 3000 }, quantite: 1, ...CLIENT }),
    })
    expect(res.status).toBe(422)
    expect(payload('configurations', 'insert')).toBeUndefined()
    expect(payload('devis', 'insert')).toBeUndefined()
  })

  it('refuse une demande sans coordonnées client (400)', async () => {
    dbP003()
    const res = await app.request(`/api/shop/configurateur/${MID}/demande`, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(CAS_2) })
    expect(res.status).toBe(400)
  })
})

// ── Interne (ERP) ──────────────────────────────────────────────────────────────

const allow = () => vi.mocked(checkPermission).mockResolvedValueOnce({ allowed: true, roleName: 'SUPER_ADMIN' })
const ERP_HEADERS = () => new Headers({ ...authHeaders('admin'), 'Content-Type': 'application/json' })

describe('Configurateur — vue interne ERP', () => {
  it('POST /catalogue/modeles/:id/estimer expose coût de revient et marge', async () => {
    allow()
    dbP003()
    const res = await app.request(`/api/catalogue/modeles/${MID}/estimer`, { method: 'POST', headers: ERP_HEADERS(), body: JSON.stringify(CAS_2) })
    expect(res.status).toBe(200)
    const { data } = await res.json() as { data: { estimation: { disponible: boolean; estimation: Record<string, number> } } }
    expect(data.estimation.estimation).toMatchObject({ coutRevientXaf: 770600, tauxMargePct: 25, margeXaf: 192650 })
  })

  it('PUT /catalogue/modeles/:id/parametres refuse un modèle non configurable', async () => {
    allow()
    dbP003({ modeles: { data: { ...MODELE_P003, type_gamme: 'catalogue' } } })
    const res = await app.request(`/api/catalogue/modeles/${MID}/parametres`, {
      method: 'PUT', headers: ERP_HEADERS(),
      body: JSON.stringify({ parametres: [{ code: 'largeur', libelle: 'Largeur', type: 'nombre', unite: 'mm', min: 2000, max: 6000 }] }),
    })
    expect(res.status).toBe(422)
  })

  it('PUT /catalogue/modeles/:id/parametres refuse des bornes incohérentes (400)', async () => {
    allow()
    dbP003()
    const res = await app.request(`/api/catalogue/modeles/${MID}/parametres`, {
      method: 'PUT', headers: ERP_HEADERS(),
      body: JSON.stringify({ parametres: [{ code: 'largeur', libelle: 'Largeur', type: 'nombre', min: 6000, max: 2000 }] }),
    })
    expect(res.status).toBe(400)
  })

  it('POST /catalogue/regles-marge remplace la règle active de la même cible et trace le changement', async () => {
    allow()
    dbP003({ regles_marge: { data: { id: 'rm-ancienne', taux_pct: 20 } } })
    const res = await app.request('/api/catalogue/regles-marge', {
      method: 'POST', headers: ERP_HEADERS(), body: JSON.stringify({ portee: 'global', taux_pct: 25 }),
    })
    expect(res.status).toBe(201)
    expect(payload('regles_marge', 'update')).toEqual({ actif: false })
    expect(payload('regles_marge', 'insert')).toMatchObject({ portee: 'global', taux_pct: 25, actif: true })
    expect(writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      actionType: 'MARGE_MODIFIEE', payloadBefore: { taux_pct: 20 },
    }))
  })

  it('POST /catalogue/regles-marge refuse une cible incohérente (400)', async () => {
    allow()
    dbP003()
    const res = await app.request('/api/catalogue/regles-marge', {
      method: 'POST', headers: ERP_HEADERS(), body: JSON.stringify({ portee: 'famille', taux_pct: 25 }),
    })
    expect(res.status).toBe(400)
  })
})

// ── Phase 4 : coût de revient complet ──────────────────────────────────────────

describe('Phase 4 — frais indirects et nouveaux types de ressources', () => {
  it('l’estimation interne inclut les frais indirects applicables (et le prix public en tient compte)', async () => {
    allow()
    dbP003({
      frais_indirects: { data: [
        { id: 'f1', libelle: 'Frais atelier', centre_cout: 'ATELIER', mode: 'pourcentage', valeur: 12, base: 'main_oeuvre',
          portee: 'global', famille_id: null, modele_id: null, date_debut: null, date_fin: null, actif: true },
        { id: 'f2', libelle: 'Réservé à un autre modèle', centre_cout: null, mode: 'fixe_par_commande', valeur: 99999, base: null,
          portee: 'modele', famille_id: null, modele_id: 'autre', date_debut: null, date_fin: null, actif: true },
      ] },
    })
    const res = await app.request(`/api/catalogue/modeles/${MID}/estimer`, { method: 'POST', headers: ERP_HEADERS(), body: JSON.stringify(CAS_2) })
    const { data } = await res.json() as { data: { estimation: { estimation: Record<string, unknown> } } }
    // CAS 2 : 770 600 + 12 % de 49 500 (5 940) = 776 540
    expect(data.estimation.estimation).toMatchObject({ fraisIndirectsXaf: 5940, coutRevientXaf: 776540 })
    expect((data.estimation.estimation.lignesFraisIndirects as unknown[])).toHaveLength(1)
  })

  it('POST /catalogue/frais-indirects enregistre une règle et trace la modification', async () => {
    allow()
    dbP003({ frais_indirects: { data: { id: 'fi-1' } } })
    const res = await app.request('/api/catalogue/frais-indirects', {
      method: 'POST', headers: ERP_HEADERS(),
      body: JSON.stringify({ libelle: 'Frais atelier', centre_cout: 'ATELIER', mode: 'pourcentage', valeur: 12, base: 'main_oeuvre', portee: 'global' }),
    })
    expect(res.status).toBe(201)
    expect(payload('frais_indirects', 'insert')).toMatchObject({ mode: 'pourcentage', valeur: 12, base: 'main_oeuvre', actif: true })
    expect(writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({ actionType: 'FRAIS_INDIRECTS_MODIFIES' }))
  })

  it('refuse un pourcentage sans assiette ou une cible incohérente (422)', async () => {
    for (const body of [
      { libelle: 'x', mode: 'pourcentage', valeur: 10, portee: 'global' },
      { libelle: 'x', mode: 'fixe_par_unite', valeur: 1000, portee: 'famille' },
      { libelle: 'x', mode: 'fixe_par_unite', valeur: 1000, portee: 'global', date_debut: '2026-12-31', date_fin: '2026-01-01' },
    ]) {
      allow()
      dbP003()
      const res = await app.request('/api/catalogue/frais-indirects', { method: 'POST', headers: ERP_HEADERS(), body: JSON.stringify(body) })
      expect(res.status).toBe(422)
    }
  })

  it('fiche technique : accepte un consommable lié au stock et une sous-traitance avec délai', async () => {
    allow()
    dbP003({ fiche_technique_ressources: { data: { id: 'r-new' } } })
    const conso = await app.request('/api/catalogue/fiche-technique/ft-1/ressources', {
      method: 'POST', headers: ERP_HEADERS(),
      body: JSON.stringify({ type: 'consommable', ressource_produit_id: '55555555-5555-4555-8555-555555555555', designation: 'Électrodes', unite: 'kg', quantite_par_unite: 0.1, cout_unitaire_reference_xaf: 3000 }),
    })
    expect(conso.status).toBe(201)

    allow()
    const st = await app.request('/api/catalogue/fiche-technique/ft-1/ressources', {
      method: 'POST', headers: ERP_HEADERS(),
      body: JSON.stringify({ type: 'sous_traitance', designation: 'Galvanisation', unite: 'm²', quantite_par_unite: 1, cout_unitaire_reference_xaf: 2000, delai_jours: 5 }),
    })
    expect(st.status).toBe(201)
  })

  it('fiche technique : refuse un délai de sous-traitance sur une matière (400)', async () => {
    allow()
    dbP003()
    const res = await app.request('/api/catalogue/fiche-technique/ft-1/ressources', {
      method: 'POST', headers: ERP_HEADERS(),
      body: JSON.stringify({ type: 'materiau', designation: 'Acier', unite: 'kg', quantite_par_unite: 20, delai_jours: 5 }),
    })
    expect(res.status).toBe(400)
  })
})

// ── Phase 5 : gamme opératoire et taux horaires ────────────────────────────────

const OPERATION_SOUDAGE = {
  id: 'op-20', numero: 20, libelle: 'Soudage', temps_unitaire_h: 1, temps_fixe_h: 0.5,
  postes_travail: { code: 'SOUD', libelle: 'Soudeur', cout_horaire_xaf: 2500 },
  equipements: { code: 'EQ-MIG', designation: 'Poste MIG', cout_horaire_xaf: 1500 },
}

describe('Phase 5 — gamme opératoire et taux horaires', () => {
  it('la gamme s’ajoute à la fiche technique dans le coût de revient (vue interne)', async () => {
    allow()
    dbP003({ gamme_operations: { data: [OPERATION_SOUDAGE] } })
    const res = await app.request(`/api/catalogue/modeles/${MID}/estimer`, { method: 'POST', headers: ERP_HEADERS(), body: JSON.stringify(CAS_2) })
    const { data } = await res.json() as { data: { estimation: { estimation: Record<string, number> } } }
    // gamme : (1 h × 13,2 m² + 0,5 h) = 13,7 h → soudeur 34 250 + MIG 20 550 ; CAS 2 sans gamme = 770 600
    expect(data.estimation.estimation.coutRevientXaf).toBe(770600 + 34250 + 20550)
  })

  it('taux horaire manquant : pas de prix, message générique au client, détail dans l’ERP', async () => {
    const sansTaux = { ...OPERATION_SOUDAGE, equipements: { ...OPERATION_SOUDAGE.equipements, cout_horaire_xaf: null } }

    dbP003({ gamme_operations: { data: [sansTaux] } })
    const pub = await app.request(`/api/shop/configurateur/${MID}/estimer`, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(CAS_2) })
    const texte = await pub.text()
    expect(JSON.parse(texte).data.estimation).toMatchObject({ disponible: false, raison: 'CALCUL_IMPOSSIBLE' })
    expect(texte).not.toMatch(/Poste MIG|horaire/)

    allow()
    dbP003({ gamme_operations: { data: [sansTaux] } })
    const erp = await app.request(`/api/catalogue/modeles/${MID}/estimer`, { method: 'POST', headers: ERP_HEADERS(), body: JSON.stringify(CAS_2) })
    const { data } = await erp.json() as { data: { erreur_fiche: string } }
    expect(data.erreur_fiche).toContain('op 20 (équipement Poste MIG)')
  })

  it('POST /catalogue/postes-travail normalise le code et trace le taux', async () => {
    allow()
    dbP003({ postes_travail: { data: { id: 'pt-1' } } })
    const res = await app.request('/api/catalogue/postes-travail', {
      method: 'POST', headers: ERP_HEADERS(), body: JSON.stringify({ code: 'soud', libelle: 'Soudeur', cout_horaire_xaf: 2500 }),
    })
    expect(res.status).toBe(201)
    expect(payload('postes_travail', 'insert')).toMatchObject({ code: 'SOUD', cout_horaire_xaf: 2500 })
    expect(writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({ actionType: 'TAUX_HORAIRE_MODIFIE' }))
  })

  it('POST /fiche-technique/:id/operations refuse une opération sans ressource ou sans temps (422)', async () => {
    for (const body of [
      { numero: 10, libelle: 'Découpe', temps_unitaire_h: 0.2 },
      { numero: 10, libelle: 'Découpe', poste_id: '77777777-7777-4777-8777-777777777777' },
    ]) {
      allow()
      dbP003()
      const res = await app.request('/api/catalogue/fiche-technique/ft-1/operations', { method: 'POST', headers: ERP_HEADERS(), body: JSON.stringify(body) })
      expect(res.status).toBe(422)
    }
  })

  it('POST /fiche-technique/:id/operations : numéro déjà utilisé → 409', async () => {
    allow()
    dbP003({ gamme_operations: { data: null, error: { code: '23505', message: 'duplicate key' } } })
    const res = await app.request('/api/catalogue/fiche-technique/ft-1/operations', {
      method: 'POST', headers: ERP_HEADERS(),
      body: JSON.stringify({ numero: 10, libelle: 'Découpe', poste_id: '77777777-7777-4777-8777-777777777777', temps_unitaire_h: 0.2 }),
    })
    expect(res.status).toBe(409)
  })
})
