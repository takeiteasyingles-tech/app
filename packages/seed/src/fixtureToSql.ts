// Prototype v6 state (localStorage 'tie.v6') → SQL that creates one test user holding that exact
// state in D1, with positional keys mapped to the stable content ids. Used by the parity harness:
// the same fixture is injected into the prototype and seeded here, then the new app logs in with
// the known session token. Re-running replaces the user (DELETE cascades to all user tables).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { POINT_KINDS } from '@tie/shared/content/schema';
import { norm } from '@tie/shared/domain/norm';
import { insertStatements, type Row, sqlLiteral, toSqlFile } from './emitSql';
import { extract } from './extract';
import { type Any, loadPrototype } from './loadPrototype';
import type { SeedContent } from './transform/content';
import { buildContent } from './transform/content';
import { itemIdFromV6, phraseIdFromV6, questionIdFromV6 } from './transform/ids';
import { MediaIndex, scanMedia } from './transform/media';
import { executeFile, resolvePersist, type Target } from './wrangler';

const DAY = 86_400_000;

export interface FixtureOptions {
  email: string;
  /** users.pass_hash, e.g. `pbkdf2-sha256$100000$<salt>$<hash>` (or null for no password). */
  passHash: string | null;
  /** sessions.token_hash: SHA-256 hex of the app session token the harness puts in its cookie. */
  sessionTokenHash: string;
  userId?: string;
  tz?: string;
  now?: number;
  /** Content rows for grading answers; built from the prototype when omitted. */
  content?: Pick<SeedContent, 'exercise_items' | 'ebook_test_questions' | 'mic_phrases'>;
}

const localDate = (ms: number, tz: string): string =>
  new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(ms);
const json = (v: unknown) => JSON.stringify(v ?? null);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const bool = (v: unknown) => (v ? 1 : 0);

function contentFromPrototype(now: number) {
  const D = loadPrototype();
  return buildContent(D, extract(), new MediaIndex(scanMedia()), now);
}

function srsSource(scene: string): string {
  if (/^Ep\./.test(scene)) return 'step';
  if (/^Mic/.test(scene)) return 'mic';
  if (/^Extra/i.test(scene)) return 'extra';
  return 'manual';
}

/**
 * The prototype's game.log never records the daily-mission bonuses (game.js adds them to the day and
 * the total only), so a ledger built from the log alone sums short of game.points (the parity
 * fixture: 265 vs 340). Each day's completed missions become `mission:{date}:{k}` rows (the engine's
 * key) sharing that day's missing points, so the ledger adds up to the daily totals.
 */
function missionRows(uid: string, g: Any, ledger: readonly Row[]): Row[] {
  const logged = new Map<string, number>();
  const lastAt = new Map<string, number>();
  for (const r of ledger) {
    const d = String(r.local_date);
    logged.set(d, (logged.get(d) ?? 0) + Number(r.points));
    lastAt.set(d, Math.max(lastAt.get(d) ?? 0, Number(r.created_at)));
  }
  const out: Row[] = [];
  for (const [date, d] of Object.entries((g.daily ?? {}) as Record<string, Any>)) {
    const done = Object.entries((d.missions ?? {}) as Record<string, unknown>)
      .filter(([, v]) => v)
      .map(([k]) => k);
    const missing = (Number(d.points) || 0) - (logged.get(date) ?? 0);
    if (!done.length || missing <= 0) continue;
    const each = Math.floor(missing / done.length);
    done.forEach((k, i) => {
      out.push({
        user_id: uid,
        award_key: `mission:${date}:${k}`,
        kind: 'mission',
        // The last one takes the remainder, so the day adds up exactly.
        points: i === done.length - 1 ? missing - each * (done.length - 1) : each,
        local_date: date,
        maggie_sec: 0,
        meta: null,
        created_at: (lastAt.get(date) ?? Date.parse(`${date}T12:00:00Z`)) + 1000 * (i + 1),
      });
    });
  }
  return out;
}

/** Statements (in FK order) that recreate the fixture user. */
export function fixtureStatements(state: Any, opts: FixtureOptions): string[] {
  if (state?.v !== 6) throw new Error('fixtureToSql expects a prototype v6 state ({v: 6, ...})');
  const now = opts.now ?? Date.now();
  const tz = opts.tz ?? 'America/Sao_Paulo';
  const uid = opts.userId ?? 'U_PARITY';
  const content = opts.content ?? contentFromPrototype(now);
  const items = new Map(content.exercise_items.map((i) => [i.id, i]));
  const questions = new Map(content.ebook_test_questions.map((q) => [q.id, q]));
  const phrases = new Set(content.mic_phrases.map((p) => p.id));

  const out: string[] = [
    `DELETE FROM users WHERE id = ${sqlLiteral(uid)} OR email = ${sqlLiteral(opts.email)};`,
    `DELETE FROM sessions WHERE token_hash = ${sqlLiteral(opts.sessionTokenHash)};`,
  ];
  const ins = (table: string, rows: Row[], key: string[]) =>
    out.push(...insertStatements({ table, key, mode: 'upsert' }, rows));

  ins(
    'users',
    [
      {
        id: uid,
        email: opts.email,
        pass_hash: opts.passHash,
        status: 'active',
        tz,
        failed_logins: 0,
        locked_until: null,
        terms_version: '2026-10',
        terms_accepted_at: now,
        created_at: now - 30 * DAY,
        last_login_at: now,
      },
    ],
    ['id'],
  );
  ins(
    'sessions',
    [
      {
        token_hash: opts.sessionTokenHash,
        user_id: uid,
        audience: 'app',
        created_at: now,
        last_seen_at: now,
        expires_at: now + 365 * DAY,
        ip_hash: null,
        ua: 'parity-fixture',
      },
    ],
    ['token_hash'],
  );

  const p = state.profile;
  if (p) {
    ins(
      'profiles',
      [
        {
          user_id: uid,
          full_name: p.fullName ?? '',
          name: p.name ?? '',
          birth: p.birth ?? '',
          age_band: p.age ?? '',
          occupation: p.occup ?? '',
          area: p.area ?? '',
          level_key: p.level || 'zero',
          goals: json(arr(p.goals)),
          deadline: p.deadline ?? '',
          history: json(arr(p.history)),
          fails: json(arr(p.fails)),
          formats: json(arr(p.formats)),
          genres: json(arr(p.genres)),
          themes: json(arr(p.themes)),
          diffs: json(arr(p.diffs)),
          main_diff: p.mainDiff ?? '',
          styles: json(arr(p.styles)),
          company: p.company ?? null,
          feedback: p.feedback ?? null,
          days: json(arr(p.days)),
          minutes: Number(p.minutes) || 20,
          reminders: json(arr(p.reminders)),
          motives: json(arr(p.motives)),
          why: p.why ?? '',
          assistant_key: p.assistant || 'margaret',
          avatar: Math.min(6, Math.max(1, Number(p.avatar) || 1)),
          photo_upload: null,
          voice: p.voice ? json(p.voice) : null,
          onb_step: Math.min(7, Math.max(1, Number(state.onbStep) || 7)),
          onb_completed_at: now - 30 * DAY,
          updated_at: now,
        },
      ],
      ['user_id'],
    );
  }

  const st = state.settings ?? {};
  ins(
    'user_settings',
    [
      {
        user_id: uid,
        ts: [1, 1.12, 1.25].includes(st.ts) ? st.ts : 1,
        sound: bool(st.sound ?? true),
        hd: bool(st.hd),
        trans: bool(st.trans ?? true),
        slow: bool(st.slow),
        remind: bool(st.remind ?? true),
        fx: bool(st.fx ?? true),
        free: bool(st.free),
      },
    ],
    ['user_id'],
  );

  // Progress
  const prog: Record<string, number> = state.prog ?? {};
  const done: Record<string, boolean> = state.epsDone ?? {};
  const epNums = [...new Set([...Object.keys(prog), ...Object.keys(done)].map(Number))].filter((n) => n > 0);
  ins(
    'episode_progress',
    epNums.map((n) => ({
      user_id: uid,
      episode_num: n,
      furthest_step: done[n] ? 10 : Math.min(10, Math.max(1, Number(prog[n]) || 1)),
      done_at: done[n] ? now - DAY : null,
      updated_at: now,
    })),
    ['user_id', 'episode_num'],
  );
  ins(
    'step_completions',
    Object.keys(state.stepOk ?? {})
      .filter((k) => state.stepOk[k])
      .map((k) => k.split('-').map(Number))
      .filter(([ep, step]) => ep && step)
      .map(([ep, step]) => ({ user_id: uid, episode_num: ep as number, step: step as number, completed_at: now })),
    ['user_id', 'episode_num', 'step'],
  );
  ins(
    'user_ebooks',
    Object.keys(state.ebooks ?? {})
      .filter((k) => state.ebooks[k])
      .map((k) => ({ user_id: uid, ebook_num: Number(k), downloaded_at: now - DAY })),
    ['user_id', 'ebook_num'],
  );

  const scores: Row[] = [];
  for (const [k, v] of Object.entries(state.scores ?? {})) {
    const id = phraseIdFromV6(k);
    if (!id || !phrases.has(id) || typeof v !== 'number') throw new Error(`fixture: unknown mic score key ${k}`);
    scores.push({
      user_id: uid,
      phrase_id: id,
      last_score: v,
      best_score: v,
      attempts: 1,
      source: 'demo',
      updated_at: now,
    });
  }
  ins('mic_scores', scores, ['user_id', 'phrase_id']);

  const answers: Row[] = [];
  for (const [k, v] of Object.entries(state.exAns ?? {})) {
    const id = itemIdFromV6(k);
    const item = id ? items.get(id) : undefined;
    if (!id || !item || typeof v !== 'number') throw new Error(`fixture: unknown exercise answer key ${k}`);
    answers.push({ user_id: uid, item_id: id, choice_idx: v, correct: bool(v === item.answer_idx), answered_at: now });
  }
  ins('exercise_answers', answers, ['user_id', 'item_id']);

  const testRows: Row[] = [];
  for (const [k, v] of Object.entries(state.testAns ?? {})) {
    const id = questionIdFromV6(k);
    const q = id ? questions.get(id) : undefined;
    if (!id || !q) throw new Error(`fixture: unknown test answer key ${k}`);
    const typed = q.accept != null;
    const acc: string[] = typed ? JSON.parse(q.accept as string) : [];
    testRows.push({
      user_id: uid,
      question_id: id,
      choice_idx: typed ? null : Number(v),
      text_value: typed ? String(v ?? '') : null,
      correct: bool(typed ? acc.includes(norm(v)) : Number(v) === q.answer_idx),
      updated_at: now,
    });
  }
  ins('ebook_test_answers', testRows, ['user_id', 'question_id']);
  if (state.testDone && typeof state.testScore === 'number') {
    ins(
      'ebook_test_results',
      [{ user_id: uid, ebook_num: 1, score: state.testScore, passed: bool(state.testScore >= 14), submitted_at: now }],
      ['user_id', 'ebook_num'],
    );
  }

  // Review deck
  const seen = new Set<string>();
  const cards: Row[] = [];
  arr(state.deck).forEach((c: Any, i) => {
    const key = norm(c.en);
    if (!key || seen.has(key)) return;
    seen.add(key);
    cards.push({
      id: `fx-card-${String(i).padStart(3, '0')}`,
      user_id: uid,
      norm_key: key,
      en: c.en,
      pt: c.pt ?? '',
      scene: c.scene ?? '',
      note: c.note ?? '',
      source: srsSource(String(c.scene ?? '')),
      due_at: typeof c.at === 'number' ? c.at : now,
      reps: Number(c.reps) || 0,
      created_at: now - 7 * DAY + i,
    });
  });
  ins('srs_cards', cards, ['id']);

  // Extras
  const ex = state.extras ?? {};
  const extraIds = new Set([...Object.keys(ex.seen ?? {}), ...Object.keys(ex.dubs ?? {})]);
  ins(
    'user_extras',
    [...extraIds].map((id) => ({
      user_id: uid,
      extra_id: id,
      seen_at: ex.seen?.[id] ? now - DAY : null,
      dub_avg: typeof ex.dubs?.[id] === 'number' ? ex.dubs[id] : null,
      dub_count: typeof ex.dubs?.[id] === 'number' ? 1 : 0,
    })),
    ['user_id', 'extra_id'],
  );

  // Game: the ledger trigger accumulates user_stats/daily_stats; the fixture's own totals win afterwards.
  const g = state.game ?? {};
  const kinds = new Set<string>(POINT_KINDS);
  const ledger: Row[] = arr(g.log)
    .filter((l: Any) => kinds.has(l.k))
    .map((l: Any, i) => ({
      user_id: uid,
      award_key: `fixture:${i}:${l.k}`,
      kind: l.k,
      points: Number(l.p) || 0,
      local_date: localDate(Number(l.t) || now, tz),
      maggie_sec: 0,
      meta: null,
      created_at: Number(l.t) || now,
    }));
  ledger.push(...missionRows(uid, g, ledger));
  ins('point_ledger', ledger, ['user_id', 'award_key']);
  out.push(`INSERT OR IGNORE INTO user_stats(user_id) VALUES(${sqlLiteral(uid)});`);
  out.push(
    `UPDATE user_stats SET points = ${sqlLiteral(Number(g.points) || 0)}, streak = ${sqlLiteral(Number(g.streak) || 0)}, ` +
      `last_day = ${sqlLiteral(g.lastDay || null)}, challenge_best = ${sqlLiteral(Number(ex.best) || 0)}, ` +
      `last_extra_id = ${sqlLiteral(ex.lastId || null)} WHERE user_id = ${sqlLiteral(uid)};`,
  );
  ins(
    'daily_stats',
    Object.entries((g.daily ?? {}) as Record<string, Any>).map(([date, d]) => ({
      user_id: uid,
      local_date: date,
      points: Number(d.points) || 0,
      steps: Number(d.steps) || 0,
      cards: Number(d.cards) || 0,
      extras: Number(d.extras) || 0,
      mic: Number(d.mic) || 0,
      maggie_sec: Number(d.maggieSec) || 0,
      goal_hit: bool(d.goal),
      missions: json(d.missions ?? {}),
    })),
    ['user_id', 'local_date'],
  );
  ins(
    'user_badges',
    arr(g.badges).map((id) => ({ user_id: uid, badge_id: String(id), earned_at: now - DAY })),
    ['user_id', 'badge_id'],
  );

  // Mic sessions (ids kept, so maggie/relatorio/<id> is the same route on both sides)
  const m = state.maggie ?? {};
  const sessions = arr(m.sessions) as Any[];
  ins(
    'mic_sessions',
    sessions.map((s) => {
      const at = Number(s.at) || now;
      const secs = Number(s.secs) || 0;
      return {
        id: String(s.id),
        user_id: uid,
        assistant_key: s.assistant || 'margaret',
        mode: s.mode || 'livre',
        mission_key: s.mission ?? null,
        extra_id: s.extraId ?? null,
        started_at: at,
        billed_until: at + secs * 1000,
        ended_at: at + secs * 1000,
        secs,
        status: 'ended',
        report: s.report ? json(s.report) : null,
        report_source: s.report?.source ?? null,
        flagged: 0,
      };
    }),
    ['id'],
  );
  ins(
    'mic_turns',
    sessions.flatMap((s) =>
      (arr(s.turns) as Any[]).map((t, idx) => ({
        session_id: String(s.id),
        idx,
        who: t.who === 'me' ? 'me' : 'her',
        en: String(t.en ?? ''),
        pt: t.pt ?? null,
        feedback: t.fb ? json(t.fb) : null,
        pron: json(arr(t.pron)),
        words: json(arr(t.words)),
        source: t.fb?.source ?? 'demo',
        created_at: (Number(s.at) || now) + idx * 20_000,
      })),
    ),
    ['session_id', 'idx'],
  );
  const limit = 60 * 60;
  const used = Math.max(0, limit - (typeof m.secLeft === 'number' ? m.secLeft : limit));
  if (used > 0) {
    ins(
      'ai_usage_monthly',
      [{ user_id: uid, period: localDate(now, tz).slice(0, 7), seconds_used: used }],
      ['user_id', 'period'],
    );
  }
  return out;
}

export function fixtureToSql(stateV6Json: string | Any, opts: FixtureOptions): string {
  const state = typeof stateV6Json === 'string' ? JSON.parse(stateV6Json) : stateV6Json;
  return toSqlFile(fixtureStatements(state, opts), `parity fixture user ${opts.email}`);
}

// CLI: tsx src/fixtureToSql.ts --state fixtures/state.v6.json --email … --pass-hash … --token-hash …
//      [--user-id U_PARITY] [--out out/fixture.sql] [--apply (--local [--persist-to dir] | --remote)]
async function main() {
  const { values } = parseArgs({
    options: {
      state: { type: 'string' },
      email: { type: 'string' },
      'pass-hash': { type: 'string' },
      'token-hash': { type: 'string' },
      'user-id': { type: 'string' },
      tz: { type: 'string' },
      out: { type: 'string' },
      apply: { type: 'boolean', default: false },
      local: { type: 'boolean', default: false },
      remote: { type: 'boolean', default: false },
      'persist-to': { type: 'string' },
    },
  });
  if (!values.state || !values.email || !values['token-hash']) {
    throw new Error('usage: fixtureToSql --state <v6.json> --email <e> --token-hash <sha256 hex> [--pass-hash <h>]');
  }
  const cwd = process.env.INIT_CWD ?? process.cwd();
  const sql = fixtureToSql(readFileSync(resolve(cwd, values.state), 'utf8'), {
    email: values.email,
    passHash: values['pass-hash'] ?? null,
    sessionTokenHash: values['token-hash'],
    userId: values['user-id'],
    tz: values.tz,
  });
  const outFile = values.out ? resolve(cwd, values.out) : fileURLToPath(new URL('../out/fixture.sql', import.meta.url));
  mkdirSync(dirname(outFile), { recursive: true });
  writeFileSync(outFile, sql);
  console.log(`fixture SQL written to ${outFile}`);
  if (values.apply) {
    if (values.remote) throw new Error('fixtures are for local test databases only');
    const t: Target = { mode: 'local', persistTo: resolvePersist(values['persist-to']) };
    await executeFile(t, outFile);
    console.log('fixture applied');
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
}
