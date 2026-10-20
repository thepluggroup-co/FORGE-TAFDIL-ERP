/**
 * Onglet ouvert avant un redéploiement : rechargement automatique, une seule fois.
 */
import { describe, it, expect, vi } from 'vitest'
import { createChunkRecovery, isStaleChunkError } from '@/lib/chunk-reload'

function memoryStorage() {
  const data = new Map<string, string>()
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => { data.set(k, v) } }
}

const PERIME = new TypeError('Failed to fetch dynamically imported module: https://forge-tafdil-erp-web.vercel.app/assets/BonsSortie-AbC123.js')

describe('isStaleChunkError', () => {
  it('reconnaît les messages des navigateurs', () => {
    expect(isStaleChunkError(PERIME)).toBe(true)
    expect(isStaleChunkError(new TypeError('Importing a module script failed.'))).toBe(true)        // Safari
    expect(isStaleChunkError(new TypeError('error loading dynamically imported module'))).toBe(true) // Firefox
    expect(isStaleChunkError(new Error("Cannot read properties of undefined (reading 'map')"))).toBe(false)
  })
})

describe('createChunkRecovery', () => {
  it('recharge une fois sur un fichier de page périmé', () => {
    const reload = vi.fn()
    const recover = createChunkRecovery({ storage: memoryStorage(), reload, now: () => 1_000_000 })
    expect(recover(PERIME)).toBe(true)
    expect(recover(PERIME)).toBe(true)   // même page : déjà en cours, pas de second reload
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('ignore les autres erreurs', () => {
    const reload = vi.fn()
    const recover = createChunkRecovery({ storage: memoryStorage(), reload, now: () => 0 })
    expect(recover(new Error('boom'))).toBe(false)
    expect(reload).not.toHaveBeenCalled()
  })

  it('ne boucle pas : nouvel échec juste après le rechargement = vraie erreur', () => {
    const storage = memoryStorage()
    let t = 1_000_000
    const reload = vi.fn()
    createChunkRecovery({ storage, reload, now: () => t })(PERIME)
    t += 3_000   // page rechargée, le fichier manque toujours
    const apresRechargement = createChunkRecovery({ storage, reload, now: () => t })
    expect(apresRechargement(PERIME)).toBe(false)
    expect(reload).toHaveBeenCalledTimes(1)
    t += 60_000  // plus tard (nouveau déploiement) : de nouveau autorisé
    expect(createChunkRecovery({ storage, reload, now: () => t })(PERIME)).toBe(true)
    expect(reload).toHaveBeenCalledTimes(2)
  })
})
