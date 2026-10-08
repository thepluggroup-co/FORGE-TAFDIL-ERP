/**
 * shop-client.test.ts — comptes clients du shop (/api/shop-client/*)
 *
 *  - secret serveur à serveur obligatoire
 *  - connexion par code email (envoi, vérification, création du compte)
 *  - Google / Facebook : rattachement par email vérifié, jamais par email non vérifié
 *  - devis du client : validation possible seulement sur SES devis « envoyés »
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const etat = vi.hoisted(() => ({
  resolver: null as null | ((table: string, f: Record<string, unknown>, op: string, payload: unknown) => { data: unknown; error: unknown } | undefined),
  ecritures: [] as Array<{ table: string; op: string; payload: unknown; filtres: Record<string, unknown> }>,
}))

vi.mock('@forge/db/supabase', () => {
  const chain = (table: string) => {
    const f: Record<string, unknown> = {}
    let op = 'select'
    let payload: unknown
    const c: Record<string, unknown> = {}
    for (const m of ['select', 'or', 'gte', 'lte', 'lt', 'gt', 'not', 'like', 'order', 'range', 'limit', 'head', 'filter', 'is', 'neq'])
      c[m] = () => c
    c.eq    = (k: string, v: unknown) => { f[k] = v; return c }
    c.ilike = (k: string, v: unknown) => { f[k] = v; return c }
    c.in    = (k: string, v: unknown) => { f[k] = v; return c }
    for (const m of ['update', 'insert', 'upsert', 'delete'])
      c[m] = (p?: unknown) => { op = m; payload = p; return c }
    const res = () => {
      if (op !== 'select') etat.ecritures.push({ table, op, payload, filtres: { ...f } })
      return etat.resolver?.(table, f, op, payload) ?? { data: op === 'select' ? null : payload ?? null, error: null }
    }
    c.single = () => Promise.resolve(res())
    c.maybeSingle = () => Promise.resolve(res())
    c.then = (ok: (v: unknown) => unknown) => Promise.resolve(res()).then(ok)
    return c
  }
  const client = { from: (t: string) => chain(t), rpc: () => Promise.resolve({ data: null, error: null }), channel: () => ({ send: () => Promise.resolve('ok') }) }
  return { supabase: client, supabaseAdmin: client }
})

const emails = vi.hoisted(() => [] as Array<{ to: string; html: string }>)
vi.mock('../services/email-queue.service', () => ({
  sendEmailDirect: vi.fn(async (p: { to: string; html: string }) => { emails.push(p); return { success: true } }),
  enqueueEmail:    vi.fn(),
  notifyWhatsApp:  vi.fn(),
}))
vi.mock('../services/workflow-notifications.service', () => ({ notifyWorkflow: vi.fn() }))
vi.mock('../services/demande-devis.service', async (orig) => ({
  ...(await orig<typeof import('../services/demande-devis.service')>()),
  synchroniserDemandeDepuisDevis: vi.fn(),
}))

import app from '../app'

const SECRET = 'secret-de-test-shop-0123456789'
const H = { 'Content-Type': 'application/json', 'x-shop-secret': SECRET }
const post = (path: string, body: unknown) => app.request(`/api/shop-client${path}`, { method: 'POST', headers: H, body: JSON.stringify(body) })

const COMPTE   = { id: 'c-shop-1', nom: 'Awa', email: 'awa@test.cm', telephone: '+237699112233', email_verifie: true, avatar_url: null }
const CLI_ERP  = 'cli-erp-1'
const DEVIS_OK = 'devis-a-moi'
const demain   = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)

beforeEach(() => {
  process.env.SHOP_API_SECRET = SECRET
  etat.resolver = null; etat.ecritures = []; emails.length = 0
})

describe('Secret serveur à serveur', () => {
  it('403 sans le bon secret', async () => {
    const res = await app.request('/api/shop-client/auth/email/code', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-shop-secret': 'faux' }, body: '{"email":"a@b.cm"}',
    })
    expect(res.status).toBe(403)
  })
})

describe('Connexion par code email', () => {
  it('envoie un code à 6 chiffres puis le vérifie et crée le compte', async () => {
    let stocke: Record<string, unknown> | null = null
    etat.resolver = (t, _f, op, payload) => {
      if (t === 'shop_email_codes' && op === 'insert') { stocke = { id: 'code-1', tentatives: 0, ...(payload as object) }; return { data: null, error: null } }
      if (t === 'shop_email_codes' && op === 'select') return { data: stocke, error: null }
      if (t === 'clients_shop' && op === 'insert') return { data: { id: 'nouveau', ...(payload as object) }, error: null }
      return undefined
    }

    // premier appel : aucune ligne récente → envoi
    const envoi = await post('/auth/email/code', { email: 'Awa@Test.cm' })
    expect(envoi.status).toBe(200)
    const code = /(\d{6})/.exec(emails[0].html)?.[1]
    expect(emails[0].to).toBe('awa@test.cm')
    expect(code).toMatch(/^\d{6}$/)

    const mauvais = await post('/auth/email/verifier', { email: 'awa@test.cm', code: code === '000000' ? '111111' : '000000' })
    expect(mauvais.status).toBe(401)

    const bon = await post('/auth/email/verifier', { email: 'awa@test.cm', code })
    expect(bon.status).toBe(200)
    expect(etat.ecritures).toContainEqual(expect.objectContaining({ table: 'clients_shop', op: 'insert', payload: expect.objectContaining({ email: 'awa@test.cm', email_verifie: true }) }))
  })
})

describe('Connexion Google / Facebook', () => {
  it('email vérifié : rattache le compte existant', async () => {
    etat.resolver = (t, f, op) => {
      if (t === 'clients_shop' && op === 'select' && f.email) return { data: COMPTE, error: null }
      if (t === 'clients_shop' && op === 'update') return { data: { ...COMPTE }, error: null }
      return undefined
    }
    const res = await post('/auth/oauth', { provider: 'google', providerId: 'g-123', email: 'awa@test.cm', emailVerifie: true, nom: 'Awa N.' })
    expect(res.status).toBe(200)
    expect(etat.ecritures).toContainEqual(expect.objectContaining({ table: 'clients_shop', op: 'update', payload: expect.objectContaining({ google_id: 'g-123' }) }))
    expect(etat.ecritures.find(e => e.op === 'insert')).toBeUndefined()
  })

  it('email NON vérifié : nouveau compte, sans reprendre l\'email', async () => {
    etat.resolver = (t, f, op, payload) => {
      if (t === 'clients_shop' && op === 'select' && f.email) return { data: COMPTE, error: null }
      if (t === 'clients_shop' && op === 'insert') return { data: { id: 'n', ...(payload as object) }, error: null }
      return undefined
    }
    const res = await post('/auth/oauth', { provider: 'facebook', providerId: 'fb-9', email: 'awa@test.cm', emailVerifie: false })
    expect(res.status).toBe(200)
    const insert = etat.ecritures.find(e => e.op === 'insert')
    expect(insert?.payload).toMatchObject({ facebook_id: 'fb-9', email: null })
  })
})

describe('Devis du client', () => {
  function monde(statut: string) {
    return (t: string, f: Record<string, unknown>, op: string) => {
      if (t === 'clients_shop' && f.id === COMPTE.id) return { data: COMPTE, error: null }
      if (t === 'clients' && op === 'select' && f.email) return { data: [{ id: CLI_ERP }], error: null }
      if (t === 'clients' && op === 'select') return { data: [], error: null }
      if (t === 'devis' && op === 'select' && f.client_id) return { data: [{
        id: DEVIS_OK, numero: 'DEV-1', statut, client_id: CLI_ERP, client_nom: 'Awa', date_validite: demain, devis_lignes: [],
      }], error: null }
      if (t === 'commandes') return { data: [], error: null }
      return undefined
    }
  }

  it('liste les devis rattachés par email vérifié', async () => {
    etat.resolver = monde('envoye')
    const res = await app.request(`/api/shop-client/clients/${COMPTE.id}/devis`, { headers: H })
    const body = await res.json() as { data: Array<{ id: string }> }
    expect(body.data.map(d => d.id)).toEqual([DEVIS_OK])
  })

  it('valide son devis « envoyé »', async () => {
    etat.resolver = monde('envoye')
    const res = await post(`/clients/${COMPTE.id}/devis/${DEVIS_OK}/decision`, { decision: 'accepte' })
    expect(res.status).toBe(200)
    expect(etat.ecritures).toContainEqual(expect.objectContaining({ table: 'devis', op: 'update', payload: expect.objectContaining({ statut: 'accepte', approuve_par_client: true }) }))
  })

  it('404 sur le devis d\'un autre client', async () => {
    etat.resolver = monde('envoye')
    const res = await post(`/clients/${COMPTE.id}/devis/devis-d-un-autre/decision`, { decision: 'accepte' })
    expect(res.status).toBe(404)
    expect(etat.ecritures.find(e => e.table === 'devis')).toBeUndefined()
  })

  it('422 si le devis n\'attend pas de réponse', async () => {
    etat.resolver = monde('brouillon')
    const res = await post(`/clients/${COMPTE.id}/devis/${DEVIS_OK}/decision`, { decision: 'accepte' })
    expect(res.status).toBe(422)
  })
})
