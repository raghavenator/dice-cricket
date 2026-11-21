import { describe, expect, it } from 'vitest';
import { resolveRolls, rollDie } from './dice';
import {
  applyBall, bowlerOptions, createMatch, currentInnings, maxOversPerBowler, needsBowler, setBowler, simulate,
} from './match';
import { aggregate, battingCard, bowlingCard, recentBatting, recentBowling } from './stats';
import { createTournament, nextFixture, pointsTable, recordResult } from './tournament';
import { PRESET_TEAMS } from '../data/presets';
import type { MatchSettings, MatchState, Rolls } from './types';

/** Deterministic PRNG (mulberry32). */
function seeded(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const [A, B] = PRESET_TEAMS;
const limited = (overs: number): MatchSettings => ({ format: 'limited', overs, bowlerMode: 'auto' });
const r = (roll1: number, roll2?: number): Rolls => ({ roll1, roll2, fielderIdx: 0 });
const play = (m: MatchState, ...rolls: Rolls[]) => rolls.reduce(applyBall, m);

describe('dice', () => {
  it('maps faces to outcomes', () => {
    for (const n of [1, 2, 3, 4, 6]) expect(resolveRolls(r(n))).toEqual({ runs: n, wicket: false });
  });
  it('5 then 3-or-under is a dot ball', () => {
    for (const n of [1, 2, 3]) expect(resolveRolls(r(5, n))).toEqual({ runs: 0, wicket: false });
  });
  it('5 then 4-or-over is a wicket', () => {
    expect(resolveRolls(r(5, 4))).toMatchObject({ wicket: true, how: 'bowled' });
    expect(resolveRolls(r(5, 5))).toMatchObject({ wicket: true, how: 'caught' });
    expect(resolveRolls(r(5, 6))).toMatchObject({ wicket: true, how: 'lbw' });
  });
  it('rollDie stays in 1..6', () => {
    expect(rollDie(() => 0)).toBe(1);
    expect(rollDie(() => 0.9999999)).toBe(6);
  });
});

describe('match', () => {
  it('rotates strike on odd runs and at the end of the over', () => {
    let m = createMatch('m', A, B, limited(5), seeded(1));
    const bat = m.teams.find((t) => t.id === m.order[0])!;
    m = play(m, r(1));
    expect(currentInnings(m).balls[0].batterId).toBe(bat.players[0].id);
    expect(currentInnings(m).striker).toBe(1);
    m = play(m, r(2), r(4), r(6), r(5, 1), r(3)); // 6 balls; ends on 3 → swap, then over swap
    expect(currentInnings(m).legalBalls).toBe(6);
    expect(currentInnings(m).striker).toBe(1);
    expect(currentInnings(m).runs).toBe(1 + 2 + 4 + 6 + 0 + 3);
  });

  it('new batter replaces the dismissed striker', () => {
    let m = createMatch('m', A, B, limited(5), seeded(2));
    m = play(m, r(5, 4));
    const inn = currentInnings(m);
    expect(inn.wickets).toBe(1);
    expect(inn.striker).toBe(2);
    expect(inn.nextIn).toBe(3);
  });

  it('ends an innings at 10 wickets and sets a target', () => {
    let m = createMatch('m', A, B, limited(50), seeded(3));
    m = play(m, r(4), ...Array.from({ length: 10 }, () => r(5, 6)));
    expect(m.innings).toHaveLength(2);
    expect(m.innings[0].endReason).toBe('allOut');
    expect(m.innings[1].target).toBe(5);
  });

  it('chasing side wins when target reached', () => {
    let m = createMatch('m', A, B, limited(1), seeded(4));
    m = play(m, r(1), r(1), r(1), r(1), r(1), r(1)); // 6 off the over
    expect(m.innings[0].endReason).toBe('overs');
    m = play(m, r(6), r(1));
    expect(m.result?.kind).toBe('win');
    expect(m.result?.winnerId).toBe(m.order[1]);
    expect(m.result?.text).toMatch(/won by 10 wickets \(4 balls left\)/);
  });

  it('tie and defend', () => {
    let m = createMatch('m', A, B, limited(1), seeded(5));
    m = play(m, ...Array(6).fill(r(1)));
    const tie = play(m, ...Array(6).fill(r(1)));
    expect(tie.result?.kind).toBe('tie');
    const defended = play(m, r(1), r(1), r(1), r(5, 1), r(5, 1), r(5, 1));
    expect(defended.result?.winnerId).toBe(m.order[0]);
    expect(defended.result?.text).toMatch(/won by 3 runs/);
  });

  it('limits bowlers and blocks consecutive overs', () => {
    let m = createMatch('m', A, B, limited(5), seeded(6));
    expect(maxOversPerBowler(m.settings)).toBe(1);
    const first = currentInnings(m).bowlerId;
    m = play(m, ...Array(6).fill(r(2)));
    const opts = bowlerOptions(m);
    expect(opts.find((o) => o.player.id === first)?.eligible).toBe(false);
    expect(currentInnings(m).bowlerId).not.toBe(first);
    const full = simulate(m, seeded(7), 'innings');
    for (const row of bowlingCard(full, 0)) expect(row.balls).toBeLessThanOrEqual(6);
  });

  it('manual mode waits for a bowler', () => {
    let m = createMatch('m', A, B, { ...limited(5), bowlerMode: 'manual' }, seeded(8));
    expect(needsBowler(m)).toBe(true);
    expect(() => applyBall(m, r(1))).toThrow();
    const pick = bowlerOptions(m).find((o) => o.eligible)!.player.id;
    m = setBowler(m, pick);
    m = play(m, ...Array(6).fill(r(1)));
    expect(needsBowler(m)).toBe(true);
    expect(() => setBowler(m, pick)).toThrow();
  });

  it('test match plays up to 4 innings and can end by an innings', () => {
    const s: MatchSettings = { format: 'test', overs: 0, bowlerMode: 'auto' };
    let m = createMatch('m', A, B, s, seeded(9));
    const out10 = Array.from({ length: 10 }, () => r(5, 4));
    m = play(m, r(1), ...out10); // A: 1
    m = play(m, r(6), r(6), ...out10); // B: 12
    m = play(m, r(2), ...out10); // A: 3 total → innings defeat
    expect(m.result?.text).toMatch(/won by an innings and 9 runs/);
    expect(m.result?.winnerId).toBe(m.order[1]);
  });

  it('test match 4th innings chase and draw', () => {
    let m = createMatch('m', A, B, { format: 'test', overs: 1, bowlerMode: 'auto' }, seeded(10));
    m = play(m, ...Array(6).fill(r(2))); // A 12
    m = play(m, ...Array(6).fill(r(1))); // B 6
    m = play(m, ...Array(6).fill(r(1))); // A 6 → total 18, B needs 13
    expect(currentInnings(m).target).toBe(13);
    const draw = play(m, ...Array(6).fill(r(1)));
    expect(draw.result?.kind).toBe('draw');
    const win = play(m, r(6), r(6), r(1));
    expect(win.result?.winnerId).toBe(m.order[1]);
  });

  it('simulated matches always finish and scorecards add up', () => {
    for (let seed = 0; seed < 30; seed++) {
      const fmt: MatchSettings = seed % 2 ? limited(20) : { format: 'test', overs: 0, bowlerMode: 'auto' };
      const m = simulate(createMatch('m', A, B, fmt, seeded(seed)), seeded(seed + 100), 'match');
      expect(m.result).not.toBeNull();
      m.innings.forEach((inn, i) => {
        const bat = battingCard(m, i);
        const bowl = bowlingCard(m, i);
        expect(bat.reduce((s, x) => s + x.runs, 0)).toBe(inn.runs);
        expect(bowl.reduce((s, x) => s + x.runs, 0)).toBe(inn.runs);
        expect(bowl.reduce((s, x) => s + x.wickets, 0)).toBe(inn.wickets);
        expect(bat.filter((x) => x.out).length).toBe(inn.wickets);
      });
    }
  });
});

describe('stats & tournaments', () => {
  it('aggregates career runs across matches', () => {
    const ms = [1, 2, 3].map((s) => simulate(createMatch(`m${s}`, A, B, limited(10), seeded(s)), seeded(s * 7), 'match'));
    const { bat, bowl } = aggregate(ms);
    const total = ms.flatMap((m) => m.innings).reduce((s, i) => s + i.runs, 0);
    expect(bat.reduce((s, x) => s + x.runs, 0)).toBe(total);
    expect(bowl.reduce((s, x) => s + x.runs, 0)).toBe(total);
    expect(bat.find((x) => x.playerId === A.players[0].id)?.matches).toBe(3);
  });

  it('recent performances are newest first and match the scorecards', () => {
    const ms = [1, 2, 3, 4, 5, 6, 7].map((s) => {
      const m = simulate(createMatch(`m${s}`, A, B, limited(10), seeded(s)), seeded(s * 11), 'match');
      return { ...m, createdAt: s * 1000 };
    });
    const opener = A.players[0].id;
    const bat = recentBatting(ms, opener, 5);
    expect(bat).toHaveLength(5);
    expect(bat.map((p) => p.matchId)).toEqual(['m7', 'm6', 'm5', 'm4', 'm3']);
    const m7 = ms[6];
    const idx = m7.innings.findIndex((i) => i.battingTeamId === A.id);
    const row = battingCard(m7, idx).find((r) => r.playerId === opener)!;
    expect(bat[0]).toMatchObject({ runs: row.runs, balls: row.balls, out: row.out, vs: B.short });

    const bowlerId = A.players[6].id;
    const bowl = recentBowling(ms, bowlerId, 5);
    expect(bowl.length).toBeGreaterThan(0);
    expect(bowl.length).toBeLessThanOrEqual(5);
    for (const p of bowl) {
      const m = ms.find((x) => x.id === p.matchId)!;
      const i = m.innings.findIndex((x) => x.bowlingTeamId === A.id);
      const r = bowlingCard(m, i).find((x) => x.playerId === bowlerId)!;
      expect([p.wickets, p.runs]).toEqual([r.wickets, r.runs]);
    }
    expect(recentBatting([], opener)).toEqual([]);
  });

  const runTournament =(n: number, structure: 'roundRobin' | 'roundRobinPlayoffs' | 'knockout') => {
    const rng = seeded(n * 31);
    let t = createTournament('t', 'Cup', PRESET_TEAMS.slice(0, n).map((x) => x.id), limited(5), structure, rng);
    let f;
    let guard = 0;
    while ((f = nextFixture(t)) && guard++ < 100) {
      const home = PRESET_TEAMS.find((x) => x.id === f!.homeId)!;
      const away = PRESET_TEAMS.find((x) => x.id === f!.awayId)!;
      const m = simulate(createMatch(`m${guard}`, home, away, t.settings, rng), rng, 'match');
      t = recordResult(t, f.id, m, rng);
    }
    return t;
  };

  it('round robin plays every pair once', () => {
    const t = runTournament(5, 'roundRobin');
    expect(t.fixtures).toHaveLength(10);
    expect(t.status).toBe('complete');
    expect(t.championId).toBe(pointsTable(t)[0].teamId);
    expect(pointsTable(t).reduce((s, x) => s + x.played, 0)).toBe(20);
  });

  it('league + playoffs adds semis and a final', () => {
    const t = runTournament(6, 'roundRobinPlayoffs');
    expect(t.fixtures.filter((f) => f.stage === 'semi')).toHaveLength(2);
    expect(t.fixtures.filter((f) => f.stage === 'final')).toHaveLength(1);
    expect(t.status).toBe('complete');
  });

  it('knockout with byes produces one champion', () => {
    for (const n of [2, 3, 5, 6]) {
      const t = runTournament(n, 'knockout');
      expect(t.status).toBe('complete');
      expect(t.fixtures).toHaveLength(n - 1);
      expect(t.fixtures[t.fixtures.length - 1].label).toBe('Final');
    }
  });
});
