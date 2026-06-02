/**
 * TEST-04 : Assistant IA répond en français
 *
 * POST /api/ai/chat { message: 'Quel est mon stock critique ?' }
 * Assert : réponse non vide, en français, contient des chiffres
 * Assert : temps de réponse < 10 secondes
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mkChain, authHeaders } from './helpers'

// Mock Supabase
vi.mock('@forge/db/supabase', () => {
  // Chaîne sûre par défaut — ne crashe jamais, retourne data=[] sans erreur
  const safeChain = () => {
    const c: Record<string, unknown> = {}
    for (const m of ['select','insert','update','delete','upsert','eq','neq','in',
      'or','gte','lte','lt','gt','not','ilike','like','order','range','limit','head','filter'])
      c[m] = vi.fn().mockReturnValue(c)
    c['single']      = vi.fn().mockResolvedValue({ data: null, error: null })
    c['maybeSingle'] = vi.fn().mockResolvedValue({ data: null, error: null })
    c['then']        = (res: (v: unknown) => unknown) =>
      Promise.resolve({ data: [], count: 0, error: null }).then(res)
    return c
  }
  const mockClient = {
    from:          vi.fn().mockImplementation(safeChain),
    rpc:           vi.fn().mockResolvedValue({ data: null, error: null }),
    channel:       vi.fn(() => ({ send: vi.fn().mockResolvedValue('ok') })),
    removeChannel: vi.fn(),
    storage: { from: vi.fn().mockReturnValue({
      upload:          vi.fn().mockResolvedValue({ error: null }),
      download:        vi.fn().mockResolvedValue({ data: null, error: { message: 'not found' } }),
      getPublicUrl:    vi.fn().mockReturnValue({ data: { publicUrl: 'https://test.supabase.co/test.pdf' } }),
      createSignedUrl: vi.fn().mockResolvedValue({ data: { signedUrl: 'https://test.supabase.co/signed.pdf' } }),
    }) },
  }
  return { supabase: mockClient, supabaseAdmin: mockClient }
})

// Mock client Anthropic — évite tout appel réseau réel
vi.mock('@forge/ai', () => ({
  anthropic: {
    messages: {
      create: vi.fn().mockResolvedValue({
        content: [
          {
            type: 'text',
            text: 'Vous avez actuellement 3 produits en stock critique.\n' +
                  '• Vis M6 : 2 unités (seuil critique : 5)\n' +
                  '• Tôle 3mm : 1 unité (seuil critique : 8)\n' +
                  '• Fil de soudure : 0 unité — RUPTURE\n\n' +
                  'Je recommande un réapprovisionnement urgent pour un total estimé de 75 000 XAF.',
          },
        ],
        usage: { input_tokens: 180, output_tokens: 72 },
      }),
    },
  },
  FORGE_MODEL: 'claude-sonnet-4-6',
}))

import app from '../app'
import { supabase } from '@forge/db/supabase'
import { anthropic } from '@forge/ai'

// ── Réponse de contexte Supabase vide (non bloquant pour le chat) ─────────────

const EMPTY_LIST = mkChain({ data: [], error: null })

describe('TEST-04 : Assistant IA répond en français', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // fetchForgeContext appelle plusieurs from() — tous retournent liste vide
    vi.mocked(supabase.from).mockReturnValue(EMPTY_LIST as never)
  })

  it('répond en français, non vide, contient des chiffres, en < 10 s', async () => {
    const t0 = Date.now()

    const res = await app.request('/api/ai/chat', {
      method:  'POST',
      headers: new Headers(authHeaders('admin')),
      body:    JSON.stringify({ message: 'Quel est mon stock critique ?' }),
    })

    const elapsed = Date.now() - t0

    expect(res.status).toBe(200)

    const body = await res.json() as {
      reply:             string
      usage:             { input_tokens: number; output_tokens: number }
      contexte_charge:   boolean
    }

    // Réponse non vide
    expect(body.reply.length).toBeGreaterThan(10)

    // Contient des mots français courants
    const frenchWords = /produit|stock|unité|critique|rupture|recommand/i
    expect(body.reply).toMatch(frenchWords)

    // Contient des chiffres (quantités, prix XAF…)
    expect(body.reply).toMatch(/\d+/)

    // Champ usage présent
    expect(body.usage.input_tokens).toBeGreaterThan(0)
    expect(body.usage.output_tokens).toBeGreaterThan(0)

    // Temps de réponse < 10 s (API mockée → quasi instantané)
    expect(elapsed).toBeLessThan(10_000)

    // Anthropic a été appelé une fois avec le bon modèle
    const mockCreate = vi.mocked(anthropic.messages.create)
    expect(mockCreate).toHaveBeenCalledTimes(1)

    const callArgs = mockCreate.mock.calls[0][0] as {
      model:    string
      messages: Array<{ role: string; content: string }>
    }
    expect(callArgs.model).toBe('claude-sonnet-4-6')
    expect(callArgs.messages.at(-1)?.content).toBe('Quel est mon stock critique ?')
  })

  it('accepte un historique de conversation', async () => {
    const res = await app.request('/api/ai/chat', {
      method:  'POST',
      headers: new Headers(authHeaders()),
      body:    JSON.stringify({
        message: 'Et pour les commandes en cours ?',
        history: [
          { role: 'user',      content: 'Quel est mon stock critique ?' },
          { role: 'assistant', content: 'Vous avez 3 produits critiques.' },
        ],
      }),
    })

    expect(res.status).toBe(200)

    const mockCreate = vi.mocked(anthropic.messages.create)
    expect(mockCreate).toHaveBeenCalledTimes(1)

    const messages = (mockCreate.mock.calls[0][0] as { messages: unknown[] }).messages
    // History + nouveau message = 3 messages au total
    expect(messages.length).toBe(3)
  })

  it('retourne 401 sans token', async () => {
    const res = await app.request('/api/ai/chat', {
      method:  'POST',
      headers: new Headers({ 'Content-Type': 'application/json' }),
      body:    JSON.stringify({ message: 'test' }),
    })
    expect(res.status).toBe(401)
  })

  it('retourne 400 si message vide', async () => {
    const res = await app.request('/api/ai/chat', {
      method:  'POST',
      headers: new Headers(authHeaders()),
      body:    JSON.stringify({ message: '' }),
    })
    expect(res.status).toBe(400)
  })
})
