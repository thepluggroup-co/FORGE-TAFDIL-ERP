/**
 * Réponses 403 du client API :
 *  - refus de permission RBAC → plus de toast « Accès refusé — Permission requise : … »
 *  - règle métier (remise plafonnée, session d'un autre caissier…) → message conservé
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const toast = vi.hoisted(() => ({ warning: vi.fn(), error: vi.fn(), success: vi.fn() }))
vi.mock('sonner', () => ({ toast }))
vi.mock('@/lib/supabase', () => ({
  supabase: { auth: { getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: 'jeton' } } }) } },
}))

import { apiClient } from '@/lib/api-client'

function repondre403(corps: unknown) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(corps), { status: 403 })))
}

beforeEach(() => { toast.warning.mockClear(); toast.error.mockClear() })

describe('apiClient — 403', () => {
  it('permission RBAC refusée en lecture : aucun toast', async () => {
    repondre403({ error: 'Accès refusé', code: 'FORBIDDEN', details: 'Permission requise : FINANCE:READ. Rôle actuel : CAISSIER' })
    await expect(apiClient.get('/api/finance/dashboard')).rejects.toThrow('Action non autorisée pour votre profil')
    expect(toast.warning).not.toHaveBeenCalled()
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('rôle requis (requireRole) : aucun toast, message simple pour l\'appelant', async () => {
    repondre403({ error: 'Accès refusé', code: 'FORBIDDEN', details: 'Rôle requis : admin. Rôle actuel : superviseur' })
    await expect(apiClient.post('/api/factures', {})).rejects.toThrow('Action non autorisée pour votre profil')
    expect(toast.warning).not.toHaveBeenCalled()
  })

  it('règle métier : le message reste affiché, sans préfixe technique', async () => {
    repondre403({ error: 'Remise limitée à 5% pour un caissier — remise demandée : 10.0%.', code: 'REMISE_LIMIT_EXCEEDED' })
    await expect(apiClient.post('/api/caisse/tickets', {})).rejects.toThrow('Remise limitée à 5%')
    expect(toast.warning).toHaveBeenCalledTimes(1)
    expect(toast.warning.mock.calls[0][0]).toMatch(/^Remise limitée/)
  })
})
