import { describe, expect, it } from 'vitest';
import { finalResult } from './finalResult';

describe('finalResult', () => {
  const r = { kind: 'win' as const, winnerId: 'me-123/haw', text: 'Harbour Hawks won by 10 wickets (11 balls left)' };

  it('tells the winner they won, with the margin', () => {
    expect(finalResult(r, 'me-123')).toEqual({ title: 'YOU WON', margin: 'by 10 wickets (11 balls left)', tone: 'won' });
  });

  it('tells the other player they lost, with the same margin', () => {
    expect(finalResult(r, 'them-456')).toEqual({ title: 'YOU LOST', margin: 'by 10 wickets (11 balls left)', tone: 'lost' });
  });

  it('handles ties and forfeits', () => {
    expect(finalResult({ kind: 'tie', text: 'Match tied' }, 'me-123')).toMatchObject({ title: 'MATCH TIED', tone: 'tie' });
    expect(finalResult({ kind: 'win', winnerId: 'me-123/haw', text: 'Harbour Hawks won by forfeit' }, 'me-123').margin).toBe('by forfeit');
  });
});
