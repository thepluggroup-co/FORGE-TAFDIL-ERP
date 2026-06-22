import { test, expect } from '@playwright/test'

// ── E2E 1 : Page de connexion — rendu initial ──────────────────────────────────
// Vérifie que /login affiche le formulaire complet sans authentification.

test('E2E-01 — /login affiche le formulaire email/mot de passe', async ({ page }) => {
  await page.goto('/login')

  // Champs de saisie
  const emailInput = page.locator('input[type="email"]')
  const passwordInput = page.locator('input[type="password"]')
  const submitBtn = page.locator('button[type="submit"]')

  await expect(emailInput).toBeVisible()
  await expect(passwordInput).toBeVisible()
  await expect(submitBtn).toBeVisible()
  await expect(submitBtn).toHaveText('Se connecter')

  // Placeholder correct
  await expect(emailInput).toHaveAttribute('placeholder', 'vous@tafdil.cm')
})

// ── E2E 2 : Route protégée — redirection vers /login si non authentifié ────────
// Accéder à /dashboard sans session doit rediriger vers /login.

test('E2E-02 — /dashboard redirige vers /login si non authentifié', async ({ page }) => {
  await page.goto('/dashboard')

  // Attendre la redirection (AuthProvider détecte l'absence de session)
  await page.waitForURL('**/login', { timeout: 10_000 })
  await expect(page).toHaveURL(/\/login/)

  // Le formulaire de connexion est affiché
  await expect(page.locator('input[type="email"]')).toBeVisible()
})

// ── E2E 3 : Credentials invalides — message d'erreur affiché ──────────────────
// Intercepte l'appel Supabase Auth et renvoie une erreur 400 pour simuler
// un mot de passe incorrect, sans dépendance à l'instance Supabase réelle.

test('E2E-03 — credentials incorrects affichent le message d\'erreur', async ({ page }) => {
  // Bloquer les appels Supabase auth pour simuler un login raté
  await page.route('**/auth/v1/token**', (route) => {
    route.fulfill({
      status: 400,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'invalid_grant', error_description: 'Invalid login credentials' }),
    })
  })

  await page.goto('/login')

  await page.fill('input[type="email"]', 'mauvais@exemple.cm')
  await page.fill('input[type="password"]', 'mauvais-mdp')
  await page.click('button[type="submit"]')

  // Le message d'erreur doit apparaître
  await expect(page.getByText('Email ou mot de passe incorrect')).toBeVisible({ timeout: 8_000 })
})
