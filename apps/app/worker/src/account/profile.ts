// profiles / user_settings rows <-> the TieState Profile, Draft and Settings shapes (spec 04 §2, state.ts).
import {
  ApiError,
  DEFAULT_ASSISTANT,
  type Draft,
  FullName,
  freshDraft,
  MEDIA_PREFIX,
  type Profile,
  type ProfilePatch,
  type Settings,
  type SettingsPatch,
  ShortName,
  VoiceTest,
} from '@tie/shared';
import { type Bind, bool, fromJson, toJson, zodIssues } from '@tie/worker-core';
import { z } from 'zod';
import { checkBirth } from './common';

export interface ProfileRow {
  user_id: string;
  full_name: string | null;
  name: string | null;
  birth: string | null;
  age_band: string | null;
  occupation: string | null;
  area: string | null;
  level_key: string;
  goals: string;
  deadline: string | null;
  history: string;
  fails: string;
  formats: string;
  genres: string;
  themes: string;
  diffs: string;
  main_diff: string | null;
  styles: string;
  company: string | null;
  feedback: string | null;
  days: string;
  minutes: number;
  reminders: string;
  motives: string;
  why: string | null;
  assistant_key: string | null;
  avatar: number;
  photo_upload: string | null;
  voice: string | null;
  onb_step: number;
  onb_completed_at: number | null;
  updated_at: number;
  /** r2_key of the active photo upload (LEFT JOIN uploads), null when none or removed. */
  photo_key: string | null;
}

/** SELECT list for ProfileRow; the caller aliases profiles as p and LEFT JOINs uploads as up. */
export const PROFILE_SELECT = `SELECT p.*, up.r2_key AS photo_key FROM profiles p
  LEFT JOIN uploads up ON up.id = p.photo_upload AND up.status = 'active' AND up.user_id = p.user_id`;

export interface SettingsRow {
  ts: number;
  sound: number;
  hd: number;
  trans: number;
  slow: number;
  remind: number;
  fx: number;
  free: number;
}

const DRAFT_DEFAULTS = freshDraft();

function strArray(text: string | null | undefined): string[] {
  const v = fromJson<unknown>(text, []);
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

function intArray(text: string | null | undefined, fallback: number[]): number[] {
  const v = fromJson<unknown>(text, fallback);
  return Array.isArray(v) ? v.filter((x): x is number => Number.isInteger(x)) : fallback;
}

function voiceOf(text: string | null | undefined): Profile['voice'] {
  if (!text) return null;
  const parsed = VoiceTest.safeParse(fromJson<unknown>(text, null));
  return parsed.success ? parsed.data : null;
}

/** /m/<r2 key>, the owner-visible URL of an upload. */
export const uploadUrl = (r2Key: string): string => MEDIA_PREFIX + r2Key;

export function profileFromRow(r: ProfileRow): Profile {
  const birth = r.birth && /^\d{4}-\d{2}-\d{2}$/.test(r.birth) ? r.birth : '';
  const avatar = Number.isInteger(r.avatar) && r.avatar >= 1 && r.avatar <= 6 ? r.avatar : 1;
  return {
    name: r.name ?? '',
    fullName: r.full_name ?? '',
    birth,
    age: r.age_band ?? '',
    occup: r.occupation ?? '',
    area: r.area ?? '',
    level: r.level_key || 'zero',
    goals: strArray(r.goals),
    deadline: r.deadline ?? '',
    history: strArray(r.history),
    fails: strArray(r.fails),
    formats: strArray(r.formats),
    genres: strArray(r.genres),
    themes: strArray(r.themes),
    diffs: strArray(r.diffs),
    mainDiff: r.main_diff ?? '',
    styles: strArray(r.styles),
    company: r.company ?? DRAFT_DEFAULTS.company,
    feedback: r.feedback ?? DRAFT_DEFAULTS.feedback,
    days: intArray(r.days, DRAFT_DEFAULTS.days),
    minutes: Number.isInteger(r.minutes) && r.minutes >= 5 ? Math.min(r.minutes, 240) : DRAFT_DEFAULTS.minutes,
    reminders: strArray(r.reminders),
    motives: strArray(r.motives),
    why: r.why ?? '',
    assistant: r.assistant_key ?? DEFAULT_ASSISTANT,
    avatar,
    photo: r.photo_key ? uploadUrl(r.photo_key) : null,
    voice: voiceOf(r.voice),
  };
}

/** Draft (cadastro answers) from the in-progress profile row. */
export function draftFromRow(r: ProfileRow | null, email: string): Draft {
  if (!r) return { ...freshDraft(), email };
  const p = profileFromRow(r);
  return {
    fullName: p.fullName,
    name: p.name,
    birth: p.birth,
    email,
    goals: p.goals,
    formats: p.formats,
    genres: p.genres,
    themes: p.themes,
    diffs: p.diffs,
    mainDiff: p.mainDiff,
    styles: p.styles,
    company: p.company,
    feedback: p.feedback,
    days: p.days,
    minutes: p.minutes,
    reminders: p.reminders.length ? p.reminders : DRAFT_DEFAULTS.reminders,
    voice: p.voice,
  };
}

const TEXT_SIZES = [1, 1.12, 1.25] as const;

/** `free` is passed in already evaluated (stored opt-in AND the dev.free_steps flag). */
export function settingsFromRow(r: SettingsRow | null | undefined, free: boolean): Settings {
  const ts = TEXT_SIZES.find((t) => Math.abs(t - (r?.ts ?? 1)) < 0.001) ?? 1;
  return {
    ts,
    sound: r ? bool(r.sound) : true,
    hd: r ? bool(r.hd) : false,
    trans: r ? bool(r.trans) : true,
    slow: r ? bool(r.slow) : false,
    remind: r ? bool(r.remind) : true,
    phone: false,
    fx: r ? bool(r.fx) : true,
    free,
  };
}

type PatchKey = Exclude<keyof ProfilePatch, 'onbStep'>;
type ColKind = 'text' | 'json' | 'int';

/** Profile field → profiles column. Column names are fixed literals, never user input. */
const PROFILE_COLUMNS: Record<PatchKey, readonly [string, ColKind]> = {
  name: ['name', 'text'],
  fullName: ['full_name', 'text'],
  birth: ['birth', 'text'],
  age: ['age_band', 'text'],
  occup: ['occupation', 'text'],
  area: ['area', 'text'],
  level: ['level_key', 'text'],
  goals: ['goals', 'json'],
  deadline: ['deadline', 'text'],
  history: ['history', 'json'],
  fails: ['fails', 'json'],
  formats: ['formats', 'json'],
  genres: ['genres', 'json'],
  themes: ['themes', 'json'],
  diffs: ['diffs', 'json'],
  mainDiff: ['main_diff', 'text'],
  styles: ['styles', 'json'],
  company: ['company', 'text'],
  feedback: ['feedback', 'text'],
  days: ['days', 'json'],
  minutes: ['minutes', 'int'],
  reminders: ['reminders', 'json'],
  motives: ['motives', 'json'],
  why: ['why', 'text'],
  assistant: ['assistant_key', 'text'],
  avatar: ['avatar', 'int'],
  voice: ['voice', 'json'],
};

/** name/fullName in a profile patch follow the signup rules (no blank names, nome + sobrenome). */
const NamePatch = z.object({ name: ShortName.optional(), fullName: FullName.optional() });

/**
 * Server-side rules on top of the ProfilePatch contract (which is the loose TieState Profile shape):
 * - `age` (the age band) is never taken from the client; it is derived from `birth`;
 * - `birth` cannot be cleared (signup always sets it) and must give an age of 5..110;
 * - `name` / `fullName` are validated (and trimmed) like at signup, so SessionUser.name never goes blank.
 */
export function sanitizeProfilePatch(patch: ProfilePatch, today: string): ProfilePatch {
  const { age: _clientAge, ...out } = patch;
  const names = NamePatch.safeParse({ name: patch.name, fullName: patch.fullName });
  if (!names.success) throw new ApiError('validation_failed', undefined, { issues: zodIssues(names.error) });
  if (names.data.name !== undefined) out.name = names.data.name;
  if (names.data.fullName !== undefined) out.fullName = names.data.fullName;
  if (patch.birth !== undefined) {
    if (patch.birth.trim() === '') {
      throw new ApiError('validation_failed', 'Confira a data de nascimento.', {
        issues: [{ path: 'birth', code: 'required', message: 'A data de nascimento não pode ficar em branco.' }],
      });
    }
    return { ...out, birth: patch.birth, age: checkBirth(patch.birth, today) };
  }
  return out;
}

/** SET fragments and binds for a validated ProfilePatch (onbStep handled by the caller). */
export function profileSet(patch: ProfilePatch): { sets: string[]; binds: Bind[] } {
  const sets: string[] = [];
  const binds: Bind[] = [];
  for (const key of Object.keys(PROFILE_COLUMNS) as PatchKey[]) {
    const value = patch[key];
    if (value === undefined) continue;
    const [col, kind] = PROFILE_COLUMNS[key];
    sets.push(`${col} = ?`);
    if (kind === 'json') binds.push(value === null ? null : toJson(value));
    else if (kind === 'text') binds.push(value === '' && key === 'birth' ? null : (value as string));
    else binds.push(value as number);
  }
  return { sets, binds };
}

const SETTINGS_COLUMNS = [
  'ts',
  'sound',
  'hd',
  'trans',
  'slow',
  'remind',
  'fx',
] as const satisfies readonly (keyof SettingsPatch)[];

export function settingsSet(patch: SettingsPatch & { free?: boolean }): { sets: string[]; binds: Bind[] } {
  const sets: string[] = [];
  const binds: Bind[] = [];
  for (const key of SETTINGS_COLUMNS) {
    const value = patch[key];
    if (value === undefined) continue;
    sets.push(`${key} = ?`);
    binds.push(value);
  }
  if (patch.free !== undefined) {
    sets.push('free = ?');
    binds.push(patch.free);
  }
  return { sets, binds };
}
