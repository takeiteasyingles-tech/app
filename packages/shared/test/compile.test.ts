// compileContent on a small hand-built set of D1 rows: shapes, ids, media URLs, persona exclusion,
// published-only files, deterministic versions and failure on broken references.
import { describe, expect, it } from 'vitest';
import { ContentCompileError, type ContentRows, compileContent, contentKey } from '../src/content/compile';
import { Catalog, Ebook, Episode, Extra } from '../src/content/schema';

const NOW = 1_760_000_000_000;
const j = JSON.stringify;

function media(id: string, rel: string, kind = 'image', mime = 'image/webp') {
  return { id, r2_key: `media/abcd1234/${rel}`, kind, mime, bytes: 10, sha256: 'x'.repeat(64), created_at: NOW };
}

function rows(): ContentRows {
  const steps = Array.from({ length: 10 }, (_, i) => ({
    n: i + 1,
    name: `Step ${i + 1}`,
    pt: `etapa ${i + 1}`,
    group_label: i === 0 ? 'ABERTURA' : null,
  }));
  const ep = (num: number, status: string) => ({
    num,
    title: `Ep ${num}`,
    season_n: 1,
    status,
    ebook_num: Math.ceil(num / 2),
    synopsis: status === 'published' ? 'Sinopse' : null,
    intro_media: num === 1 ? 'm-intro' : null,
    song_media: null,
    song_title: 'Song',
    scene_media: num === 1 ? 'm-video' : null,
    scene_note: 'nota',
    dialog_title: 'DIALOG',
    dialog_sub: 'sub',
    lyrics: j([
      { en: 'Hi! Hi! Good morning!', pt: 'Oi!', gap: 'morning' },
      { en: 'Bye bye', pt: 'Tchau' },
    ]),
    cast_names: j(['Zach']),
    visual: j([{ en: 'door', pt: 'porta' }]),
    dialog: j([{ who: 'Zach', en: 'Hi', pt: 'Oi' }]),
    lesson: j([{ k: '1 · TO BE', body: 'texto' }]),
    pron: null,
    away_exp: j([{ en: 'Hi', pt: 'Oi' }]),
    away_words: j(['hi']),
    done:
      status === 'published'
        ? j({
            title: 'T',
            line: 'L {N}',
            nextNum: '02',
            nextTitle: 'N',
            nextSub: 'S',
            nextNote: 'x',
            cta: 'Go',
            go: 'episodio/2/1',
          })
        : null,
    updated_at: NOW,
    updated_by: null,
  });
  const opt = (
    list_key: string,
    item_key: string,
    sort: number,
    label: string,
    more: Record<string, unknown> = {},
  ) => ({
    list_key,
    scope: '',
    item_key,
    sort,
    label,
    sub: null,
    icon: null,
    img_media: null,
    extra: null,
    ...more,
  });
  return {
    media: [
      media('m-intro', 'audio/intro.mp3', 'audio', 'audio/mpeg'),
      media('m-video', 'video/cena.mp4', 'video', 'video/mp4'),
      media('m-home', 'img/gen/bg/home.webp'),
      media('m-cafe', 'img/gen/scene/cafe.webp'),
      media('m-cover', 'img/gen/cover/x.webp'),
      media('m-poster', 'img/gen/avatar/as-margaret-poster.webp'),
      media('m-clip', 'video/mic/margaret-idle.mp4', 'video', 'video/mp4'),
    ],
    steps,
    seasons: [
      { n: 1, title: 'Arrival', synopsis: 'A família' },
      { n: 2, title: 'Settling In', synopsis: null },
    ],
    cast_members: [{ name: 'Zach', initials: 'ZW', color: '#3C5580' }],
    episodes: [ep(1, 'published'), ep(2, 'published'), ep(3, 'title_only')],
    mic_phrases: [
      { id: 'e1-mic-0', episode_num: 1, sort: 0, en: 'Hi!', tip: 'tip', demo_result: 7, blue: 1, fb: 'fb' },
      { id: 'e2-mic-0', episode_num: 2, sort: 0, en: 'Hello', tip: null, demo_result: null, blue: 0, fb: null },
    ],
    exercises: [
      {
        id: 'e1-ex0',
        episode_num: 1,
        sort: 0,
        kind: 'escrito',
        title: 'Ex',
        intro: null,
        audio: 'tts',
        audio_label: 'Ouvir',
      },
      {
        id: 'e2-ex0',
        episode_num: 2,
        sort: 0,
        kind: 'escrito',
        title: 'Ex2',
        intro: 'i',
        audio: null,
        audio_label: null,
      },
    ],
    exercise_items: [
      {
        id: 'e1-ex0-i1',
        exercise_id: 'e1-ex0',
        sort: 1,
        q: 'Q2',
        opts: j(['a', 'b']),
        answer_idx: 1,
        fix: null,
        say: null,
      },
      {
        id: 'e1-ex0-i0',
        exercise_id: 'e1-ex0',
        sort: 0,
        q: 'Q1',
        opts: j(['a', 'b', 'c']),
        answer_idx: 0,
        fix: 'f',
        say: 'Hi',
      },
      {
        id: 'e2-ex0-i0',
        exercise_id: 'e2-ex0',
        sort: 0,
        q: 'Q',
        opts: j(['x', 'y']),
        answer_idx: 0,
        fix: null,
        say: null,
      },
    ],
    ebooks: [
      {
        num: 1,
        title: 'Nice to Meet You',
        eps_label: '1–2',
        scope: 'Escopo',
        five: j([{ k: 'CUMPRIMENTO', title: 'T', rows: [{ q: 'How are you?', en: 'Good', pt: 'Bem' }] }]),
        real: j([{ book: 'b', street: 's', why: 'w' }]),
        lead: j([{ m: { en: 'Hi', pt: 'Oi' }, opts: [{ en: 'Hi {N}', pt: 'Oi {N}' }] }]),
        chat: j([]),
        extras_cards: j([{ name: 'Take Five', pt: 'p', desc: 'd', meta: 'm', go: 'ebook/1/five' }]),
        pdf_media: null,
        pass_score: 14,
        updated_at: NOW,
      },
      {
        num: 2,
        title: 'Sunday Lunch',
        eps_label: '3–4',
        scope: null,
        five: '[]',
        real: '[]',
        lead: '[]',
        chat: '[]',
        extras_cards: '[]',
        pdf_media: null,
        pass_score: 14,
        updated_at: NOW,
      },
    ],
    ebook_test_questions: [
      {
        id: 'eb1-t2',
        ebook_num: 1,
        part_idx: 1,
        part_title: 'PARTE B',
        n: 2,
        q: 'Hello! My ___',
        rev: 'R',
        ep_num: 1,
        step: 8,
        opts: null,
        answer_idx: null,
        accept: j(['name']),
        show: 'name',
        audio: null,
      },
      {
        id: 'eb1-t1',
        ebook_num: 1,
        part_idx: 0,
        part_title: 'PARTE A',
        n: 1,
        q: '___ Robert.',
        rev: 'R',
        ep_num: null,
        step: null,
        opts: j(['Am', 'I’m']),
        answer_idx: 1,
        accept: null,
        show: null,
        audio: 'hi',
      },
    ],
    extras: [
      {
        id: 'woods-and-beans',
        title: 'Woods & Beans',
        kind: 'Sitcom',
        format: 'series',
        genres: j(['comedia']),
        themes: j(['comida']),
        level: 'A1–A2',
        cefr: 1,
        ep_label: 'Ep. 3',
        dur: '8 min',
        cover_media: 'm-cover',
        scene_media: 'm-cafe',
        synopsis: 'S',
        cast_list: j([{ name: 'Maggie', initials: 'MW', color: '#2A6FF5' }]),
        dub: 'Lucas',
        premiere: 1,
        locked: 0,
        premium: 1,
        lines: j([{ who: 'Maggie', en: 'Hi', pt: 'Oi' }]),
        vocab: j([{ en: 'order', pt: 'pedido' }]),
        sort: 0,
        status: 'published',
      },
      {
        id: 'draft-one',
        title: 'Draft',
        kind: null,
        format: 'series',
        genres: '[]',
        themes: '[]',
        level: null,
        cefr: null,
        ep_label: null,
        dur: null,
        cover_media: null,
        scene_media: null,
        synopsis: null,
        cast_list: '[]',
        dub: null,
        premiere: 0,
        locked: 0,
        premium: 0,
        lines: '[]',
        vocab: '[]',
        sort: 1,
        status: 'draft',
      },
    ],
    albums: [
      { id: 'season-one', title: 'Músicas', sub: 'sub', level: 'A1', img_media: null, genres: j(['pop']), sort: 0 },
    ],
    album_tracks: [
      {
        id: 'season-one-t0',
        album_id: 'season-one',
        sort: 0,
        title: 'Say Hello',
        src_from: 'Episódio 1',
        audio_media: 'm-intro',
        ep_num: 1,
        bpm: null,
        music_key: null,
        lines: null,
      },
      {
        id: 'season-one-t1',
        album_id: 'season-one',
        sort: 1,
        title: 'Own',
        src_from: 'TIE',
        audio_media: null,
        ep_num: null,
        bpm: 100,
        music_key: 2,
        lines: j([{ en: 'a b', pt: 'c', gap: 'b' }]),
      },
    ],
    assistants: [
      {
        key: 'margaret',
        name: 'Maggie',
        full_name: 'Margaret Woods',
        art: 'a',
        age: 45,
        aka: j(['Maggie']),
        role: 'Designer',
        tag: 'Acolhedora',
        style: 'Estilo',
        hello_en: 'Hello!',
        hello_pt: 'Olá!',
        voice: j({ gender: 'female', pitch: 1.05, rate: 1 }),
        tts_speaker: 'asteria',
        persona: 'SECRET-PERSONA-TEXT warm and elegant',
        poster_media: 'm-poster',
        thumb_media: null,
        sort: 0,
        active: 1,
      },
    ],
    assistant_clips: [{ assistant_key: 'margaret', state: 'idle', media_id: 'm-clip' }],
    mic_missions: [
      {
        key: 'gente',
        title: 'Fazendo amizade',
        role: 'vizinha',
        goal: 'g',
        turns: j([{ en: 'Hi', pt: 'Oi', words: [] }]),
        sort: 0,
      },
    ],
    content_blobs: [
      { key: 'focus', json: j({ listening: { t: 't', b: 'b', cta: 'c', go: 'g' } }) },
      { key: 'personalize', json: j({ formatWord: { series: 'séries' }, formatTheme: {} }) },
      { key: 'extras_shelves', json: j([{ k: 'pra-voce', t: 'Pra você' }]) },
      {
        key: 'srs_grades',
        json: j([
          { label: 'De novo', hint: '< 1 min', ms: 0 },
          { label: 'Difícil', hint: '10 min', ms: 600000 },
          { label: 'Bom', hint: '2 dias', ms: 172800000 },
          { label: 'Fácil', hint: '5 dias', ms: 432000000 },
        ]),
      },
      { key: 'mic_modes', json: j([{ k: 'livre', t: 'Conversa livre', s: 's', icon: 'chat' }]) },
      { key: 'mic_openers', json: j({ _: { en: 'Hi, {N}.', pt: 'Oi, {N}.' } }) },
      { key: 'mic_follow', json: j([{ en: 'Bye', pt: 'Tchau', end: true }]) },
      { key: 'mic_pron', json: j([{ en: 'Hi', target: 'h', tip: 't' }]) },
      { key: 'mic_help', json: j([{ en: 'Sorry?', pt: 'não entendi' }]) },
      { key: 'ebook_teasers', json: j({ 1: { title: 'O almoço', sub: 'E-book 2' } }) },
      { key: 'scene_images', json: j({ default: 'm-home', episodes: { 2: 'm-cafe' } }) },
      { key: 'ui_images', json: j({ 'bg/home': 'm-home' }) },
      { key: 'onboarding_meta', json: j({ remindMax: 5 }) },
    ],
    option_lists: [
      opt('onb_steps', 'conta', 0, 'Sua conta', { sub: 'Leva um minuto.', extra: j({ h: 'Primeiro' }) }),
      opt('onb_steps', 'objetivo', 1, 'Objetivo', { sub: 's', extra: j({ h: 'h', skip: true }) }),
      opt('levels', 'zero', 0, 'Do zero', { sub: 'Nunca', extra: j({ season: 1, cefr: 'A1' }) }),
      opt('formats', 'series', 0, 'Séries', { img_media: 'm-cover' }),
      opt('genres', 'comedia', 0, 'Comédia', { scope: 'series' }),
      opt('genres', 'comedia', 0, 'Comédia', { scope: 'filmes' }),
      opt('genres', 'rock', 0, 'Rock', { scope: 'musica' }),
      opt('goals', 'viagem', 0, 'Viajar', { sub: 'Aeroporto', icon: 'plane' }),
      ...['D', 'S', 'T', 'Q', 'Q', 'S', 'S'].map((d, i) => opt('days', String(i), i, d)),
      opt('minutes', '20', 0, '20 min'),
      opt('minutes', '30', 1, '30 min'),
    ],
    point_rules: [
      { kind: 'step', points: 10, daily_cap: null, verifiable: 1 },
      { kind: 'word', points: 3, daily_cap: 20, verifiable: 0 },
      { kind: 'not_a_kind', points: 99, daily_cap: null, verifiable: 1 },
    ],
    levels: [
      { n: 2, min_points: 100, name: 'Curioso' },
      { n: 1, min_points: 0, name: 'Iniciante' },
    ],
    badges: [
      {
        id: 'first-step',
        title: 'Primeiro passo',
        sub: 'Concluiu',
        icon: 'flag',
        rule: j({ type: 'count', kind: 'step', min: 1 }),
        sort: 0,
      },
    ],
  };
}

describe('compileContent', () => {
  it('builds a valid catalog, published episodes, available e-books and published extras', async () => {
    const c = await compileContent(rows(), { publishedAt: NOW });
    expect(Object.keys(c.files)).toEqual([
      'catalog.json',
      'ebook/1.json',
      'ep/1.json',
      'ep/2.json',
      'extra/woods-and-beans.json',
    ]);
    expect(c.manifest).toEqual({
      version: c.version,
      publishedAt: NOW,
      files: { catalog: 'catalog.json', episodes: [1, 2], ebooks: [1], extras: ['woods-and-beans'] },
    });
    expect(c.version).toMatch(/^[0-9a-f]{64}$/);
    expect(c.premiumExtras).toEqual(['woods-and-beans']);

    const cat = Catalog.parse(JSON.parse(c.files['catalog.json'] as string));
    expect(cat.version).toBe(c.version);
    expect(cat.titles).toEqual(['Ep 1', 'Ep 2', 'Ep 3']);
    expect(cat.episodes.map((e) => e.status)).toEqual(['published', 'published', 'title_only']);
    expect(cat.ebooks.map((e) => [e.num, e.available, e.episodes])).toEqual([
      [1, true, [1, 2]],
      [2, false, [3]],
    ]);
    expect(cat.steps[0]).toEqual({ n: 1, name: 'Step 1', pt: 'etapa 1', group: 'ABERTURA' });
    expect(cat.steps[1]).not.toHaveProperty('group');
    expect(cat.onboarding.genres).toEqual({
      series: [{ k: 'comedia', t: 'Comédia' }],
      filmes: [{ k: 'comedia', t: 'Comédia' }],
      musica: [{ k: 'rock', t: 'Rock' }],
    });
    expect(cat.onboarding.steps[1]).toEqual({ k: 'objetivo', t: 'Objetivo', h: 'h', s: 's', skip: true });
    expect(cat.onboarding.levels[0]).toMatchObject({ k: 'zero', season: 1, cefr: 'A1', s: 'Nunca' });
    expect(cat.onboarding.formats[0]?.img).toBe('/m/media/abcd1234/img/gen/cover/x.webp');
    expect(cat.onboarding.minutes).toEqual([
      { k: 20, t: '20 min' },
      { k: 30, t: '30 min' },
    ]);
    expect(cat.extras.map((x) => x.id)).toEqual(['woods-and-beans']);
    expect(cat.mic.pron[0]?.id).toBe('pron-0');
    expect(cat.game.points.step).toBe(10);
    expect(cat.game.points.word).toBe(3);
    expect(cat.game.points.card).toBe(0);
    expect(cat.game.points).not.toHaveProperty('not_a_kind');
    expect(cat.game.levels.map((l) => l.n)).toEqual([1, 2]);
    expect(cat.images).toEqual({ 'bg/home': '/m/media/abcd1234/img/gen/bg/home.webp' });
  });

  it('never ships assistant personas, and maps media ids to /m/ URLs', async () => {
    const c = await compileContent(rows(), { publishedAt: NOW });
    for (const text of Object.values(c.files)) {
      expect(text).not.toContain('SECRET-PERSONA-TEXT');
      expect(text).not.toContain('"persona"');
      expect(text).not.toMatch(/"m-(intro|video|home|cafe|cover|poster|clip)"/);
    }
    const a = c.catalog.assistants[0];
    expect(a).toMatchObject({
      k: 'margaret',
      poster: '/m/media/abcd1234/img/gen/avatar/as-margaret-poster.webp',
      thumb: null,
      voice: { gender: 'female', pitch: 1.05, rate: 1, tts: 'asteria' },
      clips: { idle: '/m/media/abcd1234/video/mic/margaret-idle.mp4' },
    });
  });

  it('episode files carry stable ids, sorted items, scene stills and inlined defaults', async () => {
    const c = await compileContent(rows(), { publishedAt: NOW });
    const e1 = Episode.parse(JSON.parse(c.files['ep/1.json'] as string));
    expect(e1.introAudio).toBe('/m/media/abcd1234/audio/intro.mp3');
    expect(e1.sceneVideo).toBe('/m/media/abcd1234/video/cena.mp4');
    expect(e1.sceneImage).toBe('/m/media/abcd1234/img/gen/bg/home.webp');
    expect(e1.ebookTitle).toBe('NICE TO MEET YOU');
    expect(e1.ebookEps).toBe('1–2');
    expect(e1.lyrics.map((l) => l.id)).toEqual(['e1-ly0', 'e1-ly1']);
    expect(e1.lyrics[0]?.gap).toBe('morning');
    expect(e1.visual[0]).toEqual({ id: 'e1-vi0', en: 'door', pt: 'porta' });
    expect(e1.dialog[0]?.id).toBe('e1-dl0');
    expect(e1.mic[0]).toEqual({ id: 'e1-mic-0', en: 'Hi!', tip: 'tip', result: 7, blue: true, fb: 'fb' });
    expect(e1.ex[0]?.items.map((i) => i.id)).toEqual(['e1-ex0-i0', 'e1-ex0-i1']);
    expect(e1.ex[0]).toMatchObject({ audio: 'tts', audioLabel: 'Ouvir' });
    expect(e1.ex[0]?.items[0]).toMatchObject({ a: 0, fix: 'f', say: 'Hi' });

    const e2 = Episode.parse(JSON.parse(c.files['ep/2.json'] as string));
    expect(e2.sceneImage).toBe('/m/media/abcd1234/img/gen/scene/cafe.webp');
    expect(e2.mic[0]).toEqual({ id: 'e2-mic-0', en: 'Hello', tip: '', result: 7, fb: '' });
    expect(e2.ex[0]?.intro).toBe('i');
  });

  it('e-book test parts follow part_idx and n, with defaults for ep and step', async () => {
    const c = await compileContent(rows(), { publishedAt: NOW });
    const eb = Ebook.parse(JSON.parse(c.files['ebook/1.json'] as string));
    expect(eb.test.map((p) => p.title)).toEqual(['PARTE A', 'PARTE B']);
    expect(eb.test[0]?.qs[0]).toEqual({
      id: 'eb1-t1',
      n: 1,
      q: '___ Robert.',
      rev: 'R',
      ep: 1,
      step: 7,
      opts: ['Am', 'I’m'],
      a: 1,
      audio: 'hi',
    });
    expect(eb.test[1]?.qs[0]).toMatchObject({ id: 'eb1-t2', acc: ['name'], show: 'name', step: 8 });
    expect(eb.teaser).toEqual({ title: 'O almoço', sub: 'E-book 2' });
    expect(eb.episodes).toEqual([1, 2]);
  });

  it('album tracks inline episode lyrics with gaps (first word when none)', async () => {
    const c = await compileContent(rows(), { publishedAt: NOW });
    const [t0, t1] = c.catalog.albums[0]?.tracks ?? [];
    expect(t0?.audio).toBe('/m/media/abcd1234/audio/intro.mp3');
    expect(t0?.lines).toEqual([
      { en: 'Hi! Hi! Good morning!', pt: 'Oi!', gap: 'morning' },
      { en: 'Bye bye', pt: 'Tchau', gap: 'Bye' },
    ]);
    expect(t1).toMatchObject({ bpm: 100, key: 2, lines: [{ en: 'a b', pt: 'c', gap: 'b' }] });
    expect(t1).not.toHaveProperty('ep');
  });

  it('extra files keep lines and vocab; premium is flagged', async () => {
    const c = await compileContent(rows(), { publishedAt: NOW });
    const x = Extra.parse(JSON.parse(c.files['extra/woods-and-beans.json'] as string));
    expect(x).toMatchObject({
      premium: true,
      premiere: true,
      locked: false,
      cover: '/m/media/abcd1234/img/gen/cover/x.webp',
    });
    expect(x.vocab).toEqual([{ en: 'order', pt: 'pedido' }]);
  });

  it('is deterministic: same rows → same version and bytes; any change → new version', async () => {
    const a = await compileContent(rows(), { publishedAt: NOW });
    const b = await compileContent(rows(), { publishedAt: NOW + 5000 });
    expect(b.version).toBe(a.version);
    expect(b.files).toEqual(a.files);
    expect(b.manifest.publishedAt).toBe(NOW + 5000);

    const changed = rows();
    (changed.mic_phrases[0] as { en: string }).en = 'Hi there!';
    const c = await compileContent(changed, { publishedAt: NOW });
    expect(c.version).not.toBe(a.version);
  });

  it('fails with issues on broken media references and invalid shapes', async () => {
    const bad = rows();
    (bad.extras[0] as { cover_media: string }).cover_media = 'm-missing';
    (bad.exercise_items[0] as { opts: string }).opts = j(['only-one']);
    const err = await compileContent(bad, { publishedAt: NOW }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ContentCompileError);
    const issues = (err as ContentCompileError).issues;
    expect(issues.some((i) => i.message.includes('unknown media id "m-missing"'))).toBe(true);
    expect(issues.some((i) => i.file === 'ep/1.json' && i.path.startsWith('ex.0.items'))).toBe(true);
  });

  it('content keys live under content/{ver}/', () => {
    expect(contentKey('ab12', 'ep/1.json')).toBe('content/ab12/ep/1.json');
  });
});
