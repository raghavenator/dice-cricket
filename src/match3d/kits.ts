/** Shirt colours for the two sides: each team's own colour, unless they are too alike to tell apart. */
export interface Kits {
  batting: string;
  fielding: string;
}

export const DEFAULT_KITS: Kits = { batting: '#2e47b8', fielding: '#2b7a3e' };

function rgb(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/i.exec(hex.trim());
  if (!m) return null;
  const h = m[1].length === 3 ? m[1].replace(/./g, (c) => c + c) : m[1];
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
}

/** Rough perceptual distance between two colours (weighted RGB, 0..~765). */
export function colourDistance(a: string, b: string): number {
  const x = rgb(a);
  const y = rgb(b);
  if (!x || !y) return 0;
  const rm = (x[0] + y[0]) / 2;
  const [dr, dg, db] = [x[0] - y[0], x[1] - y[1], x[2] - y[2]];
  return Math.sqrt((2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db);
}

const TOO_CLOSE = 160;

export function kitsFor(battingColor: string | undefined, fieldingColor: string | undefined): Kits {
  if (!battingColor || !fieldingColor || !rgb(battingColor) || !rgb(fieldingColor)) return DEFAULT_KITS;
  if (colourDistance(battingColor, fieldingColor) < TOO_CLOSE) return DEFAULT_KITS;
  return { batting: battingColor, fielding: fieldingColor };
}
