import type { Ball, DismissalHow } from '../engine/types';

/** Which 3D clip a ball plays. One-to-one with the engine's result for that ball. */
export type ClipKind = 'ground' | 'four' | 'six' | 'bowled' | 'caught' | 'lbw' | 'survive';

export interface Outcome {
  kind: ClipKind;
  runs: number;
  /** A 5 was rolled, so there was a wicket check (second die). */
  check: boolean;
  how?: DismissalHow;
  /** Caught by the bowler ("c & b"). */
  cAndB: boolean;
}

/**
 * Map the engine's Ball to a clip. Uses the structured result (runs, wicket, how), never commentary text.
 * Dot balls only happen when a wicket check is survived (roll1 5, roll2 3 or less).
 */
export function outcomeOf(b: Pick<Ball, 'roll1' | 'roll2' | 'runs' | 'wicket' | 'how' | 'fielderId' | 'bowlerId'>): Outcome {
  const check = b.roll1 === 5;
  const base = { runs: b.runs, check, cAndB: false };
  if (b.wicket) {
    if (!b.how) throw new Error('A wicket needs a dismissal type');
    return { ...base, kind: b.how, how: b.how, cAndB: b.how === 'caught' && b.fielderId === b.bowlerId };
  }
  if (check) return { ...base, kind: 'survive' };
  if (b.runs === 4) return { ...base, kind: 'four' };
  if (b.runs === 6) return { ...base, kind: 'six' };
  if (b.runs >= 1 && b.runs <= 3) return { ...base, kind: 'ground' };
  throw new Error(`No clip for a ball of ${b.runs} runs`);
}
