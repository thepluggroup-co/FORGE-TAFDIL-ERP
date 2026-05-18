/**
 * StockLevel.test.tsx — Tests 1 à 4
 *
 * 1. Affiche la couleur VERTE si stock > seuil_alerte
 * 2. Affiche la couleur ORANGE si stock entre seuil_alerte et seuil_critique
 * 3. Affiche la couleur ROUGE si stock <= seuil_critique
 * 4. Affiche la valeur numérique correcte sous la barre
 */

import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { StockLevel } from '@forge/ui'

afterEach(() => cleanup())

// Colors set by the component as inline styles (jsdom normalises hex → rgb)
const GREEN = 'rgb(22, 163, 74)'   // #16a34a
const AMBER = 'rgb(217, 119, 6)'   // #d97706
const RED   = 'rgb(220, 38, 38)'   // #dc2626

function getFillBar(container: HTMLElement): HTMLElement {
  // The fill div is the only child with transition-all inside the bar track
  return container.querySelector('.absolute.rounded-full') as HTMLElement
}

// ── Test 1 — VERT ─────────────────────────────────────────────────────────────

describe('Test 1 — stock > seuil_alerte → couleur VERTE', () => {
  it('barre verte quand current=80 > alertThreshold=50', () => {
    const { container } = render(
      <StockLevel current={80} alertThreshold={50} criticalThreshold={20} max={100} unit="kg" showLabel />,
    )
    expect(getFillBar(container)).toHaveStyle({ backgroundColor: GREEN })
  })

  it('label courant en vert avec la valeur', () => {
    render(
      <StockLevel current={80} alertThreshold={50} criticalThreshold={20} max={100} unit="kg" showLabel />,
    )
    expect(screen.getByText(/80 kg/)).toHaveStyle({ color: GREEN })
  })

  it('vert exact à la frontière current === alertThreshold + 1', () => {
    const { container } = render(
      <StockLevel current={51} alertThreshold={50} criticalThreshold={20} max={100} unit="kg" />,
    )
    expect(getFillBar(container)).toHaveStyle({ backgroundColor: GREEN })
  })
})

// ── Test 2 — ORANGE ───────────────────────────────────────────────────────────

describe('Test 2 — stock entre seuil_alerte et seuil_critique → ORANGE', () => {
  it('barre orange quand criticalThreshold < current <= alertThreshold', () => {
    const { container } = render(
      <StockLevel current={35} alertThreshold={50} criticalThreshold={20} max={100} unit="kg" showLabel />,
    )
    expect(getFillBar(container)).toHaveStyle({ backgroundColor: AMBER })
  })

  it('label courant en orange', () => {
    render(
      <StockLevel current={35} alertThreshold={50} criticalThreshold={20} max={100} unit="kg" showLabel />,
    )
    expect(screen.getByText(/35 kg/)).toHaveStyle({ color: AMBER })
  })

  it('orange exact quand current === alertThreshold', () => {
    const { container } = render(
      <StockLevel current={50} alertThreshold={50} criticalThreshold={20} max={100} unit="kg" />,
    )
    expect(getFillBar(container)).toHaveStyle({ backgroundColor: AMBER })
  })
})

// ── Test 3 — ROUGE ────────────────────────────────────────────────────────────

describe('Test 3 — stock <= seuil_critique → couleur ROUGE', () => {
  it('barre rouge quand current=10 < criticalThreshold=20', () => {
    const { container } = render(
      <StockLevel current={10} alertThreshold={50} criticalThreshold={20} max={100} unit="kg" showLabel />,
    )
    expect(getFillBar(container)).toHaveStyle({ backgroundColor: RED })
  })

  it('label courant en rouge', () => {
    render(
      <StockLevel current={10} alertThreshold={50} criticalThreshold={20} max={100} unit="kg" showLabel />,
    )
    expect(screen.getByText(/10 kg/)).toHaveStyle({ color: RED })
  })

  it('rouge exact quand current === criticalThreshold (limite basse)', () => {
    const { container } = render(
      <StockLevel current={20} alertThreshold={50} criticalThreshold={20} max={100} unit="kg" />,
    )
    expect(getFillBar(container)).toHaveStyle({ backgroundColor: RED })
  })
})

// ── Test 4 — valeur numérique sous la barre ───────────────────────────────────

describe('Test 4 — valeur numérique correcte sous la barre', () => {
  it('affiche current et max avec l\'unité', () => {
    render(
      <StockLevel current={42} alertThreshold={60} criticalThreshold={20} max={200} unit="kg" showLabel />,
    )
    expect(screen.getByText(/42 kg/)).toBeInTheDocument()
    expect(screen.getByText(/200 kg/)).toBeInTheDocument()
  })

  it('masque les labels si showLabel=false', () => {
    render(
      <StockLevel current={50} alertThreshold={70} criticalThreshold={30} max={100} unit="kg" showLabel={false} />,
    )
    expect(screen.queryByText(/50 kg/)).not.toBeInTheDocument()
    expect(screen.queryByText(/100 kg/)).not.toBeInTheDocument()
  })

  it('largeur de la barre proportionnelle (pct = current / max × 100)', () => {
    const { container } = render(
      <StockLevel current={60} alertThreshold={80} criticalThreshold={30} max={100} />,
    )
    const bar = getFillBar(container)
    expect(bar.style.width).toBe('60%')
  })

  it('ne dépasse pas 100% si current > max', () => {
    const { container } = render(
      <StockLevel current={150} alertThreshold={80} criticalThreshold={30} max={100} />,
    )
    expect(getFillBar(container).style.width).toBe('100%')
  })
})
