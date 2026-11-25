import { PRESET_TEAMS } from '../data/presets';
import { rollDice } from '../engine/dice';
import { applyBall, bowlerOptions, currentInnings, getTeam, needsBowler, pickAutoBowler, setBowler } from '../engine/match';
import { aggregate, battingCard } from '../engine/stats';
import type { MatchState, Rng, Rolls } from '../engine/types';
import { applyLineup, autoPlan, defaultLineup, lineupProblem, minBowlers, onlineSettings, parseLineup, planProblem } from './lineup';
import { chooseNextBatter, createOnlineMatch, nextBatterOptions, ownedId, splitOwnedId, type Side } from './rules';
import { MAX_OVERS, OnlineError, parseNickname, parseSettings, parseTeam } from './validate';

const [hawks, rhinos] = PRESET_TEAMS;

function seeded(seed: number): Rng {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const side = (ownerId: string, nickname: string, team = hawks): Side => ({ ownerId, nickname, team });

const newMatch = (overs = 5, host = side('AAA', 'Raj'), guest = side('BBB', 'Sam', rhinos)) =>
  createOnlineMatch('m1', host, guest, onlineSettings(overs), { winnerId: host.ownerId, choice: 'bat' }, 1000);

const WICKET: Rolls = { roll1: 5, roll2: 4, fielderIdx: 0 };
const run = (n: number): Rolls => ({ roll1: n, fielderIdx: 0 });

function bowl(m: MatchState, rolls: Rolls): MatchState {
  if (needsBowler(m)) m = setBowler(m, pickAutoBowler(m));
  return applyBall(m, rolls);
}

describe('validation', () => {
  it('accepts every sample team and drops unknown keys', () => {
    for (const t of PRESET_TEAMS) expect(parseTeam({ ...t, extra: 1 })).toEqual(t);
  });

  it('rejects bad teams', () => {
    const bad: unknown[] = [
      null,
      [],
      'team',
      { ...hawks, players: hawks.players.slice(1) },
      { ...hawks, players: [...hawks.players, { ...hawks.players[0], id: 'x' }] },
      { ...hawks, players: hawks.players.map((p) => ({ ...p, id: 'same' })) },
      { ...hawks, color: 'red;background:url(x)' },
      { ...hawks, name: '   ' },
      { ...hawks, name: 'x'.repeat(41) },
      { ...hawks, name: 'evil‮txet' },
      { ...hawks, short: 'TOOLONG' },
      { ...hawks, id: 'other/p-hawks' },
    ];
    for (const t of bad) expect(() => parseTeam(t)).toThrow(OnlineError);
  });

  it('allows joiners used by Indic scripts', () => {
    expect(parseNickname(' क्‍ष ')).toBe('क्‍ष');
    expect(() => parseNickname('a\nb')).toThrow(OnlineError);
  });

  it('forces limited overs with manual bowlers', () => {
    expect(parseSettings({ overs: 7, format: 'test', bowlerMode: 'auto' })).toEqual(onlineSettings(7));
    for (const overs of [0, 21, 2.5, NaN, '5', undefined]) expect(() => parseSettings({ overs })).toThrow(OnlineError);
  });
});

describe('lineup', () => {
  it('is legal by default for every sample team and length', () => {
    for (const t of PRESET_TEAMS)
      for (let o = 1; o <= MAX_OVERS; o++) expect(lineupProblem(t, defaultLineup(t), o)).toBeNull();
  });

  it('makes a legal plan for every length, even with the fewest bowlers', () => {
    const ids = hawks.players.map((p) => p.id);
    for (let o = 1; o <= MAX_OVERS; o++) {
      for (let k = minBowlers(o); k <= ids.length; k++) {
        const bowlers = ids.slice(0, k);
        expect(planProblem(autoPlan(bowlers, o)!, bowlers, o)).toBeNull();
      }
      expect(autoPlan(ids.slice(0, minBowlers(o) - 1), o)).toBeNull();
    }
  });

  it('rejects broken lineups', () => {
    const ok = defaultLineup(hawks);
    const [b1, b2, b3, b4, b5] = ok.bowlers;
    const bad = [
      { ...ok, battingOrder: ok.battingOrder.slice(1) },
      { ...ok, battingOrder: [...ok.battingOrder.slice(1), ok.battingOrder[1]] },
      { ...ok, battingOrder: [...ok.battingOrder.slice(1), 'stranger'] },
      { ...ok, bowlers: [b1, b2, b3, b4] },
      { ...ok, bowlers: [b1, b2, b3, b4, b4] },
      { ...ok, bowlers: [b1, b2, b3, b4, 'stranger'] },
      { ...ok, bowlingPlan: [b1, b2, b3, b4] },
      { ...ok, bowlingPlan: [b1, b1, b3, b4, b5] },
      { ...ok, bowlingPlan: [b1, b2, b3, b4, b1] },
      { ...ok, bowlingPlan: [b1, b2, b3, b4, ok.battingOrder[0]] },
    ];
    for (const l of bad) expect(lineupProblem(hawks, l, 5)).toEqual(expect.any(String));
    expect(lineupProblem(hawks, { ...ok, bowlingPlan: [b5, b4, b3, b2, b1] }, 5)).toBeNull();
  });

  it('reorders a copy and leaves the saved team alone', () => {
    const before = structuredClone(hawks);
    const l = { battingOrder: hawks.players.map((p) => p.id).reverse(), bowlers: [hawks.players[0].id] };
    const t = applyLineup(hawks, l);
    expect(t.players.map((p) => p.id)).toEqual(l.battingOrder);
    expect(t.players.filter((p) => p.bowler).map((p) => p.id)).toEqual(l.bowlers);
    expect(hawks).toEqual(before);
  });

  it('checks the shape of what clients send', () => {
    const ok = defaultLineup(hawks);
    expect(parseLineup({ ...ok, extra: 1 })).toEqual(ok);
    for (const v of [null, {}, { ...ok, bowlers: 'all' }, { ...ok, bowlers: [1] }, { ...ok, bowlingPlan: Array(21).fill('a') }])
      expect(() => parseLineup(v)).toThrow(OnlineError);
  });

  it('agrees with the engine about who may bowl', () => {
    for (let o = 1; o <= MAX_OVERS; o++) {
      const plan = autoPlan(defaultLineup(rhinos).bowlers, o)!;
      let m = newMatch(o);
      for (const id of plan) {
        const full = ownedId('BBB', id);
        expect(bowlerOptions(m).find((x) => x.player.id === full)!.eligible).toBe(true);
        m = setBowler(m, full);
        for (let i = 0; i < 6; i++) m = applyBall(m, run(2));
      }
      expect(m.innings[0].done).toBe(true);
    }
  });
});

describe('online match', () => {
  it('lets both captains bring the same team', () => {
    const m = newMatch(5, side('AAA', 'Raj'), side('BBB', 'Sam'));
    expect(m.teams.map((t) => t.name)).toEqual(['Harbour Hawks (Raj)', 'Harbour Hawks (Sam)']);
    expect(m.teams.map((t) => t.short)).toEqual(['HAW1', 'HAW2']);
    const ids = m.teams.flatMap((t) => t.players.map((p) => p.id));
    expect(new Set(ids).size).toBe(22);
    expect(splitOwnedId(ids[0])).toEqual({ ownerId: 'AAA', id: hawks.players[0].id });
    expect(hawks.name).toBe('Harbour Hawks');
  });

  it('tells same-named captains apart and refuses playing yourself', () => {
    const m = newMatch(5, side('AAA', 'Sam'), side('BBB', 'sam'));
    expect(m.teams.map((t) => t.name)).toEqual(['Harbour Hawks (host)', 'Harbour Hawks (guest)']);
    expect(() => newMatch(5, side('AAA', 'Raj'), side('AAA', 'Raj', rhinos))).toThrow(OnlineError);
  });

  it('follows the toss', () => {
    const h = side('AAA', 'Raj');
    const g = side('BBB', 'Sam', rhinos);
    const order = (winnerId: string, choice: 'bat' | 'bowl') =>
      createOnlineMatch('m', h, g, onlineSettings(5), { winnerId, choice }, 1).order[0];
    expect(order('AAA', 'bat')).toBe('AAA/p-hawks');
    expect(order('AAA', 'bowl')).toBe('BBB/p-rhinos');
    expect(order('BBB', 'bat')).toBe('BBB/p-rhinos');
    expect(order('BBB', 'bowl')).toBe('AAA/p-hawks');
    expect(() => order('CCC', 'bat')).toThrow(OnlineError);
  });

  it('adds up a player across matches as host and as guest', () => {
    const a = side('AAA', 'Raj');
    const b = side('BBB', 'Sam');
    let m1 = newMatch(1, a, b);
    m1 = bowl(m1, run(4));
    let m2 = createOnlineMatch('m2', b, a, onlineSettings(1), { winnerId: 'AAA', choice: 'bat' }, 2000);
    m2 = bowl(m2, run(6));
    const mine = aggregate([m1, m2]).bat.find((x) => x.playerId === `AAA/${hawks.players[0].id}`)!;
    expect(mine.runs).toBe(10);
    expect(mine.matches).toBe(2);
  });
});

describe('next batter', () => {
  const batters = (m: MatchState) => {
    const inn = currentInnings(m);
    const { players } = getTeam(m, inn.battingTeamId);
    return [players[inn.striker].id, players[inn.nonStriker].id];
  };
  const id = (n: number) => `AAA/${hawks.players[n - 1].id}`;

  it('can be changed only straight after a wicket', () => {
    let m = newMatch();
    expect(nextBatterOptions(m)).toEqual([]);
    m = bowl(m, run(1));
    expect(() => chooseNextBatter(m, id(5))).toThrow(OnlineError);
    m = bowl(m, WICKET);
    expect(nextBatterOptions(m).map((p) => p.id)).toEqual([3, 4, 5, 6, 7, 8, 9, 10, 11].map(id));
    expect(() => chooseNextBatter(m, id(1))).toThrow(OnlineError);
    expect(() => chooseNextBatter(m, `BBB/${rhinos.players[4].id}`)).toThrow(OnlineError);
    m = chooseNextBatter(m, id(8));
    expect(batters(m)).toEqual([id(8), id(1)]);
    m = bowl(m, run(2));
    expect(nextBatterOptions(m)).toEqual([]);
    // The rest of the order is kept.
    m = bowl(m, WICKET);
    expect(batters(m)).toEqual([id(3), id(1)]);
  });

  it('works on the last ball of an over, when the new batter is at the other end', () => {
    let m = newMatch();
    for (let i = 0; i < 5; i++) m = bowl(m, run(2));
    m = bowl(m, WICKET);
    m = chooseNextBatter(m, id(11));
    expect(batters(m)).toEqual([id(2), id(11)]);
  });

  it('does not change the state it is given', () => {
    const m = bowl(newMatch(), WICKET);
    const copy = structuredClone(m);
    chooseNextBatter(m, id(9));
    expect(m).toEqual(copy);
  });

  it('offers one batter after the ninth wicket and none after the tenth', () => {
    let m = newMatch();
    for (let i = 0; i < 9; i++) m = bowl(m, WICKET);
    expect(nextBatterOptions(m).map((p) => p.id)).toEqual([id(11)]);
    m = bowl(m, WICKET);
    expect(m.innings[0].endReason).toBe('allOut');
    expect(nextBatterOptions(m)).toEqual([]);
  });

  it('keeps scorecards consistent over many random matches', () => {
    for (let seed = 1; seed <= 60; seed++) {
      const rng = seeded(seed);
      let m = newMatch(1 + (seed % MAX_OVERS), side('AAA', 'Raj'), side('BBB', 'Sam'));
      let guard = 0;
      while (!m.result && guard++ < 1000) {
        const opts = nextBatterOptions(m);
        if (opts.length) m = chooseNextBatter(m, opts[Math.floor(rng() * opts.length)].id);
        m = bowl(m, rollDice(rng));
      }
      expect(m.result).not.toBeNull();
      m.innings.forEach((inn, i) => {
        const rows = battingCard(m, i);
        expect(rows).toHaveLength(11);
        expect(rows.reduce((s, r) => s + r.runs, 0)).toBe(inn.runs);
        expect(rows.filter((r) => r.out).length).toBe(inn.wickets);
        for (const b of inn.balls) expect(rows.find((r) => r.playerId === b.batterId)!.batted).toBe(true);
      });
    }
  });
});

describe('isolation from the offline game', () => {
  const files = import.meta.glob('../**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
  // Keys are relative to this folder: online files start with "./", everything else with "../".
  const main = Object.entries(files).filter(([path]) => path.startsWith('../'));
  const online = Object.entries(files).filter(([path]) => path.startsWith('./') && !path.includes('.test.'));

  it('sees both sides', () => {
    expect(main.length).toBeGreaterThan(20);
    expect(online.length).toBeGreaterThan(4);
  });

  it('never imports online code into the main game', () => {
    for (const [path, src] of main) expect(/from\s+['"][^'"]*\/online\//.test(src), path).toBe(false);
  });

  it('never starts the main game or writes to its database from online code', () => {
    for (const [path, src] of online) {
      expect(/\.init\(\)/.test(src), path).toBe(false);
      // The main game's store may be read, and its in-memory history filled for hover cards, but none of its actions used.
      expect(/useGame\.getState|useGame\(/.test(src), path).toBe(false);
      expect(/\bdb\.\w+\.(put|bulkPut|add|bulkAdd|update|delete|bulkDelete|clear|modify)\b/.test(src), path).toBe(false);
    }
  });
});
