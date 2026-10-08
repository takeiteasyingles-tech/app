// Configuration rows the seed creates once (an admin owns them afterwards): plans, feature flags,
// app settings, AI prompts and the gamification tables (point rules, levels, badge rules).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DEFAULT_MODELS, DEFAULT_TERMS_VERSION, FLAGS, PLAN_FEATURES, SETTINGS } from '@tie/shared/constants';
import type { BadgeRowDb, LevelRowDb, PointRuleRowDb } from '@tie/shared/content/compile';
import { BadgeRule } from '@tie/shared/contracts/game';
import type { Extracted } from '../extract';
import { ids } from './ids';

export interface PlanRowDb {
  id: string;
  slug: string;
  name: string;
  ai_minutes_month: number;
  features: string;
  is_default: number;
  active: number;
  created_at: number;
  updated_at: number;
}
export interface FlagRowDb {
  key: string;
  enabled: number;
  rollout_pct: number;
  rules: string | null;
  updated_by: string | null;
  updated_at: number;
}
export interface SettingRowDb {
  key: string;
  value: string;
  updated_by: string | null;
  updated_at: number;
}
export interface PromptRowDb {
  key: string;
  template: string;
  version: number;
  updated_by: string | null;
  updated_at: number;
}

export interface SeedConfig {
  plans: PlanRowDb[];
  feature_flags: FlagRowDb[];
  app_settings: SettingRowDb[];
  ai_prompts: PromptRowDb[];
  point_rules: PointRuleRowDb[];
  levels: LevelRowDb[];
  badges: BadgeRowDb[];
}

/**
 * Prototype badge tests (game.js BADGES[].test) → rule JSON. Explicit on purpose: a new prototype
 * badge without a mapping fails the seed instead of silently never being awarded.
 */
export const BADGE_RULES: Record<string, BadgeRule> = {
  'first-step': { type: 'count', kind: 'step', min: 1 },
  'first-episode': { type: 'count', kind: 'episode', min: 1 },
  'first-talk': { type: 'count', kind: 'maggie_turn', min: 1 },
  'talk-10': { type: 'count', kind: 'maggie_turn', min: 10 },
  'mic-8': { type: 'count', kind: 'mic_good', min: 1 },
  cinema: { type: 'count', kind: 'extra', min: 1 },
  dub: { type: 'count', kind: 'dub', min: 1 },
  'cards-20': { type: 'count', kind: 'card', min: 20 },
  'streak-3': { type: 'streak', min: 3 },
  'streak-7': { type: 'streak', min: 7 },
  'pts-500': { type: 'points', min: 500 },
  test: { type: 'count', kind: 'test_pass', min: 1 },
  song: { type: 'count', kind: 'song', min: 1 },
  'goal-5': { type: 'goal_days', min: 5 },
};

/**
 * Client-attested kinds (POST /api/game/event) get a daily cap; everything else is verified by the
 * server (graded answers, unlocked steps, tutor turns...) and is idempotent through its award key.
 */
export const SOFT_CAPS: Record<string, number> = { song: 10, quiz_hit: 30, word: 20 };

/**
 * Server-verified kinds that still repeat many times a day get a cap too (spec 06): Mic turns and
 * sessions, and reviewed cards. Same numbers as the engine's SERVER_DAILY_CAPS (game/rules.ts).
 */
export const SERVER_CAPS: Record<string, number> = { maggie_turn: 100, maggie_session: 8, card: 100 };

export const PLAN_DEFS = [
  { slug: 'gratis', name: 'Grátis', minutes: 60, features: {}, isDefault: true },
  {
    slug: 'premium',
    name: 'Premium',
    minutes: 600,
    features: { [PLAN_FEATURES.premiumExtras]: true, [PLAN_FEATURES.hd]: true },
    isDefault: false,
  },
] as const;

/** ai_prompts.key → prompts/<file>. The report prompt lives in recap_system.md. */
export const PROMPT_FILES = {
  tutor_system: 'tutor_system.md',
  report_system: 'recap_system.md',
  guard: 'guard.md',
} as const;
const PROMPTS_DIR = fileURLToPath(new URL('../../prompts/', import.meta.url));

export function readPrompt(key: keyof typeof PROMPT_FILES): string {
  const text = readFileSync(PROMPTS_DIR + PROMPT_FILES[key], 'utf8')
    .replace(/\r\n/g, '\n')
    .trim();
  if (!text) throw new Error(`prompt ${key} is empty`);
  return text;
}

export function buildConfig(X: Extracted, now: number): SeedConfig {
  const badges: BadgeRowDb[] = X.BADGES.map((bd, i) => {
    const rule = BADGE_RULES[bd.id];
    if (!rule) throw new Error(`badge "${bd.id}" has no rule mapping (seed/src/transform/config.ts BADGE_RULES)`);
    BadgeRule.parse(rule);
    return { id: bd.id, title: bd.t, sub: bd.s, icon: bd.icon, rule: JSON.stringify(rule), sort: i };
  });
  const point_rules: PointRuleRowDb[] = Object.entries(X.POINTS).map(([kind, points]) => ({
    kind,
    points,
    daily_cap: SOFT_CAPS[kind] ?? SERVER_CAPS[kind] ?? null,
    verifiable: kind in SOFT_CAPS ? 0 : 1,
  }));
  const levels: LevelRowDb[] = X.LEVELS.map(([min, name], i) => ({ n: i + 1, min_points: min, name }));

  const plans: PlanRowDb[] = PLAN_DEFS.map((p) => ({
    id: ids.plan(p.slug),
    slug: p.slug,
    name: p.name,
    ai_minutes_month: p.minutes,
    features: JSON.stringify(p.features),
    is_default: p.isDefault ? 1 : 0,
    active: 1,
    created_at: now,
    updated_at: now,
  }));

  const flag = (key: string, enabled: boolean): FlagRowDb => ({
    key,
    enabled: enabled ? 1 : 0,
    rollout_pct: 100,
    rules: null,
    updated_by: null,
    updated_at: now,
  });
  const feature_flags = [flag(FLAGS.aiEnabled, true), flag(FLAGS.freeSteps, false), flag(FLAGS.storeRecordings, false)];

  const setting = (key: string, value: string): SettingRowDb => ({ key, value, updated_by: null, updated_at: now });
  const app_settings = [
    setting(SETTINGS.modelTutor, DEFAULT_MODELS.tutor),
    setting(SETTINGS.modelTutorFallback, DEFAULT_MODELS.tutorFallback),
    setting(SETTINGS.modelAsr, DEFAULT_MODELS.asr),
    setting(SETTINGS.modelTts, DEFAULT_MODELS.tts),
    setting(SETTINGS.modelGuard, DEFAULT_MODELS.guard),
    setting(SETTINGS.retentionTranscriptsDays, '180'),
    setting(SETTINGS.termsVersion, DEFAULT_TERMS_VERSION),
  ];

  const ai_prompts: PromptRowDb[] = (Object.keys(PROMPT_FILES) as (keyof typeof PROMPT_FILES)[]).map((key) => ({
    key,
    template: readPrompt(key),
    version: 1,
    updated_by: null,
    updated_at: now,
  }));

  return { plans, feature_flags, app_settings, ai_prompts, point_rules, levels, badges };
}
