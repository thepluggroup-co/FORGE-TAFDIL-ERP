import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { NumberInput } from '@forge/ui'

describe('NumberInput', () => {
  it('commits an empty optional field as null', () => {
    const commit = vi.fn()
    render(<NumberInput aria-label="Quantité" onValueCommit={commit} />)
    fireEvent.blur(screen.getByLabelText('Quantité'))
    expect(commit).toHaveBeenCalledWith(null)
  })

  it('n’affiche pas un zéro initial à effacer', () => {
    render(<NumberInput aria-label="Montant" value={0} />)
    expect((screen.getByLabelText('Montant') as HTMLInputElement).value).toBe('')
  })

  it('supprime les zéros initiaux', () => {
    render(<NumberInput aria-label="Quantité" />)
    const input = screen.getByLabelText('Quantité') as HTMLInputElement
    fireEvent.change(input, { target: { value: '05' } })
    expect(input.value).toBe('5')
  })

  it('incrémente depuis vide à 1 puis 2', () => {
    const commit = vi.fn()
    render(<NumberInput aria-label="Quantité" onValueCommit={commit} />)
    const input = screen.getByLabelText('Quantité')
    fireEvent.keyDown(input, { key: 'ArrowUp' })
    fireEvent.keyDown(input, { key: 'ArrowUp' })
    expect((input as HTMLInputElement).value).toBe('2')
    expect(commit).toHaveBeenLastCalledWith(2)
  })

  it('accepte la virgule pour les dimensions et interdit les décimales en mode entier', () => {
    const dimCommit = vi.fn()
    const integerError = vi.fn()
    render(<>
      <NumberInput aria-label="Dimension" mode="dimension" onValueCommit={dimCommit} />
      <NumberInput aria-label="Montant FCFA" mode="integer" onValidationError={integerError} />
    </>)
    const dimension = screen.getByLabelText('Dimension')
    fireEvent.change(dimension, { target: { value: '1,5' } })
    fireEvent.blur(dimension)
    expect(dimCommit).toHaveBeenCalledWith(1.5)
    const amount = screen.getByLabelText('Montant FCFA')
    fireEvent.change(amount, { target: { value: '2.5' } })
    fireEvent.blur(amount)
    expect(integerError).toHaveBeenCalledWith('Saisissez un nombre entier.')
  })
})
