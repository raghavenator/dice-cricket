import { CREATE_WINDOW_MS, CreateLimit, EXPIRE_MS, LobbyBook, MAX_LISTED, RESERVE_MS, type Listing } from './lobby';

const room = (code: string, ownerId: string, since: number, kind: 'open' | 'quick' = 'quick'): Listing => ({
  code, kind, ownerId, nickname: ownerId.toLowerCase(), overs: 5, since,
});

/** A book with these rooms waiting, all just heard from. */
function book(now: number, ...rooms: Listing[]) {
  const b = new LobbyBook();
  for (const r of rooms) b.announce(r.code, r, now);
  return b;
}

describe('open rooms', () => {
  it('are listed newest first, without your own, quick rooms, or anyone\'s id', () => {
    const b = book(100, room('AAA', 'ANN', 1, 'open'), room('BBB', 'BOB', 3, 'open'), room('CCC', 'CAT', 2), room('DDD', 'ME', 4, 'open'));
    expect(b.openRooms('ME', 100)).toEqual([
      { code: 'BBB', nickname: 'bob', overs: 5, since: 3 },
      { code: 'AAA', nickname: 'ann', overs: 5, since: 1 },
    ]);
  });

  it('come off when they say so, or go quiet', () => {
    const b = book(100, room('AAA', 'ANN', 1, 'open'), room('BBB', 'BOB', 2, 'open'));
    b.announce('AAA', null, 200);
    expect(b.openRooms('ME', 200).map((r) => r.code)).toEqual(['BBB']);
    expect(b.openRooms('ME', 100 + EXPIRE_MS)).toEqual([]);
    expect(b.prune(100 + EXPIRE_MS)).toEqual(['BBB']);
    expect(b.entries.size).toBe(0);
  });

  it('stay on while they keep saying so', () => {
    const b = book(100, room('AAA', 'ANN', 1, 'open'));
    b.announce('AAA', room('AAA', 'ANN', 1, 'open'), 60_000);
    expect(b.prune(100 + EXPIRE_MS)).toEqual([]);
  });

  it('ignore messages that arrive late', () => {
    const b = book(100);
    const waiting = room('AAA', 'ANN', 1, 'open');
    // "No longer waiting" overtakes "waiting".
    b.announce('AAA', null, 200, 105);
    expect(b.announce('AAA', waiting, 201, 104)).toBeNull();
    expect(b.openRooms('ME', 201)).toEqual([]);
    // Waiting again later, then an old "no longer waiting" turns up.
    b.announce('AAA', waiting, 300, 110);
    expect(b.announce('AAA', null, 301, 107)).not.toBeNull();
    expect(b.openRooms('ME', 301)).toHaveLength(1);
    // The lobby's own early listing of a quick room never overrides the room itself.
    b.announce('BBB', null, 300, 120);
    expect(b.announce('BBB', room('BBB', 'BOB', 1), 301, 0)).toBeNull();
    expect(b.pair('ME', 301, null)).toBeNull();
  });

  it('forget ended rooms in time', () => {
    const b = book(100);
    b.announce('AAA', null, 100, 100);
    b.prune(100 + 2 * EXPIRE_MS);
    expect(b.announce('AAA', room('AAA', 'ANN', 1, 'open'), 1e6, 50)).not.toBeNull();
  });

  it('are limited in number', () => {
    const b = book(1, ...Array.from({ length: 80 }, (_, i) => room(`R${i}`, `P${i}`, i, 'open')));
    expect(b.openRooms('ME', 1)).toHaveLength(MAX_LISTED);
  });
});

describe('quick match', () => {
  it('starts a new room when nobody is waiting', () => {
    expect(book(1).pair('ME', 1, null)).toBeNull();
    expect(book(1, room('AAA', 'ANN', 1, 'open')).pair('ME', 1, null)).toBeNull();
  });

  it('joins whoever has waited longest, and sends nobody else there', () => {
    const b = book(100, room('BBB', 'BOB', 20), room('AAA', 'ANN', 10));
    expect(b.pair('ME', 100, null)).toBe('AAA');
    expect(b.pair('YOU', 100, null)).toBe('BBB');
    expect(b.pair('THEM', 100, null)).toBeNull();
    // Nobody arrived, so the room becomes available again.
    expect(b.pair('THEM', 100 + RESERVE_MS, null)).toBe('AAA');
  });

  it('never matches you with yourself, and takes you back to your own room', () => {
    const b = book(100, room('AAA', 'ME', 10));
    expect(b.pair('ME', 100, null)).toBe('AAA');
    expect(b.pair('ME', 100, 'AAA')).toBe('AAA');
  });

  it('brings the later of two waiting players to the earlier, never both', () => {
    const b = book(100, room('AAA', 'ANN', 10), room('BBB', 'BOB', 20));
    expect(b.pair('ANN', 100, 'AAA')).toBe('AAA');
    expect(b.pair('BOB', 100, 'BBB')).toBe('AAA');
    expect(b.entries.has('BBB')).toBe(false);
    expect(b.pair('ANN', 101, 'AAA')).toBe('AAA');
  });

  it('settles ties the same way for both', () => {
    for (const first of ['ANN', 'BOB']) {
      const b = book(100, room('AAA', 'ANN', 10), room('BBB', 'BOB', 10));
      const ann = () => b.pair('ANN', 100, 'AAA');
      const bob = () => b.pair('BOB', 100, 'BBB');
      const got = first === 'ANN' ? [ann(), bob()] : [bob(), ann()].reverse();
      expect(got).toEqual(['AAA', 'AAA']);
    }
  });

  it('does not move someone whose opponent is on the way', () => {
    const b = book(100, room('BBB', 'BOB', 20));
    expect(b.pair('CAT', 100, null)).toBe('BBB');
    b.announce('AAA', room('AAA', 'ANN', 10), 100);
    expect(b.pair('BOB', 101, 'BBB')).toBe('BBB');
  });

  it('does not move someone who has just been joined', () => {
    const b = book(100, room('AAA', 'ANN', 10));
    expect(b.pair('BOB', 100, 'BBB')).toBe('BBB');
    expect(b.entries.has('AAA')).toBe(true);
    expect(b.pair('CAT', 100, null)).toBe('AAA');
  });

  it('keeps a reservation when the room repeats itself', () => {
    const b = book(100, room('AAA', 'ANN', 10));
    expect(b.pair('BOB', 100, null)).toBe('AAA');
    b.announce('AAA', room('AAA', 'ANN', 10), 101);
    expect(b.pair('CAT', 102, null)).toBeNull();
  });

  it('pairs everyone off in the end, whatever order they ask in', () => {
    for (let seed = 1; seed <= 300; seed++) {
      let x = seed;
      const rnd = (n: number) => ((x = (x * 1103515245 + 12345) & 0x7fffffff) >> 8) % n;
      const players = Array.from({ length: 2 + rnd(6) }, (_, i) => `P${i}`);
      const b = new LobbyBook();
      const at = new Map<string, string>(); // player → room they are in
      const sitting = new Map<string, string[]>(); // room → players
      let now = 1000;
      let made = 0;
      for (let step = 0; step < 400; step++) {
        now += rnd(3000);
        const p = players[rnd(players.length)];
        const cur = at.get(p) ?? null;
        if (cur && sitting.get(cur)!.length === 2) continue; // playing
        for (const [code, ps] of sitting) if (ps.length === 1) b.announce(code, room(code, ps[0], made), now);
        let code = b.pair(p, now, cur);
        if (!code) {
          code = `R${made++}`;
          b.announce(code, room(code, p, now), now);
        }
        if (code === cur) continue;
        if (cur) {
          sitting.set(cur, []);
          b.announce(cur, null, now);
        }
        const there = sitting.get(code) ?? [];
        expect(there.length).toBeLessThan(2);
        expect(there).not.toContain(p);
        there.push(p);
        sitting.set(code, there);
        at.set(p, code);
        if (there.length === 2) b.announce(code, null, now);
      }
      const alone = [...sitting.values()].filter((ps) => ps.length === 1).length;
      expect(alone).toBe(players.length % 2);
    }
  });
});

describe('limit on new rooms', () => {
  it('is exact, per person, and wears off', () => {
    const l = new CreateLimit(3);
    expect([1, 2, 3, 4].map((t) => l.allow('a', t))).toEqual([true, true, true, false]);
    expect(l.allow('b', 4)).toBe(true);
    expect(l.allow('a', 1 + CREATE_WINDOW_MS)).toBe(true);
    expect(l.allow('a', 1 + CREATE_WINDOW_MS)).toBe(false);
  });
});
