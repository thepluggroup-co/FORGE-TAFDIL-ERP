/**
 * controle-couts.test.ts — Catalogue Hybride Phase 8 : contrôle des coûts
 *
 *  - calculerCoutsOF : prévu / réel aux taux figés, estimation à terminaison,
 *    taux inconnu jamais compté pour 0
 *  - calculerMargeCommande : coûts hors atelier repris du devis, marge réelle
 *  - rendementAtelier
 *  - GET /api/production/indicateurs : plus aucune valeur en dur
 *  - GET /api/production/couts/synthese : droits COMMERCIAL:CONFIGURE, calcul groupé
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { authHeaders } from './helpers'
import {
  calculerCoutsOF, calculerMargeCommande, rendementAtelier,
  type OperationCout, type ConsommationCout,
} from '@forge/shared'

vi.hoisted(() => {
  process.env.NODE_ENV = 'test'
  process.env.SUPABASE_JWT_SECRET = 'forge-test-jwt-secret-x0x0x0x0x0x0x0x0x0x0'
  process.env.SUPABASE_URL = 'http://localhost:54321'
  process.env.SUPABASE_ANON_KEY = 'test-anon-key'
  process.env.SUPABASE_SERVICE_ROLE_KEY = ''
})

type OpDb = { table: string; action: string; payload?: unknown; filtres: Array<[string, unknown]> }

const etat = vi.hoisted(() => ({
  journal: [] as Array<{ table: string; action: string; payload?: unknown; filtres: Array<[string, unknown]> }>,
  repondre: (() => ({ data: null, error: null })) as (op: { table: string; action: string; payload?: unknown; filtres: Array<[string, unknown]> }) => { data: unknown; error: unknown; count?: number },
}))

vi.mock('@forge/db/supabase', () => {
  const chaine = (table: string) => {
    const op: OpDb = { table, action: 'select', filtres: [] }
    const c: Record<string, unknown> = {}
    const terminer = () => { etat.journal.push(op); return etat.repondre(op) }
    for (const m of ['select', 'order', 'range', 'limit', 'head', 'or', 'filter'])
      c[m] = vi.fn().mockReturnValue(c)
    for (const m of ['insert', 'update', 'delete', 'upsert'])
      c[m] = vi.fn((payload?: unknown) => { op.action = m; op.payload = payload; return c })
    for (const m of ['eq', 'neq', 'in', 'gte', 'lte', 'lt', 'gt', 'ilike', 'like', 'not'])
      c[m] = vi.fn((col: string, val: unknown) => { op.filtres.push([col, val]); return c })
    c['single']      = vi.fn(() => Promise.resolve(terminer()))
    c['maybeSingle'] = vi.fn(() => Promise.resolve(terminer()))
    c['then']        = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(terminer()).then(res, rej)
    return c
  }
  const client = {
    from: vi.fn((t: string) => chaine(t)),
    rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
    channel: vi.fn(() => ({ send: vi.fn().mockResolvedValue('ok') })),
    removeChannel: vi.fn(),
    storage: { from: vi.fn(), createBucket: vi.fn() },
  }
  return { supabase: client, supabaseAdmin: client }
})

vi.mock('../services/workflow-notifications.service', () => ({ notifyWorkflow: vi.fn().mockResolvedValue(undefined) }))
vi.mock('../services/sms.service', () => ({ notifyCommandeSms: vi.fn().mockResolvedValue({ ok: true, skipped: false }) }))
vi.mock('../middleware/auth', () => ({
  authMiddleware: async (c: any, next: () => Promise<void>) => {
    if (!c.req.header('Authorization')?.startsWith('Bearer ')) return c.json({ error: 'Token manquant' }, 401)
    c.set('user', { id: 'user-direction', email: 'direction@tafdil.cm', role: 'admin' })
    c.set('requestId', 'test')
    await next()
  },
  verifierBearer: async () => ({ ok: false, status: 401, error: 'Token invalide', code: 'INVALID_TOKEN' }),
}))
vi.mock('../services/rbacService', () => ({
  checkPermission:           vi.fn().mockResolvedValue({ allowed: true, roleName: 'SUPER_ADMIN' }),
  writeAuditLog:             vi.fn(),
  invalidatePermissionCache: vi.fn(),
}))

import app from '../app'
import { checkPermission } from '../services/rbacService'

beforeEach(() => {
  etat.journal.length = 0
  etat.repondre = () => ({ data: null, error: null })
  vi.mocked(checkPermission).mockResolvedValue({ allowed: true, roleName: 'SUPER_ADMIN' } as never)
})

// ── Pur : coûts d'un OF ────────────────────────────────────────────────────────

const op = (o: Partial<OperationCout>): OperationCout => ({
  numero: 10, libelle: 'Découpe', statut: 'terminee', temps_prevu_h: 2, temps_reel_h: 2,
  poste_libelle: 'Soudeur', equipement_designation: null, cout_horaire_poste_xaf: 2500, cout_horaire_equipement_xaf: null, ...o,
})
const conso = (k: Partial<ConsommationCout>): ConsommationCout => ({
  designation: 'Tube', type: 'materiau', quantite_prevue: 10, quantite_reelle: 10, cout_unitaire_reference_xaf: 1000, ...k,
})

describe('calculerCoutsOF (pur)', () => {
  it('valorise prévu et réel aux MÊMES taux figés, par poste', () => {
    const c = calculerCoutsOF(
      [
        op({ temps_prevu_h: 4, temps_reel_h: 5 }),
        op({ numero: 20, libelle: 'Pliage', poste_libelle: null, cout_horaire_poste_xaf: null,
             equipement_designation: 'Plieuse', cout_horaire_equipement_xaf: 3000, temps_prevu_h: 1, temps_reel_h: 1.5 }),
      ],
      [conso({ quantite_prevue: 10, quantite_reelle: 12 }), conso({ designation: 'Électrodes', type: 'consommable', quantite_prevue: 2, quantite_reelle: 2, cout_unitaire_reference_xaf: 3500 })],
    )
    expect(c.prevu).toEqual({ mainOeuvreXaf: 10000, machinesXaf: 3000, matieresXaf: 10000, consommablesXaf: 7000, totalXaf: 30000 })
    expect(c.reel).toEqual({ mainOeuvreXaf: 12500, machinesXaf: 4500, matieresXaf: 12000, consommablesXaf: 7000, totalXaf: 36000 })
    expect(c.ecartXaf).toBe(6000)
    expect(c.ecartPct).toBe(20)
    expect(c.complet).toBe(true)
    expect(c.alertes).toEqual([])
  })

  it('estime à terminaison un OF en cours et le signale', () => {
    const c = calculerCoutsOF(
      [op({ statut: 'en_cours', temps_prevu_h: 4, temps_reel_h: 1 }), op({ numero: 20, statut: 'en_cours', temps_prevu_h: 1, temps_reel_h: 3 }),
       op({ numero: 30, statut: 'sautee', temps_prevu_h: 2, temps_reel_h: null })],
      [conso({ quantite_reelle: null })],
    )
    // étape 10 : max(1, 4) = 4 h ; étape 20 : max(3, 1) = 3 h ; étape 30 sautée : 0 des deux côtés
    expect(c.reel.mainOeuvreXaf).toBe(7 * 2500)
    expect(c.prevu.mainOeuvreXaf).toBe(5 * 2500)
    expect(c.reel.matieresXaf).toBe(10000)   // non saisie → quantité prévue
    expect(c.complet).toBe(false)
  })

  it('ne compte jamais un taux horaire inconnu pour 0 : étape exclue et signalée', () => {
    const c = calculerCoutsOF([op({ cout_horaire_poste_xaf: null })], [])
    expect(c.prevu.totalXaf).toBe(0)
    expect(c.alertes[0]).toContain('taux horaire inconnu')
  })

  it('signale un OF sans gamme', () => {
    expect(calculerCoutsOF([], []).alertes).toContain('OF sans gamme : aucun coût de fabrication suivi')
  })
})

describe('calculerMargeCommande (pur)', () => {
  const of = calculerCoutsOF([op({ temps_prevu_h: 4, temps_reel_h: 6 })], [conso({ quantite_reelle: 11 })])   // réel 15 000 + 11 000

  it('ajoute les coûts hors atelier prévus au devis et calcule la marge réelle', () => {
    const m = calculerMargeCommande({
      prixVenteHtXaf: 50000,
      ofs: [of],
      snapshot: { coutRevientXaf: 28000, fraisIndirectsXaf: 3000, coutTransportXaf: 2000, coutSousTraitanceXaf: 0, coutOptionsXaf: 0, coutInstallationXaf: 0 },
    })
    expect(m.autresCoutsPrevusXaf).toBe(5000)
    expect(m.coutRevientReelXaf).toBe(26000 + 5000)
    expect(m.margePrevueXaf).toBe(22000)
    expect(m.margeReelleXaf).toBe(19000)
    expect(m.ecartMargeXaf).toBe(-3000)
    expect(m.tauxMargeReellePct).toBe(38)
    expect(m.complet).toBe(true)
  })

  it('sans estimation figée au devis : fabrication seule, signalé', () => {
    const m = calculerMargeCommande({ prixVenteHtXaf: 30000, ofs: [of], snapshot: null })
    expect(m.autresCoutsPrevusXaf).toBeNull()
    expect(m.margePrevueXaf).toBeNull()
    expect(m.margeReelleXaf).toBe(4000)
    expect(m.complet).toBe(false)
    expect(m.alertes.join(' ')).toContain('frais indirects')
  })
})

describe('rendementAtelier (pur)', () => {
  it('temps prévu ÷ temps réel des étapes terminées', () => {
    expect(rendementAtelier([{ temps_prevu_h: 8, temps_reel_h: 10 }, { temps_prevu_h: 2, temps_reel_h: 2.5 }])).toBe(80)
    expect(rendementAtelier([])).toBeNull()
  })
})

// ── API ────────────────────────────────────────────────────────────────────────

describe('GET /api/production/indicateurs', () => {
  it('calcule OF, machines, rendement et anomalies depuis la base', async () => {
    etat.repondre = (o) => {
      if (o.table === 'jobs_production') return { data: [
        { statut: 'in_production', date_fin_prevue: '2020-01-01' },
        { statut: 'in_production', date_fin_prevue: '2999-01-01' },
        { statut: 'confirmed', date_fin_prevue: null },
      ], error: null }
      if (o.table === 'equipements') return { data: [
        { statut: 'disponible' }, { statut: 'en_service' }, { statut: 'maintenance' }, { statut: 'en_panne' },
      ], error: null }
      if (o.table === 'of_operations') return { data: [{ temps_prevu_h: 9, temps_reel_h: 10 }], error: null }
      return { data: null, error: null }
    }
    const res = await app.request('/api/production/indicateurs', { headers: authHeaders() })
    expect(res.status).toBe(200)
    const { data } = await res.json() as { data: Record<string, unknown> }
    expect(data).toMatchObject({
      of_en_cours: 2, of_a_lancer: 1, of_en_retard: 1,
      machines: { operationnelles: 2, total: 4, en_panne: 1, en_maintenance: 1 },
      rendement_30j_pct: 90,
      anomalies: { total: 2, of_en_retard: 1, machines_en_panne: 1 },
    })
    // seules les machines de production comptent, hors cédées / hors service
    const machines = etat.journal.find((o) => o.table === 'equipements')!
    expect(machines.filtres).toContainEqual(['categorie', ['machine_production', 'machine_legere']])
  })

  it('reste disponible avant la migration Phase 7 (rendement inconnu)', async () => {
    etat.repondre = (o) => o.table === 'of_operations'
      ? { data: null, error: { code: 'PGRST205', message: 'table absente' } }
      : { data: [], error: null }
    const res = await app.request('/api/production/indicateurs', { headers: authHeaders() })
    expect(res.status).toBe(200)
    expect(((await res.json()) as { data: { rendement_30j_pct: unknown } }).data.rendement_30j_pct).toBeNull()
  })
})

describe('GET /api/production/couts/synthese', () => {
  it('exige le droit COMMERCIAL:CONFIGURE', async () => {
    vi.mocked(checkPermission).mockResolvedValue({ allowed: false, roleName: 'OPERATEUR' } as never)
    const res = await app.request('/api/production/couts/synthese', { headers: authHeaders() })
    expect(res.status).toBe(403)
    expect(vi.mocked(checkPermission).mock.calls.at(-1)?.slice(1, 3)).toEqual(['COMMERCIAL', 'CONFIGURE'])
  })

  it('calcule la marge réelle par commande, les moins rentables d\'abord', async () => {
    etat.repondre = (o) => {
      if (o.table === 'jobs_production' && o.filtres.some(([c]) => c === 'commande_id' && Array.isArray(o.filtres.find(([k]) => k === 'commande_id')?.[1])))
        return { data: [{ id: 'of-1', commande_id: 'cmd-1', statut: 'pret' }, { id: 'of-2', commande_id: 'cmd-2', statut: 'pret' }], error: null }
      if (o.table === 'jobs_production') return { data: [{ commande_id: 'cmd-1' }, { commande_id: 'cmd-2' }, { commande_id: 'cmd-1' }], error: null }
      if (o.table === 'commandes') return { data: [
        { id: 'cmd-1', numero: 'CMD-1', client_nom: 'A', statut: 'pret', total_ht_xaf: 100000, devis_id: null },
        { id: 'cmd-2', numero: 'CMD-2', client_nom: 'B', statut: 'pret', total_ht_xaf: 20000, devis_id: null },
      ], error: null }
      if (o.table === 'of_operations') return { data: [
        { job_id: 'of-1', numero: 10, libelle: 'Soudage', statut: 'terminee', temps_prevu_h: 10, temps_reel_h: 10, poste_libelle: 'Soudeur', equipement_designation: null, cout_horaire_poste_xaf: 2500, cout_horaire_equipement_xaf: null },
        { job_id: 'of-2', numero: 10, libelle: 'Soudage', statut: 'terminee', temps_prevu_h: 5, temps_reel_h: 12, poste_libelle: 'Soudeur', equipement_designation: null, cout_horaire_poste_xaf: 2500, cout_horaire_equipement_xaf: null },
      ], error: null }
      if (o.table === 'of_consommations') return { data: [], error: null }
      return { data: [], error: null }
    }
    const res = await app.request('/api/production/couts/synthese?jours=30', { headers: authHeaders() })
    expect(res.status).toBe(200)
    const body = await res.json() as { data: Array<{ numero: string; marge: { margeReelleXaf: number } }>; totaux: Record<string, number>; periode_jours: number }
    expect(body.periode_jours).toBe(30)
    expect(body.data.map((l) => [l.numero, l.marge.margeReelleXaf])).toEqual([['CMD-2', -10000], ['CMD-1', 75000]])
    expect(body.totaux).toMatchObject({ prix_vente_ht_xaf: 120000, cout_revient_reel_xaf: 55000, marge_reelle_xaf: 65000, commandes_deficitaires: 1 })
    // chargement groupé : une seule lecture des étapes pour tous les OF
    expect(etat.journal.filter((o) => o.table === 'of_operations')).toHaveLength(1)
  })
})
