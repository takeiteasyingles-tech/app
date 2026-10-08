// `npm run check:models -w @tie/app` (also run by `npm run deploy`): checks that every Workers AI model
// id the app uses by default (DEFAULT_MODELS) exists in the account's catalog, via
// `wrangler ai models list --json` (needs CLOUDFLARE_API_TOKEN, like the deploy itself). Ids an admin
// sets later in app_settings are checked the same way by pasting them: `-- @cf/x/y …`.
import { spawnSync } from 'node:child_process';
import { DEFAULT_MODELS } from '@tie/shared/constants';

/** Model names from `wrangler ai models list --json` (an array of {name} or {id}/{name} objects). */
export function catalogNames(json: unknown): Set<string> {
  const out = new Set<string>();
  const list = Array.isArray(json)
    ? json
    : json && typeof json === 'object' && Array.isArray((json as { result?: unknown }).result)
      ? (json as { result: unknown[] }).result
      : [];
  for (const m of list) {
    if (!m || typeof m !== 'object') continue;
    const name = (m as { name?: unknown }).name;
    if (typeof name === 'string') out.add(name);
  }
  return out;
}

/** The ids not in the catalog (empty: all good). */
export function missingModels(catalog: ReadonlySet<string>, ids: readonly string[]): string[] {
  return [...new Set(ids)].filter((id) => !catalog.has(id));
}

function main(): void {
  const extra = process.argv.slice(2).filter((a) => a.startsWith('@cf/'));
  const ids = [...Object.values(DEFAULT_MODELS), ...extra];
  const r = spawnSync('npx', ['wrangler', 'ai', 'models', 'list', '--json'], {
    encoding: 'utf8',
    shell: process.platform === 'win32',
    maxBuffer: 32 * 1024 * 1024,
  });
  if (r.status !== 0) {
    console.error('wrangler ai models list failed (is CLOUDFLARE_API_TOKEN set?)');
    console.error(r.stderr?.slice(-2000) ?? '');
    process.exitCode = 1;
    return;
  }
  const start = r.stdout.indexOf('[');
  const catalog = catalogNames(JSON.parse(start >= 0 ? r.stdout.slice(start) : r.stdout));
  const missing = missingModels(catalog, ids);
  if (missing.length) {
    console.error(`Workers AI models not in the account catalog: ${missing.join(', ')}`);
    console.error('Fix DEFAULT_MODELS (packages/shared/src/constants.ts) or the ai.model.* app settings.');
    process.exitCode = 1;
    return;
  }
  console.log(`Workers AI models OK (${ids.length} checked against ${catalog.size} in the catalog).`);
}

const isMain = process.argv[1] && /[\\/]scripts[\\/]checkModels\.ts$/.test(process.argv[1]);
if (isMain) main();
