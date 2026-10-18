import { describe, expect, it } from 'vitest'
import { filterEnabledFeatureModules, NAV_GROUPS } from '@/components/layout/Sidebar'
import { disabledModuleRedirect } from '@forge/shared'

describe('registre des modules actifs', () => {
  it('retire du menu les modules désactivés', () => {
    const visible = filterEnabledFeatureModules(NAV_GROUPS)
    const paths = visible.flatMap((group) => group.items.map((item) => item.path))
    expect(paths).not.toContain('/iot')
    expect(paths).not.toContain('/securite')
    expect(paths).not.toContain('/intelligence')
    expect(paths).not.toContain('/projets')
    expect(paths).not.toContain('/marketing')
    expect(paths).toContain('/devis')
    expect(disabledModuleRedirect('iot')).toBe('/dashboard')
  })
})
