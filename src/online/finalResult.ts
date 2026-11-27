import type { Result } from '../engine/types';

export interface FinalResult {
  title: string;
  margin: string;
  tone: 'won' | 'lost' | 'tie';
}

/** The big end-of-match message for one player: "YOU WON" / "YOU LOST" and the margin. */
export function finalResult(r: Result, ownerId: string): FinalResult {
  if (r.kind !== 'win') return { title: r.kind === 'tie' ? 'MATCH TIED' : 'DRAW', margin: '', tone: 'tie' };
  const won = !!r.winnerId?.startsWith(`${ownerId}/`);
  const m = / won (.+)$/.exec(r.text);
  return { title: won ? 'YOU WON' : 'YOU LOST', margin: m ? m[1] : r.text, tone: won ? 'won' : 'lost' };
}
