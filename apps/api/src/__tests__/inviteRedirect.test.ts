import { describe, expect, it } from 'vitest'
import { resolveInviteRedirectUrl } from '../utils/inviteRedirect'

function avecEnv(env: Record<string, string | undefined>, fn: () => void) {
  const avant: Record<string, string | undefined> = {}
  for (const k of Object.keys(env)) {
    avant[k] = process.env[k]
    if (env[k] === undefined) delete process.env[k]
    else process.env[k] = env[k]
  }
  try { fn() } finally {
    for (const [k, v] of Object.entries(avant)) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
  }
}

describe('resolveInviteRedirectUrl — origines locales (recette AD-04)', () => {
  it('ignore les origines localhost en tête de FRONTEND_URL', () => {
    avecEnv({
      INVITE_REDIRECT_URL: undefined,
      FRONTEND_URL: 'http://localhost:5173,http://localhost:3000,https://erp.tafdil.cm',
    }, () => {
      expect(resolveInviteRedirectUrl()).toBe('https://erp.tafdil.cm/set-password')
    })
  })

  it('en production, jamais localhost : retombe sur l\'URL web par défaut', () => {
    avecEnv({ INVITE_REDIRECT_URL: undefined, FRONTEND_URL: 'http://localhost:5173', NODE_ENV: 'production' }, () => {
      expect(resolveInviteRedirectUrl()).toBe('https://forge-tafdil-erp-web.vercel.app/set-password')
    })
  })

  it('hors production, localhost reste utilisable faute de mieux', () => {
    avecEnv({ INVITE_REDIRECT_URL: undefined, FRONTEND_URL: 'http://localhost:5173', NODE_ENV: 'test' }, () => {
      expect(resolveInviteRedirectUrl()).toBe('http://localhost:5173/set-password')
    })
  })
})

describe('resolveInviteRedirectUrl', () => {
  it('uses INVITE_REDIRECT_URL when provided', () => {
    const previous = process.env.INVITE_REDIRECT_URL
    process.env.INVITE_REDIRECT_URL = 'https://forge.example.com'

    try {
      // /set-password (pas /login) : cf. utils/inviteRedirect.ts — un invité n'a
      // pas encore de mot de passe au premier lien reçu.
      expect(resolveInviteRedirectUrl()).toBe('https://forge.example.com/set-password')
    } finally {
      if (previous === undefined) delete process.env.INVITE_REDIRECT_URL
      else process.env.INVITE_REDIRECT_URL = previous
    }
  })

  it('falls back to FRONTEND_URL when no explicit redirect is provided', () => {
    const previousInvite = process.env.INVITE_REDIRECT_URL
    const previousFrontend = process.env.FRONTEND_URL
    delete process.env.INVITE_REDIRECT_URL
    process.env.FRONTEND_URL = 'forge.example.com'

    try {
      expect(resolveInviteRedirectUrl()).toBe('https://forge.example.com/set-password')
    } finally {
      if (previousInvite === undefined) delete process.env.INVITE_REDIRECT_URL
      else process.env.INVITE_REDIRECT_URL = previousInvite
      if (previousFrontend === undefined) delete process.env.FRONTEND_URL
      else process.env.FRONTEND_URL = previousFrontend
    }
  })
})
