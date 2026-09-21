import { describe, expect, it } from 'vitest'
import { compteEncaissement } from '../services/comptabilite.service'

describe('comptes de trésorerie des encaissements', () => {
  it.each([
    ['banque', '521'],
    ['virement', '521'],
    ['caisse', '571'],
    ['especes', '571'],
    ['mtn_momo', '5521'],
    ['orange_money', '5522'],
  ] as const)('affecte %s au compte %s', (mode, compte) => {
    expect(compteEncaissement(mode)).toBe(compte)
  })
})
