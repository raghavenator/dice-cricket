import type { MatchState } from '../engine/types';

export interface StageFinal {
  title: string;
  margin: string;
  tone: 'won' | 'lost' | 'tie';
}

/** The end-of-match message over the 3D field for the offline game: who won, and by how much. */
export function offlineFinal(m: MatchState): StageFinal | null {
  const r = m.result;
  if (!r) return null;
  if (r.kind !== 'win') return { title: r.kind === 'tie' ? 'MATCH TIED' : 'MATCH DRAWN', margin: '', tone: 'tie' };
  const winner = m.teams.find((t) => t.id === r.winnerId);
  const by = / won (.+)$/.exec(r.text);
  return { title: `${(winner?.name ?? 'Winners').toUpperCase()} WIN`, margin: by ? by[1] : r.text, tone: 'won' };
}
