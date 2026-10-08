// `npm run fixture:gen -w @tie/parity [-- --slot N]`: regenerates fixtures/state.v6.json by driving the
// prototype itself (same determinism as the harness: frozen clock, seeded Math.random, demo AI), then
// validates it in the prototype and against fixtureToSql. Uses only the slot's prototype port.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { FIXTURE_FILE, OUT_ROOT, slot as slotOf } from '../config';
import { contextOptions, launchBrowser, prepareContext, settle } from '../determinism';
import { servePrototype } from '../servePrototype';
import { buildFixtureInPage } from './builder';
import { validateInPrototype, validateSql } from './validate';

async function main() {
  const { values } = parseArgs({ options: { slot: { type: 'string', default: '0' } } });
  const sl = slotOf(Number(values.slot));
  const server = await servePrototype(sl.protoPort);
  const browser = await launchBrowser();
  try {
    const ctx = await browser.newContext(contextOptions('desktop'));
    await prepareContext(ctx, { side: 'prototype', seedKey: 'fixture-gen', allowOrigins: [server.url] });
    const page = await ctx.newPage();
    await page.goto(`${server.url}/#/entrar`, { waitUntil: 'load' });
    await settle(page);
    const state = await page.evaluate(buildFixtureInPage);
    await ctx.close();

    const proto = await validateInPrototype(browser, server.url, state);
    const sql = validateSql(state);
    mkdirSync(OUT_ROOT, { recursive: true });
    if (proto.screenshot) writeFileSync(join(OUT_ROOT, 'fixture-hoje.png'), proto.screenshot);
    const problems = [...proto.problems, ...sql.problems];
    if (problems.length) throw new Error(`generated fixture is invalid:\n  ${problems.join('\n  ')}`);
    writeFileSync(FIXTURE_FILE, `${JSON.stringify(state, null, 2)}\n`);
    console.log(`fixture written: ${FIXTURE_FILE}`);
    console.log(`Hoje screenshot: ${join(OUT_ROOT, 'fixture-hoje.png')}`);
  } finally {
    await browser.close();
    await server.close();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
