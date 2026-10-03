/**
 * production-of.test.ts — Catalogue Hybride Phase 7 : l'OF reprend la gamme
 *
 *  - planifierOF / avancementDepuisOperations / transitions (pur, @forge/shared)
 *  - chargement de la gamme dans un OF : temps prévus, taux figés, matières
 *  - suivi d'étape : OF non lancé, temps réel obligatoire, avancement pondéré
 *  - consommation réelle : seul l'écart est déstocké (pas de double sortie)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { authHeaders } from './helpers'
import {
  planifierOF, avancementDepuisOperations, transitionOperationAutorisee, resumerFabrication,
  type OperationGammeSource, type RessourceMatiereSource,
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
    for (const m of ['select', 'order', 'range', 'limit', 'head', 'or', 'not', 'filter'])
      c[m] = vi.fn().mockReturnValue(c)
    for (const m of ['insert', 'update', 'delete', 'upsert'])
      c[m] = vi.fn((payload?: unknown) => { op.action = m; op.payload = payload; return c })
    for (const m of ['eq', 'neq', 'in', 'gte', 'lte', 'lt', 'gt', 'ilike', 'like'])
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
    c.set('user', { id: 'user-atelier', email: 'atelier@tafdil.cm', role: 'admin' })
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
import { chargerGammeDansOF } from '../services/production-of.service'

const JOB = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const OP  = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const CO  = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const FT  = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const ops = (table: string, action?: string) => etat.journal.filter((o) => o.table === table && (!action || o.action === action))

beforeEach(() => {
  etat.journal.length = 0
  etat.repondre = () => ({ data: null, error: null })
})

// ── Pur ────────────────────────────────────────────────────────────────────────

const GAMME: OperationGammeSource[] = [
  { id: 'g20', numero: 20, libelle: 'Soudage', tempsUnitaireH: 0.5, tempsFixeH: 1,
    poste: { id: 'p-soud', libelle: 'Soudeur', coutHoraireXaf: 2500 }, equipement: { id: 'e-poste', designation: 'Poste MIG', coutHoraireXaf: 1200 } },
  { id: 'g10', numero: 10, libelle: 'Découpe', tempsUnitaireH: 0.2, tempsFixeH: 0.5,
    poste: { id: 'p-dec', libelle: 'Découpeur', coutHoraireXaf: 2000 }, equipement: null },
]
const MATIERES: RessourceMatiereSource[] = [
  { id: 'r-tube', type: 'materiau', designation: 'Tube 40×40', unite: 'ml', produitId: 'prod-tube', quantiteParUnite: 3.2, coutUnitaireReferenceXaf: 1800 },
  { id: 'r-elec', type: 'consommable', designation: 'Électrodes', unite: 'kg', produitId: null, quantiteParUnite: 0.1, quantiteFixe: 0.5, coutUnitaireReferenceXaf: 3500 },
]

describe('planifierOF (pur)', () => {
  it('temps prévu = unitaire × quantité facturable + fixe, étapes dans l\'ordre, taux figés', () => {
    const plan = planifierOF(13.2, GAMME, MATIERES)
    expect(plan.ok).toBe(true)
    if (!plan.ok) return
    expect(plan.operations.map((o) => o.numero)).toEqual([10, 20])
    expect(plan.operations[0]).toMatchObject({ libelle: 'Découpe', tempsPrevuH: 3.14, coutHorairePosteXaf: 2000, coutHoraireEquipementXaf: null })
    expect(plan.operations[1]).toMatchObject({ tempsPrevuH: 7.6, posteLibelle: 'Soudeur', equipementDesignation: 'Poste MIG', coutHoraireEquipementXaf: 1200 })
    expect(plan.consommations).toEqual([
      expect.objectContaining({ designation: 'Tube 40×40', quantitePrevue: 42.24, produitId: 'prod-tube' }),
      expect.objectContaining({ designation: 'Électrodes', quantitePrevue: 1.82 }),
    ])
  })

  it('refuse une quantité nulle et une fiche vide', () => {
    expect(planifierOF(0, GAMME, MATIERES)).toMatchObject({ ok: false, code: 'QUANTITE_INVALIDE' })
    expect(planifierOF(5, [], [])).toMatchObject({ ok: false, code: 'GAMME_VIDE' })
  })
})

describe('avancement et transitions (pur)', () => {
  it('pondère par les temps prévus et ignore les étapes sautées', () => {
    const etapes = [
      { statut: 'terminee', temps_prevu_h: 6, temps_reel_h: 7 },
      { statut: 'en_cours', temps_prevu_h: 2, temps_reel_h: null },
      { statut: 'sautee',   temps_prevu_h: 4, temps_reel_h: null },
    ]
    expect(avancementDepuisOperations(etapes)).toBe(75)
    expect(avancementDepuisOperations([])).toBe(0)
    expect(resumerFabrication(etapes, [{ quantite_reelle: 3 }, { quantite_reelle: null }])).toMatchObject({
      tempsPrevuH: 8, tempsReelH: 7, operationsTerminees: 1, operationsTotal: 2, consommationsSaisies: 1, consommationsTotal: 2,
    })
  })

  it('suit a_faire → en_cours → terminee, sans saut direct', () => {
    expect(transitionOperationAutorisee('a_faire', 'en_cours')).toBe(true)
    expect(transitionOperationAutorisee('en_cours', 'terminee')).toBe(true)
    expect(transitionOperationAutorisee('a_faire', 'terminee')).toBe(false)
    expect(transitionOperationAutorisee('terminee', 'sautee')).toBe(false)
  })
})

// ── Chargement de la gamme ────────────────────────────────────────────────────

describe('chargerGammeDansOF', () => {
  const ficheUneEtape = (surcharge: (op: OpDb) => { data: unknown; error: unknown } | undefined = () => undefined) => (op: OpDb) => {
    const r = surcharge(op)
    if (r) return r
    if (op.table === 'of_operations' && op.action === 'select') return { data: null, error: null, count: 0 }
    if (op.table === 'gamme_operations') return { data: [{
      id: 'g10', numero: 10, libelle: 'Découpe', temps_unitaire_h: 0.2, temps_fixe_h: 0.5,
      postes_travail: { id: 'p-dec', libelle: 'Découpeur', cout_horaire_xaf: 2000 }, equipements: null,
    }], error: null }
    if (op.table === 'fiche_technique_ressources') return { data: [{
      id: 'r-tube', type: 'materiau', designation: 'Tube 40×40', unite: 'ml', ressource_produit_id: 'prod-tube',
      quantite_par_unite: 3.2, cout_unitaire_reference_xaf: 1800,
    }], error: null }
    return { data: null, error: null }
  }

  it('échec des matières : les étapes sont retirées, le chargement reste relançable', async () => {
    etat.repondre = ficheUneEtape((op) => op.table === 'of_consommations' && op.action === 'insert'
      ? { data: null, error: { message: 'insert refusé' } } : undefined)
    expect(await chargerGammeDansOF(JOB, FT, 10)).toMatchObject({ ok: false, code: 'ERREUR_DB' })
    expect(ops('of_operations', 'delete')).toHaveLength(1)
    expect(ops('of_operations', 'delete')[0].filtres).toContainEqual(['job_id', JOB])
    expect(ops('jobs_production', 'update')).toHaveLength(0)
  })

  it('chargement concurrent (doublon d\'étape) : signalé comme déjà chargé', async () => {
    etat.repondre = ficheUneEtape((op) => op.table === 'of_operations' && op.action === 'insert'
      ? { data: null, error: { code: '23505', message: 'duplicate key' } } : undefined)
    expect(await chargerGammeDansOF(JOB, FT, 10)).toMatchObject({ ok: false, code: 'GAMME_DEJA_CHARGEE' })
    expect(ops('of_consommations', 'insert')).toHaveLength(0)
    expect(ops('of_operations', 'delete')).toHaveLength(0)
  })

  it('copie étapes et matières dans l\'OF et le rattache à la fiche', async () => {
    etat.repondre = (op) => {
      if (op.table === 'of_operations' && op.action === 'select') return { data: null, error: null, count: 0 }
      if (op.table === 'gamme_operations') return { data: [{
        id: 'g10', numero: 10, libelle: 'Découpe', temps_unitaire_h: 0.2, temps_fixe_h: 0.5,
        postes_travail: { id: 'p-dec', libelle: 'Découpeur', cout_horaire_xaf: 2000 }, equipements: null,
      }], error: null }
      if (op.table === 'fiche_technique_ressources') return { data: [{
        id: 'r-tube', type: 'materiau', designation: 'Tube 40×40', unite: 'ml', ressource_produit_id: 'prod-tube',
        quantite_par_unite: 3.2, cout_unitaire_reference_xaf: 1800,
      }], error: null }
      return { data: null, error: null }
    }

    const res = await chargerGammeDansOF(JOB, FT, 10)
    expect(res).toEqual({ ok: true, operations: 1, consommations: 1 })
    expect((ops('of_operations', 'insert')[0].payload as unknown[])[0]).toMatchObject({
      job_id: JOB, numero: 10, temps_prevu_h: 2.5, poste_libelle: 'Découpeur', cout_horaire_poste_xaf: 2000,
    })
    expect((ops('of_consommations', 'insert')[0].payload as unknown[])[0]).toMatchObject({
      job_id: JOB, produit_id: 'prod-tube', quantite_prevue: 32, cout_unitaire_reference_xaf: 1800,
    })
    expect(ops('jobs_production', 'update')[0].payload).toMatchObject({ fiche_technique_id: FT, quantite_facturable: 10 })
  })

  it('ne recharge jamais une gamme déjà présente', async () => {
    etat.repondre = (op) => op.table === 'of_operations' ? { data: null, error: null, count: 3 } : { data: null, error: null }
    expect(await chargerGammeDansOF(JOB, FT, 10)).toMatchObject({ ok: false, code: 'GAMME_DEJA_CHARGEE' })
    expect(ops('of_operations', 'insert')).toHaveLength(0)
  })
})

// ── Suivi d'étape ─────────────────────────────────────────────────────────────

describe('PATCH /api/production/jobs/:id/operations/:opId', () => {
  const scenario = (statutJob: string, statutOp: string, tempsReel: number | null = null) => {
    etat.repondre = (op) => {
      if (op.table === 'jobs_production' && op.action === 'select') return { data: { id: JOB, statut: statutJob }, error: null }
      if (op.table === 'of_operations' && op.action === 'select' && op.filtres.some(([c]) => c === 'id'))
        return { data: { id: OP, statut: statutOp, temps_reel_h: tempsReel, debut_le: null }, error: null }
      if (op.table === 'of_operations' && op.action === 'update') return { data: { id: OP, statut: (op.payload as { statut?: string }).statut ?? statutOp }, error: null }
      if (op.table === 'of_operations' && op.action === 'select') return { data: [
        { statut: 'terminee', temps_prevu_h: 3, temps_reel_h: 3.5 },
        { statut: 'a_faire',  temps_prevu_h: 1, temps_reel_h: null },
      ], error: null }
      return { data: null, error: null }
    }
  }
  const patch = (body: unknown) => app.request(`/api/production/jobs/${JOB}/operations/${OP}`, {
    method: 'PATCH', headers: authHeaders(), body: JSON.stringify(body),
  })

  it('refuse de démarrer une étape si l\'OF n\'est pas lancé', async () => {
    scenario('confirmed', 'a_faire')
    const res = await patch({ statut: 'en_cours' })
    expect(res.status).toBe(422)
    expect(((await res.json()) as { code: string }).code).toBe('OF_NON_LANCE')
  })

  it('exige le temps réel pour terminer une étape', async () => {
    scenario('in_production', 'en_cours')
    const res = await patch({ statut: 'terminee' })
    expect(res.status).toBe(422)
    expect(((await res.json()) as { code: string }).code).toBe('TEMPS_REEL_REQUIS')
  })

  it('termine l\'étape et recalcule l\'avancement pondéré de l\'OF', async () => {
    scenario('in_production', 'en_cours')
    const res = await patch({ statut: 'terminee', temps_reel_h: 3.5 })
    expect(res.status).toBe(200)
    expect(((await res.json()) as { avancement_pct: number }).avancement_pct).toBe(75)
    expect(ops('of_operations', 'update')[0].payload).toMatchObject({ statut: 'terminee', temps_reel_h: 3.5, saisi_par: 'user-atelier' })
    expect(ops('jobs_production', 'update')[0].payload).toMatchObject({ avancement_pct: 75 })
    // Jamais de passage automatique à « prêt » (entrée en stock, facture)
    expect((ops('jobs_production', 'update')[0].payload as Record<string, unknown>).statut).toBeUndefined()
  })

  it('rouvrir une étape terminée efface sa date de fin', async () => {
    scenario('in_production', 'terminee', 3.5)
    const res = await patch({ statut: 'en_cours' })
    expect(res.status).toBe(200)
    expect(ops('of_operations', 'update')[0].payload).toMatchObject({ statut: 'en_cours', fin_le: null })
  })
})

// ── Consommations ─────────────────────────────────────────────────────────────

describe('PATCH /api/production/jobs/:id/consommations/:cId', () => {
  const scenario = (dejaSortie: number, { stock = 100, conflit = false } = {}) => {
    etat.repondre = (op) => {
      if (op.table === 'jobs_production') return { data: { id: JOB, numero: 'OF-CMD-001-01', statut: 'in_production' }, error: null }
      if (op.table === 'of_consommations' && op.action === 'select')
        return { data: {
          id: CO, produit_id: 'prod-tube', designation: 'Tube 40×40', quantite_sortie_stock: dejaSortie,
          quantite_reelle: dejaSortie, saisi_par: 'user-avant', saisi_le: '2026-09-01T08:00:00Z', notes: null,
        }, error: null }
      if (op.table === 'of_consommations' && op.action === 'update') return { data: conflit ? null : { id: CO }, error: null }
      if (op.table === 'produits' && op.action === 'select') return { data: { stock_actuel: stock, stock_min: 5, stock_critique: 2 }, error: null }
      return { data: null, error: null }
    }
  }
  const patch = (body: unknown) => app.request(`/api/production/jobs/${JOB}/consommations/${CO}`, {
    method: 'PATCH', headers: authHeaders(), body: JSON.stringify(body),
  })

  it('déstocke seulement l\'écart avec ce qui est déjà sorti', async () => {
    scenario(30)
    const res = await patch({ quantite_reelle: 34, sortir_stock: true })
    expect(res.status).toBe(200)
    expect(ops('mouvements_stock', 'insert')[0].payload).toMatchObject({ produit_id: 'prod-tube', type: 'sortie', quantite: 4, reference: 'OF-CMD-001-01' })
    expect(ops('of_consommations', 'update')[0].payload).toMatchObject({ quantite_reelle: 34, quantite_sortie_stock: 34 })
    // Réservation conditionnelle : seulement si personne n'a déstocké entre-temps
    expect(ops('of_consommations', 'update')[0].filtres).toContainEqual(['quantite_sortie_stock', 30])
  })

  it('une saisie concurrente est refusée sans toucher au stock', async () => {
    scenario(30, { conflit: true })
    const res = await patch({ quantite_reelle: 34, sortir_stock: true })
    expect(res.status).toBe(409)
    expect(((await res.json()) as { code: string }).code).toBe('CONFLIT_SAISIE')
    expect(ops('mouvements_stock', 'insert')).toHaveLength(0)
  })

  it('stock insuffisant : la réservation est annulée', async () => {
    scenario(30, { stock: 2 })
    const res = await patch({ quantite_reelle: 34, sortir_stock: true })
    expect(res.status).toBe(422)
    expect(ops('mouvements_stock', 'insert')).toHaveLength(0)
    const [reservation, annulation] = ops('of_consommations', 'update')
    expect(reservation.payload).toMatchObject({ quantite_sortie_stock: 34 })
    expect(annulation.payload).toMatchObject({ quantite_reelle: 30, quantite_sortie_stock: 30, saisi_par: 'user-avant' })
    expect(annulation.filtres).toContainEqual(['quantite_sortie_stock', 34])
  })

  it('ressaisir la même quantité ne déstocke pas une deuxième fois', async () => {
    scenario(34)
    await patch({ quantite_reelle: 34, sortir_stock: true })
    expect(ops('mouvements_stock', 'insert')).toHaveLength(0)
  })

  it('une baisse de quantité fait un retour en stock', async () => {
    scenario(34)
    await patch({ quantite_reelle: 31, sortir_stock: true })
    expect(ops('mouvements_stock', 'insert')[0].payload).toMatchObject({ type: 'entree', quantite: 3 })
  })
})
