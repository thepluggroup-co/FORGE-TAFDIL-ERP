/**
 * DataTable.test.tsx — Tests 5 à 8
 *
 * 5. Affiche toutes les lignes passées en props
 * 6. Le filtre recherche réduit les résultats en temps réel
 * 7. Le tri par colonne fonctionne ASC puis DESC au deuxième clic
 * 8. Le bouton Export CSV déclenche un téléchargement
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, within, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DataTable } from '@forge/ui'
import type { Column } from '@forge/ui'

afterEach(() => cleanup())

// ── Fixtures ──────────────────────────────────────────────────────────────────

type Row = Record<string, unknown> & { id: string; nom: string; quantite: number; unite: string }

const COLS: Column<Row>[] = [
  { id: 'nom',      header: 'Nom',      accessor: 'nom',      sortable: true  },
  { id: 'quantite', header: 'Quantité', accessor: 'quantite', sortable: true  },
  { id: 'unite',    header: 'Unité',    accessor: 'unite',    sortable: false },
]

const DATA: Row[] = [
  { id: '1', nom: 'Aluminium', quantite: 100, unite: 'kg' },
  { id: '2', nom: 'Acier',     quantite: 50,  unite: 'kg' },
  { id: '3', nom: 'Cuivre',    quantite: 25,  unite: 'kg' },
]

// ── Test 5 — Affiche toutes les lignes ────────────────────────────────────────

describe('Test 5 — affiche toutes les lignes passées en props', () => {
  it('rend les 3 lignes de données', () => {
    render(<DataTable columns={COLS} data={DATA} keyField="id" />)
    expect(screen.getByText('Aluminium')).toBeInTheDocument()
    expect(screen.getByText('Acier')).toBeInTheDocument()
    expect(screen.getByText('Cuivre')).toBeInTheDocument()
  })

  it('affiche les en-têtes de colonnes', () => {
    render(<DataTable columns={COLS} data={DATA} />)
    expect(screen.getByRole('columnheader', { name: /Nom/       })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: /Quantité/  })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: /Unité/     })).toBeInTheDocument()
  })

  it('affiche emptyMessage si data est vide', () => {
    render(<DataTable columns={COLS} data={[]} emptyMessage="Aucun produit" />)
    expect(screen.getByText('Aucun produit')).toBeInTheDocument()
  })

  it('affiche le compteur de résultats', () => {
    render(<DataTable columns={COLS} data={DATA} />)
    expect(screen.getByText(/3 résultats/)).toBeInTheDocument()
  })
})

// ── Test 6 — Filtre recherche en temps réel ───────────────────────────────────

describe('Test 6 — filtre recherche réduit les résultats en temps réel', () => {
  it('filtre à "Alu" → seul Aluminium visible', async () => {
    const user = userEvent.setup()
    render(<DataTable columns={COLS} data={DATA} keyField="id" />)

    await user.type(screen.getByPlaceholderText('Rechercher...'), 'Alu')

    expect(screen.getByText('Aluminium')).toBeInTheDocument()
    expect(screen.queryByText('Acier')).not.toBeInTheDocument()
    expect(screen.queryByText('Cuivre')).not.toBeInTheDocument()
  })

  it('filtre insensible à la casse', async () => {
    const user = userEvent.setup()
    render(<DataTable columns={COLS} data={DATA} keyField="id" />)

    await user.type(screen.getByPlaceholderText('Rechercher...'), 'acier')

    expect(screen.getByText('Acier')).toBeInTheDocument()
    expect(screen.queryByText('Aluminium')).not.toBeInTheDocument()
  })

  it('effacer le filtre restaure les 3 lignes', async () => {
    const user = userEvent.setup()
    render(<DataTable columns={COLS} data={DATA} keyField="id" />)

    const searchInput = screen.getByPlaceholderText('Rechercher...')
    await user.type(searchInput, 'Alu')
    await user.clear(searchInput)

    expect(screen.getByText('Aluminium')).toBeInTheDocument()
    expect(screen.getByText('Acier')).toBeInTheDocument()
    expect(screen.getByText('Cuivre')).toBeInTheDocument()
  })

  it('filtre sans correspondance → message vide', async () => {
    const user = userEvent.setup()
    render(<DataTable columns={COLS} data={DATA} keyField="id" emptyMessage="Aucun résultat" />)

    await user.type(screen.getByPlaceholderText('Rechercher...'), 'xyz-introuvable')

    expect(screen.getByText('Aucun résultat')).toBeInTheDocument()
  })
})

// ── Test 7 — Tri ASC puis DESC ────────────────────────────────────────────────

describe('Test 7 — tri par colonne ASC puis DESC au deuxième clic', () => {
  it('premier clic → indicateur ↑ (ASC)', async () => {
    const user = userEvent.setup()
    render(<DataTable columns={COLS} data={DATA} keyField="id" />)

    const nomHeader = screen.getByRole('columnheader', { name: /Nom/ })
    await user.click(nomHeader)

    expect(within(nomHeader).getByText('↑')).toBeInTheDocument()
  })

  it('deuxième clic → indicateur ↓ (DESC)', async () => {
    const user = userEvent.setup()
    render(<DataTable columns={COLS} data={DATA} keyField="id" />)

    const nomHeader = screen.getByRole('columnheader', { name: /Nom/ })
    await user.click(nomHeader)
    await user.click(nomHeader)

    expect(within(nomHeader).getByText('↓')).toBeInTheDocument()
  })

  it('tri ASC ordonne les lignes alphabétiquement (Acier < Aluminium < Cuivre)', async () => {
    const user = userEvent.setup()
    render(<DataTable columns={COLS} data={DATA} keyField="id" />)

    const nomHeader = screen.getByRole('columnheader', { name: /Nom/ })
    await user.click(nomHeader)

    // Sélectionne uniquement les cellules contenant un des noms de produit
    const productNames = ['Acier', 'Aluminium', 'Cuivre']
    const cells = screen
      .getAllByRole('cell')
      .filter((c) => productNames.includes(c.textContent ?? ''))

    expect(cells[0].textContent).toBe('Acier')
    expect(cells[1].textContent).toBe('Aluminium')
    expect(cells[2].textContent).toBe('Cuivre')
  })

  it('tri DESC inverse l\'ordre (Cuivre > Aluminium > Acier)', async () => {
    const user = userEvent.setup()
    render(<DataTable columns={COLS} data={DATA} keyField="id" />)

    const nomHeader = screen.getByRole('columnheader', { name: /Nom/ })
    await user.click(nomHeader) // ASC
    await user.click(nomHeader) // DESC

    const productNames = ['Acier', 'Aluminium', 'Cuivre']
    const cells = screen
      .getAllByRole('cell')
      .filter((c) => productNames.includes(c.textContent ?? ''))

    expect(cells[0].textContent).toBe('Cuivre')
    expect(cells[1].textContent).toBe('Aluminium')
    expect(cells[2].textContent).toBe('Acier')
  })

  it('colonne non-sortable (Unité) ne réinitialise pas le tri', async () => {
    const user = userEvent.setup()
    render(<DataTable columns={COLS} data={DATA} keyField="id" />)

    const nomHeader   = screen.getByRole('columnheader', { name: /Nom/    })
    const uniteHeader = screen.getByRole('columnheader', { name: /Unité/  })

    await user.click(nomHeader)   // tri Nom ASC
    await user.click(uniteHeader) // clic sur colonne non-sortable

    // L'indicateur de tri reste sur Nom
    expect(within(nomHeader).getByText('↑')).toBeInTheDocument()
  })
})

// ── Test 8 — Export CSV ───────────────────────────────────────────────────────

describe('Test 8 — bouton Export CSV déclenche un téléchargement', () => {
  beforeEach(() => {
    // jsdom ne définit pas ces méthodes — on les crée avant de les espionner
    URL.createObjectURL = vi.fn().mockReturnValue('blob:fake-url')
    URL.revokeObjectURL = vi.fn()
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('clic sur Exporter CSV crée un Blob et déclenche le téléchargement', async () => {
    const user = userEvent.setup()
    render(<DataTable columns={COLS} data={DATA} keyField="id" />)

    await user.click(screen.getByRole('button', { name: /Exporter CSV/i }))

    expect(URL.createObjectURL as ReturnType<typeof vi.fn>).toHaveBeenCalledOnce()
    expect(URL.createObjectURL as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(expect.any(Blob))
    expect(HTMLAnchorElement.prototype.click).toHaveBeenCalledOnce()
    expect(URL.revokeObjectURL as ReturnType<typeof vi.fn>).toHaveBeenCalledWith('blob:fake-url')
  })

  it('le CSV contient les en-têtes de colonnes', async () => {
    const user = userEvent.setup()
    let capturedBlob: Blob | undefined

    URL.createObjectURL = vi.fn().mockImplementation((blob: Blob) => {
      capturedBlob = blob
      return 'blob:fake-url'
    })

    render(<DataTable columns={COLS} data={DATA} keyField="id" />)
    await user.click(screen.getByRole('button', { name: /Exporter CSV/i }))

    const text = await capturedBlob!.text()
    expect(text).toMatch(/Nom.*Quantité.*Unité/)
    expect(text).toContain('Aluminium')
  })
})
