// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createOfflineAuth } from '@forge/shared'
import type { OfflineAuthStorage } from '@forge/shared'

interface Profile { nom: string | null; role: string }

function memoryStorage(): OfflineAuthStorage & { dump: () => string } {
  const map = new Map<string, string>()
  return {
    get:    (k) => map.get(k) ?? null,
    set:    (k, v) => { map.set(k, v) },
    remove: (k) => { map.delete(k) },
    dump:   () => [...map.values()].join('\n'),
  }
}

const DAY = 24 * 60 * 60 * 1000

describe('connexion hors ligne (offline-auth)', () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }) })
  afterEach(() => { vi.useRealTimers() })

  it('accepte les identifiants mémorisés et rend le profil', async () => {
    const storage = memoryStorage()
    const auth = createOfflineAuth<Profile>(storage)
    await auth.remember('email', 'Chef@Tafdil.cm', 's3cret-pass', 'u1', { nom: 'Chef', role: 'admin' })

    // casse et espaces de l'email indifférents, comme côté serveur
    expect(await auth.verify('email', ' chef@tafdil.cm ', 's3cret-pass'))
      .toEqual({ ok: true, userId: 'u1', profile: { nom: 'Chef', role: 'admin' } })
  })

  it('ne stocke jamais le secret en clair', async () => {
    const storage = memoryStorage()
    await createOfflineAuth<Profile>(storage).remember('phone', '699001122', '4821', 'u1', { nom: null, role: 'caissier' })
    expect(storage.dump()).not.toContain('4821')
  })

  it('refuse un mauvais secret et un compte inconnu sur l\'appareil', async () => {
    const auth = createOfflineAuth<Profile>(memoryStorage())
    await auth.remember('email', 'a@b.cm', 'bon', 'u1', { nom: null, role: 'admin' })

    expect(await auth.verify('email', 'a@b.cm', 'mauvais')).toEqual({ ok: false, reason: 'invalid' })
    expect(await auth.verify('email', 'autre@b.cm', 'bon')).toEqual({ ok: false, reason: 'unknown' })
  })

  it('retrouve un numéro de téléphone quel que soit son formatage', async () => {
    const auth = createOfflineAuth<Profile>(memoryStorage())
    await auth.remember('phone', '+237 6 99 00 11 22', '4821', 'u1', { nom: null, role: 'caissier' })
    expect((await auth.verify('phone', '+237699001122', '4821')).ok).toBe(true)
  })

  it('bloque après 5 échecs, même avec le bon secret, puis débloque', async () => {
    const auth = createOfflineAuth<Profile>(memoryStorage())
    await auth.remember('phone', '699001122', '4821', 'u1', { nom: null, role: 'caissier' })

    for (let i = 0; i < 4; i++) {
      expect(await auth.verify('phone', '699001122', '0000')).toEqual({ ok: false, reason: 'invalid' })
    }
    expect(await auth.verify('phone', '699001122', '0000')).toEqual({ ok: false, reason: 'locked' })
    expect(await auth.verify('phone', '699001122', '4821')).toEqual({ ok: false, reason: 'locked' })

    vi.setSystemTime(Date.now() + 6 * 60 * 1000)
    expect((await auth.verify('phone', '699001122', '4821')).ok).toBe(true)
  })

  it('expire après 7 jours sans connexion en ligne ; touch() repousse l\'échéance', async () => {
    const auth = createOfflineAuth<Profile>(memoryStorage())
    await auth.remember('email', 'a@b.cm', 'bon', 'u1', { nom: null, role: 'admin' })

    vi.setSystemTime(Date.now() + 6 * DAY)
    expect((await auth.verify('email', 'a@b.cm', 'bon')).ok).toBe(true)

    // profil confirmé par le serveur au jour 6 : nom mis à jour, échéance repoussée
    auth.touch('u1', { nom: 'Awa' })
    vi.setSystemTime(Date.now() + 6 * DAY)
    expect(await auth.verify('email', 'a@b.cm', 'bon'))
      .toEqual({ ok: true, userId: 'u1', profile: { nom: 'Awa', role: 'admin' } })

    vi.setSystemTime(Date.now() + 2 * DAY)
    expect(await auth.verify('email', 'a@b.cm', 'bon')).toEqual({ ok: false, reason: 'expired' })
  })

  it('getProfile rend le dernier profil connu d\'un utilisateur', async () => {
    const auth = createOfflineAuth<Profile>(memoryStorage())
    expect(auth.getProfile('u1')).toBeNull()
    await auth.remember('email', 'a@b.cm', 'bon', 'u1', { nom: 'Awa', role: 'admin' })
    expect(auth.getProfile('u1')).toEqual({ nom: 'Awa', role: 'admin' })
    expect(auth.getProfile('u2')).toBeNull()
  })
})
