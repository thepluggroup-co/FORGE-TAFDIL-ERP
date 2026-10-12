// ── Connexion hors ligne (desktop + mobile) ───────────────────────────────────
//
// Sans réseau, Supabase Auth est injoignable : impossible de vérifier un mot de
// passe ou un PIN. Après chaque connexion EN LIGNE réussie, l'app mémorise donc
// sur l'appareil une empreinte dérivée (PBKDF2, jamais le secret lui-même) et
// le profil de l'utilisateur. Hors ligne, les mêmes identifiants sont vérifiés
// contre cette empreinte.
//
// Limites voulues :
//  - seuls les comptes déjà connectés en ligne SUR CET APPAREIL peuvent entrer ;
//  - au-delà de `maxOfflineDays` sans connexion en ligne, l'accès est refusé
//    (sinon un compte désactivé côté serveur resterait utilisable indéfiniment) ;
//  - après `maxAttempts` échecs, blocage temporaire.
//
// Un PIN à 4 chiffres reste devinable par quelqu'un qui copie le stockage de
// l'appareil : cette empreinte protège contre un collègue curieux, pas contre
// un vol d'appareil — d'où la durée limitée et le chiffrement disque recommandé.

export interface OfflineAuthStorage {
  get(key: string): string | null
  set(key: string, value: string): void
  remove(key: string): void
}

export type OfflineCredentialKind = 'email' | 'phone'

export type OfflineVerifyFailure = 'unknown' | 'invalid' | 'expired' | 'locked'

export type OfflineVerifyResult<P> =
  | { ok: true; userId: string; profile: P }
  | { ok: false; reason: OfflineVerifyFailure }

interface StoredCredential<P> {
  userId:       string
  salt:         string
  hash:         string
  iterations:   number
  profile:      P
  lastOnlineAt: number
  failures:     number
  lockedUntil:  number
}

export interface OfflineAuthOptions {
  maxOfflineDays?: number
  maxAttempts?:    number
  lockMinutes?:    number
}

const PREFIX     = 'forge-offline-auth:'
const INDEX_KEY  = `${PREFIX}index`
const ITERATIONS = 200_000

export const OFFLINE_AUTH_MESSAGES: Record<OfflineVerifyFailure, string> = {
  unknown: 'Hors ligne — ce compte ne s\'est encore jamais connecté sur cet appareil. Une connexion Internet est nécessaire la première fois.',
  invalid: 'Identifiants incorrects (vérification hors ligne).',
  expired: 'Hors ligne depuis trop longtemps — reconnectez-vous une fois avec Internet.',
  locked:  'Trop de tentatives — réessayez dans quelques minutes.',
}

function toBase64(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s)
}

function fromBase64(value: string): Uint8Array {
  const s = atob(value)
  const bytes = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i)
  return bytes
}

async function derive(secret: string, salt: Uint8Array, iterations: number): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256)
  return toBase64(new Uint8Array(bits))
}

function sameString(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

/** Un numéro saisi « 6 99 00 11 22 » ou « +237699001122 » doit retrouver la même empreinte. */
function normalizeIdentifier(kind: OfflineCredentialKind, identifier: string): string {
  const value = identifier.trim().toLowerCase()
  return kind === 'phone' ? value.replace(/[^\d+]/g, '') : value
}

export function createOfflineAuth<P>(storage: OfflineAuthStorage, options: OfflineAuthOptions = {}) {
  const maxOfflineMs = (options.maxOfflineDays ?? 7) * 24 * 60 * 60 * 1000
  const maxAttempts  = options.maxAttempts ?? 5
  const lockMs       = (options.lockMinutes ?? 5) * 60 * 1000

  const keyOf = (kind: OfflineCredentialKind, identifier: string) =>
    `${PREFIX}${kind}:${normalizeIdentifier(kind, identifier)}`

  function read(key: string): StoredCredential<P> | null {
    try {
      const raw = storage.get(key)
      return raw ? JSON.parse(raw) as StoredCredential<P> : null
    } catch {
      return null
    }
  }

  function readIndex(): string[] {
    try {
      const raw = storage.get(INDEX_KEY)
      return raw ? JSON.parse(raw) as string[] : []
    } catch {
      return []
    }
  }

  function recordsOf(userId: string): Array<[string, StoredCredential<P>]> {
    return readIndex()
      .map((key) => [key, read(key)] as const)
      .filter((entry): entry is [string, StoredCredential<P>] => entry[1]?.userId === userId)
  }

  return {
    /** À appeler après une connexion EN LIGNE réussie. */
    async remember(kind: OfflineCredentialKind, identifier: string, secret: string, userId: string, profile: P): Promise<void> {
      const salt = crypto.getRandomValues(new Uint8Array(16))
      const record: StoredCredential<P> = {
        userId,
        salt:         toBase64(salt),
        hash:         await derive(secret, salt, ITERATIONS),
        iterations:   ITERATIONS,
        profile,
        lastOnlineAt: Date.now(),
        failures:     0,
        lockedUntil:  0,
      }
      const key = keyOf(kind, identifier)
      storage.set(key, JSON.stringify(record))
      const index = readIndex()
      if (!index.includes(key)) storage.set(INDEX_KEY, JSON.stringify([...index, key]))
    },

    /** Profil confirmé par le serveur : rafraîchit la copie locale et la date de dernière connexion en ligne. */
    touch(userId: string, patch?: Partial<P>): void {
      for (const [key, record] of recordsOf(userId)) {
        storage.set(key, JSON.stringify({
          ...record,
          profile:      patch ? { ...record.profile, ...patch } : record.profile,
          lastOnlineAt: Date.now(),
        }))
      }
    },

    /** Dernier profil connu pour cet utilisateur (session encore valide mais serveur injoignable). */
    getProfile(userId: string): P | null {
      return recordsOf(userId)[0]?.[1].profile ?? null
    },

    async verify(kind: OfflineCredentialKind, identifier: string, secret: string): Promise<OfflineVerifyResult<P>> {
      const key = keyOf(kind, identifier)
      const record = read(key)
      if (!record) return { ok: false, reason: 'unknown' }
      if (record.lockedUntil > Date.now()) return { ok: false, reason: 'locked' }
      if (Date.now() - record.lastOnlineAt > maxOfflineMs) return { ok: false, reason: 'expired' }

      const hash = await derive(secret, fromBase64(record.salt), record.iterations)
      if (!sameString(hash, record.hash)) {
        const failures = record.failures + 1
        const locked = failures >= maxAttempts
        storage.set(key, JSON.stringify({
          ...record,
          failures:    locked ? 0 : failures,
          lockedUntil: locked ? Date.now() + lockMs : 0,
        }))
        return { ok: false, reason: locked ? 'locked' : 'invalid' }
      }

      if (record.failures > 0) storage.set(key, JSON.stringify({ ...record, failures: 0, lockedUntil: 0 }))
      return { ok: true, userId: record.userId, profile: record.profile }
    },
  }
}

/** Adaptateur localStorage (renderer Electron, WebView Capacitor). */
export function localOfflineAuthStorage(): OfflineAuthStorage {
  return {
    get:    (key) => { try { return localStorage.getItem(key) } catch { return null } },
    set:    (key, value) => { try { localStorage.setItem(key, value) } catch { /* stockage plein ou indisponible */ } },
    remove: (key) => { try { localStorage.removeItem(key) } catch { /* idem */ } },
  }
}
