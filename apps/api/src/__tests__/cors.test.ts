import { describe, expect, it } from 'vitest'
import app from '../app'

describe('CORS', () => {
  it('allows the active production Vercel origin', async () => {
    const res = await app.request('/health', {
      headers: {
        Origin: 'https://forge-tafdil-erp-web.vercel.app',
      },
    })

    expect(res.headers.get('access-control-allow-origin')).toBe('https://forge-tafdil-erp-web.vercel.app')
  })

  it('allows the legacy Vercel origin', async () => {
    const res = await app.request('/health', {
      headers: {
        Origin: 'https://forge-tafdil.vercel.app',
      },
    })

    expect(res.headers.get('access-control-allow-origin')).toBe('https://forge-tafdil.vercel.app')
  })
})
