// Three-way merge of an episode's lesson voices (PROD 0016, episodes.voices). Saves merge against the
// server's current value, so an edit made meanwhile (another tab, the MCP agent) to a voice this
// editor did not touch survives.

import type { EpisodeVoices } from '@tie/shared/content/schema';

type Voices = EpisodeVoices;

function flatten(v: unknown): Map<string, string> {
  const out = new Map<string, string>();
  if (!v || typeof v !== 'object') return out;
  const o = v as Voices;
  if (o.narrator) out.set('narrator', o.narrator);
  for (const [k, id] of Object.entries(o.steps ?? {})) if (id) out.set(`steps.${k}`, id);
  for (const [k, id] of Object.entries(o.cast ?? {})) if (id) out.set(`cast.${k}`, id);
  if (o.extras?.narrator) out.set('extras.narrator', o.extras.narrator);
  for (const [k, id] of Object.entries(o.extras?.cast ?? {})) if (id) out.set(`extras.cast.${k}`, id);
  return out;
}

function unflatten(m: Map<string, string>): Voices {
  const out: Voices = {};
  const steps: Record<string, string> = {};
  const cast: Record<string, string> = {};
  const extrasCast: Record<string, string> = {};
  let extrasNarrator: string | undefined;
  for (const [k, id] of m) {
    if (k === 'narrator') out.narrator = id;
    else if (k === 'extras.narrator') extrasNarrator = id;
    else if (k.startsWith('steps.')) steps[k.slice(6)] = id;
    else if (k.startsWith('extras.cast.')) extrasCast[k.slice(12)] = id;
    else if (k.startsWith('cast.')) cast[k.slice(5)] = id;
  }
  if (Object.keys(steps).length) out.steps = steps;
  if (Object.keys(cast).length) out.cast = cast;
  if (extrasNarrator || Object.keys(extrasCast).length) {
    out.extras = {
      ...(extrasNarrator ? { narrator: extrasNarrator } : {}),
      ...(Object.keys(extrasCast).length ? { cast: extrasCast } : {}),
    };
  }
  return out;
}

/** `server` plus what changed from `base` to `draft` (a cleared entry is removed). */
export function mergeEpisodeVoices(server: unknown, base: unknown, draft: unknown): Voices {
  const out = flatten(server);
  const b = flatten(base);
  const d = flatten(draft);
  for (const k of new Set([...b.keys(), ...d.keys()])) {
    const was = b.get(k);
    const now = d.get(k);
    if (was === now) continue;
    if (now) out.set(k, now);
    else out.delete(k);
  }
  return unflatten(out);
}
