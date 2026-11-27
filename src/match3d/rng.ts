/**
 * Seeded randomness for the 3D clips only (never for scoring).
 * The seed comes from state both online players share, so both see the same shot.
 */

/** FNV-1a 32-bit hash. */
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Seed for one ball: match id + innings index + the ball's index in that innings. */
export const seedFor = (matchId: string, inningsIdx: number, ballIdx: number): number =>
  hash(`${matchId}|${inningsIdx}|${ballIdx}`);

export type Rand = () => number;

/** mulberry32: small, fast, deterministic; returns [0, 1). */
export function mulberry32(seed: number): Rand {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const between = (r: Rand, a: number, b: number) => a + r() * (b - a);
export const pick = <T>(r: Rand, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)];
