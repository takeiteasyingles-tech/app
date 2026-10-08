// The whole prototype → rows → SQL → compiled snapshot pipeline, without touching wrangler.
import { createHash } from 'node:crypto';
import { type CompiledContent, compileContent } from '@tie/shared/content/compile';
import { Catalog, Ebook, Episode } from '@tie/shared/content/schema';
import { BadgeRule } from '@tie/shared/contracts/game';
import { norm } from '@tie/shared/domain/norm';
import { beforeAll, describe, expect, it } from 'vitest';
import { bootstrapSql } from '../src/bootstrapAdmin';
import { insertStatements, MAX_STATEMENT_BYTES, seedStatements, sqlLiteral } from '../src/emitSql';
import { fixtureStatements } from '../src/fixtureToSql';
import { buildSeed } from '../src/index';
import type { Any } from '../src/loadPrototype';
import { releaseSql } from '../src/publish';
import { BADGE_RULES } from '../src/transform/config';

const NOW = Date.UTC(2026, 8, 15, 15, 0, 0);
let S: ReturnType<typeof buildSeed>;
let compiled: CompiledContent;

beforeAll(async () => {
  S = buildSeed(NOW);
  compiled = await compileContent({ ...S.content, ...S.config }, { publishedAt: NOW });
});

describe('extraction and transform', () => {
  it('produces the expected table sizes', () => {
    const c = S.content;
    expect(c.episodes).toHaveLength(20);
    expect(c.episodes.filter((e) => e.status === 'published').map((e) => e.num)).toEqual([1, 2, 5]);
    expect(c.extras).toHaveLength(9);
    expect(c.ebook_test_questions).toHaveLength(20);
    expect(c.assistants).toHaveLength(5);
    expect(c.assistant_clips).toHaveLength(20);
    expect(c.media.length).toBeGreaterThanOrEqual(60);
    expect(c.ebooks).toHaveLength(10);
    expect(c.steps).toHaveLength(10);
    expect(c.seasons).toHaveLength(8);
    expect(c.mic_missions).toHaveLength(8);
    expect(c.albums).toHaveLength(3);
    expect(S.config.badges).toHaveLength(14);
    expect(S.config.levels).toHaveLength(10);
    expect(S.config.point_rules).toHaveLength(15);
    expect(S.config.plans.map((p) => [p.slug, p.ai_minutes_month, p.is_default])).toEqual([
      ['gratis', 60, 1],
      ['premium', 600, 0],
    ]);
    expect(Object.fromEntries(S.config.feature_flags.map((f) => [f.key, f.enabled]))).toEqual({
      'ai.enabled': 1,
      'dev.free_steps': 0,
      'mic.store_recordings': 0,
    });
    expect(S.config.ai_prompts.map((p) => p.key)).toEqual(['tutor_system', 'report_system', 'guard']);
  });

  it('extracts closure constants and inline copy from the screens', () => {
    expect(S.X.SEASONS[0]).toBe('Arrival');
    expect(S.X.ebookTitles).toMatchObject({ 1: 'Nice to Meet You', 2: 'Sunday Lunch', 3: 'Welcome to Beacon' });
    expect(S.X.seasonSynopsis).toMatch(/^A família/);
    expect(S.X.ebookTeaser.title).toMatch(/^O almoço de domingo/);
    expect(S.X.ebookTeaser.sub).toMatch(/^E-book 2/);
    expect(S.X.sceneImages).toEqual({
      default: 'assets/img/gen/bg/home.webp',
      episodes: { 2: 'assets/img/gen/scene/cafe-counter.webp' },
    });
    expect(S.X.hardcodedAssets).toEqual(
      expect.arrayContaining([
        'assets/img/gen/bg/home.webp',
        'assets/img/gen/bg/login.webp',
        'assets/img/gen/bg/maggie-set.webp',
      ]),
    );
  });

  it('maps every prototype badge to a valid rule', () => {
    for (const b of S.X.BADGES) expect(BadgeRule.safeParse(BADGE_RULES[b.id]).success, b.id).toBe(true);
    for (const b of S.config.badges) expect(BadgeRule.parse(JSON.parse(b.rule))).toEqual(BADGE_RULES[b.id]);
  });

  it('folds EP_GAPS into lyrics and gives lyric/dialog/visual items stable ids', () => {
    const e1 = S.content.episodes.find((e) => e.num === 1);
    const lyrics = JSON.parse(e1?.lyrics ?? '[]');
    expect(lyrics[0]).toEqual({ id: 'e1-ly0', en: 'Hi! Hi! Good morning!', pt: 'Oi! Oi! Bom dia!', gap: 'morning' });
    expect(lyrics.every((l: Any) => l.gap)).toBe(true);
    expect(JSON.parse(e1?.dialog ?? '[]')[0].id).toBe('e1-dl0');
    expect(JSON.parse(e1?.visual ?? '[]')[0]).toEqual({ id: 'e1-vi0', en: 'morning', pt: 'manhã' });
    expect(S.content.mic_phrases.filter((p) => p.episode_num === 1).map((p) => p.id)[0]).toBe('e1-mic-0');
    expect(S.content.exercise_items.find((i) => i.id === 'e1-ex0-i3')?.q).toBe('Todos dizem: “Bye!”');
    expect(JSON.parse(e1?.done ?? '{}').go).toBe('episodio/2/1');
  });

  it("the shared norm() matches the prototype's for every acc and show value", () => {
    const protoNorm = S.D.norm as (x: unknown) => string;
    let checked = 0;
    for (const part of S.D.TEST as Any[]) {
      for (const q of part.qs as Any[]) {
        for (const v of [...(q.acc ?? []), ...(q.show ? [q.show] : [])]) {
          expect(norm(v), v).toBe(protoNorm(v));
          checked++;
        }
        if (q.show) expect(q.acc.map(norm)).toContain(norm(q.show));
      }
    }
    expect(checked).toBeGreaterThan(15);
  });

  it('genres are scoped by format and keep repeated keys', () => {
    const genres = S.content.option_lists.filter((o) => o.list_key === 'genres');
    expect(genres.filter((g) => g.item_key === 'comedia').map((g) => g.scope)).toEqual(['series', 'filmes', 'novelas']);
  });
});

describe('SQL', () => {
  it('keeps every statement under the D1 limit and upserts content', () => {
    const stmts = seedStatements(S.content, S.config);
    for (const s of stmts) expect(Buffer.byteLength(s)).toBeLessThanOrEqual(MAX_STATEMENT_BYTES);
    expect(stmts.find((s) => s.startsWith('INSERT INTO episodes'))).toMatch(/ON CONFLICT\(num\) DO UPDATE SET/);
    expect(stmts.find((s) => s.startsWith('INSERT INTO plans'))).toMatch(/ON CONFLICT\(id\) DO NOTHING;$/);
    expect(stmts.some((s) => /REPLACE/i.test(s.split('VALUES')[0] ?? ''))).toBe(false);
  });

  it('splits big tables into several statements', () => {
    const rows = Array.from({ length: 300 }, (_, i) => ({ id: `r${i}`, text: 'x'.repeat(1000) }));
    const stmts = insertStatements({ table: 't', key: ['id'], mode: 'upsert' }, rows);
    expect(stmts.length).toBeGreaterThan(2);
    for (const s of stmts) expect(Buffer.byteLength(s)).toBeLessThanOrEqual(MAX_STATEMENT_BYTES);
    expect(stmts.join('').match(/\('r\d+'/g)).toHaveLength(300);
  });

  it('escapes literals', () => {
    expect(sqlLiteral("it's")).toBe("'it''s'");
    expect(sqlLiteral(null)).toBe('NULL');
    expect(sqlLiteral(true)).toBe('1');
    expect(sqlLiteral(1.12)).toBe('1.12');
  });

  it('release SQL points content.current at the version', () => {
    const sql = releaseSql(compiled, 'seed', null, NOW);
    expect(sql).toContain(`'content.current', '${compiled.version}'`);
    expect(sql).toContain('ON CONFLICT(version) DO NOTHING');
  });

  it('bootstrap stores only the invite token hash', () => {
    const token = 'T'.repeat(43);
    const sql = bootstrapSql(token, NOW, 'diego.perez@digitalsolvers.com', 'U1');
    expect(sql).not.toContain(token);
    expect(sql).toContain(createHash('sha256').update(token).digest('hex'));
    expect(sql).toContain("'super_admin'");
    expect(sql).toMatch(
      /INSERT INTO users\(id, email, pass_hash[^)]*\) VALUES\('U1', 'diego\.perez@digitalsolvers\.com', NULL/,
    );
  });
});

describe('compiled snapshot of the real prototype', () => {
  it('validates and lists the published files', () => {
    expect(compiled.manifest.files).toEqual({
      catalog: 'catalog.json',
      episodes: [1, 2, 5],
      ebooks: [1],
      extras: S.content.extras.map((x) => x.id),
    });
    const cat = Catalog.parse(JSON.parse(compiled.files['catalog.json'] as string));
    expect(cat.titles).toHaveLength(20);
    expect(cat.assistants.map((a) => a.voice.tts)).toEqual(['asteria', 'orion', 'luna', 'arcas', 'athena']);
    expect(cat.onboarding.remindMax).toBe(5);
    expect(cat.images?.['avatar/user-1']).toMatch(/^\/m\/media\/[0-9a-f]{8}\/img\/gen\/avatar\/user-1\.webp$/);
    expect(cat.seasons[0]?.synopsis).toMatch(/^A família/);
  });

  it('never contains a persona', () => {
    const personas = S.content.assistants.map((a) => a.persona as string);
    for (const text of Object.values(compiled.files)) for (const p of personas) expect(text.includes(p)).toBe(false);
  });

  it('episode 1 and e-book 1 match the prototype', () => {
    const e1 = Episode.parse(JSON.parse(compiled.files['ep/1.json'] as string));
    expect(e1.mic).toHaveLength(S.D.EPS[1].mic.length);
    expect(e1.ex.flatMap((x) => x.items)).toHaveLength(21);
    expect(e1.sceneVideo).toMatch(/^\/m\/media\/[0-9a-f]{8}\/video\/cena-aula-1\.mp4$/);
    const e2 = Episode.parse(JSON.parse(compiled.files['ep/2.json'] as string));
    expect(e2.sceneImage).toMatch(/scene\/cafe-counter\.webp$/);
    expect(e2.introAudio).toBeNull();
    const eb = Ebook.parse(JSON.parse(compiled.files['ebook/1.json'] as string));
    expect(eb.test.flatMap((p) => p.qs)).toHaveLength(20);
    expect(eb.teaser?.title).toMatch(/^O almoço/);
    expect(eb.extrasCards).toHaveLength(4);
  });

  it('is reproducible', async () => {
    const again = await compileContent({ ...buildSeed(NOW + 1).content, ...S.config }, { publishedAt: NOW });
    expect(again.version).toBe(compiled.version);
  });
});

describe('fixtureToSql', () => {
  const state = {
    v: 6,
    onbStep: 7,
    profile: {
      name: 'Ana',
      fullName: 'Ana Teste',
      birth: '1990-05-01',
      age: '25-34',
      occup: 'trabalho',
      area: 'tech',
      level: 'basico',
      goals: ['series'],
      deadline: '6m',
      history: [],
      fails: [],
      formats: ['series'],
      genres: ['comedia'],
      themes: [],
      diffs: ['listening'],
      mainDiff: 'listening',
      styles: ['vendo'],
      company: 'desafio',
      feedback: 'direto',
      days: [1, 2, 3],
      minutes: 20,
      reminders: ['20:00'],
      motives: [],
      why: '',
      assistant: 'margaret',
      avatar: 2,
      photo: null,
      voice: null,
    },
    prog: { 1: 6 },
    ebooks: { 1: true },
    epsDone: {},
    stepOk: { '1-4': true },
    scores: { '1-0': 7, '1-2': 9 },
    exAns: { '1-0-0': 0, '1-0-1': 0 },
    testAns: { 1: 1, 9: 'Name', 14: 'Good morning, I am Ana' },
    testDone: true,
    testScore: 15,
    deck: [{ en: 'morning', pt: 'manhã', scene: 'Ep. 1 · Take a Look', at: NOW, reps: 1 }],
    due: 1,
    extras: { seen: { 'woods-and-beans': true }, dubs: { 'woods-and-beans': 8 }, best: 4, lastId: 'woods-and-beans' },
    maggie: {
      secLeft: 3000,
      sessions: [
        {
          id: 'abc1234',
          at: NOW - 3600_000,
          assistant: 'margaret',
          mode: 'livre',
          mission: null,
          extraId: null,
          secs: 120,
          turns: [{ who: 'me', en: 'I have 30 years', pt: '', fb: { status: 'ajuste' }, pron: [], words: [] }],
          report: {
            summary_pt: 'ok',
            strengths: [],
            fixes: [],
            pron: [],
            words: [],
            next_goal_pt: 'x',
            source: 'demo',
          },
        },
      ],
    },
    game: {
      points: 340,
      streak: 3,
      lastDay: '2026-09-15',
      daily: {
        '2026-09-15': { points: 40, steps: 1, cards: 0, maggieSec: 0, extras: 0, mic: 2, goal: false, missions: {} },
      },
      badges: ['first-step'],
      log: [{ k: 'step', t: NOW, p: 10 }],
    },
    settings: {
      ts: 1,
      sound: true,
      hd: false,
      trans: true,
      slow: false,
      remind: true,
      phone: false,
      fx: true,
      free: false,
    },
  };

  it('maps v6 keys to stable ids and grades answers', () => {
    const sql = fixtureStatements(state, {
      email: 'parity@test.local',
      passHash: null,
      sessionTokenHash: 'a'.repeat(64),
      now: NOW,
      content: S.content,
    }).join('\n');
    expect(sql).toMatch(/^DELETE FROM users WHERE id = 'U_PARITY'/);
    expect(sql).toContain("('U_PARITY', 'e1-mic-0', 7, 7, 1, 'demo'");
    expect(sql).toContain("('U_PARITY', 'e1-mic-2', 9, 9");
    expect(sql).toContain("('U_PARITY', 'e1-ex0-i0', 0, 1,");
    expect(sql).toContain("('U_PARITY', 'e1-ex0-i1', 0, 0,");
    expect(sql).toContain("('U_PARITY', 'eb1-t1', 1, NULL, 1,");
    expect(sql).toContain("('U_PARITY', 'eb1-t9', NULL, 'Name', 1,");
    expect(sql).toContain("('U_PARITY', 'eb1-t14', NULL, 'Good morning, I am Ana', 1,");
    expect(sql).toContain("'abc1234', 'U_PARITY', 'margaret', 'livre'");
    expect(sql).toContain('UPDATE user_stats SET points = 340, streak = 3');
    expect(sql).toContain("('U_PARITY', '2026-09', 600)");
  });

  it('rejects unknown keys', () => {
    expect(() =>
      fixtureStatements(
        { ...state, scores: { '9-9': 5 } },
        { email: 'x@y.z', passHash: null, sessionTokenHash: 'b', now: NOW, content: S.content },
      ),
    ).toThrow(/unknown mic score key/);
  });
});
