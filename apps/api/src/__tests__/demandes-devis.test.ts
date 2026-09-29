/**
 * demandes-devis.test.ts — Catalogue Hybride Phase 6 : demandes de devis structurées
 *
 *  - workflow partagé (@forge/shared/demande-devis) : transitions, statuts historiques, synchro devis
 *  - POST /api/shop/devis : multipart, PDF réel accepté, faux PDF refusé, aucun devis créé d'office
 *  - PATCH /api/shop-erp/devis-web/:id/statut : transition interdite, motif requis, historique
 *  - POST /api/shop-erp/devis/:id/creer-erp : devis sans TVA (V3 §19), demande → en chiffrage
 *  - synchroniserDemandeDepuisDevis : devis accepté → demande acceptée ; convertie jamais rouverte
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { authHeaders } from './helpers'
import {
  transitionDemandeAutorisee, transitionsDemande, normaliserStatutDemande, statutDemandeDepuisDevis,
} from '@forge/shared'

vi.hoisted(() => {
  process.env.NODE_ENV = 'test'
  process.env.SUPABASE_JWT_SECRET = 'forge-test-jwt-secret-x0x0x0x0x0x0x0x0x0x0'
  process.env.SUPABASE_URL = 'http://localhost:54321'
  process.env.SUPABASE_ANON_KEY = 'test-anon-key'
  process.env.SUPABASE_SERVICE_ROLE_KEY = ''
})

// ── Base simulée, sensible à la table et à l'opération ─────────────────────────

interface Op { table: string; action: 'select' | 'insert' | 'update' | 'delete' | 'upsert'; payload?: unknown; filtres: Array<[string, unknown]> }
type Reponse = { data: unknown; error: unknown; count?: number }

const etat = vi.hoisted(() => ({
  journal: [] as Array<{ table: string; action: string; payload?: unknown; filtres: Array<[string, unknown]> }>,
  repondre: (() => ({ data: null, error: null })) as (op: { table: string; action: string; payload?: unknown; filtres: Array<[string, unknown]> }) => { data: unknown; error: unknown; count?: number },
  uploads: [] as Array<{ bucket: string; path: string; contentType: string }>,
}))

vi.mock('@forge/db/supabase', () => {
  const chaine = (table: string) => {
    const op: Op = { table, action: 'select', filtres: [] }
    const c: Record<string, unknown> = {}
    const terminer = () => { etat.journal.push(op); return etat.repondre(op) }
    for (const m of ['select', 'order', 'range', 'limit', 'head', 'or', 'not', 'filter'])
      c[m] = vi.fn().mockReturnValue(c)
    for (const m of ['insert', 'update', 'delete', 'upsert'] as const)
      c[m] = vi.fn((payload?: unknown) => { op.action = m; op.payload = payload; return c })
    for (const m of ['eq', 'neq', 'in', 'gte', 'lte', 'lt', 'gt', 'ilike', 'like'])
      c[m] = vi.fn((col: string, val: unknown) => { op.filtres.push([col, val]); return c })
    c['single']      = vi.fn(() => Promise.resolve(terminer()))
    c['maybeSingle'] = vi.fn(() => Promise.resolve(terminer()))
    c['then']        = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(terminer()).then(res, rej)
    return c
  }
  const client = {
    from:          vi.fn((t: string) => chaine(t)),
    rpc:           vi.fn().mockResolvedValue({ data: null, error: null }),
    channel:       vi.fn(() => ({ send: vi.fn().mockResolvedValue('ok') })),
    removeChannel: vi.fn(),
    storage: {
      createBucket: vi.fn().mockResolvedValue({ data: null, error: null }),
      from: vi.fn((bucket: string) => ({
        upload: vi.fn((path: string, _buf: unknown, opts: { contentType: string }) => {
          etat.uploads.push({ bucket, path, contentType: opts.contentType })
          return Promise.resolve({ error: null })
        }),
        getPublicUrl:    vi.fn(() => ({ data: { publicUrl: 'https://test/public' } })),
        createSignedUrl: vi.fn(() => Promise.resolve({ data: { signedUrl: 'https://test/signed' } })),
      })),
    },
  }
  return { supabase: client, supabaseAdmin: client }
})

vi.mock('../services/client-sync.service', () => ({ ensureClient: vi.fn().mockResolvedValue('client-123') }))
vi.mock('../services/workflow-notifications.service', () => ({ notifyWorkflow: vi.fn().mockResolvedValue(undefined) }))
vi.mock('../services/sms.service', () => ({ notifyCommandeSms: vi.fn().mockResolvedValue({ ok: true, skipped: false }) }))
vi.mock('../middleware/auth', () => ({
  authMiddleware: async (c: any, next: () => Promise<void>) => {
    if (!c.req.header('Authorization')?.startsWith('Bearer ')) return c.json({ error: 'Token manquant' }, 401)
    c.set('user', { id: 'user-erp', email: 'erp@tafdil.cm', role: 'admin' })
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
import { synchroniserDemandeDepuisDevis } from '../services/demande-devis.service'

const DEMANDE_ID = '11111111-1111-4111-8111-111111111111'
const ops = (table: string, action?: string) => etat.journal.filter((o) => o.table === table && (!action || o.action === action))

beforeEach(() => {
  etat.journal.length = 0
  etat.uploads.length = 0
  etat.repondre = () => ({ data: null, error: null })
})

// ── Workflow partagé ───────────────────────────────────────────────────────────

describe('Workflow des demandes (@forge/shared)', () => {
  it('suit la chaîne demande → qualification → chiffrage → devis → acceptation → conversion', () => {
    expect(transitionDemandeAutorisee('nouvelle', 'en_qualification')).toBe(true)
    expect(transitionDemandeAutorisee('en_qualification', 'en_chiffrage')).toBe(true)
    expect(transitionDemandeAutorisee('en_chiffrage', 'devis_envoye')).toBe(true)
    expect(transitionDemandeAutorisee('devis_envoye', 'acceptee')).toBe(true)
    expect(transitionDemandeAutorisee('acceptee', 'convertie')).toBe(true)
  })

  it('refuse les sauts d\'étape et toute sortie d\'un état terminal', () => {
    expect(transitionDemandeAutorisee('nouvelle', 'devis_envoye')).toBe(false)
    expect(transitionDemandeAutorisee('nouvelle', 'convertie')).toBe(false)
    expect(transitionsDemande('convertie')).toEqual([])
    expect(transitionsDemande('refusee')).toEqual([])
  })

  it('interprète les statuts historiques', () => {
    expect(normaliserStatutDemande('vue')).toBe('en_qualification')
    expect(normaliserStatutDemande('en_cours')).toBe('en_qualification')
    expect(normaliserStatutDemande('traitee')).toBe('en_chiffrage')
    expect(normaliserStatutDemande('inconnu')).toBeNull()
  })

  it('déduit le statut de la demande de celui du devis', () => {
    expect(statutDemandeDepuisDevis('envoye')).toBe('devis_envoye')
    expect(statutDemandeDepuisDevis('accepte')).toBe('acceptee')
    expect(statutDemandeDepuisDevis('transforme')).toBe('convertie')
    expect(statutDemandeDepuisDevis('inexistant')).toBeNull()
  })
})

// ── Dépôt public ───────────────────────────────────────────────────────────────

const PDF_REEL  = new Uint8Array([...Buffer.from('%PDF-1.7\n'), ...new Array(40).fill(0x20)])
const FAUX_PDF  = new Uint8Array(Buffer.from('<html><script>alert(1)</script></html> renommé en pdf'))

function formulaire(fichiers: Array<[Uint8Array, string]>) {
  const f = new FormData()
  f.append('nom', 'Jean Nkomo')
  f.append('telephone', '+237699000000')
  f.append('description', 'Portail coulissant 4 m en acier galvanisé')
  f.append('quantite', '2')
  f.append('dimensions', '4 m x 2 m')
  f.append('delai_souhaite', '2026-11-15')
  for (const [octets, nom] of fichiers) f.append('documents', new File([octets], nom, { type: 'application/pdf' }))
  return f
}

describe('POST /api/shop/devis — demande structurée avec pièces jointes', () => {
  beforeEach(() => {
    etat.repondre = (op) => op.table === 'demandes_devis_web' && op.action === 'insert'
      ? { data: { id: DEMANDE_ID, numero: 'DEM-00042', created_at: '2026-09-28T10:00:00Z' }, error: null }
      : { data: null, error: null }
  })

  it('enregistre la demande, accepte le vrai PDF et refuse le faux (signature)', async () => {
    const res = await app.request('/api/shop/devis', {
      method: 'POST', body: formulaire([[PDF_REEL, 'plan.pdf'], [FAUX_PDF, 'piege.pdf']]),
    })
    expect(res.status).toBe(201)
    const body = await res.json() as { numero: string; statut: string; documents: { acceptes: number; refuses: Array<{ file: string }> } }
    expect(body.numero).toBe('DEM-00042')
    expect(body.statut).toBe('nouvelle')
    expect(body.documents.acceptes).toBe(1)
    expect(body.documents.refuses.map((r) => r.file)).toEqual(['piege.pdf'])

    const insertion = ops('demandes_devis_web', 'insert')[0].payload as Record<string, unknown>
    expect(insertion).toMatchObject({ statut: 'nouvelle', source: 'web', quantite: 2, dimensions: '4 m x 2 m', delai_souhaite: '2026-11-15', client_id: 'client-123' })

    expect(etat.uploads).toHaveLength(1)
    expect(etat.uploads[0]).toMatchObject({ bucket: 'demandes-devis', contentType: 'application/pdf' })
    const docs = ops('demandes_devis_documents', 'insert')[0].payload as Array<Record<string, unknown>>
    expect(docs).toHaveLength(1)
    expect(docs[0]).toMatchObject({ demande_id: DEMANDE_ID, nom_fichier: 'plan.pdf', type_mime: 'application/pdf' })

    expect(ops('demandes_devis_historique', 'insert')[0].payload).toMatchObject({ ancien_statut: null, nouveau_statut: 'nouvelle' })
    // Plus de devis vide créé d'office : il naît au chiffrage
    expect(ops('devis', 'insert')).toHaveLength(0)
  })

  it('refuse plus de 5 fichiers', async () => {
    const res = await app.request('/api/shop/devis', {
      method: 'POST', body: formulaire(Array.from({ length: 6 }, (_, i) => [PDF_REEL, `p${i}.pdf`] as [Uint8Array, string])),
    })
    expect(res.status).toBe(422)
    expect(((await res.json()) as { code: string }).code).toBe('TROP_DE_FICHIERS')
    expect(ops('demandes_devis_web', 'insert')).toHaveLength(0)
  })

  it('accepte encore le JSON (anciens clients) et valide les champs', async () => {
    const ok = await app.request('/api/shop/devis', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nom: 'Awa', telephone: '+237677000000', description: 'Garde-corps escalier intérieur' }),
    })
    expect(ok.status).toBe(201)

    const ko = await app.request('/api/shop/devis', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nom: 'Awa', telephone: '+237677000000', description: 'court' }),
    })
    expect(ko.status).toBe(400)
  })
})

// ── Statut côté ERP ────────────────────────────────────────────────────────────

describe('PATCH /api/shop-erp/devis-web/:id/statut', () => {
  const avecStatut = (statut: string) => {
    etat.repondre = (op) => op.table === 'demandes_devis_web' && op.action === 'select'
      ? { data: { id: DEMANDE_ID, statut }, error: null }
      : { data: null, error: null }
  }
  const patch = (body: unknown) => app.request(`/api/shop-erp/devis-web/${DEMANDE_ID}/statut`, {
    method: 'PATCH', headers: authHeaders(), body: JSON.stringify(body),
  })

  it('refuse une transition hors workflow', async () => {
    avecStatut('nouvelle')
    const res = await patch({ statut: 'acceptee' })
    expect(res.status).toBe(422)
    expect(((await res.json()) as { code: string }).code).toBe('TRANSITION_INTERDITE')
    expect(ops('demandes_devis_web', 'update')).toHaveLength(0)
  })

  it('exige un motif pour un refus', async () => {
    avecStatut('nouvelle')
    const res = await patch({ statut: 'refusee' })
    expect(res.status).toBe(422)
    expect(((await res.json()) as { code: string }).code).toBe('MOTIF_REQUIS')
  })

  it('applique une transition autorisée et l\'historise (qui, motif)', async () => {
    avecStatut('en_qualification')
    const res = await patch({ statut: 'infos_requises', commentaire: 'Merci d\'envoyer les cotes exactes' })
    expect(res.status).toBe(200)
    expect(ops('demandes_devis_web', 'update')[0].payload).toEqual({ statut: 'infos_requises' })
    expect(ops('demandes_devis_historique', 'insert')[0].payload).toMatchObject({
      ancien_statut: 'en_qualification', nouveau_statut: 'infos_requises', par: 'user-erp', commentaire: 'Merci d\'envoyer les cotes exactes',
    })
  })
})

// ── Chiffrage ──────────────────────────────────────────────────────────────────

describe('POST /api/shop-erp/devis/:id/creer-erp', () => {
  it('crée le devis sans TVA, reprend le besoin qualifié et passe la demande en chiffrage', async () => {
    const demande = {
      id: DEMANDE_ID, numero: 'DEM-00042', statut: 'en_qualification', nom: 'Jean Nkomo', telephone: '+237699000000',
      email: null, description: 'Portail coulissant', erp_devis_id: null, client_id: 'client-123', source: 'web',
      quantite: 2, dimensions: '4 m x 2 m', materiau: 'acier galvanisé', localisation: null, delai_souhaite: null,
    }
    etat.repondre = (op) => {
      if (op.table === 'demandes_devis_web' && op.action === 'select') return { data: demande, error: null }
      if (op.table === 'devis' && op.action === 'insert') return { data: { id: 'devis-1', numero: 'DEV-20260928-0001' }, error: null }
      if (op.table === 'devis' && op.action === 'select') return { data: null, error: null, count: 0 }
      return { data: null, error: null }
    }

    const res = await app.request(`/api/shop-erp/devis/${DEMANDE_ID}/creer-erp`, {
      method: 'POST', headers: authHeaders(), body: JSON.stringify({ montant_ht: 850_000 }),
    })
    expect(res.status).toBe(201)

    const devis = ops('devis', 'insert')[0].payload as Record<string, unknown>
    expect(devis).toMatchObject({ total_ht_xaf: 850_000, tva_xaf: 0, total_ttc_xaf: 850_000, client_id: 'client-123', source_demande: 'web' })
    expect(devis.notes).toContain('Quantité : 2')
    expect(devis.notes).toContain('Matériau : acier galvanisé')

    const majStatut = ops('demandes_devis_web', 'update').map((o) => o.payload as Record<string, unknown>)
    expect(majStatut).toContainEqual({ statut: 'en_chiffrage' })
    expect(ops('demandes_devis_historique', 'insert')[0].payload).toMatchObject({ nouveau_statut: 'en_chiffrage' })
  })

  it('refuse de chiffrer une demande refusée', async () => {
    etat.repondre = (op) => op.table === 'demandes_devis_web' && op.action === 'select'
      ? { data: { id: DEMANDE_ID, statut: 'refusee', erp_devis_id: null }, error: null }
      : { data: null, error: null }
    const res = await app.request(`/api/shop-erp/devis/${DEMANDE_ID}/creer-erp`, {
      method: 'POST', headers: authHeaders(), body: JSON.stringify({}),
    })
    expect(res.status).toBe(422)
    expect(ops('devis', 'insert')).toHaveLength(0)
  })
})

// ── Synchronisation devis → demande ────────────────────────────────────────────

describe('synchroniserDemandeDepuisDevis', () => {
  it('aligne la demande liée sur l\'acceptation du devis', async () => {
    etat.repondre = (op) => op.table === 'demandes_devis_web' && op.action === 'select'
      ? (op.filtres.some(([c]) => c === 'erp_devis_id')
        ? { data: [{ id: DEMANDE_ID, statut: 'devis_envoye' }], error: null }
        : { data: { id: DEMANDE_ID, statut: 'devis_envoye' }, error: null })
      : { data: null, error: null }

    await synchroniserDemandeDepuisDevis('devis-1', 'accepte')
    expect(ops('demandes_devis_web', 'update')[0].payload).toEqual({ statut: 'acceptee' })
    expect(ops('demandes_devis_historique', 'insert')[0].payload).toMatchObject({ ancien_statut: 'devis_envoye', nouveau_statut: 'acceptee', par: null })
  })

  it('ne rouvre jamais une demande convertie', async () => {
    etat.repondre = (op) => op.table === 'demandes_devis_web' && op.action === 'select'
      ? { data: [{ id: DEMANDE_ID, statut: 'convertie' }], error: null }
      : { data: null, error: null }
    await synchroniserDemandeDepuisDevis('devis-1', 'expire')
    expect(ops('demandes_devis_web', 'update')).toHaveLength(0)
  })

  it('ne fait jamais échouer l\'opération sur le devis', async () => {
    etat.repondre = () => { throw new Error('base indisponible') }
    await expect(synchroniserDemandeDepuisDevis('devis-1', 'accepte')).resolves.toBeUndefined()
  })
})
