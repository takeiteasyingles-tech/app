import { expect, test } from '@playwright/test';
import { slot } from '../src/config';
import { launchBrowser } from '../src/determinism';
import { fixtureUsers, loadFixture } from '../src/fixture/state';
import { validateInPrototype, validateSql } from '../src/fixture/validate';
import { servePrototype } from '../src/servePrototype';

test('state.v6.json loads in the prototype and maps to D1 rows', async () => {
  const state = loadFixture();
  const server = await servePrototype(slot(Number(process.env.FIXTURE_SLOT ?? '0')).protoPort);
  const browser = await launchBrowser();
  try {
    for (const u of fixtureUsers(state).filter((x) => x.key !== 'fresh')) {
      const res = await validateInPrototype(browser, server.url, u.state);
      expect(res.problems, `user ${u.key}`).toEqual([]);
    }
    expect(validateSql(state).problems).toEqual([]);
  } finally {
    await browser.close();
    await server.close();
  }
});
