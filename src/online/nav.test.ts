import { describe, expect, it } from 'vitest';
import { parseRoute } from './nav';

describe('parseRoute', () => {
  it('reads the online menu pages', () => {
    expect(parseRoute('')).toEqual({ name: 'home' });
    expect(parseRoute('#/private')).toEqual({ name: 'private' });
    expect(parseRoute('#/open')).toEqual({ name: 'open' });
    expect(parseRoute('#/stats')).toEqual({ name: 'stats' });
  });

  it('still reads rooms, players and matches', () => {
    expect(parseRoute('#/join/K7M4QP')).toEqual({ name: 'join', code: 'K7M4QP' });
    expect(parseRoute('#/stats/player/a%20b')).toEqual({ name: 'player', id: 'a b' });
    expect(parseRoute('#/stats/match/m1')).toEqual({ name: 'match', id: 'm1' });
    expect(parseRoute('#/nowhere')).toEqual({ name: 'home' });
  });
});
