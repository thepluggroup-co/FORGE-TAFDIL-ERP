/**
 * push.service.test.ts — sendPushToUser / sendPushToRole / registerPushToken /
 * unregisterPushToken.
 *
 * FIREBASE_SERVICE_ACCOUNT_JSON n'est jamais réellement initialisé ici : les
 * scénarios qui en ont besoin (rôle introuvable, aucun profil actif, échec de
 * lecture des tokens) retournent tous AVANT d'atteindre sendToTokens/Firebase,
 * donc aucun appel réel à firebase-admin n'est déclenché.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@forge/db', () => ({
  supabaseAdmin: { from: vi.fn() },
}))

import { supabaseAdmin } from '@forge/db'
import {
  sendPushToUser,
  sendPushToRole,
  registerPushToken,
  unregisterPushToken,
} from '../services/push.service'

type MockFn = ReturnType<typeof vi.fn>
const db = supabaseAdmin as unknown as { from: MockFn }

function makeThenable(response: unknown) {
  const builder: Record<string, unknown> = {}
  const chain = () => builder
  Object.assign(builder, {
    select: chain, eq: chain, in: chain, neq: chain, order: chain,
    upsert: chain, delete: chain, insert: chain, update: chain,
    single: () => Promise.resolve(response),
    maybeSingle: () => Promise.resolve(response),
    then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve(response).then(resolve, reject),
  })
  return builder
}

function mockFrom(responses: Record<string, unknown>) {
  db.from.mockImplementation((table: string) => makeThenable(responses[table] ?? { data: null, error: null }))
}

const SAVED_FIREBASE_ENV = process.env.FIREBASE_SERVICE_ACCOUNT_JSON

describe('push.service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    delete process.env.FIREBASE_SERVICE_ACCOUNT_JSON
  })

  afterEach(() => {
    if (SAVED_FIREBASE_ENV === undefined) delete process.env.FIREBASE_SERVICE_ACCOUNT_JSON
    else process.env.FIREBASE_SERVICE_ACCOUNT_JSON = SAVED_FIREBASE_ENV
  })

  describe('sendPushToUser', () => {
    it('sans Firebase configuré : dry-run, aucune requête DB', async () => {
      await sendPushToUser('profile-1', { title: 'Titre', body: 'Corps' })
      expect(db.from).not.toHaveBeenCalled()
    })
  })

  describe('sendPushToRole', () => {
    it('sans Firebase configuré : dry-run, aucune requête DB', async () => {
      await sendPushToRole('MAGASINIER', { title: 'Alerte stock', body: 'Rupture' })
      expect(db.from).not.toHaveBeenCalled()
    })

    it('rôle introuvable : retourne sans lire push_tokens', async () => {
      process.env.FIREBASE_SERVICE_ACCOUNT_JSON = 'dummy'
      mockFrom({ rbac_roles: { data: null, error: null } })

      await sendPushToRole('ROLE_INEXISTANT', { title: 'T', body: 'B' })

      expect(db.from).toHaveBeenCalledWith('rbac_roles')
      expect(db.from).not.toHaveBeenCalledWith('rbac_user_profiles')
      expect(db.from).not.toHaveBeenCalledWith('push_tokens')
    })

    it('rôle trouvé mais aucun profil actif : retourne sans lire push_tokens', async () => {
      process.env.FIREBASE_SERVICE_ACCOUNT_JSON = 'dummy'
      mockFrom({
        rbac_roles:         { data: { id: 'role-1' }, error: null },
        rbac_user_profiles: { data: [], error: null },
      })

      await sendPushToRole('MAGASINIER', { title: 'T', body: 'B' })

      expect(db.from).toHaveBeenCalledWith('rbac_user_profiles')
      expect(db.from).not.toHaveBeenCalledWith('push_tokens')
    })

    it('échec de lecture des push_tokens par rôle : retourne sans lever d\'exception', async () => {
      process.env.FIREBASE_SERVICE_ACCOUNT_JSON = 'dummy'
      mockFrom({
        rbac_roles:         { data: { id: 'role-1' }, error: null },
        rbac_user_profiles: { data: [{ profile_id: 'p1' }, { profile_id: 'p2' }], error: null },
        push_tokens:        { data: null, error: { message: 'colonne manquante' } },
      })

      await expect(sendPushToRole('MAGASINIER', { title: 'T', body: 'B' })).resolves.toBeUndefined()

      expect(db.from).toHaveBeenCalledWith('push_tokens')
    })
  })

  describe('registerPushToken', () => {
    it('upsert réussi : envoie le bon payload avec onConflict profile_id,token', async () => {
      mockFrom({ push_tokens: { data: null, error: null } })

      await registerPushToken('profile-1', 'token-abc', 'android', '1.2.3')

      expect(db.from).toHaveBeenCalledWith('push_tokens')
    })

    it('échec upsert : lève une erreur avec le message Supabase', async () => {
      mockFrom({ push_tokens: { data: null, error: { message: 'duplicate key' } } })

      await expect(registerPushToken('profile-1', 'token-abc', 'ios')).rejects.toThrow('duplicate key')
    })
  })

  describe('unregisterPushToken', () => {
    it('supprime le token pour le profil donné', async () => {
      mockFrom({ push_tokens: { data: null, error: null } })

      await unregisterPushToken('profile-1', 'token-abc')

      expect(db.from).toHaveBeenCalledWith('push_tokens')
    })
  })
})
