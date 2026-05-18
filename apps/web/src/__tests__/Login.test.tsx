/**
 * Login.test.tsx — Tests 12 à 14
 *
 * 12. Soumission avec email vide → validation HTML5 bloque, signIn non appelé
 * 13. Soumission avec credentials corrects → redirect vers /production
 * 14. Soumission avec credentials incorrects → message d'erreur visible
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockNavigate = vi.fn()

vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
}))

vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, initial, animate, exit, transition, ...rest }: any) =>
      <div {...rest}>{children}</div>,
    p: ({ children, initial, animate, exit, transition, ...rest }: any) =>
      <p {...rest}>{children}</p>,
  },
  AnimatePresence: ({ children }: any) => <>{children}</>,
}))

const mockSignIn = vi.fn()

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({
    signIn:  mockSignIn,
    signOut: vi.fn(),
    user:    null,
    session: null,
    loading: false,
  }),
}))

import Login from '../pages/Login'

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks()
  // signIn retourne succès par défaut — surchargeable par test
  mockSignIn.mockResolvedValue({ error: null })
})

afterEach(() => cleanup())

// ── Test 12 — Email vide → formulaire non soumis ──────────────────────────────

describe('Test 12 — soumission avec email vide', () => {
  it('signIn n\'est pas appelé si l\'email est vide (required)', async () => {
    const user = userEvent.setup()
    render(<Login />)

    // Remplir seulement le mot de passe, laisser l'email vide
    await user.type(screen.getByPlaceholderText('••••••••'), 'password123')
    await user.click(screen.getByRole('button', { name: /Se connecter/i }))

    // La validation HTML5 `required` bloque la soumission → signIn jamais appelé
    expect(mockSignIn).not.toHaveBeenCalled()
  })

  it('aucun message d\'erreur React affiché si email vide', async () => {
    const user = userEvent.setup()
    render(<Login />)

    await user.type(screen.getByPlaceholderText('••••••••'), 'password123')
    await user.click(screen.getByRole('button', { name: /Se connecter/i }))

    expect(screen.queryByText(/Email ou mot de passe incorrect/i)).not.toBeInTheDocument()
  })

  it('le champ email a l\'attribut required', () => {
    render(<Login />)
    const emailInput = screen.getByPlaceholderText('vous@tafdil.cm')
    expect(emailInput).toBeRequired()
  })

  it('le champ mot de passe a l\'attribut required', () => {
    render(<Login />)
    const pwdInput = screen.getByPlaceholderText('••••••••')
    expect(pwdInput).toBeRequired()
  })
})

// ── Test 13 — Credentials corrects → redirect /production ─────────────────────

describe('Test 13 — soumission avec credentials corrects', () => {
  it('navigue vers /production après connexion réussie', async () => {
    mockSignIn.mockResolvedValueOnce({ error: null })
    const user = userEvent.setup()
    render(<Login />)

    await user.type(screen.getByPlaceholderText('vous@tafdil.cm'), 'admin@tafdil.cm')
    await user.type(screen.getByPlaceholderText('••••••••'), 'motdepasse-correct')
    await user.click(screen.getByRole('button', { name: /Se connecter/i }))

    expect(mockSignIn).toHaveBeenCalledWith('admin@tafdil.cm', 'motdepasse-correct')
    expect(mockNavigate).toHaveBeenCalledWith('/production', { replace: true })
  })

  it('pas de message d\'erreur après connexion réussie', async () => {
    mockSignIn.mockResolvedValueOnce({ error: null })
    const user = userEvent.setup()
    render(<Login />)

    await user.type(screen.getByPlaceholderText('vous@tafdil.cm'), 'admin@tafdil.cm')
    await user.type(screen.getByPlaceholderText('••••••••'), 'motdepasse-correct')
    await user.click(screen.getByRole('button', { name: /Se connecter/i }))

    expect(screen.queryByText(/Email ou mot de passe incorrect/i)).not.toBeInTheDocument()
  })

  it('le bouton affiche "Connexion..." pendant le chargement', async () => {
    // Promettre une résolution manuelle pour inspecter l'état intermédiaire
    let resolve!: (v: { error: null }) => void
    mockSignIn.mockReturnValueOnce(new Promise((r) => { resolve = r }))

    const user = userEvent.setup()
    render(<Login />)

    await user.type(screen.getByPlaceholderText('vous@tafdil.cm'), 'admin@tafdil.cm')
    await user.type(screen.getByPlaceholderText('••••••••'), 'motdepasse-correct')
    await user.click(screen.getByRole('button', { name: /Se connecter/i }))

    expect(screen.getByText(/Connexion\.\.\./i)).toBeInTheDocument()

    resolve({ error: null })
  })
})

// ── Test 14 — Credentials incorrects → message d'erreur ──────────────────────

describe('Test 14 — soumission avec credentials incorrects', () => {
  it('affiche "Email ou mot de passe incorrect" après échec Supabase', async () => {
    mockSignIn.mockResolvedValueOnce({ error: 'Invalid login credentials' })
    const user = userEvent.setup()
    render(<Login />)

    await user.type(screen.getByPlaceholderText('vous@tafdil.cm'), 'wrong@tafdil.cm')
    await user.type(screen.getByPlaceholderText('••••••••'), 'mauvais-mdp')
    await user.click(screen.getByRole('button', { name: /Se connecter/i }))

    expect(await screen.findByText(/Email ou mot de passe incorrect/i)).toBeInTheDocument()
  })

  it('ne navigue pas après un échec', async () => {
    mockSignIn.mockResolvedValueOnce({ error: 'Invalid login credentials' })
    const user = userEvent.setup()
    render(<Login />)

    await user.type(screen.getByPlaceholderText('vous@tafdil.cm'), 'wrong@tafdil.cm')
    await user.type(screen.getByPlaceholderText('••••••••'), 'mauvais-mdp')
    await user.click(screen.getByRole('button', { name: /Se connecter/i }))

    await screen.findByText(/Email ou mot de passe incorrect/i)
    expect(mockNavigate).not.toHaveBeenCalled()
  })

  it('le bouton re-devient actif après un échec', async () => {
    mockSignIn.mockResolvedValueOnce({ error: 'Invalid login credentials' })
    const user = userEvent.setup()
    render(<Login />)

    await user.type(screen.getByPlaceholderText('vous@tafdil.cm'), 'wrong@tafdil.cm')
    await user.type(screen.getByPlaceholderText('••••••••'), 'mauvais-mdp')
    await user.click(screen.getByRole('button', { name: /Se connecter/i }))

    await screen.findByText(/Email ou mot de passe incorrect/i)
    expect(screen.getByRole('button', { name: /Se connecter/i })).not.toBeDisabled()
  })
})
