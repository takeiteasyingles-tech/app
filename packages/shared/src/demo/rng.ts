/** A Math.random-compatible source in [0, 1); inject a seeded one for deterministic output. */
export type Rng = () => number;

/** TIE.u.pick. */
export function pick<T>(arr: readonly T[], rng: Rng = Math.random): T {
  const v = arr[Math.floor(rng() * arr.length)];
  if (v === undefined) throw new Error('pick from an empty list');
  return v;
}

/** mulberry32: small seeded PRNG for tests and reproducible demo replies. */
export function seededRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
