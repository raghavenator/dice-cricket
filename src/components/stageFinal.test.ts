import { describe, expect, it } from 'vitest';
import { PRESET_TEAMS } from '../data/presets';
import { createMatch } from '../engine/match';
import { offlineFinal } from './stageFinal';

const [A, B] = PRESET_TEAMS;
const base = createMatch('m', A, B, { format: 'limited', overs: 5, bowlerMode: 'auto' }, () => 0.3);

describe('offlineFinal', () => {
  it('names the winner and the margin', () => {
    const m = { ...base, result: { kind: 'win' as const, winnerId: A.id, text: `${A.name} won by 10 wickets (11 balls left)` } };
    expect(offlineFinal(m)).toEqual({ title: `${A.name.toUpperCase()} WIN`, margin: 'by 10 wickets (11 balls left)', tone: 'won' });
  });

  it('handles ties, draws and unfinished matches', () => {
    expect(offlineFinal({ ...base, result: { kind: 'tie', text: 'Match tied' } })?.title).toBe('MATCH TIED');
    expect(offlineFinal({ ...base, result: { kind: 'draw', text: 'Match drawn' } })?.title).toBe('MATCH DRAWN');
    expect(offlineFinal(base)).toBeNull();
  });
});
