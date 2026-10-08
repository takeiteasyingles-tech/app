// npm run smoke:full -- [--slot <N>] [--skip-build]
// Cross-worker smoke on one seeded local slot (default 8): tie-app on :8200+N and tie-admin on :8300+N,
// both on the slot's Miniflare persist dir (one D1, one R2, as in production). It walks the whole
// product once: signup → onboarding → episode steps → review → extras → Mic demo → report → photo
// upload → admin login → content edit + publish → the app sees the new content version → moderation
// removes the photo. The content edit is reverted and republished at the end, so the slot keeps the
// seeded content for the e2e specs. The per-screen detail lives in specs/U1..U6.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { parseArgs } from 'node:util';
import type { BrowserContext, Page } from '@playwright/test';
import { SUPER_ADMIN_EMAIL } from '@tie/shared/authz';
import { buildApp } from '../../parity/src/build';
import { slot as slotOf } from '../../parity/src/config';
import { launchBrowser, TSX_HELPERS } from '../../parity/src/determinism';
import { FIXTURE_PASSWORD } from '../../parity/src/fixture/state';
import { killAll } from '../../parity/src/proc';
import { startSlot } from '../../parity/src/slot';
import { type DevServer, startDevServer } from '../../parity/src/wranglerDev';
import { stubTurnstile } from './turnstile';

const ERROR_CARD = 'Algo deu errado nesta tela.';

interface Res<T = Record<string, unknown>> {
  status: number;
  body: T;
}

/** fetch() inside the page: same-origin cookies, Origin and Sec-Fetch-Site, like the SPA itself. */
async function api<T = Record<string, unknown>>(page: Page, method: string, path: string, body?: unknown) {
  return page.evaluate(
    async ([m, p, b]) => {
      const init: RequestInit = { method: m as string, credentials: 'same-origin', headers: {} };
      if (b !== undefined) {
        (init.headers as Record<string, string>)['Content-Type'] = 'application/json';
        init.body = JSON.stringify(b);
      }
      const r = await fetch(p as string, init);
      const text = await r.text();
      let json: unknown = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = text;
      }
      return { status: r.status, body: json };
    },
    [method, path, body] as const,
  ) as Promise<Res<T>>;
}

function ok<T>(r: Res<T>, what: string): T {
  assert.ok(r.status >= 200 && r.status < 300, `${what}: HTTP ${r.status} ${JSON.stringify(r.body).slice(0, 300)}`);
  return r.body;
}

async function screenOk(page: Page, hash: string, what: string) {
  await page.goto(hash);
  await page.waitForLoadState('networkidle');
  await page.locator('.view, .app, main').first().waitFor({ state: 'visible', timeout: 20_000 });
  assert.equal(await page.getByText(ERROR_CARD).count(), 0, `${what}: error card on ${hash}`);
}

async function newContext(browser: Awaited<ReturnType<typeof launchBrowser>>, baseURL: string) {
  const ctx: BrowserContext = await browser.newContext({
    baseURL,
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
    viewport: { width: 1280, height: 900 },
    serviceWorkers: 'block',
  });
  await ctx.addInitScript(TSX_HELPERS);
  await stubTurnstile(ctx);
  return ctx;
}

async function main() {
  const { values } = parseArgs({
    options: { slot: { type: 'string', default: '8' }, 'skip-build': { type: 'boolean', default: false } },
  });
  const n = Number(values.slot);
  const sl = slotOf(n);
  const log = (m: string) => console.log(`[smoke s${n}] ${m}`);
  const steps: string[] = [];
  const step = (m: string) => {
    steps.push(m);
    log(`✓ ${m}`);
  };

  const env = await startSlot({ slot: n, app: 'app', skipBuild: values['skip-build'], realClock: true, log });
  let admin: DevServer | null = null;
  let browser: Awaited<ReturnType<typeof launchBrowser>> | null = null;
  try {
    // tie-admin on its own port, same persist dir (= the same D1 and R2 as tie-app).
    const adminSlot = { ...sl, appPort: 8300 + n, inspectorPort: 9300 + n, origin: `http://localhost:${8300 + n}` };
    if (!values['skip-build']) {
      log(`build: admin → ${sl.distDir('admin')}`);
      await buildApp('admin', sl.distDir('admin'), { tag: `build:s${n}:admin` });
    }
    log(`wrangler dev (admin) on ${adminSlot.origin}…`);
    admin = await startDevServer({ app: 'admin', slot: adminSlot, realClock: true });

    browser = await launchBrowser();
    const appCtx = await newContext(browser, env.origin);
    const page = await appCtx.newPage();

    // 1. Signup + onboarding (UI).
    const id = randomBytes(4).toString('hex');
    const email = `smoke-${id}@e2e.test`;
    await page.goto('/#/entrar');
    await page.getByText('Criar conta grátis').first().click();
    await page.locator('#onb-fullname').fill('Sofia Smoke');
    await page.locator('#onb-name').fill('Sofia');
    await page.locator('#onb-birth').fill('1994-05-10');
    await page.locator('#onb-email').fill(email);
    await page.locator('#onb-pass').fill(`smoke-${randomBytes(6).toString('hex')}`);
    const button = (name: RegExp) => page.getByRole('button', { name }).first();
    await button(/^Continuar/).click();
    await page.waitForURL(/#\/cadastro\/2$/, { timeout: 20_000 });
    await page.getByText('Viajar sem travar').first().click();
    await button(/^Continuar/).click();
    for (const s of [3, 4, 5]) {
      await page.waitForURL(new RegExp(`#\\/cadastro\\/${s}$`));
      await button(/^Pular$/).click();
    }
    await page.waitForURL(/#\/cadastro\/6$/);
    await button(/^Continuar/).click();
    await page.waitForURL(/#\/cadastro\/7$/);
    await button(/Pular por enquanto|Começar o curso/).click();
    await page.waitForURL(/#\/inicio$/, { timeout: 20_000 });
    await page.getByRole('heading', { level: 1, name: /Oi, Sofia/ }).waitFor({ timeout: 20_000 });
    step(`signup + onboarding (${email}) → Hoje`);

    // 2. Episode 1, steps 1-5 (server-side gating, e-book download at step 3).
    // step-ok marks the media of step s as played; advance names the step to move to (s + 1).
    for (const s of [1, 2, 3, 4, 5]) {
      if (s === 3) ok(await api(page, 'POST', '/api/ebooks/1/download', {}), 'ebook download');
      else ok(await api(page, 'POST', '/api/progress/step-ok', { ep: 1, step: s }), `step-ok ${s}`);
      ok(await api(page, 'POST', '/api/progress/advance', { ep: 1, step: s + 1 }), `advance ${s} → ${s + 1}`);
    }
    const state1 = ok(await api<{ prog: Record<string, number> }>(page, 'GET', '/api/me/state'), 'state');
    assert.equal(state1.prog['1'], 6, `prog[1] after five steps: ${JSON.stringify(state1.prog)}`);
    await screenOk(page, '/#/episodio/1/6', 'player');
    step('episode 1 steps 1-5 accepted; player opens on step 6');

    // 3. Review: step 4 unlocked the episode's visual words.
    const queue = ok(await api<{ cards: { id: string }[] }>(page, 'GET', '/api/srs/queue'), 'srs queue');
    const cards = queue.cards ?? (queue as unknown as { items: { id: string }[] }).items ?? [];
    assert.ok(cards.length > 0, `review queue is empty: ${JSON.stringify(queue).slice(0, 200)}`);
    ok(
      await api(page, 'POST', `/api/srs/cards/${encodeURIComponent(cards[0]?.id ?? '')}/grade`, { grade: 2 }),
      'grade',
    );
    await screenOk(page, '/#/revisao', 'revisao');
    step(`review: ${cards.length} card(s) due, one graded`);

    // 4. Extras: the catalog of the current content version, one Extra marked seen.
    const manifest0 = ok(await api<{ version: string }>(page, 'GET', '/api/content/manifest'), 'manifest');
    const catalog0 = ok(
      await api<{ extras: { id: string; title: string }[]; episodes?: unknown }>(
        page,
        'GET',
        `/api/content/v/${manifest0.version}/catalog.json`,
      ),
      'catalog',
    );
    const extra = (catalog0.extras ?? [])[0];
    assert.ok(extra, 'catalog has no extras');
    ok(await api(page, 'POST', `/api/extras/${encodeURIComponent(extra.id)}/seen`, {}), 'extra seen');
    await screenOk(page, '/#/extra', 'extra');
    step(`extras: "${extra.title}" marked seen`);

    // 5. Mic in demo mode (no AI binding locally): session → tutor turn → end → report.
    const prof = ok(await api<{ profile: { assistant: string } }>(page, 'GET', '/api/me/state'), 'state').profile;
    const sess = ok(
      await api<{ id: string; quotaLeftS: number }>(page, 'POST', '/api/mic/sessions', {
        assistant: prof.assistant,
        mode: 'livre',
      }),
      'mic session',
    );
    const reply = ok(
      await api<{ source?: string; reply_en?: string }>(page, 'POST', '/api/tutor', {
        session_id: sess.id,
        text: 'I like to drink coffee in the morning.',
        turn: 1,
      }),
      'tutor',
    );
    assert.ok(reply.reply_en, `tutor reply has no reply_en: ${JSON.stringify(reply).slice(0, 200)}`);
    ok(await api(page, 'POST', `/api/mic/sessions/${sess.id}/end`, {}), 'mic end');
    const report = ok(
      await api<Record<string, unknown>>(page, 'POST', '/api/report', { session_id: sess.id }),
      'report',
    );
    assert.ok(Object.keys(report).length > 0, 'empty Mic report');
    await screenOk(page, '/#/maggie', 'maggie');
    step(`Mic demo: session ${sess.id}, tutor source=${reply.source ?? '?'}, report ok`);

    // 6. A learner report and a profile photo (both go to the moderation queue).
    ok(
      await api(page, 'POST', '/api/reports', { refType: 'mic_session', refId: sess.id, reason: 'smoke: teste' }),
      'user report',
    );
    const photo = (await page.evaluate(async () => {
      const c = new OffscreenCanvas(256, 256);
      const g = c.getContext('2d') as OffscreenCanvasRenderingContext2D;
      g.fillStyle = '#1e5bff';
      g.fillRect(0, 0, 256, 256);
      g.fillStyle = '#ff8a00';
      g.fillRect(64, 64, 128, 128);
      const blob = await c.convertToBlob({ type: 'image/jpeg', quality: 0.9 });
      const fd = new FormData();
      fd.append('photo', new File([blob], 'smoke.jpg', { type: 'image/jpeg' }));
      const r = await fetch('/api/me/photo', { method: 'POST', body: fd, credentials: 'same-origin' });
      return { status: r.status, body: await r.json() };
    })) as Res<{ photo: string; status: string }>;
    const up = ok(photo, 'photo upload');
    const photoUrl = up.photo;
    assert.equal((await api(page, 'GET', photoUrl)).status, 200, 'owner cannot read the new photo');
    await screenOk(page, '/#/perfil', 'perfil');
    step(`report filed; photo uploaded (${up.status})`);

    // 7. Admin: login through the admin SPA.
    const adminCtx = await newContext(browser, admin.origin);
    const ad = await adminCtx.newPage();
    await ad.goto('/#/entrar');
    await ad.locator('#login-email').fill(SUPER_ADMIN_EMAIL);
    await ad.locator('#login-pass').fill(FIXTURE_PASSWORD);
    await ad.getByRole('button', { name: /^Entrar$/ }).click();
    await ad.waitForFunction(() => !/#\/entrar$/.test(location.hash), null, { timeout: 20_000 });
    const me = ok(await api<{ user: { roles: string[] } }>(ad, 'GET', '/admin-api/auth/me'), 'admin me');
    assert.ok(me.user.roles.includes('super_admin'), `admin me: ${JSON.stringify(me.user)}`);
    step(`admin login (${SUPER_ADMIN_EMAIL}, roles ${me.user.roles.join(', ')})`);

    // 8. Content edit + publish → the app sees the new version.
    const epRes = ok(await api<{ item: { title: string } }>(ad, 'GET', '/admin-api/content/episodes/1'), 'episode 1');
    const original = epRes.item.title;
    const edited = `${original} · smoke ${id}`;
    const put = async (title: string) =>
      ok(await api(ad, 'PUT', '/admin-api/content/episodes/1', { title }), `episode title → ${title}`);
    const publish = async (notes: string) =>
      ok(await api<{ release: { version: string } }>(ad, 'POST', '/admin-api/content/publish', { notes }), 'publish')
        .release.version;
    await put(edited);
    let restored = false;
    try {
      const v1 = await publish(`smoke ${id}`);
      assert.notEqual(v1, manifest0.version, 'publish did not change the content version');
      const manifest1 = ok(
        await api<{ version: string }>(page, 'GET', '/api/content/manifest'),
        'manifest after publish',
      );
      assert.equal(manifest1.version, v1, 'the app does not serve the new content version');
      const ep1 = ok(await api<{ title: string }>(page, 'GET', `/api/content/v/${v1}/ep/1.json`), 'ep/1.json');
      assert.equal(ep1.title, edited, 'ep/1.json does not carry the edited title');
      await page.goto('/#/trilha');
      await page.reload();
      await page.getByText(`smoke ${id}`).first().waitFor({ timeout: 20_000 });
      step(`publish ${v1.slice(0, 12)} → app manifest + Trilha show the edited title`);
    } finally {
      // Revert so the slot keeps the seeded content (the e2e specs assert the prototype's titles).
      await put(original);
      const v2 = await publish(`smoke ${id} revert`);
      restored = v2 === manifest0.version;
      log(`reverted episode 1 title; content.current ${v2.slice(0, 12)} (${restored ? 'same as before' : 'NEW'})`);
    }
    assert.ok(restored, 'reverting the edit did not restore the original content version');

    // 9. Moderation removes the photo → the owner no longer gets it.
    const queueRes = ok(
      await api<{ items: { id: string; kind: string; subjectUserId: string | null; refId: string | null }[] }>(
        ad,
        'GET',
        '/admin-api/moderation?status=pending&kind=photo',
      ),
      'moderation queue',
    );
    const st = ok(await api<{ user?: { id: string } }>(page, 'GET', '/api/me/state'), 'state');
    const userId = st.user?.id;
    const item = queueRes.items.find((it) => (userId ? it.subjectUserId === userId : true));
    assert.ok(item, `no pending photo item for ${userId}: ${JSON.stringify(queueRes.items).slice(0, 300)}`);
    ok(
      await api(ad, 'POST', `/admin-api/moderation/${item.id}/decision`, { decision: 'removed', notes: 'smoke' }),
      'decision',
    );
    const after = ok(await api<{ profile: { photo?: string | null } }>(page, 'GET', '/api/me/state'), 'state');
    assert.ok(!after.profile.photo, `profile.photo still set: ${after.profile.photo}`);
    const gone = (await api(page, 'GET', photoUrl)).status;
    assert.equal(gone, 404, `removed photo still served to its owner (HTTP ${gone})`);
    step('moderation: photo removed → profile cleared, /m/ answers 404');

    await adminCtx.close();
    await appCtx.close();
    console.log(`\nfull smoke passed (${steps.length} checks)`);
  } finally {
    await browser?.close().catch(() => {});
    await admin?.stop().catch(() => {});
    await env.close();
    killAll();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? (err.stack ?? err.message) : err);
  process.exitCode = 1;
});
