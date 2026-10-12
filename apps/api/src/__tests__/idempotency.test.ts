import { describe, expect, it } from 'vitest'
import { Hono } from 'hono'
import { createIdempotencyMiddleware } from '../middleware/idempotency'
import type { IdempotencyClaim, IdempotencyStore } from '../middleware/idempotency'
import type { HonoVariables } from '../types'

interface Entry { owner: string; status: number | null; body: unknown }

function memoryStore(): IdempotencyStore & { entries: Map<string, Entry> } {
  const entries = new Map<string, Entry>()
  return {
    entries,
    async claim(key, o): Promise<IdempotencyClaim> {
      const owner = `${o.userId} ${o.method} ${o.path}`
      const found = entries.get(key)
      if (!found) { entries.set(key, { owner, status: null, body: null }); return { state: 'new' } }
      if (found.owner !== owner) return { state: 'mismatch' }
      if (found.status === null) return { state: 'in_progress' }
      return { state: 'done', status: found.status, body: found.body }
    },
    async complete(key, status, body) { entries.set(key, { ...entries.get(key)!, status, body }) },
    async release(key) { if (entries.get(key)?.status === null) entries.delete(key) },
  }
}

function buildApp(store: IdempotencyStore, userId = 'user-1') {
  const state = { created: 0, stock: 1 }
  const app = new Hono<{ Variables: HonoVariables }>()
  app.use('*', async (c, next) => { c.set('user', { id: userId } as HonoVariables['user']); await next() })
  app.use('*', createIdempotencyMiddleware(store))
  app.post('/clients', (c) => { state.created += 1; return c.json({ id: `client-${state.created}` }, 201) })
  app.delete('/clients/:id', (c) => { state.created -= 1; return c.body(null, 204) })
  app.post('/sorties', (c) => {
    if (state.stock <= 0) return c.json({ error: 'Stock insuffisant' }, 409)
    state.stock -= 1
    return c.json({ ok: true }, 201)
  })
  app.post('/boom', () => { throw new Error('panne') })
  app.get('/clients', (c) => c.json({ total: state.created }))
  return { app, state }
}

const post = (app: Hono<{ Variables: HonoVariables }>, path: string, key?: string, method = 'POST') =>
  app.request(path, { method, headers: key ? { 'Idempotency-Key': key } : {} })

describe('middleware anti-doublon (Idempotency-Key)', () => {
  it('rejoue la réponse enregistrée sans réexécuter l\'action', async () => {
    const { app, state } = buildApp(memoryStore())

    const first = await post(app, '/clients', 'cle-aaaaaaaa')
    const replay = await post(app, '/clients', 'cle-aaaaaaaa')

    expect(first.status).toBe(201)
    expect(replay.status).toBe(201)
    expect(await replay.json()).toEqual({ id: 'client-1' })
    expect(replay.headers.get('Idempotent-Replayed')).toBe('true')
    expect(state.created).toBe(1)
  })

  it('deux clés différentes = deux actions ; sans clé, aucun filtrage', async () => {
    const { app, state } = buildApp(memoryStore())
    await post(app, '/clients', 'cle-aaaaaaaa')
    await post(app, '/clients', 'cle-bbbbbbbb')
    await post(app, '/clients')
    await post(app, '/clients')
    expect(state.created).toBe(4)
  })

  it('rejoue aussi une réponse 204 sans corps', async () => {
    const { app, state } = buildApp(memoryStore())
    state.created = 1
    expect((await post(app, '/clients/1', 'cle-suppr-01', 'DELETE')).status).toBe(204)
    expect((await post(app, '/clients/1', 'cle-suppr-01', 'DELETE')).status).toBe(204)
    expect(state.created).toBe(0)
  })

  it('ne mémorise pas un refus : la même clé peut réussir plus tard', async () => {
    const { app, state } = buildApp(memoryStore())
    state.stock = 0
    expect((await post(app, '/sorties', 'cle-sortie-1')).status).toBe(409)

    state.stock = 1   // réapprovisionné — l'utilisateur clique « Réessayer »
    expect((await post(app, '/sorties', 'cle-sortie-1')).status).toBe(201)
    expect((await post(app, '/sorties', 'cle-sortie-1')).status).toBe(201)   // rejoué
    expect(state.stock).toBe(0)
  })

  it('libère la clé quand le traitement plante', async () => {
    const store = memoryStore()
    const { app } = buildApp(store)
    expect((await post(app, '/boom', 'cle-boom-001')).status).toBe(500)
    expect(store.entries.has('cle-boom-001')).toBe(false)
  })

  it('refuse une clé réutilisée pour une autre action ou par un autre utilisateur', async () => {
    const store = memoryStore()
    const { app } = buildApp(store)
    await post(app, '/clients', 'cle-aaaaaaaa')

    expect((await post(app, '/sorties', 'cle-aaaaaaaa')).status).toBe(422)
    expect((await post(buildApp(store, 'user-2').app, '/clients', 'cle-aaaaaaaa')).status).toBe(422)
  })

  it('répond 409 réessayable si la même action est encore en cours', async () => {
    const store = memoryStore()
    store.entries.set('cle-en-cours', { owner: 'user-1 POST /clients', status: null, body: null })
    const { app, state } = buildApp(store)

    const res = await post(app, '/clients', 'cle-en-cours')
    expect(res.status).toBe(409)
    expect((await res.json() as { code: string }).code).toBe('IDEMPOTENCY_IN_PROGRESS')
    expect(state.created).toBe(0)
  })

  it('laisse passer quand le stockage est indisponible, et ignore les lectures', async () => {
    const unavailable: IdempotencyStore = {
      claim: async () => ({ state: 'unavailable' }),
      complete: async () => {},
      release: async () => {},
    }
    const { app, state } = buildApp(unavailable)
    await post(app, '/clients', 'cle-aaaaaaaa')
    await post(app, '/clients', 'cle-aaaaaaaa')
    expect(state.created).toBe(2)
    expect((await app.request('/clients', { headers: { 'Idempotency-Key': 'cle-aaaaaaaa' } })).status).toBe(200)
  })

  it('rejette une clé trop courte', async () => {
    const { app } = buildApp(memoryStore())
    expect((await post(app, '/clients', 'abc')).status).toBe(400)
  })
})
