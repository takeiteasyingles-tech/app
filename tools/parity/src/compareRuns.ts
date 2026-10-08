// `npm run compare -w @tie/parity -- <runIdA> <runIdB>`: determinism check. Diffs every pair of two runs
// side by side (prototype vs prototype, app vs app); identical inputs should give ~0%.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runDirs } from './config';
import { diff, type Key } from './pair';

const [r1, r2] = process.argv.slice(2);
if (!r1 || !r2) {
  console.error('usage: npm run compare -w @tie/parity -- <runIdA> <runIdB>');
  process.exit(1);
}
const load = (run: string) => JSON.parse(readFileSync(join(runDirs(run).key, 'key.json'), 'utf8')) as Key;
const k1 = load(r1);
const k2 = load(r2);
const file = (run: string, k: Key, id: string, side: 'prototype' | 'app') =>
  join(runDirs(run).pairs, id, k.pairs[id]?.A === side ? 'A.png' : 'B.png');
let worst = 0;
let compared = 0;
for (const id of Object.keys(k1.pairs)) {
  if (!k2.pairs[id]) continue;
  compared++;
  for (const side of ['prototype', 'app'] as const) {
    const d = diff(readFileSync(file(r1, k1, id, side)), readFileSync(file(r2, k2, id, side)));
    if (d.pct > 0) console.log(`${k1.pairs[id]?.route} ${k1.pairs[id]?.viewport} ${side}: ${d.pct}%`);
    worst = Math.max(worst, d.pct);
  }
}
console.log(`pairs compared: ${compared}, worst cross-run diff: ${worst}%`);
