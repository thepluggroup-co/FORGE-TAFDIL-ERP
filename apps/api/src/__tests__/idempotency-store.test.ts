/**
 * idempotency-store.test.ts — implémentation Supabase de IdempotencyStore
 * (claim / complete / release), distincte de idempotency.test.ts qui ne teste
 * que le middleware avec un store en mémoire.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@forge/db', () => ({
  supabaseAdmin: { from: vi.fn() },
}))

import { supabaseAdmin } from '@forge/db'
import { supabaseIdempotencyStore } from '../middleware/idempotency'

type MockFn = ReturnType<typeof vi.fn>
const db = supabaseAdmin as unknown as { from: MockFn }

function makeThenable(response: unknown) {
  const builder: Record<string, unknown> = {}
  const chain = () => builder
  Object.assign(builder, {
    select: chain, eq: chain, in: chain, lt: chain, is: chain, order: chain,
    update: chain, insert: chain, delete: chain,
    single: () => Promise.resolve(response),
    maybeSingle: () => Promise.resolve(response),
    then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve(response).then(resolve, reject),
  })
  return builder
}

function queueFrom(...responses: unknown[]) {
  for (const r of responses) db.from.mockImplementationOnce(() => makeThenable(r))
}

const OWNER = { userId: 'user-1', method: 'POST', path: '/clients' }

describe('supabaseIdempotencyStore', () => {
  let randomSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.clearAllMocks()
    // >= 0.01 : désactive le ménage opportuniste sauf test dédié.
    randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.5)
  })

  describe('claim', () => {
    it('clé neuve : insert réussit, aucun nettoyage déclenché', async () => {
      queueFrom({ error: null })
      const res = await supabaseIdempotencyStore.claim('cle-1', OWNER)
      expect(res).toEqual({ state: 'new' })
      expect(db.from).toHaveBeenCalledTimes(1)
    })

    it('clé neuve + tirage de nettoyage favorable : purge aussi les clés expirées', async () => {
      randomSpy.mockReturnValue(0)
      queueFrom({ error: null }, { error: null })
      const res = await supabaseIdempotencyStore.claim('cle-1', OWNER)
      expect(res).toEqual({ state: 'new' })
      expect(db.from).toHaveBeenCalledTimes(2)
    })

    it('insert échoue (ni doublon) : stockage indisponible, avertit une fois', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      queueFrom({ error: { code: '42P01', message: 'relation absente' } })
      const res = await supabaseIdempotencyStore.claim('cle-1', OWNER)
      expect(res).toEqual({ state: 'unavailable' })
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('relation absente'))
      warnSpy.mockRestore()
    })

    it('doublon mais ligne disparue avant lecture : réessayable', async () => {
      queueFrom({ error: { code: '23505' } }, { data: null })
      const res = await supabaseIdempotencyStore.claim('cle-1', OWNER)
      expect(res).toEqual({ state: 'in_progress' })
    })

    it('doublon avec propriétaire/méthode/chemin différent : conflit', async () => {
      queueFrom(
        { error: { code: '23505' } },
        { data: { user_id: 'autre-user', method: 'POST', path: '/clients', status: null, response: null, created_at: new Date().toISOString() } },
      )
      const res = await supabaseIdempotencyStore.claim('cle-1', OWNER)
      expect(res).toEqual({ state: 'mismatch' })
    })

    it('doublon déjà terminé : rejoue le statut et le corps mémorisés', async () => {
      queueFrom(
        { error: { code: '23505' } },
        { data: { user_id: 'user-1', method: 'POST', path: '/clients', status: 201, response: { id: 'c-1' }, created_at: new Date().toISOString() } },
      )
      const res = await supabaseIdempotencyStore.claim('cle-1', OWNER)
      expect(res).toEqual({ state: 'done', status: 201, body: { id: 'c-1' } })
    })

    it('doublon encore en cours récemment : fait réessayer plus tard', async () => {
      queueFrom(
        { error: { code: '23505' } },
        { data: { user_id: 'user-1', method: 'POST', path: '/clients', status: null, response: null, created_at: new Date().toISOString() } },
      )
      const res = await supabaseIdempotencyStore.claim('cle-1', OWNER)
      expect(res).toEqual({ state: 'in_progress' })
    })

    it('doublon en cours depuis trop longtemps, reprise réussie : traité comme neuf', async () => {
      const old = new Date(Date.now() - 5 * 60 * 1000).toISOString() // 5 min > timeout 2 min
      queueFrom(
        { error: { code: '23505' } },
        { data: { user_id: 'user-1', method: 'POST', path: '/clients', status: null, response: null, created_at: old } },
        { data: [{ key: 'cle-1' }] },
      )
      const res = await supabaseIdempotencyStore.claim('cle-1', OWNER)
      expect(res).toEqual({ state: 'new' })
    })

    it('doublon en cours depuis trop longtemps, reprise perdue (autre requête plus rapide) : en cours', async () => {
      const old = new Date(Date.now() - 5 * 60 * 1000).toISOString()
      queueFrom(
        { error: { code: '23505' } },
        { data: { user_id: 'user-1', method: 'POST', path: '/clients', status: null, response: null, created_at: old } },
        { data: [] },
      )
      const res = await supabaseIdempotencyStore.claim('cle-1', OWNER)
      expect(res).toEqual({ state: 'in_progress' })
    })
  })

  describe('complete', () => {
    it('mémorise le statut et le corps sans erreur', async () => {
      queueFrom({ error: null })
      await expect(supabaseIdempotencyStore.complete('cle-1', 201, { id: 'c-1' })).resolves.toBeUndefined()
      expect(db.from).toHaveBeenCalledWith('idempotency_keys')
    })

    it('échec de l\'écriture : avertit sans lever d\'exception', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      queueFrom({ error: { message: 'contrainte violée' } })
      await supabaseIdempotencyStore.complete('cle-1', 201, {})
      expect(warnSpy).toHaveBeenCalledWith(expect.any(String), 'contrainte violée')
      warnSpy.mockRestore()
    })
  })

  describe('release', () => {
    it('supprime la clé libérée', async () => {
      queueFrom({ error: null })
      await expect(supabaseIdempotencyStore.release('cle-1')).resolves.toBeUndefined()
      expect(db.from).toHaveBeenCalledWith('idempotency_keys')
    })
  })
})
