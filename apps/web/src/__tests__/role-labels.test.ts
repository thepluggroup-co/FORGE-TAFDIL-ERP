import { describe, expect, it } from 'vitest'
import { ROLE_LABELS, UserRoleSchema } from '@forge/shared'

describe('rôles partagés', () => {
  it('accepte manager, caissier et livreur sans conserver superviseur', () => {
    expect(UserRoleSchema.safeParse('manager').success).toBe(true)
    expect(UserRoleSchema.safeParse('caissier').success).toBe(true)
    expect(UserRoleSchema.safeParse('livreur').success).toBe(true)
    expect(UserRoleSchema.safeParse('superviseur').success).toBe(false)
  })

  it('expose un libellé unique pour le rôle legacy et le rôle RBAC Manager', () => {
    expect(ROLE_LABELS.manager).toBe('Manager')
    expect(ROLE_LABELS.MANAGER).toBe(ROLE_LABELS.manager)
  })
})
