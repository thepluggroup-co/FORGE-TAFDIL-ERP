import { expect, test } from '@playwright/test'

const loginUrl = process.env.PLAYWRIGHT_HTTPS_LOGIN_URL ?? 'https://forge-tafdil-erp-web.vercel.app/login'

test('la page de connexion est servie en HTTPS avec un certificat accepté', async ({ page }) => {
  const errors: string[] = []
  page.on('requestfailed', (request) => {
    if (request.url().startsWith('https://') && request.failure()?.errorText.includes('CERT')) {
      errors.push(`${request.url()}: ${request.failure()?.errorText}`)
    }
  })

  const response = await page.goto(loginUrl, { waitUntil: 'domcontentloaded' })
  expect(response, 'la navigation HTTPS doit répondre').not.toBeNull()
  expect(new URL(page.url()).protocol).toBe('https:')
  await expect(page.getByRole('button', { name: /se connecter/i })).toBeVisible()
  expect(errors).toEqual([])
})

test('HTTP redirige vers la page de connexion HTTPS', async ({ page }) => {
  const insecureUrl = new URL(loginUrl)
  insecureUrl.protocol = 'http:'
  await page.goto(insecureUrl.toString(), { waitUntil: 'domcontentloaded' })
  expect(new URL(page.url()).protocol).toBe('https:')
  await expect(page.getByRole('button', { name: /se connecter/i })).toBeVisible()
})
