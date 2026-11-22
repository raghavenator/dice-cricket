import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db, type MatchRecord } from './db';
import { exportBackup, importBackup, parseBackup, type Backup } from './backup';
import { PRESET_TEAMS } from './presets';
import { createMatch, simulate } from '../engine/match';
import { createTournament, recordResult } from '../engine/tournament';
import { createSeries, recordSeriesResult } from '../engine/series';
import type { MatchSettings } from '../engine/types';

function seeded(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const [A, B, C] = PRESET_TEAMS;
const t20: MatchSettings = { format: 'limited', overs: 5, bowlerMode: 'auto' };
const test: MatchSettings = { format: 'test', overs: 0, bowlerMode: 'auto' };

const played = (id: string, settings = t20, seed = 1) =>
  simulate(createMatch(id, A, B, settings, seeded(seed)), seeded(seed + 100), 'match');

const record = (id: string, extra: Partial<MatchRecord> = {}): MatchRecord => ({
  id, tournamentId: null, fixtureId: null, seriesId: null, completedAt: 1_700_000_000_000, match: played(id), ...extra,
});

/** A realistic database: teams, a part-played tournament and series, history, and an unfinished live match. */
async function seed() {
  let t = createTournament('t1', 'Cup', [A.id, B.id, C.id], t20, 'roundRobin', seeded(9));
  const f = t.fixtures[0];
  const tm = simulate(createMatch('tm1', PRESET_TEAMS.find((x) => x.id === f.homeId)!, PRESET_TEAMS.find((x) => x.id === f.awayId)!, t20, seeded(3)), seeded(4), 'match');
  t = recordResult(t, f.id, tm, seeded(5));
  let s = createSeries('s1', 'Ashes', A.id, B.id, [{ key: 'test', settings: test, games: 2 }]);
  const sm = played('sm1', test, 7);
  s = recordSeriesResult(s, s.fixtures[0].id, sm);
  await db.teams.bulkPut(PRESET_TEAMS);
  await db.tournaments.put(t);
  await db.series.put(s);
  await db.matches.bulkPut([
    record('m1'),
    { ...record('tm1'), match: tm, tournamentId: 't1', fixtureId: f.id },
    { ...record('sm1'), match: sm, seriesId: 's1', fixtureId: s.fixtures[0].id },
  ]);
  await db.live.put({ key: 'live', match: createMatch('live1', A, C, t20, seeded(11)), tournamentId: null, fixtureId: null, seriesId: null, saved: false });
}

const snapshot = async () => (await exportBackup()).data;
const roundTrip = (b: Backup) => parseBackup(JSON.stringify(b));

beforeEach(async () => {
  await Promise.all([db.teams, db.tournaments, db.series, db.matches, db.live].map((t) => t.clear()));
});

describe('backup round trip', () => {
  it('validators accept everything the app itself produces', async () => {
    await seed();
    const b = await exportBackup();
    expect(roundTrip(b).data).toEqual(b.data);
  });

  it('export then replace into an empty database restores identical contents', async () => {
    await seed();
    const before = await snapshot();
    const file = roundTrip(await exportBackup());
    await Promise.all([db.teams, db.tournaments, db.series, db.matches, db.live].map((t) => t.clear()));
    const counts = await importBackup(file, 'replace');
    expect(await snapshot()).toEqual(before);
    expect(counts.matches).toBe(3);
  });

  it('replace removes records that are not in the file', async () => {
    await seed();
    const file = roundTrip(await exportBackup());
    await db.matches.put(record('extra'));
    await importBackup(file, 'replace');
    expect(await db.matches.get('extra')).toBeUndefined();
  });
});

describe('merge', () => {
  it('keeps existing matches and adds the file’s matches', async () => {
    await db.matches.put(record('from-file'));
    const file = roundTrip(await exportBackup());
    await db.matches.clear();
    await db.matches.put(record('already-here'));
    await importBackup(file, 'merge');
    expect((await db.matches.toArray()).map((r) => r.id).sort()).toEqual(['already-here', 'from-file']);
  });

  it('a team with the same id takes the file’s version', async () => {
    await db.teams.put({ ...A, name: 'Edited In File' });
    const file = roundTrip(await exportBackup());
    await db.teams.put(A);
    await importBackup(file, 'merge');
    expect((await db.teams.get(A.id))!.name).toBe('Edited In File');
  });

  it('does not let an older backup undo tournament progress', async () => {
    await seed();
    const t = (await db.tournaments.get('t1'))!;
    const older = roundTrip({ ...(await exportBackup()), data: { ...(await snapshot()), tournaments: [{ ...t, fixtures: t.fixtures.map(({ result: _r, matchId: _m, ...f }) => f) }] } });
    await importBackup(older, 'merge');
    expect((await db.tournaments.get('t1'))!.fixtures.filter((f) => f.result)).toHaveLength(1);
  });

  it('does not overwrite an unfinished live match', async () => {
    await seed();
    const file = roundTrip(await exportBackup());
    file.data.live[0] = { ...file.data.live[0], match: { ...file.data.live[0].match, id: 'other-live' } };
    await importBackup(file, 'merge');
    expect((await db.live.get('live'))!.match.id).toBe('live1');
  });
});

describe('rejecting bad or malicious files', () => {
  let good: Backup;
  beforeEach(async () => {
    await seed();
    good = await exportBackup();
  });
  /** Applies a change to a deep copy of a valid backup, then expects parseBackup to reject it. */
  const rejects = (mutate: (b: any) => void, msg?: RegExp) => {
    const b = structuredClone(good);
    mutate(b);
    expect(() => parseBackup(JSON.stringify(b))).toThrow(msg);
  };

  it('rejects non-JSON, other apps, other formats and missing tables', () => {
    expect(() => parseBackup('not json')).toThrow(/not valid JSON/);
    expect(() => parseBackup('{"app":"other"}')).toThrow(/Not a Dice Cricket backup/);
    rejects((b) => { b.format = 99; }, /different version/);
    rejects((b) => { delete b.data.matches; }, /matches: expected a list/);
    rejects((b) => { b.data.teams = 'x'; }, /teams: expected a list/);
  });

  it('rejects team colours that could load a remote URL', () => {
    rejects((b) => { b.data.teams[0].color = 'url(https://example.com/x)'; }, /hex colour/);
    rejects((b) => { b.data.teams[0].color = 'red;background:url(x)'; }, /hex colour/);
    rejects((b) => { b.data.matches[0].match.teams[0].color = 'url(x)'; }, /matches\[0\]\.match\.teams\[0\]\.color/);
  });

  it('rejects broken match data', () => {
    rejects((b) => { delete b.data.matches[0].match.innings; }, /innings: expected a list/);
    rejects((b) => { b.data.matches[0].match.innings[0].balls[0].roll1 = 9; }, /roll1: number outside 1–6/);
    rejects((b) => { b.data.matches[0].match.innings[0].battingTeamId = 'nobody'; }, /team not in this match/);
    rejects((b) => { b.data.matches[0].match.result = { kind: 'bogus', text: '' }; }, /kind/);
  });

  it('rejects oversized data', () => {
    rejects((b) => { b.data.teams[0].players = Array.from({ length: 100_000 }, (_, i) => ({ id: `p${i}`, name: 'x', bowler: false })); }, /1–30 items/);
    rejects((b) => { b.data.teams[0].name = 'x'.repeat(1000); }, /longer than 200/);
    expect(() => parseBackup(' '.repeat(26 * 1024 * 1024))).toThrow(/too large/);
  });

  it('rejects data that passes validation but would crash the stats', () => {
    rejects((b) => {
      const f = b.data.tournaments[0].fixtures.find((x: any) => x.result);
      f.homeId = 'not-in-tournament';
    }, /can't be read by this version/);
  });

  it('drops unknown keys, including __proto__, without touching Object.prototype', () => {
    const json = JSON.stringify(good).replace('"bowler":', '"__proto__":{"polluted":true},"extra":1,"bowler":');
    const b = parseBackup(json);
    const p = b.data.teams[0].players[0] as any;
    expect(Object.keys(p).sort()).toEqual(['bowler', 'id', 'name']);
    expect(Object.getPrototypeOf(p)).toBe(Object.prototype);
    expect(({} as any).polluted).toBeUndefined();
  });

  it('a rejected file writes nothing', async () => {
    const before = await snapshot();
    const b = structuredClone(good) as any;
    b.data.teams[0].color = 'url(x)';
    expect(() => parseBackup(JSON.stringify(b))).toThrow();
    expect(await snapshot()).toEqual(before);
  });

  it('drops invalid preference fields instead of rejecting the file', () => {
    const b = parseBackup(JSON.stringify({ ...good, prefs: { autoDelay: 1e12, rollSpeed: 'fast', lastSettings: { format: 'x' } } }));
    expect(b.prefs).toEqual({ rollSpeed: 'fast' });
  });
});
