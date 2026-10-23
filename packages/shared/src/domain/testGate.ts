/** A completed episode means all ten steps, recorded by the progress service. */
export function testGate(
  defaults: readonly number[],
  done: Readonly<Record<string, boolean>>,
  required: readonly number[] = [],
  minCompleted: number | null = null,
  enabled = true,
  published?: readonly number[],
) {
  const available = published ? new Set(published) : null;
  const episodes = [...new Set(required.length ? required : defaults.filter((n) => !available || available.has(n)))];
  const minimum = minCompleted ?? episodes.length;
  const completed = episodes.filter((n) => done[String(n)] === true && (!available || available.has(n))).length;
  return {
    episodes,
    minimum,
    completed,
    remaining: Math.max(0, minimum - completed),
    unlocked: enabled && episodes.length > 0 && minimum > 0 && completed >= minimum,
  };
}
