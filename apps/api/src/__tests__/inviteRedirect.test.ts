import { describe, expect, it } from 'vitest'
import { resolveInviteRedirectUrl } from '../utils/inviteRedirect'

describe('resolveInviteRedirectUrl', () => {
  it('uses INVITE_REDIRECT_URL when provided', () => {
    const previous = process.env.INVITE_REDIRECT_URL
    process.env.INVITE_REDIRECT_URL = 'https://forge.example.com'

    try {
      expect(resolveInviteRedirectUrl()).toBe('https://forge.example.com/login')
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
      expect(resolveInviteRedirectUrl()).toBe('https://forge.example.com/login')
    } finally {
      if (previousInvite === undefined) delete process.env.INVITE_REDIRECT_URL
      else process.env.INVITE_REDIRECT_URL = previousInvite
      if (previousFrontend === undefined) delete process.env.FRONTEND_URL
      else process.env.FRONTEND_URL = previousFrontend
    }
  })
})
