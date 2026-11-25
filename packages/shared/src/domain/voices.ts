// PROD (spec 05 "Lesson voices"): an episode's voices are one JSON object edited from several places (each
// tab of the episode editor, Take Some Extras → Vozes, MCP agents). A save sends the whole object, so a
// screen opened before someone else's save would put back what it loaded and wipe their voices. mergeVoices
// applies only what this screen changed (draft vs the base it loaded) on top of the latest saved object.
import type { EpisodeVoices } from '../content/schema';

type Flat = Map<string, string>;

/** "narrator", "steps.3", "cast.Zach", "extras.narrator", "extras.cast.Margaret" → voice id. */
function flatten(v: EpisodeVoices | null | undefined): Flat {
  const out: Flat = new Map();
  if (!v || typeof v !== 'object') return out;
  if (v.narrator) out.set('narrator', v.narrator);
  for (const [k, id] of Object.entries(v.steps ?? {})) if (id) out.set(`steps.${k}`, id);
  for (const [k, id] of Object.entries(v.cast ?? {})) if (id) out.set(`cast.${k}`, id);
  if (v.extras?.narrator) out.set('extras.narrator', v.extras.narrator);
  for (const [k, id] of Object.entries(v.extras?.cast ?? {})) if (id) out.set(`extras.cast.${k}`, id);
  return out;
}

function unflatten(f: Flat): EpisodeVoices {
  const out: EpisodeVoices = {};
  const steps: Record<string, string> = {};
  const cast: Record<string, string> = {};
  const extrasCast: Record<string, string> = {};
  let extrasNarrator: string | undefined;
  for (const [path, id] of f) {
    if (path === 'narrator') out.narrator = id;
    else if (path === 'extras.narrator') extrasNarrator = id;
    else if (path.startsWith('steps.')) steps[path.slice(6)] = id;
    else if (path.startsWith('extras.cast.')) extrasCast[path.slice(12)] = id;
    else if (path.startsWith('cast.')) cast[path.slice(5)] = id;
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

/** The latest saved voices with only this screen's changes (draft vs base) applied; empty entries dropped. */
export function mergeVoices(
  latest: EpisodeVoices | null | undefined,
  base: EpisodeVoices | null | undefined,
  draft: EpisodeVoices | null | undefined,
): EpisodeVoices {
  const out = flatten(latest);
  const b = flatten(base);
  const d = flatten(draft);
  for (const path of new Set([...b.keys(), ...d.keys()])) {
    const was = b.get(path);
    const now = d.get(path);
    if (was === now) continue;
    if (now) out.set(path, now);
    else out.delete(path);
  }
  return unflatten(out);
}

/** Whether two voices objects hold the same voices (order and empty entries ignored). */
export function sameVoices(a: EpisodeVoices | null | undefined, b: EpisodeVoices | null | undefined): boolean {
  const x = flatten(a);
  const y = flatten(b);
  return x.size === y.size && [...x].every(([k, v]) => y.get(k) === v);
}
