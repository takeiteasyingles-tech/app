// `npm run parity:reveal -- --run <runId> --votes <votes.json> [--json]`
// Merges a critic's blind votes {pairId: 'A'|'B'|'tie'} with the run's key and prints, per pair, the
// winner (app | prototype | tie) and the pixel diff %. Relative paths resolve from where npm was run.
import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { runDirs } from './config';
import type { Key } from './pair';

export type Vote = 'A' | 'B' | 'tie';
export type Winner = 'app' | 'prototype' | 'tie' | 'no-vote';

export interface RevealRow {
  pairId: string;
  route: string;
  viewport: string;
  vote: Vote | null;
  winner: Winner;
  diffPct: number;
}

/** 'A' | 'B' | 'tie' (case-insensitive tie, surrounding spaces ignored); anything else is null. */
export function parseVote(raw: unknown): Vote | null {
  const v = typeof raw === 'string' ? raw.trim() : '';
  return v === 'A' || v === 'B' ? v : /^tie$/i.test(v) ? 'tie' : null;
}

export interface RevealResult {
  rows: RevealRow[];
  /** Votes for pairIds that are not in the key. */
  unknown: string[];
  /** Votes for known pairs whose value is not A, B or tie (counted as no vote). */
  invalid: { pairId: string; value: unknown }[];
}

export function reveal(key: Key, votes: Record<string, unknown>): RevealResult {
  const invalid: RevealResult['invalid'] = [];
  const rows: RevealRow[] = Object.entries(key.pairs).map(([pairId, e]) => {
    const raw = votes[pairId];
    const vote = parseVote(raw);
    if (vote === null && raw !== undefined && raw !== null && raw !== '') invalid.push({ pairId, value: raw });
    const winner: Winner = vote === 'A' ? e.A : vote === 'B' ? e.B : vote === 'tie' ? 'tie' : 'no-vote';
    return { pairId, route: e.route, viewport: e.viewport, vote, winner, diffPct: e.diffPct };
  });
  rows.sort((a, b) => a.route.localeCompare(b.route) || a.viewport.localeCompare(b.viewport));
  const unknown = Object.keys(votes).filter((k) => !(k in key.pairs));
  invalid.sort((a, b) => a.pairId.localeCompare(b.pairId));
  return { rows, unknown, invalid };
}

function main() {
  const { values } = parseArgs({
    options: { run: { type: 'string' }, votes: { type: 'string' }, json: { type: 'boolean', default: false } },
  });
  if (!values.run || !values.votes)
    throw new Error('usage: npm run parity:reveal -- --run <runId> --votes <votes.json>');
  const cwd = process.env.INIT_CWD ?? process.cwd();
  const keyFile = join(runDirs(values.run).key, 'key.json');
  if (!existsSync(keyFile)) throw new Error(`no key for run ${values.run} (${keyFile})`);
  const key = JSON.parse(readFileSync(keyFile, 'utf8')) as Key;
  const votesFile = isAbsolute(values.votes) ? values.votes : resolve(cwd, values.votes);
  const votes = JSON.parse(readFileSync(votesFile, 'utf8')) as Record<string, unknown>;
  const { rows, unknown, invalid } = reveal(key, votes);
  if (values.json) {
    console.log(JSON.stringify({ runId: key.runId, rows, unknown, invalid }, null, 2));
    return;
  }
  console.log(`run ${key.runId} (${rows.length} pairs)`);
  console.log(
    `${'pairId'.padEnd(12)}${'route'.padEnd(20)}${'viewport'.padEnd(10)}${'vote'.padEnd(6)}${'winner'.padEnd(11)}diff%`,
  );
  for (const r of rows) {
    console.log(
      `${r.pairId.padEnd(12)}${r.route.padEnd(20)}${r.viewport.padEnd(10)}${(r.vote ?? '-').padEnd(6)}${r.winner.padEnd(11)}${r.diffPct.toFixed(2)}`,
    );
  }
  const count = (w: Winner) => rows.filter((r) => r.winner === w).length;
  console.log(
    `\napp ${count('app')} · prototype ${count('prototype')} · tie ${count('tie')} · no vote ${count('no-vote')}`,
  );
  if (unknown.length) console.log(`ignored votes for unknown pairIds: ${unknown.join(', ')}`);
  if (invalid.length)
    console.log(
      `ignored invalid vote values (expected A, B or tie): ${invalid.map((x) => `${x.pairId}=${JSON.stringify(x.value)}`).join(', ')}`,
    );
}

if (/reveal\.ts$/.test(process.argv[1] ?? '')) {
  try {
    main();
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  }
}
