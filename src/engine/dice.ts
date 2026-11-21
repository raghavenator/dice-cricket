import type { DismissalHow, Rng, Rolls } from './types';

export const rollDie = (rng: Rng): number => Math.min(6, Math.floor(rng() * 6) + 1);

/** Roll everything needed for one delivery. A 5 triggers a second "wicket check" roll. */
export function rollDice(rng: Rng): Rolls {
  const roll1 = rollDie(rng);
  const roll2 = roll1 === 5 ? rollDie(rng) : undefined;
  return { roll1, roll2, fielderIdx: Math.floor(rng() * 11) };
}

export interface Outcome {
  runs: number;
  wicket: boolean;
  how?: DismissalHow;
}

/**
 * The rules of Dice Cricket:
 *   1, 2, 3, 4, 6 → that many runs
 *   5 → roll again: 4 or more is OUT, 3 or less is a dot ball
 * The second roll also flavours the dismissal: 4 bowled, 5 caught, 6 lbw.
 */
export function resolveRolls(r: Pick<Rolls, 'roll1' | 'roll2'>): Outcome {
  if (r.roll1 !== 5) return { runs: r.roll1, wicket: false };
  if (r.roll2 === undefined) throw new Error('A 5 needs a wicket-check roll');
  if (r.roll2 <= 3) return { runs: 0, wicket: false };
  const how: DismissalHow = r.roll2 === 4 ? 'bowled' : r.roll2 === 5 ? 'caught' : 'lbw';
  return { runs: 0, wicket: true, how };
}
