// Content entities the CMS edits through /admin-api/content/<name>: one declarative spec per table
// (API key ↔ column, column kind, parent, media kinds, references and the user data that blocks a
// delete). routes/content.ts turns each spec into list/get/create/update/remove.
import { adminApi, ClipState, type EndpointDef, type MediaKind as MediaKindSchema, norm } from '@tie/shared';
import { type Query, q } from '@tie/worker-core';
import type { z } from 'zod';

export type MediaKind = z.infer<typeof MediaKindSchema>;
export type Item = Record<string, unknown>;

export type FieldKind = 'text' | 'int' | 'bool' | 'json' | 'jsonNull' | 'media';

export interface Field {
  key: string;
  col: string;
  kind: FieldKind;
  /** Media kinds accepted by a media field. */
  media?: readonly MediaKind[];
}

export interface Issue {
  path: string;
  code: string;
  message: string;
}

/** A reference that has no FK in D1 (or whose FK error would be opaque), checked before writing. */
export interface RefCheck {
  key: string;
  table: string;
  col: string;
  label: string;
}

/** User data (or content) that still points at a row; any hit makes DELETE answer 409 in_use. */
export interface InUseCheck {
  label: string;
  /** SELECT COUNT(*) AS n ... with one `?` for the primary key. */
  sql: string;
}

/** Extra state stored outside the entity's own row (assistant clips). */
export interface Virtual {
  key: string;
  load(db: D1Database, ids: readonly (string | number)[]): Promise<Map<string | number, unknown>>;
  writes(db: D1Database, id: string | number, value: unknown): Query<unknown>[];
  media(value: unknown): { id: string; path: string; kinds: readonly MediaKind[] }[];
  empty: unknown;
}

export interface CrudDefs {
  list: EndpointDef & { query: z.ZodType };
  get: EndpointDef & { params: z.ZodType };
  create: EndpointDef & { body: z.ZodType };
  update: EndpointDef & { params: z.ZodType; body: z.ZodType };
  remove: EndpointDef & { params: z.ZodType };
}

export interface Entity {
  /** URL segment and audit name ('episodes', 'mic-phrases'). */
  name: string;
  /** audit_log.target_type. */
  target: string;
  table: string;
  pk: Field;
  numericPk: boolean;
  parent?: { key: string; table: string; col: string };
  fields: Field[];
  orderBy: string;
  /** Columns the server stamps on every write. */
  stamp?: { updatedAt: boolean; updatedBy: boolean };
  api: CrudDefs;
  refs?: RefCheck[];
  inUse?: InUseCheck[];
  virtual?: Virtual;
  /** Normalizes a validated item before checks and writes. */
  normalize?(item: Item): Item;
  /** Cross-field rules the row schema cannot express. */
  check?(item: Item): Issue[];
}

const f = (key: string, col: string, kind: FieldKind = 'text', media?: readonly MediaKind[]): Field => ({
  key,
  col,
  kind,
  ...(media ? { media } : {}),
});

const C = adminApi.content;

// Deepgram Aura (aura-1) voices; /api/tts additionally allowlists one per assistant (TTS_SPEAKERS).
export const AURA_SPEAKERS = [
  'asteria',
  'luna',
  'stella',
  'athena',
  'hera',
  'orion',
  'arcas',
  'perseus',
  'angus',
  'orpheus',
  'helios',
  'zeus',
] as const;

const optsIssues = (item: Item, optsKey: string, idxKey: string): Issue[] => {
  const opts = item[optsKey];
  const idx = item[idxKey];
  if (Array.isArray(opts) && typeof idx === 'number' && idx >= opts.length) {
    return [
      { path: idxKey, code: 'out_of_range', message: `A resposta certa precisa ser uma das ${opts.length} opções.` },
    ];
  }
  return [];
};

const episodes: Entity = {
  name: 'episodes',
  target: 'episode',
  table: 'episodes',
  pk: f('num', 'num', 'int'),
  numericPk: true,
  fields: [
    f('num', 'num', 'int'),
    f('title', 'title'),
    f('seasonN', 'season_n', 'int'),
    f('status', 'status'),
    f('ebookNum', 'ebook_num', 'int'),
    f('synopsis', 'synopsis'),
    f('introMedia', 'intro_media', 'media', ['audio']),
    f('songMedia', 'song_media', 'media', ['audio']),
    f('songTitle', 'song_title'),
    f('sceneMedia', 'scene_media', 'media', ['video']),
    f('sceneNote', 'scene_note'),
    f('dialogTitle', 'dialog_title'),
    f('dialogSub', 'dialog_sub'),
    f('lyrics', 'lyrics', 'json'),
    f('castNames', 'cast_names', 'json'),
    f('visual', 'visual', 'json'),
    f('dialog', 'dialog', 'json'),
    f('lesson', 'lesson', 'json'),
    f('pron', 'pron', 'jsonNull'),
    f('awayExp', 'away_exp', 'json'),
    f('awayWords', 'away_words', 'json'),
    f('done', 'done', 'jsonNull'),
  ],
  orderBy: 'num',
  stamp: { updatedAt: true, updatedBy: true },
  api: C.episodes,
  refs: [
    { key: 'seasonN', table: 'seasons', col: 'n', label: 'temporada' },
    { key: 'ebookNum', table: 'ebooks', col: 'num', label: 'e-book' },
  ],
  inUse: [
    { label: 'progresso de alunos', sql: 'SELECT COUNT(*) AS n FROM episode_progress WHERE episode_num = ?' },
    { label: 'etapas concluídas', sql: 'SELECT COUNT(*) AS n FROM step_completions WHERE episode_num = ?' },
    { label: 'faixas de álbum', sql: 'SELECT COUNT(*) AS n FROM album_tracks WHERE ep_num = ?' },
  ],
  check(item) {
    if (item.status === 'published' && item.done == null) {
      return [{ path: 'done', code: 'required', message: 'Um episódio publicado precisa da tela de conclusão.' }];
    }
    return [];
  },
};

const micPhrases: Entity = {
  name: 'mic-phrases',
  target: 'mic_phrase',
  table: 'mic_phrases',
  pk: f('id', 'id'),
  numericPk: false,
  parent: { key: 'episodeNum', table: 'episodes', col: 'num' },
  fields: [
    f('id', 'id'),
    f('episodeNum', 'episode_num', 'int'),
    f('sort', 'sort', 'int'),
    f('en', 'en'),
    f('tip', 'tip'),
    f('demoResult', 'demo_result', 'int'),
    f('blue', 'blue', 'bool'),
    f('fb', 'fb'),
  ],
  orderBy: 'episode_num, sort, id',
  api: C.micPhrases,
  inUse: [{ label: 'notas de alunos', sql: 'SELECT COUNT(*) AS n FROM mic_scores WHERE phrase_id = ?' }],
};

const exercises: Entity = {
  name: 'exercises',
  target: 'exercise',
  table: 'exercises',
  pk: f('id', 'id'),
  numericPk: false,
  parent: { key: 'episodeNum', table: 'episodes', col: 'num' },
  fields: [
    f('id', 'id'),
    f('episodeNum', 'episode_num', 'int'),
    f('sort', 'sort', 'int'),
    f('kind', 'kind'),
    f('title', 'title'),
    f('intro', 'intro'),
    f('audio', 'audio'),
    f('audioLabel', 'audio_label'),
  ],
  orderBy: 'episode_num, sort, id',
  api: C.exercises,
  inUse: [
    {
      label: 'respostas de alunos',
      sql: `SELECT COUNT(*) AS n FROM exercise_answers a JOIN exercise_items i ON i.id = a.item_id WHERE i.exercise_id = ?`,
    },
  ],
};

const items: Entity = {
  name: 'items',
  target: 'exercise_item',
  table: 'exercise_items',
  pk: f('id', 'id'),
  numericPk: false,
  parent: { key: 'exerciseId', table: 'exercises', col: 'id' },
  fields: [
    f('id', 'id'),
    f('exerciseId', 'exercise_id'),
    f('sort', 'sort', 'int'),
    f('q', 'q'),
    f('opts', 'opts', 'json'),
    f('answerIdx', 'answer_idx', 'int'),
    f('fix', 'fix'),
    f('say', 'say'),
  ],
  orderBy: 'exercise_id, sort, id',
  api: C.items,
  inUse: [{ label: 'respostas de alunos', sql: 'SELECT COUNT(*) AS n FROM exercise_answers WHERE item_id = ?' }],
  check: (item) => optsIssues(item, 'opts', 'answerIdx'),
};

const ebooks: Entity = {
  name: 'ebooks',
  target: 'ebook',
  table: 'ebooks',
  pk: f('num', 'num', 'int'),
  numericPk: true,
  fields: [
    f('num', 'num', 'int'),
    f('title', 'title'),
    f('epsLabel', 'eps_label'),
    f('scope', 'scope'),
    f('five', 'five', 'json'),
    f('real', 'real', 'json'),
    f('lead', 'lead', 'json'),
    f('chat', 'chat', 'json'),
    f('extrasCards', 'extras_cards', 'json'),
    f('pdfMedia', 'pdf_media', 'media', ['pdf']),
    f('passScore', 'pass_score', 'int'),
  ],
  orderBy: 'num',
  stamp: { updatedAt: true, updatedBy: false },
  api: C.ebooks,
  inUse: [
    { label: 'episódios', sql: 'SELECT COUNT(*) AS n FROM episodes WHERE ebook_num = ?' },
    { label: 'downloads de alunos', sql: 'SELECT COUNT(*) AS n FROM user_ebooks WHERE ebook_num = ?' },
    { label: 'resultados de teste', sql: 'SELECT COUNT(*) AS n FROM ebook_test_results WHERE ebook_num = ?' },
  ],
};

const testQuestions: Entity = {
  name: 'test-questions',
  target: 'test_question',
  table: 'ebook_test_questions',
  pk: f('id', 'id'),
  numericPk: false,
  parent: { key: 'ebookNum', table: 'ebooks', col: 'num' },
  fields: [
    f('id', 'id'),
    f('ebookNum', 'ebook_num', 'int'),
    f('partIdx', 'part_idx', 'int'),
    f('partTitle', 'part_title'),
    f('n', 'n', 'int'),
    f('q', 'q'),
    f('rev', 'rev'),
    f('epNum', 'ep_num', 'int'),
    f('step', 'step', 'int'),
    f('opts', 'opts', 'jsonNull'),
    f('answerIdx', 'answer_idx', 'int'),
    f('accept', 'accept', 'jsonNull'),
    f('show', 'show'),
    f('audio', 'audio'),
  ],
  orderBy: 'ebook_num, n',
  api: C.testQuestions,
  refs: [{ key: 'epNum', table: 'episodes', col: 'num', label: 'episódio' }],
  inUse: [{ label: 'respostas de alunos', sql: 'SELECT COUNT(*) AS n FROM ebook_test_answers WHERE question_id = ?' }],
  // Typed answers are compared after norm() (spec: "already normalized with norm()").
  normalize(item) {
    const accept = item.accept;
    if (!Array.isArray(accept)) return item;
    const normalized = [...new Set(accept.map((a) => norm(a)).filter((a) => a !== ''))];
    return { ...item, accept: normalized.length ? normalized : null };
  },
  check(item) {
    const out: Issue[] = [];
    const hasChoice = Array.isArray(item.opts) && typeof item.answerIdx === 'number';
    if (!hasChoice && !Array.isArray(item.accept)) {
      out.push({
        path: 'opts',
        code: 'required',
        message: 'A questão precisa de opções com resposta, ou de respostas aceitas.',
      });
    }
    if (Array.isArray(item.opts) && item.opts.length < 2) {
      out.push({ path: 'opts', code: 'too_small', message: 'Pelo menos 2 opções.' });
    }
    if ((item.opts == null) !== (item.answerIdx == null)) {
      out.push({ path: 'answerIdx', code: 'pair', message: 'Opções e resposta certa andam juntas.' });
    }
    return [...out, ...optsIssues(item, 'opts', 'answerIdx')];
  },
};

const extras: Entity = {
  name: 'extras',
  target: 'extra',
  table: 'extras',
  pk: f('id', 'id'),
  numericPk: false,
  fields: [
    f('id', 'id'),
    f('title', 'title'),
    f('kind', 'kind'),
    f('format', 'format'),
    f('genres', 'genres', 'json'),
    f('themes', 'themes', 'json'),
    f('level', 'level'),
    f('cefr', 'cefr', 'int'),
    f('epLabel', 'ep_label'),
    f('dur', 'dur'),
    f('coverMedia', 'cover_media', 'media', ['image']),
    f('sceneMedia', 'scene_media', 'media', ['image']),
    f('synopsis', 'synopsis'),
    f('cast', 'cast_list', 'json'),
    f('dub', 'dub'),
    f('premiere', 'premiere', 'bool'),
    f('locked', 'locked', 'bool'),
    f('premium', 'premium', 'bool'),
    f('lines', 'lines', 'json'),
    f('vocab', 'vocab', 'json'),
    f('sort', 'sort', 'int'),
    f('status', 'status'),
  ],
  orderBy: 'sort, id',
  api: C.extras,
  inUse: [{ label: 'progresso de alunos', sql: 'SELECT COUNT(*) AS n FROM user_extras WHERE extra_id = ?' }],
};

const albums: Entity = {
  name: 'albums',
  target: 'album',
  table: 'albums',
  pk: f('id', 'id'),
  numericPk: false,
  fields: [
    f('id', 'id'),
    f('title', 'title'),
    f('sub', 'sub'),
    f('level', 'level'),
    f('imgMedia', 'img_media', 'media', ['image']),
    f('genres', 'genres', 'json'),
    f('sort', 'sort', 'int'),
  ],
  orderBy: 'sort, id',
  api: C.albums,
};

const tracks: Entity = {
  name: 'tracks',
  target: 'album_track',
  table: 'album_tracks',
  pk: f('id', 'id'),
  numericPk: false,
  parent: { key: 'albumId', table: 'albums', col: 'id' },
  fields: [
    f('id', 'id'),
    f('albumId', 'album_id'),
    f('sort', 'sort', 'int'),
    f('title', 'title'),
    f('srcFrom', 'src_from'),
    f('audioMedia', 'audio_media', 'media', ['audio']),
    f('epNum', 'ep_num', 'int'),
    f('bpm', 'bpm', 'int'),
    f('musicKey', 'music_key', 'int'),
    f('lines', 'lines', 'jsonNull'),
  ],
  orderBy: 'album_id, sort, id',
  api: C.tracks,
  refs: [{ key: 'epNum', table: 'episodes', col: 'num', label: 'episódio' }],
};

const clipsVirtual: Virtual = {
  key: 'clips',
  empty: {},
  async load(db, ids) {
    const out = new Map<string | number, unknown>(ids.map((id) => [id, {}]));
    if (!ids.length) return out;
    const res = await db
      .prepare('SELECT assistant_key, state, media_id FROM assistant_clips ORDER BY assistant_key, state')
      .all<{ assistant_key: string; state: string; media_id: string }>();
    for (const r of res.results) {
      const clips = out.get(r.assistant_key) as Record<string, string> | undefined;
      if (clips) clips[r.state] = r.media_id;
    }
    return out;
  },
  writes(db, id, value) {
    const clips = (value ?? {}) as Record<string, string | undefined>;
    const stmts: Query<unknown>[] = [q(db, 'DELETE FROM assistant_clips WHERE assistant_key = ?', id)];
    for (const state of ClipState.options) {
      const mediaId = clips[state];
      if (mediaId) {
        stmts.push(
          q(db, 'INSERT INTO assistant_clips(assistant_key, state, media_id) VALUES(?, ?, ?)', id, state, mediaId),
        );
      }
    }
    return stmts;
  },
  media(value) {
    const clips = (value ?? {}) as Record<string, string | undefined>;
    return Object.entries(clips)
      .filter((e): e is [string, string] => typeof e[1] === 'string')
      .map(([state, id]) => ({ id, path: `clips.${state}`, kinds: ['video'] as const }));
  },
};

const assistants: Entity = {
  name: 'assistants',
  target: 'assistant',
  table: 'assistants',
  pk: f('key', 'key'),
  numericPk: false,
  fields: [
    f('key', 'key'),
    f('name', 'name'),
    f('fullName', 'full_name'),
    f('art', 'art'),
    f('age', 'age', 'int'),
    f('aka', 'aka', 'json'),
    f('role', 'role'),
    f('tag', 'tag'),
    f('style', 'style'),
    f('helloEn', 'hello_en'),
    f('helloPt', 'hello_pt'),
    f('voice', 'voice', 'json'),
    f('ttsSpeaker', 'tts_speaker'),
    f('posterMedia', 'poster_media', 'media', ['image']),
    f('thumbMedia', 'thumb_media', 'media', ['image']),
    f('sort', 'sort', 'int'),
    f('active', 'active', 'bool'),
  ],
  orderBy: 'sort, key',
  api: C.assistants,
  virtual: clipsVirtual,
  inUse: [
    { label: 'perfis de alunos', sql: 'SELECT COUNT(*) AS n FROM profiles WHERE assistant_key = ?' },
    { label: 'sessões do Mic', sql: 'SELECT COUNT(*) AS n FROM mic_sessions WHERE assistant_key = ?' },
  ],
  check(item) {
    return (AURA_SPEAKERS as readonly string[]).includes(String(item.ttsSpeaker))
      ? []
      : [
          {
            path: 'ttsSpeaker',
            code: 'unknown',
            message: `Voz desconhecida. Use uma destas: ${AURA_SPEAKERS.join(', ')}.`,
          },
        ];
  },
};

const missions: Entity = {
  name: 'missions',
  target: 'mic_mission',
  table: 'mic_missions',
  pk: f('key', 'key'),
  numericPk: false,
  fields: [
    f('key', 'key'),
    f('title', 'title'),
    f('role', 'role'),
    f('goal', 'goal'),
    f('turns', 'turns', 'json'),
    f('sort', 'sort', 'int'),
  ],
  orderBy: 'sort, key',
  api: C.missions,
  inUse: [{ label: 'sessões do Mic', sql: 'SELECT COUNT(*) AS n FROM mic_sessions WHERE mission_key = ?' }],
};

export const ENTITIES: readonly Entity[] = [
  episodes,
  micPhrases,
  exercises,
  items,
  ebooks,
  testQuestions,
  extras,
  albums,
  tracks,
  assistants,
  missions,
];

/** Ids published to snapshot paths (extra/{id}.json) and award keys: ASCII word characters only. */
export const TEXT_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/;

// ---------- Row mapping ----------

export function fromRow(e: Entity, row: Record<string, unknown>): Item {
  const out: Item = {};
  for (const fd of e.fields) {
    const v = row[fd.col];
    switch (fd.kind) {
      case 'bool':
        out[fd.key] = v === 1 || v === true;
        break;
      case 'json':
      case 'jsonNull': {
        let parsed: unknown = fd.kind === 'json' ? [] : null;
        if (typeof v === 'string' && v !== '') {
          try {
            parsed = JSON.parse(v);
          } catch {
            // corrupt column: keep the fallback
          }
        }
        out[fd.key] = parsed;
        break;
      }
      default:
        out[fd.key] = v ?? null;
    }
  }
  return out;
}

export function toCol(fd: Field, value: unknown): string | number | null {
  if (value === undefined || value === null) return fd.kind === 'json' ? '[]' : null;
  switch (fd.kind) {
    case 'bool':
      return value ? 1 : 0;
    case 'json':
    case 'jsonNull':
      return JSON.stringify(value);
    default:
      return value as string | number;
  }
}

/** Media ids an item references, with the kinds each field accepts. */
export function mediaRefs(e: Entity, item: Item): { id: string; path: string; kinds: readonly MediaKind[] }[] {
  const out: { id: string; path: string; kinds: readonly MediaKind[] }[] = [];
  for (const fd of e.fields) {
    const v = item[fd.key];
    if (fd.kind === 'media' && typeof v === 'string' && v) out.push({ id: v, path: fd.key, kinds: fd.media ?? [] });
  }
  if (e.virtual) out.push(...e.virtual.media(item[e.virtual.key]));
  return out;
}
