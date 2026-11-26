// Course home: `/` serves the landing page (web/home.html) to visitors and the app shell to learners
// with a session (worker/src/routes/home.ts); app hash links hop to /app (public/site/hop.js); the
// landing's sign-up form hands its fields to the app's #/cadastro/1 (core/signupHandoff.ts).
import { randomBytes } from 'node:crypto';
import { expect, type Page, test } from '@playwright/test';
import { stubTurnstile } from '../src/turnstile';

test.beforeEach(async ({ context }) => {
  await stubTurnstile(context);
  await context.route('**/api/health', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ai: false }) }),
  );
});

/** Console errors and uncaught exceptions (CSP violations are console errors). */
function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(String(e)));
  return errors;
}

test('a visitor at / gets the course home, with no console or CSP errors', async ({ page }) => {
  const errors = collectErrors(page);
  const res = await page.goto('/');
  expect(res?.headers()['cache-control']).toBe('no-cache');
  expect(res?.headers().vary ?? '').toMatch(/cookie/i);
  await expect(page).toHaveTitle(/Inglês para quem fala português/);
  await expect(page.getByRole('heading', { level: 1, name: /Inglês para quem fala português/i })).toBeVisible();
  await expect(page.locator('#stage')).toHaveCount(0);
  await expect(page.locator('.nav-entrar')).toHaveAttribute('href', '/app#/entrar');
  // The demo conversation runs to its result.
  await page.locator('[data-personagem="robert"]').click();
  for (let i = 0; i < 7; i++) await page.locator('#chat-opcoes .opcao').first().click();
  await expect(page.locator('#chat-resultado')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('#chat-resultado')).toContainText('pontos com Robert');
  expect(errors).toEqual([]);
});

test('app hash links on / open the app at /app', async ({ page }) => {
  await page.goto('/#/entrar');
  await expect(page).toHaveURL(/\/app#\/entrar$/);
  await expect(page.locator('#login-email')).toBeVisible();
  // The landing's own anchors stay on the landing.
  await page.goto('/#planos');
  await expect(page).toHaveURL(/\/#planos$/);
  await expect(page.locator('#planos')).toBeVisible();
  // With the landing already open, an app hash only changes the fragment: it still hops.
  await page.goto('/#/entrar?esqueci=1');
  await expect(page).toHaveURL(/\/app#\/entrar\?esqueci=1$/);
  await expect(page.locator('#forgot-email')).toBeVisible();
});

test('the landing form hands its fields to #/cadastro/1, which creates the account', async ({ page, context }) => {
  const id = randomBytes(4).toString('hex');
  const email = `e2e-home-${id}@e2e.test`;
  await page.goto('/');
  const form = page.locator('#form-cadastro');
  await form.getByRole('button').click();
  await expect(form.locator('.campo.invalido')).toHaveCount(4);
  await expect(page.locator('#check-termos')).toHaveClass(/invalido/);

  await page.locator('#f-nome').fill('Bruna Landing');
  await page.locator('#f-apelido').fill('Bru');
  await page.locator('#f-nasc').pressSequentially('21031996');
  await expect(page.locator('#f-nasc')).toHaveValue('21/03/1996');
  await page.locator('#f-email').fill(email);
  await page.locator('#f-termos').check();
  await form.getByRole('button').click();

  await expect(page).toHaveURL(/\/app#\/cadastro\/1$/);
  await expect(page.locator('#onb-fullname')).toHaveValue('Bruna Landing');
  await expect(page.locator('#onb-name')).toHaveValue('Bru');
  await expect(page.locator('#onb-birth')).toHaveValue('1996-03-21');
  await expect(page.locator('#onb-email')).toHaveValue(email);
  await expect(page.locator('#onb-pass')).toBeFocused();
  // Read once: nothing personal stays behind.
  expect(await page.evaluate(() => sessionStorage.length)).toBe(0);

  await page.locator('#onb-pass').fill(`e2e-${randomBytes(6).toString('hex')}`);
  await page
    .getByRole('button', { name: /^Continuar/ })
    .first()
    .click();
  await expect(page).toHaveURL(/#\/cadastro\/2$/, { timeout: 20_000 });

  // With the session cookie, / is the app again.
  expect((await context.cookies()).some((c) => /tie_s$/.test(c.name))).toBe(true);
  await page.goto('/');
  await expect(page.locator('#stage')).toHaveCount(1);
  await expect(page).toHaveURL(/\/#\/cadastro\/\d$/, { timeout: 20_000 });
});

test('phone: the header fits at 360px and the page never scrolls sideways', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto('/');
  await expect(page.locator('.nav-entrar')).toBeVisible();
  await expect(page.locator('.nav .btn-cta')).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  const header = await page.evaluate(() => {
    const r = (s: string) => document.querySelector(s)?.getBoundingClientRect();
    return {
      cta: r('.nav .btn-cta')?.right ?? 0,
      logo: r('.logo img')?.right ?? 0,
      entrar: r('.nav-entrar')?.left ?? 0,
    };
  });
  expect(header.cta).toBeLessThanOrEqual(360);
  expect(header.entrar).toBeGreaterThan(header.logo);
});
