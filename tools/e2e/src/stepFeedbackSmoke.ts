// npm exec tsx tools/e2e/src/stepFeedbackSmoke.ts
// Local end-to-end coverage for the optional, mandatory-on-advance platform feedback.
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
  const sl = slotOf(17);
  const env = await startSlot({ slot: 17, app: 'app', realClock: true });
  let admin: DevServer | null = null;
  let browser: Awaited<ReturnType<typeof launchBrowser>> | null = null;
  try {
    await buildApp('admin', sl.distDir('admin'));
    admin = await startDevServer({
      app: 'admin',
      slot: { ...sl, appPort: 8317, inspectorPort: 9317, origin: 'http://localhost:8317' },
      realClock: true,
    });
    browser = await launchBrowser();
    const ac = await browser.newContext({ baseURL: admin.origin, viewport: { width: 1440, height: 1000 } });
    await stubTurnstile(ac);
    const ap = await ac.newPage();
    await ap.goto('/#/entrar');
    await ap.locator('#login-email').fill(env.fixtures.admin.email);
    await ap.locator('#login-pass').fill(FIXTURE_PASSWORD);
    await ap.getByRole('button', { name: 'Entrar', exact: true }).click();
    await ap.waitForFunction(() => !location.hash.includes('entrar'), null, { timeout: 20_000 });
    await ap.goto('/#/config');
    const flag = ap.getByRole('switch', { name: 'feedback.steps', exact: true });
    await expect(flag).toBeVisible();
    if ((await flag.getAttribute('aria-checked')) === 'true') await flag.click();
    await expect(flag).toHaveAttribute('aria-checked', 'false');
    const initialRows = await (await ap.request.get('/admin-api/feedback/steps?episode=1&step=4')).json();

    const sc = await browser.newContext({ baseURL: env.origin, viewport: { width: 375, height: 812 } });
    await stubTurnstile(sc);
    const sp = await sc.newPage();
    const user = env.fixtures.users.find((u) => u.key === 'ep1-done');
    assert.ok(user);
    await sp.goto('/#/entrar');
    await sp.locator('#login-email').fill(user.email);
    await sp.locator('#login-pass').fill(FIXTURE_PASSWORD);
    await sp.getByRole('button', { name: 'Entrar', exact: true }).first().click();
    await sp.waitForURL(/#\/inicio/, { timeout: 20_000 });
    await sp.goto('/#/episodio/1/1');
    await sp.locator('.player-foot .next').click();
    await expect(sp).toHaveURL(/#\/episodio\/1\/2$/);
    await expect(sp.getByRole('dialog')).toHaveCount(0);

    await flag.click();
    await expect(flag).toHaveAttribute('aria-checked', 'true');
    await sp.reload();
    await sp.goto('/#/episodio/1/4');
    await sp.locator('.player-foot .next').click();
    const dialog = sp.getByRole('dialog', { name: 'Como foi sua experiência?' });
    await expect(dialog).toBeVisible();
    const submit = dialog.getByRole('button', { name: 'Enviar e continuar' });
    await expect(submit).toBeDisabled();
    await dialog.getByRole('radio', { name: '4 de 5 estrelas' }).check();
    await expect(submit).toBeDisabled();
    await dialog.getByRole('radio', { name: 'Sim', exact: true }).check();
    await dialog.getByRole('textbox', { name: /O que dificultou/ }).fill('Não achei o controle de volume');
    await dialog.getByRole('textbox', { name: /O que podemos melhorar/ }).fill('Deixar os botões mais visíveis');
    await expect(submit).toBeEnabled();
    mkdirSync('tools/e2e/out/step-feedback', { recursive: true });
    await sp.screenshot({ path: 'tools/e2e/out/step-feedback/mobile.png', animations: 'disabled' });

    // Failed writes preserve both the stage and the filled-in response.
    await sp.route('**/api/feedback/steps/*', (r) =>
      r.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'internal', message: 'Falha de teste.' } }),
      }),
    );
    await submit.click();
    await expect(dialog.getByRole('alert')).toContainText('Falha de teste.');
    await expect(sp).toHaveURL(/#\/episodio\/1\/4$/);
    await expect(dialog.getByRole('textbox', { name: /O que dificultou/ })).toHaveValue(
      'Não achei o controle de volume',
    );
    await sp.unroute('**/api/feedback/steps/*');
    const [saved] = await Promise.all([
      sp.waitForResponse((r) => r.url().includes('/api/feedback/steps/') && r.status() === 200),
      submit.click(),
    ]);
    assert.equal(saved.status(), 200);
    await expect(sp).toHaveURL(/#\/episodio\/1\/5$/);

    // Backwards navigation is free; every subsequent forward transition asks again, including map jumps.
    await sp.locator('.player-foot .prev').click();
    await expect(sp).toHaveURL(/#\/episodio\/1\/4$/);
    await sp.getByRole('button', { name: 'Mapa', exact: true }).click();
    await sp
      .getByRole('dialog', { name: 'Mapa do episódio 1' })
      .getByRole('button', { name: /Take It In/ })
      .click();
    await expect(dialog).toBeVisible();
    await sp.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(sp).toHaveURL(/#\/episodio\/1\/4$/);

    await sp.setViewportSize({ width: 1440, height: 1000 });
    await sp.locator('.player-foot .next').click();
    await expect(dialog).toBeVisible();
    await sp.screenshot({ path: 'tools/e2e/out/step-feedback/desktop.png', animations: 'disabled' });
    await dialog.getByRole('radio', { name: '5 de 5 estrelas' }).check();
    await dialog.getByRole('radio', { name: 'Não', exact: true }).check();
    await submit.click();
    await expect(sp).toHaveURL(/#\/episodio\/1\/5$/);

    await sp.goto('/#/episodio/1/10');
    await sp.locator('.player-foot .next').click();
    await expect(dialog).toBeVisible();
    await expect(sp).toHaveURL(/#\/episodio\/1\/10$/);
    await dialog.getByRole('radio', { name: '5 de 5 estrelas' }).check();
    await dialog.getByRole('radio', { name: 'Não', exact: true }).check();
    await submit.click();
    await expect(sp).toHaveURL(/#\/concluido\/1$/);

    const rows = await (await ap.request.get('/admin-api/feedback/steps?episode=1&step=4')).json();
    assert.equal(rows.items.length, initialRows.items.length + 2);
    assert.ok(rows.items.some((r: { difficulty: string }) => r.difficulty === 'Não achei o controle de volume'));
    assert.ok(rows.items.every((r: { step: number }) => r.step === 4));
    assert.equal((await ap.request.get('/admin-api/feedback/steps?step=11')).status(), 400);
    await ap.goto('/#/feedbacks?tipo=plataforma');
    await expect(ap.getByText('Não achei o controle de volume', { exact: false }).first()).toBeVisible();
    await ap.screenshot({ path: 'tools/e2e/out/step-feedback/admin.png', animations: 'disabled' });
    console.log(
      'Step feedback smoke passed: flag off/on, mobile/desktop, validation, failed save/retry, map, back, repeat, finish and admin list.',
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
