import { describe, expect, it } from 'vitest';
import { resolveRolls, rollDie } from './dice';
import {
  applyBall, bowlerOptions, createMatch, currentInnings, maxOversPerBowler, needsBowler, setBowler, simulate,
} from './match';
import { aggregate, battingCard, bowlingCard, playerMatches, recentBatting, recentBowling, recentForm } from './stats';
import { createTournament, nextFixture, pointsTable, recordResult, roundRobin } from './tournament';
import {
  addLeg, createSeries, legLabel, legStanding, nextSeriesFixture, recordSeriesResult, seriesOutcome, type Series,
} from './series';
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

  it('player match log covers every appearance and sums to the career aggregate', () => {
    const [, , C] = PRESET_TEAMS;
    const ms = [1, 2, 3, 4, 5].map((s) => {
      const m = simulate(createMatch(`m${s}`, A, s === 3 ? C : B, limited(10), seeded(s)), seeded(s * 17), 'match');
      return { ...m, createdAt: s * 1000 };
    });
    const opener = B.players[0].id;
    const log = playerMatches(ms, opener);
    expect(log.map((p) => p.matchId)).toEqual(['m5', 'm4', 'm2', 'm1']);
    expect(log.every((p) => p.vsShort === A.short && p.teamId === B.id)).toBe(true);
    const { bat, bowl } = aggregate(ms);
    for (const pid of [opener, A.players[6].id, A.players[10].id]) {
      const l = playerMatches(ms, pid);
      expect(l.flatMap((p) => p.bat).reduce((s, b) => s + b.runs, 0)).toBe(bat.find((x) => x.playerId === pid)?.runs ?? 0);
      expect(l.flatMap((p) => p.bowl).reduce((s, b) => s + b.wickets, 0)).toBe(bowl.find((x) => x.playerId === pid)?.wickets ?? 0);
    }
    for (const p of log) {
      const res = ms.find((m) => m.id === p.matchId)!.result!;
      expect(p.result).toBe(res.kind === 'tie' ? 'T' : res.winnerId === B.id ? 'W' : 'L');
    }
    expect(playerMatches(ms, 'nobody')).toEqual([]);
  });

  it('player match log records both innings of a Test', () => {
    const t = simulate(createMatch('t', A, B, { format: 'test', overs: 0, bowlerMode: 'auto' }, seeded(3)), seeded(9), 'match');
    const opener = A.players[0].id;
    const [p] = playerMatches([t], opener);
    const want = t.innings.filter((i) => i.battingTeamId === A.id).length;
    expect(p.bat).toHaveLength(want);
    expect(want).toBeGreaterThanOrEqual(1);
  });

  it('recent form is newest first, capped, and skips other teams', () => {
    const [, , C] = PRESET_TEAMS;
    const recs = [1, 2, 3, 4, 5, 6, 7].map((s) => ({
      match: simulate(createMatch(`m${s}`, A, s === 4 ? C : B, limited(5), seeded(s)), seeded(s * 13), 'match'),
      tournamentId: null,
      completedAt: s * 1000,
    }));
    const form = recentForm(recs, B.id, 5);
    expect(form.map((f) => f.record.match.id)).toEqual(['m7', 'm6', 'm5', 'm3', 'm2']);
    for (const f of form) {
      const res = f.record.match.result!;
      const want = res.kind === 'tie' ? 'T' : res.winnerId === B.id ? 'W' : 'L';
      expect(f.letter).toBe(want);
    }
    expect(recentForm(recs, C.id)).toHaveLength(1);
    expect(recentForm(recs, PRESET_TEAMS[5].id)).toEqual([]);
  });

  const runTournament = (n: number, structure: 'roundRobin' | 'roundRobinPlayoffs' | 'knockout', legs: 1 | 2 = 1) => {
    const rng = seeded(n * 31);
    let t = createTournament('t', 'Cup', PRESET_TEAMS.slice(0, n).map((x) => x.id), limited(5), structure, rng, legs);
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

  it('double round robin plays every pair twice, home and away', () => {
    for (const n of [4, 5]) {
      const ids = PRESET_TEAMS.slice(0, n).map((x) => x.id);
      const fs = roundRobin(ids, 2);
      expect(fs).toHaveLength(n * (n - 1));
      for (let i = 0; i < n; i++)
        for (let j = 0; j < n; j++)
          if (i !== j) expect(fs.filter((f) => f.homeId === ids[i] && f.awayId === ids[j])).toHaveLength(1);
      const rounds = n % 2 ? n : n - 1;
      expect(Math.max(...fs.map((f) => f.round))).toBe(rounds * 2);
    }
    expect(roundRobin(['a', 'b', 'c', 'd'])).toHaveLength(6);
  });

  it('double round robin + playoffs completes with 6 league games each', () => {
    const t = runTournament(4, 'roundRobinPlayoffs', 2);
    expect(t.legs).toBe(2);
    expect(t.fixtures.filter((f) => f.stage === 'group')).toHaveLength(12);
    expect(pointsTable(t).every((r) => r.played === 6)).toBe(true);
    expect(t.fixtures.filter((f) => f.stage === 'semi')).toHaveLength(2);
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

describe('bilateral series', () => {
  const T20 = limited(20);
  const T10 = limited(10);
  const TEST: MatchSettings = { format: 'test', overs: 0, bowlerMode: 'auto' };
  const names = (id: string) => {
    const t = PRESET_TEAMS.find((x) => x.id === id)!;
    return { name: t.name, short: t.short };
  };
  const stub = (id: string, result: MatchState['result']) => ({ id, result } as MatchState);
  const win = (id: string) => ({ kind: 'win' as const, winnerId: id, text: '' });
  const tie = { kind: 'tie' as const, text: '' };
  const draw = { kind: 'draw' as const, text: '' };
  /** Plays every fixture in order with the given results. */
  const playAll = (s: Series, results: MatchState['result'][]) =>
    s.fixtures.reduce((acc, f, i) => recordSeriesResult(acc, f.id, stub(`m${i}`, results[i])), s);

  it('merges same-format legs and expands fixtures in schedule order', () => {
    let legs = addLeg([], TEST, 1);
    legs = addLeg(legs, T10, 2);
    legs = addLeg(legs, T20, 1);
    legs = addLeg(legs, T10, 1);
    expect(legs.map((l) => [legLabel(l.settings), l.games])).toEqual([['Test', 1], ['10-over', 3], ['20-over', 1]]);
    const s = createSeries('s', 'S', A.id, B.id, legs);
    expect(s.fixtures.map((f) => `${f.legIdx}:${f.game}`)).toEqual(['0:1', '1:1', '1:2', '1:3', '2:1']);
    expect(nextSeriesFixture(s)?.id).toBe(s.fixtures[0].id);
  });

  it('single format: most wins takes it, ties and draws count for nobody', () => {
    const s = createSeries('s', 'S', A.id, B.id, addLeg([], T20, 5));
    const mid = playAll({ ...s, fixtures: s.fixtures.slice(0, 3) }, [win(A.id), tie, win(B.id)]);
    expect(legStanding({ ...mid, fixtures: [...mid.fixtures, ...s.fixtures.slice(3)] }, 0, names).text).toBe('Level 1-1');
    const done = playAll(s, [win(A.id), tie, win(B.id), win(A.id), win(A.id)]);
    expect(done.status).toBe('complete');
    const o = seriesOutcome(done, names);
    expect(o).toMatchObject({ complete: true, winnerId: A.id, multi: false, score: '3-1' });
    expect(o.text).toBe(`${A.name} won the 5-match 20-over series 3-1`);
    const drawn = playAll(createSeries('s', 'S', A.id, B.id, addLeg([], TEST, 2)), [win(B.id), win(A.id)]);
    expect(seriesOutcome(drawn, names)).toMatchObject({ winnerId: null, text: 'The 2-match Test series was drawn 1-1' });
    const oneOff = playAll(createSeries('s', 'S', A.id, B.id, addLeg([], TEST, 1)), [draw]);
    expect(legStanding(oneOff, 0, names).text).toBe('The one-off Test was drawn');
  });

  it('multi-format: most mini-series wins, equal is a drawn series', () => {
    const legs3 = addLeg(addLeg(addLeg([], TEST, 1), T10, 3), T20, 1);
    const s3 = createSeries('s', 'S', A.id, B.id, legs3);
    const won = playAll(s3, [win(B.id), win(A.id), win(A.id), win(B.id), win(A.id)]);
    expect(legStanding(won, 1, names).text).toBe(`${A.name} won the 3-match 10-over series 2-1`);
    expect(seriesOutcome(won, names)).toMatchObject({ winnerId: A.id, home: 2, away: 1, multi: true, text: `${A.name} won the multi-format series 2-1` });

    const legs2 = addLeg(addLeg([], TEST, 1), T20, 1);
    const level = playAll(createSeries('s', 'S', A.id, B.id, legs2), [win(A.id), win(B.id)]);
    expect(seriesOutcome(level, names)).toMatchObject({ winnerId: null, text: 'The multi-format series was drawn 1-1' });

    // Drawn mini-series count for nobody: Test drawn, 10-over level 1-1 (one tie), 20-over to A → A wins 1-0.
    const oneDrawn = playAll(s3, [draw, win(A.id), win(B.id), tie, win(A.id)]);
    expect(legStanding(oneDrawn, 1, names).winnerId).toBeNull();
    expect(seriesOutcome(oneDrawn, names)).toMatchObject({ winnerId: A.id, home: 1, away: 0, score: '1-0' });
    // 3 formats, one drawn, the other two split → drawn series.
    const split = playAll(s3, [draw, win(A.id), win(A.id), win(B.id), win(B.id)]);
    expect(seriesOutcome(split, names)).toMatchObject({ complete: true, winnerId: null, home: 1, away: 1, text: 'The multi-format series was drawn 1-1' });
    const inProgress = playAll({ ...s3, fixtures: s3.fixtures.slice(0, 2) }, [win(B.id), win(A.id)]);
    expect(seriesOutcome({ ...inProgress, fixtures: [...inProgress.fixtures, ...s3.fixtures.slice(2)] }, names).text)
      .toBe(`1 of 3 series decided · ${B.short} lead 1-0`);
  });

  it('simulated series always complete', () => {
    const rng = seeded(99);
    let s = createSeries('s', 'S', A.id, B.id, addLeg(addLeg([], { ...TEST, overs: 3 }, 1), limited(5), 3));
    for (let f = nextSeriesFixture(s); f; f = nextSeriesFixture(s)) {
      const settings = s.legs[f.legIdx].settings;
      s = recordSeriesResult(s, f.id, simulate(createMatch(f.id, A, B, settings, rng), rng, 'match'));
    }
    expect(s.status).toBe('complete');
    expect(seriesOutcome(s, names).complete).toBe(true);
  });
});
