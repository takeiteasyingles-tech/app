// Smoke: a new person signs up (Turnstile test key, stubbed offline), goes through the 7 onboarding
// steps and lands on Hoje; the fixture user signs in with email + password and lands on Hoje too.
// Selectors follow the prototype screens the app ports (ids like #onb-email, button labels in pt-BR).
import { randomBytes } from 'node:crypto';
import { expect, type Page, test } from '@playwright/test';
import { FIXTURE_PASSWORD } from '../../parity/src/fixture/state';
import { stubTurnstile } from '../src/turnstile';

test.beforeEach(async ({ context }) => {
  await stubTurnstile(context);
  await context.route('**/api/health', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ai: false }) }),
  );
});

const button = (page: Page, name: RegExp) => page.getByRole('button', { name }).first();

async function expectHoje(page: Page, name: string) {
  await expect(page).toHaveURL(/#\/inicio$/, { timeout: 20_000 });
  await expect(page.getByRole('heading', { level: 1, name: new RegExp(`Oi, ${name}`) })).toBeVisible();
  await expect(page.getByText('Algo deu errado nesta tela.')).toHaveCount(0);
}

test('signup → onboarding → Hoje', async ({ page }) => {
  const id = randomBytes(4).toString('hex');
  const email = `e2e-${id}@e2e.test`;
  const pass = `e2e-${randomBytes(6).toString('hex')}`;

  await page.goto('/#/entrar');
  await page.getByText('Criar conta grátis').first().click();
  await expect(page).toHaveURL(/#\/cadastro\/1$/);

  // 1 · Sua conta (Turnstile renders here or on submit; the stub answers either way)
  await page.locator('#onb-fullname').fill('Carla Teste');
  await page.locator('#onb-name').fill('Carla');
  await page.locator('#onb-birth').fill('1996-03-21');
  await page.locator('#onb-email').fill(email);
  await page.locator('#onb-pass').fill(pass);
  await button(page, /^Continuar/).click();
  await expect(page).toHaveURL(/#\/cadastro\/2$/, { timeout: 20_000 });

  // 2-5 · optional steps: pick one option where it is quick, skip the rest
  await page.getByText('Viajar sem travar').first().click();
  await button(page, /^Continuar/).click();
  await expect(page).toHaveURL(/#\/cadastro\/3$/);
  for (const n of [3, 4, 5]) {
    await button(page, /^Pular$/).click();
    await expect(page).toHaveURL(new RegExp(`#\\/cadastro\\/${n + 1}$`));
  }

  // 6 · Meta (defaults are valid) → 7 · voice test, skipped
  await button(page, /^Continuar/).click();
  await expect(page).toHaveURL(/#\/cadastro\/7$/);
  await button(page, /Pular por enquanto|Começar o curso/).click();

  await expectHoje(page, 'Carla');
});

test('fixture user signs in → Hoje', async ({ page }) => {
  await page.goto('/#/entrar');
  await page.locator('#login-email').fill('ana@parity.test');
  await page.locator('#login-pass').fill(FIXTURE_PASSWORD);
  await button(page, /^Entrar$/).click();
  await expectHoje(page, 'Ana');
});
