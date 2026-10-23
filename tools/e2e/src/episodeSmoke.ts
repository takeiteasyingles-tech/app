// Focused browser check for the episode-owned materials and test release rule, on local slot 9.
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { expect } from '@playwright/test';
import { buildApp } from '../../parity/src/build';
import { slot as slotOf } from '../../parity/src/config';
import { launchBrowser } from '../../parity/src/determinism';
import { FIXTURE_PASSWORD } from '../../parity/src/fixture/state';
import { killAll } from '../../parity/src/proc';
import { startSlot } from '../../parity/src/slot';
import { type DevServer, startDevServer } from '../../parity/src/wranglerDev';
import { stubTurnstile } from './turnstile';

async function main() {
  const sl = slotOf(9);
  const env = await startSlot({ slot: 9, app: 'app', realClock: true });
  let admin: DevServer | null = null;
  let browser: Awaited<ReturnType<typeof launchBrowser>> | null = null;
  try {
    await buildApp('admin', sl.distDir('admin'));
    admin = await startDevServer({
      app: 'admin',
      slot: { ...sl, appPort: 8309, inspectorPort: 9309, origin: 'http://localhost:8309' },
      realClock: true,
    });
    browser = await launchBrowser();
    const adminCtx = await browser.newContext({ baseURL: admin.origin, viewport: { width: 1440, height: 1000 } });
    await stubTurnstile(adminCtx);
    const page = await adminCtx.newPage();
    await page.goto('/#/entrar');
    await page.locator('#login-email').fill(env.fixtures.admin.email);
    await page.locator('#login-pass').fill(FIXTURE_PASSWORD);
    await page.getByRole('button', { name: 'Entrar', exact: true }).click();
    await page.waitForFunction(() => !location.hash.includes('entrar'), null, { timeout: 20_000 });
    await page.goto('/#/conteudo/temporadas/1');
    await expect(page.locator('a.nav').filter({ hasText: /^Episódios$|^E-books$|^Extras$|^Testes?$/ })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Novo episódio', exact: true })).toBeVisible();
    await page.locator('a[href="#/conteudo/episodios/1"]').first().click();
    await expect(page.getByRole('link', { name: 'Teste e liberação', exact: true })).toBeVisible();
    await page.getByRole('link', { name: 'E-book', exact: true }).click();
    await expect(page.getByRole('link', { name: 'Take Five', exact: true })).toBeVisible();
    await page.goto('/#/conteudo/episodios/1/extra');
    await expect(page.locator('h1')).toContainText('Extra');
    const resetStatus = await page.evaluate(
      async () =>
        (
          await fetch('/admin-api/content/ebooks/1', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ testMinCompleted: null }),
          })
        ).status,
    );
    assert.equal(resetStatus, 200);
    await page.goto('/#/conteudo/episodios/1/teste');
    await expect(page.locator('h1')).toContainText('Teste do episódio 1');
    await expect(page.getByLabel(/Quantidade de episódios completos/)).toBeVisible();
    const checkboxes = page.locator('input[type="checkbox"]');
    // The enabled switch is a button; these checkboxes are only the prerequisite episodes.
    await checkboxes.nth(0).check();
    await checkboxes.nth(1).check();
    const minimum = page.getByLabel(/Quantidade de episódios completos/);
    await minimum.fill('2');
    const [saved] = await Promise.all([
      page.waitForResponse(
        (response) => response.url().endsWith('/admin-api/content/ebooks/1') && response.request().method() === 'PUT',
      ),
      page.getByRole('button', { name: 'Salvar', exact: true }).click(),
    ]);
    assert.equal(saved.status(), 200);
    await expect(page.getByRole('button', { name: 'Salvar', exact: true })).not.toHaveAttribute('aria-busy', 'true');
    await expect(page.getByRole('button', { name: 'Salvar', exact: true })).toBeDisabled();
    const updated = await page.request.get('/admin-api/content/ebooks/1');
    assert.equal(updated.status(), 200);
    assert.deepEqual((await updated.json()).item.testRequiredEpisodes, [1, 2]);
    const publishStatus = await page.evaluate(
      async () =>
        (
          await fetch('/admin-api/content/publish', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ notes: 'Local episode smoke' }),
          })
        ).status,
    );
    assert.equal(publishStatus, 200);
    const episodes = await (await page.request.get('/admin-api/content/episodes')).json();
    assert.equal(new Set(episodes.items.map((e: { ebookNum: number }) => e.ebookNum)).size, episodes.items.length);
    mkdirSync('tools/e2e/out/episodes', { recursive: true });
    await page.screenshot({ path: 'tools/e2e/out/episodes/admin-test.png', fullPage: true, animations: 'disabled' });

    const appCtx = await browser.newContext({ baseURL: env.origin, viewport: { width: 375, height: 812 } });
    const user = env.fixtures.users.find((u) => u.key === 'main') ?? env.fixtures.users[0];
    assert.ok(user);
    await stubTurnstile(appCtx);
    const student = await appCtx.newPage();
    await student.goto('/#/entrar');
    await student.locator('#login-email').fill(user.email);
    await student.locator('#login-pass').fill(FIXTURE_PASSWORD);
    await student.getByRole('button', { name: 'Entrar', exact: true }).first().click();
    await student.waitForURL(/#\/inicio/, { timeout: 20_000 });
    await student.goto('/#/trilha');
    await expect(student.locator('section[aria-label="Episódio 1"]')).toBeVisible();
    await expect(student.getByRole('navigation', { name: 'Temporadas', exact: true })).toBeVisible();
    await expect(student.locator('section[aria-label="Episódio 1"]')).toContainText('de 2 episódios completos');
    const ep2 = episodes.items.find((e: { num: number }) => e.num === 2);
    await student.goto(`/#/ebook/${ep2.ebookNum}`);
    await expect(student.getByText('Teste do episódio', { exact: true })).toBeVisible();
    await student.goto(`/#/ebook/${ep2.ebookNum}/teste`);
    await expect(student.getByRole('heading', { name: 'Teste bloqueado' })).toBeVisible();
    await student.goto('/#/trilha');
    await expect(student.locator('.view')).toHaveCSS('opacity', '1');
    assert.ok(await student.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    await student.screenshot({
      path: 'tools/e2e/out/episodes/student-trail.png',
      fullPage: true,
      animations: 'disabled',
    });
    await student.setViewportSize({ width: 1440, height: 1000 });
    await expect(student.locator('.side')).toBeVisible();
    assert.ok(await student.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    await student.screenshot({
      path: 'tools/e2e/out/episodes/student-trail-desktop.png',
      fullPage: true,
      animations: 'disabled',
    });
    console.log(
      'Episode smoke passed: nested editors, rule persistence, unique books, dynamic book routes, test gate and mobile trail.',
    );
  } finally {
    await browser?.close();
    await admin?.stop();
    await env.close();
    killAll();
  }
}

main().catch((error) => {
  console.error(error);
  killAll();
  process.exitCode = 1;
});
