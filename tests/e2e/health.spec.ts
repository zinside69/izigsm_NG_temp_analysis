import { test, expect } from '@playwright/test'

test.describe('Health & app shell', () => {
  test('GET /api/health répond ok', async ({ request }) => {
    const res = await request.get('/api/health')
    expect(res.ok()).toBeTruthy()
    const body = await res.json()
    expect(body.status).toBe('ok')
    expect(body.app).toBe('iziGSM')
  })

  test('la page de login se charge', async ({ page }) => {
    await page.goto('/login.html')
    await expect(page.locator('#login-form')).toBeVisible()
    await expect(page.locator('#login-email')).toBeVisible()
    await expect(page.locator('#login-password')).toBeVisible()
  })
})
