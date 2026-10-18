import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(new URL('../../../../packages/db/migrations/0043_role_manager.sql', import.meta.url), 'utf8')

describe('migration role manager', () => {
  it('réaffecte les profils et métadonnées superviseur, puis enlève le rôle de la contrainte', () => {
    expect(migration).toMatch(/UPDATE\s+auth\.users[\s\S]*?raw_app_meta_data[\s\S]*?WHERE\s+raw_app_meta_data->>'role'\s*=\s*'superviseur'/i)
    expect(migration).toMatch(/UPDATE\s+public\.profiles\s+SET\s+role\s*=\s*'manager'\s+WHERE\s+role\s*=\s*'superviseur'/i)
    expect(migration).toContain("'manager'")
    expect(migration).toContain("p.role IN ('admin', 'manager')")
    expect(migration).not.toMatch(/CHECK\s*\([^;]*'superviseur'/is)
  })
})
