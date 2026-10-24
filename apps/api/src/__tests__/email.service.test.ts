/**
 * email.service.test.ts — provider console (dry-run), resend, brevo, échecs réseau,
 * et le gabarit HTML du BL (échappement + contenu).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

import { escapeHtml, sendEmail, sendBlEmail } from '../services/email.service'

const ENV_KEYS = ['EMAIL_PROVIDER', 'EMAIL_API_KEY', 'EMAIL_FROM'] as const
const savedEnv: Record<string, string | undefined> = {}

describe('email.service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    for (const k of ENV_KEYS) { savedEnv[k] = process.env[k]; delete process.env[k] }
  })

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k]
      else process.env[k] = savedEnv[k]
    }
  })

  describe('escapeHtml', () => {
    it('échappe les 5 caractères spéciaux HTML', () => {
      expect(escapeHtml(`<a href="x">O'Brien & Fils</a>`))
        .toBe('&lt;a href=&quot;x&quot;&gt;O&#39;Brien &amp; Fils&lt;/a&gt;')
    })

    it("laisse une chaîne sans caractère spécial inchangée", () => {
      expect(escapeHtml('TAFDIL SARL')).toBe('TAFDIL SARL')
    })
  })

  describe('sendEmail — dry-run (console)', () => {
    it('provider par défaut (non défini) : dry-run, aucun appel réseau', async () => {
      const res = await sendEmail({ to: 'client@test.cm', subject: 'Test', html: '<p>Hi</p>' })
      expect(res).toEqual({ ok: true, skipped: true })
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('EMAIL_PROVIDER=resend mais EMAIL_API_KEY absent : retombe en dry-run', async () => {
      process.env.EMAIL_PROVIDER = 'resend'
      const res = await sendEmail({ to: 'client@test.cm', subject: 'Test', html: '<p>Hi</p>' })
      expect(res).toEqual({ ok: true, skipped: true })
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('destinataire manquant : échoue sans tenter d\'envoi', async () => {
      process.env.EMAIL_PROVIDER = 'resend'
      process.env.EMAIL_API_KEY = 'key-123'
      const res = await sendEmail({ to: null, subject: 'Test', html: '<p>Hi</p>' })
      expect(res).toEqual({ ok: false, skipped: true, error: 'Destinataire manquant' })
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('provider inconnu : avertit et retombe en dry-run', async () => {
      process.env.EMAIL_PROVIDER = 'mailgun'
      process.env.EMAIL_API_KEY = 'some-key'
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const res = await sendEmail({ to: 'client@test.cm', subject: 'Test', html: '<p>Hi</p>' })
      expect(res).toEqual({ ok: true, skipped: true })
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('mailgun'))
      warnSpy.mockRestore()
    })
  })

  describe('sendEmail — provider resend', () => {
    beforeEach(() => {
      process.env.EMAIL_PROVIDER = 'resend'
      process.env.EMAIL_API_KEY = 'resend-key-abc'
    })

    it('envoi réussi : poste sur api.resend.com avec le bon header et renvoie l\'id', async () => {
      fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'resend-id-1' }) })

      const res = await sendEmail({ to: 'client@test.cm', subject: 'Sujet', html: '<p>Corps</p>' })

      expect(res).toEqual({ ok: true, id: 'resend-id-1' })
      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.resend.com/emails',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({ Authorization: 'Bearer resend-key-abc' }),
        }),
      )
      const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)
      expect(body).toMatchObject({ to: 'client@test.cm', subject: 'Sujet', html: '<p>Corps</p>' })
    })

    it('réponse HTTP non-ok : renvoie ok:false avec le statut dans l\'erreur', async () => {
      fetchMock.mockResolvedValueOnce({ ok: false, status: 422, text: async () => 'Invalid recipient' })

      const res = await sendEmail({ to: 'bad@test.cm', subject: 'Sujet', html: '<p>Corps</p>' })

      expect(res.ok).toBe(false)
      expect(res.error).toContain('422')
      expect(res.error).toContain('Invalid recipient')
    })

    it('fetch qui lève (coupure réseau) : capturée, ok:false avec le message', async () => {
      fetchMock.mockRejectedValueOnce(new Error('ECONNRESET'))

      const res = await sendEmail({ to: 'client@test.cm', subject: 'Sujet', html: '<p>Corps</p>' })

      expect(res).toEqual({ ok: false, error: 'ECONNRESET' })
    })
  })

  describe('sendEmail — provider brevo', () => {
    beforeEach(() => {
      process.env.EMAIL_PROVIDER = 'brevo'
      process.env.EMAIL_API_KEY = 'brevo-key-xyz'
    })

    it('envoi réussi : poste sur api.brevo.com avec le bon format de destinataires', async () => {
      fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ messageId: 'brevo-id-1' }) })

      const res = await sendEmail({ to: 'client@test.cm', subject: 'Sujet', html: '<p>Corps</p>' })

      expect(res).toEqual({ ok: true, id: 'brevo-id-1' })
      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.brevo.com/v3/smtp/email',
        expect.objectContaining({ headers: expect.objectContaining({ 'api-key': 'brevo-key-xyz' }) }),
      )
      const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)
      expect(body.to).toEqual([{ email: 'client@test.cm' }])
      expect(body.htmlContent).toBe('<p>Corps</p>')
    })

    it('réponse HTTP non-ok : renvoie ok:false avec le statut dans l\'erreur', async () => {
      fetchMock.mockResolvedValueOnce({ ok: false, status: 401, text: async () => 'Unauthorized' })

      const res = await sendEmail({ to: 'client@test.cm', subject: 'Sujet', html: '<p>Corps</p>' })

      expect(res.ok).toBe(false)
      expect(res.error).toContain('401')
    })
  })

  describe('sendBlEmail', () => {
    it('destinataire manquant : propage l\'échec de sendEmail sans construire inutilement', async () => {
      const res = await sendBlEmail({
        to: null,
        clientNom: 'Jean Mbarga',
        numeroBl: 'BL-001',
        commandeRef: 'CMD-001',
        blSignedUrl: 'https://x.test/bl.pdf',
      })
      expect(res).toEqual({ ok: false, skipped: true, error: 'Destinataire manquant' })
    })

    it('échappe le nom client dans le HTML envoyé et garde le sujet avec le n° de BL', async () => {
      process.env.EMAIL_PROVIDER = 'resend'
      process.env.EMAIL_API_KEY = 'key'
      fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'r1' }) })

      await sendBlEmail({
        to: 'client@test.cm',
        clientNom: `O'Brien <script>`,
        numeroBl: 'BL-20260101-0007',
        commandeRef: 'CMD-20260101-0007',
        blSignedUrl: 'https://supabase.co/bl.pdf?token=abc',
      })

      const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)
      expect(body.subject).toContain('BL-20260101-0007')
      expect(body.html).toContain('O&#39;Brien')
      expect(body.html).not.toContain('<script>')
      expect(body.html).toContain('https://supabase.co/bl.pdf?token=abc')
      expect(body.text).toContain('BL-20260101-0007')
    })
  })
})
