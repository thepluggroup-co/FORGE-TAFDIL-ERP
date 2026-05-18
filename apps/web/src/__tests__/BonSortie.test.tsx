/**
 * BonSortie.test.tsx — Tests 9 à 11
 *
 * 9.  Bouton Valider visible si statut=soumis, absent si statut=execute
 * 10. Formulaire création bon — Soumettre désactivé sans technicien/produit sélectionné
 * 11. Stepper affiche la bonne étape active selon le statut du bon
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, initial, animate, exit, transition, ...rest }: any) =>
      <div {...rest}>{children}</div>,
  },
  AnimatePresence: ({ children }: any) => <>{children}</>,
}))

vi.mock('@forge/ui', () => ({
  PageHeader: ({ title, actions }: any) => (
    <div>
      <h1>{title}</h1>
      {actions}
    </div>
  ),
  DataTable: ({ columns, data }: any) => (
    <table>
      <tbody>
        {(data as Record<string, unknown>[]).map((row, i: number) => (
          <tr key={i}>
            {(columns as { id: string; accessor: unknown; render?: (v: unknown, r: unknown) => unknown }[]).map((col) => {
              const val =
                typeof col.accessor === 'function'
                  ? (col.accessor as (r: unknown) => unknown)(row)
                  : row[col.accessor as string]
              return (
                <td key={col.id}>
                  {col.render ? (col.render(val, row) as React.ReactNode) : String(val ?? '')}
                </td>
              )
            })}
          </tr>
        ))}
      </tbody>
    </table>
  ),
  StatusBadge: ({ status }: any) => <span data-status={status}>{status}</span>,
  SlideOver: ({ isOpen, children, title }: any) =>
    isOpen ? (
      <div data-testid="slideover">
        <h2>{title}</h2>
        {children}
      </div>
    ) : null,
  Button: ({ children, onClick, disabled, variant, size, ...rest }: any) => (
    <button onClick={onClick} disabled={disabled} {...rest}>
      {children}
    </button>
  ),
  EmptyState: ({ title }: any) => <div>{title}</div>,
}))

vi.mock('@/hooks/useBons', () => ({
  useBons:        vi.fn(),
  useCreateBon:   vi.fn(),
  useValidateBon: vi.fn(),
  useExecuteBon:  vi.fn(),
}))

vi.mock('@/hooks/useStocks', () => ({ useStocks:  vi.fn() }))
vi.mock('@/hooks/useRH',     () => ({ useEmployes: vi.fn() }))

vi.mock('@/lib/utils', () => ({
  formatXAF:      (n: number) => `${n} XAF`,
  formatDateTime: (s: string) => s ?? '',
}))

import React from 'react'
import BonsSortie from '../pages/stocks/BonsSortie'
import { useBons, useCreateBon, useValidateBon, useExecuteBon } from '@/hooks/useBons'
import { useStocks } from '@/hooks/useStocks'
import { useEmployes } from '@/hooks/useRH'

// ── Fixtures ──────────────────────────────────────────────────────────────────

const BON_SOUMIS = {
  id: 'bon-soumis-001', numero: 'TAF-20260518-0001', statut: 'soumis',
  technicien_nom: 'Jean Dupont', cout_total_xaf: 15000,
  created_at: '2026-05-18T10:00:00Z',
  lignes: [{ produit_id: 'p1', designation: 'Aluminium 6060', quantite: 5, unite: 'kg' }],
}

const BON_VALIDE = {
  id: 'bon-valide-001', numero: 'TAF-20260518-0002', statut: 'valide',
  technicien_nom: 'Marie Curie', cout_total_xaf: 8000,
  created_at: '2026-05-18T09:00:00Z',
  lignes: [{ produit_id: 'p2', designation: 'Acier inox', quantite: 2, unite: 'kg' }],
}

const BON_EXECUTE = {
  id: 'bon-exe-001', numero: 'TAF-20260518-0003', statut: 'execute',
  technicien_nom: 'Paul Martin', cout_total_xaf: 3500,
  created_at: '2026-05-17T15:00:00Z',
  lignes: [{ produit_id: 'p3', designation: 'Cuivre', quantite: 1, unite: 'kg' }],
}

const STOCKS_DATA = {
  data: [
    { id: 'p1', designation: 'Aluminium 6060', stock_actuel: 50, unite: 'kg' },
    { id: 'p2', designation: 'Acier inox',     stock_actuel: 30, unite: 'kg' },
  ],
}

const EMPLOYES_DATA = {
  data: [
    { id: 'e1', nom: 'Jean Dupont' },
    { id: 'e2', nom: 'Marie Curie' },
  ],
}

function setupDefaultMocks() {
  vi.mocked(useBons).mockReturnValue({ data: { data: [] }, isLoading: false } as any)
  vi.mocked(useCreateBon).mockReturnValue({ mutate: vi.fn(), isPending: false } as any)
  vi.mocked(useValidateBon).mockReturnValue({ mutate: vi.fn(), isPending: false } as any)
  vi.mocked(useExecuteBon).mockReturnValue({ mutate: vi.fn(), isPending: false } as any)
  vi.mocked(useStocks).mockReturnValue({ data: STOCKS_DATA } as any)
  vi.mocked(useEmployes).mockReturnValue({ data: EMPLOYES_DATA } as any)
}

beforeEach(() => { vi.clearAllMocks(); setupDefaultMocks() })
afterEach(() => cleanup())

// ── Test 9 — Bouton Valider / visibilité par statut ────────────────────────────

describe('Test 9 — bouton Valider visible selon le statut du bon', () => {
  it('affiche le bouton "Valider" pour un bon soumis', () => {
    vi.mocked(useBons).mockReturnValue({
      data: { data: [BON_SOUMIS] }, isLoading: false,
    } as any)

    render(<BonsSortie />)
    expect(screen.getByRole('button', { name: /Valider/i })).toBeInTheDocument()
  })

  it('n\'affiche pas le bouton "Valider" pour un bon exécuté', () => {
    vi.mocked(useBons).mockReturnValue({
      data: { data: [BON_EXECUTE] }, isLoading: false,
    } as any)

    render(<BonsSortie />)
    expect(screen.queryByRole('button', { name: /Valider/i })).not.toBeInTheDocument()
  })

  it('affiche "Exécuter" pour un bon validé, pas "Valider"', () => {
    vi.mocked(useBons).mockReturnValue({
      data: { data: [BON_VALIDE] }, isLoading: false,
    } as any)

    render(<BonsSortie />)
    expect(screen.getByRole('button', { name: /Exécuter/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Valider/i })).not.toBeInTheDocument()
  })

  it('un seul "Valider" si une seule entrée soumise parmi plusieurs bons', () => {
    vi.mocked(useBons).mockReturnValue({
      data: { data: [BON_SOUMIS, BON_VALIDE, BON_EXECUTE] }, isLoading: false,
    } as any)

    render(<BonsSortie />)
    expect(screen.getAllByRole('button', { name: /Valider/i })).toHaveLength(1)
  })
})

// ── Test 10 — Formulaire bon : Soumettre désactivé sans données ───────────────

describe('Test 10 — formulaire création bon désactive Soumettre si données manquantes', () => {
  it('le bouton Soumettre est désactivé à l\'ouverture (pas de technicien)', async () => {
    const user = userEvent.setup()
    render(<BonsSortie />)

    await user.click(screen.getByRole('button', { name: /Nouveau Bon/i }))

    const submitBtn = screen.getByRole('button', { name: /Soumettre le bon/i })
    expect(submitBtn).toBeDisabled()
  })

  it('Soumettre reste désactivé après sélection du technicien seul (produit_id vide)', async () => {
    const user = userEvent.setup()
    render(<BonsSortie />)

    await user.click(screen.getByRole('button', { name: /Nouveau Bon/i }))

    // La <label> Technicien n'est pas reliée au <select> via htmlFor → pas de nom accessible.
    // On prend le premier combobox (technicien) par position.
    const [techSelect] = screen.getAllByRole('combobox')
    await user.selectOptions(techSelect, 'Jean Dupont')

    const submitBtn = screen.getByRole('button', { name: /Soumettre le bon/i })
    expect(submitBtn).toBeDisabled()
  })

  it('Soumettre s\'active quand technicien ET produit sont sélectionnés', async () => {
    const user = userEvent.setup()
    render(<BonsSortie />)

    await user.click(screen.getByRole('button', { name: /Nouveau Bon/i }))

    // Sélectionner le technicien (premier <select>)
    const combos = screen.getAllByRole('combobox')
    await user.selectOptions(combos[0], 'Jean Dupont')

    // Sélectionner le produit (deuxième <select>)
    await user.selectOptions(combos[1], 'p1')

    expect(screen.getByRole('button', { name: /Soumettre le bon/i })).not.toBeDisabled()
  })

  it('Annuler ferme le formulaire', async () => {
    const user = userEvent.setup()
    render(<BonsSortie />)

    await user.click(screen.getByRole('button', { name: /Nouveau Bon/i }))
    expect(screen.getByTestId('slideover')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Annuler/i }))
    expect(screen.queryByTestId('slideover')).not.toBeInTheDocument()
  })
})

// ── Test 11 — Stepper : étape active selon le statut ─────────────────────────

describe('Test 11 — stepper affiche la bonne étape active selon le statut du bon', () => {
  it('status=soumis → label "Soumis" en rouge, "Validé" et "Exécuté" en gris', () => {
    vi.mocked(useBons).mockReturnValue({
      data: { data: [BON_SOUMIS] }, isLoading: false,
    } as any)

    render(<BonsSortie />)

    // WorkflowStepper rend ces labels en inline style
    expect(screen.getByText('Soumis')).toHaveStyle({ color: '#C62828' })
    expect(screen.getByText('Validé')).toHaveStyle({ color: '#9ca3af' })
    expect(screen.getByText('Exécuté')).toHaveStyle({ color: '#9ca3af' })
  })

  it('status=valide → "Soumis" et "Validé" en rouge, "Exécuté" en gris', () => {
    vi.mocked(useBons).mockReturnValue({
      data: { data: [BON_VALIDE] }, isLoading: false,
    } as any)

    render(<BonsSortie />)

    expect(screen.getByText('Soumis')).toHaveStyle({ color: '#C62828' })
    expect(screen.getByText('Validé')).toHaveStyle({ color: '#C62828' })
    expect(screen.getByText('Exécuté')).toHaveStyle({ color: '#9ca3af' })
  })

  it('status=execute → toutes les étapes en rouge (complètes)', () => {
    vi.mocked(useBons).mockReturnValue({
      data: { data: [BON_EXECUTE] }, isLoading: false,
    } as any)

    render(<BonsSortie />)

    expect(screen.getByText('Soumis')).toHaveStyle({ color: '#C62828' })
    expect(screen.getByText('Validé')).toHaveStyle({ color: '#C62828' })
    expect(screen.getByText('Exécuté')).toHaveStyle({ color: '#C62828' })
  })
})
