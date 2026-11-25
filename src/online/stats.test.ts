import 'fake-indexeddb/auto';
import { PRESET_TEAMS } from '../data/presets';
import { rollDice } from '../engine/dice';
import { needsBowler, pickAutoBowler, setBowler } from '../engine/match';
import { aggregate, battingCard, playerMatches } from '../engine/stats';
import type { MatchState, Rng, Team } from '../engine/types';
import { applyEvent } from './events';
import { onlineSettings } from './lineup';
import { exportOnline, importOnline, previewImport, readBackup } from './onlineBackup';
import { onlineDb, saveFinished, type OnlineRecord } from './onlineDb';
import {
  ME, NO_FILTERS, asMine, filterMatches, filterOptions, headToHead, hoverHistory, overview, statMatches, whoseRows,
} from './statMatches';
import { createOnlineMatch, nextBatterOptions } from './rules';
import { OnlineError } from './validate';

const [hawks, rhinos, strikers] = PRESET_TEAMS;

function seeded(seed: number): Rng {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Opts {
  host?: string;
  guest?: string;
  names?: [string, string];
  teams?: [Team, Team];
  overs?: number;
  /** Forfeit by this side after this many balls. */
  forfeit?: { by: 'host' | 'guest'; after: number };
  at?: number;
}

/** Plays a whole match, choosing random next batters. */
function play(seed: number, o: Opts = {}): OnlineRecord {
  const host = { ownerId: o.host ?? 'RAJ', nickname: o.names?.[0] ?? 'Raj' };
  const guest = { ownerId: o.guest ?? 'SAM', nickname: o.names?.[1] ?? 'Sam' };
  const [a, b] = o.teams ?? [hawks, rhinos];
  const rng = seeded(seed);
  const at = o.at ?? seed * 1000;
  let m: MatchState = createOnlineMatch(
    `ABCDEF-${seed}-1`, { ...host, team: a }, { ...guest, team: b }, onlineSettings(o.overs ?? 5),
    { winnerId: rng() < 0.5 ? host.ownerId : guest.ownerId, choice: rng() < 0.5 ? 'bat' : 'bowl' }, at - 500,
  );
  let balls = 0;
  while (!m.result) {
    const opts = nextBatterOptions(m);
    if (opts.length) m = applyEvent(m, { type: 'batter', playerId: opts[Math.floor(rng() * opts.length)].id });
    if (needsBowler(m)) m = setBowler(m, pickAutoBowler(m));
    if (o.forfeit && balls++ >= o.forfeit.after) {
      m = applyEvent(m, { type: 'forfeit', teamId: m.teams[o.forfeit.by === 'host' ? 0 : 1].id });
      break;
    }
    m = applyEvent(m, { type: 'ball', rolls: rollDice(rng) });
  }
  return { id: m.id, match: m, host, guest, end: o.forfeit ? { kind: 'forfeit', loser: o.forfeit.by } : { kind: 'played' }, completedAt: at };
}

const RAJ = new Set(['RAJ']);
const winner = (r: OnlineRecord) => r.match.result!.winnerId?.split('/')[0];

describe('preparing matches', () => {
  it('moves only ids, changes nothing else, and leaves the original alone', () => {
    const r = play(1);
    const copy = structuredClone(r.match);
    const m = asMine(r.match, RAJ);
    expect(r.match).toEqual(copy);
    expect(JSON.parse(JSON.stringify(m).replaceAll('"me/', '"RAJ/'))).toEqual(copy);
    expect(JSON.stringify(m)).not.toContain('RAJ/');
    m.innings.forEach((_, i) => expect(battingCard(m, i).map((x) => x.runs)).toEqual(battingCard(copy, i).map((x) => x.runs)));
  });

  it('keeps the same team on both sides apart, and names the opponent', () => {
    const [m] = statMatches([play(1, { teams: [hawks, hawks] })], RAJ);
    expect(m.match.teams.map((t) => [t.id, t.name, t.short])).toEqual([
      ['me/p-hawks', 'Harbour Hawks', 'HAW'],
      ['SAM/p-hawks', 'Harbour Hawks (Sam)', 'HAW'],
    ]);
    const bat = aggregate([m.match]).bat.filter((x) => x.name === hawks.players[0].name);
    expect(bat.map((x) => x.playerId).sort()).toEqual(['SAM/p-hawks-1', 'me/p-hawks-1']);
  });

  it('leaves real brackets and numbers in names alone', () => {
    const odd: Team = { ...hawks, name: 'Leeds (A)', short: 'L1' };
    const [m] = statMatches([play(1, { teams: [odd, { ...rhinos, name: 'York (B)', short: 'Y2' }] })], RAJ);
    expect(m.match.teams.map((t) => [t.name, t.short])).toEqual([['Leeds (A)', 'L1'], ['York (B) (Sam)', 'Y2']]);
  });

  it('adds up a career as host, as guest, and from another browser', () => {
    const rs = [play(1), play(2, { host: 'SAM', guest: 'RAJ', names: ['Sam', 'Raj'], teams: [rhinos, hawks] }), play(3, { host: 'OLD' })];
    const ms = statMatches(rs, new Set(['RAJ', 'OLD']));
    expect(ms).toHaveLength(3);
    const { bat } = aggregate(ms.map((m) => m.match));
    const opener = bat.filter((x) => x.playerId === 'me/p-hawks-1');
    expect(opener).toHaveLength(1);
    expect(opener[0].matches).toBe(3);
    const raw = rs.map((r) => aggregate([r.match]).bat.find((x) => /^(RAJ|OLD)\/p-hawks-1$/.test(x.playerId))!.runs);
    expect(opener[0].runs).toBe(raw.reduce((s, n) => s + n, 0));
    expect(playerMatches(ms.map((m) => m.match), 'me/p-hawks-1')).toHaveLength(3);
  });

  it("leaves out other people's matches and matches against yourself", () => {
    const rs = [play(1, { host: 'ANN', guest: 'BOB' }), play(2, { host: 'RAJ', guest: 'OLD' })];
    expect(statMatches(rs, new Set(['RAJ', 'OLD']))).toEqual([]);
    expect(hoverHistory(rs, new Set(['RAJ', 'OLD']), 'RAJ')).toHaveLength(1);
  });

  it('gives hover cards your career under the id on screen', () => {
    const h = hoverHistory([play(1, { host: 'OLD' })], new Set(['RAJ', 'OLD']), 'RAJ');
    expect(h[0].match.teams.map((t) => t.id)).toEqual(['RAJ/p-hawks', 'SAM/p-rhinos']);
  });
});

describe('records', () => {
  const rs = Array.from({ length: 40 }, (_, i) => play(i + 1));
  const ms = statMatches(rs, RAJ);

  it('counts results', () => {
    const o = overview(ms);
    expect(o.played).toBe(40);
    expect(o.won).toBe(rs.filter((r) => winner(r) === 'RAJ').length);
    expect(o.lost).toBe(rs.filter((r) => winner(r) === 'SAM').length);
    expect(o.won + o.lost + o.tied).toBe(40);
    expect(o.winPct).toBe(`${Math.round((o.won / 40) * 100)}%`);
  });

  it('is the mirror image for the opponent', () => {
    const me = overview(ms);
    const them = overview(statMatches(rs, new Set(['SAM'])));
    expect([them.won, them.lost, them.tied]).toEqual([me.lost, me.won, me.tied]);
  });

  it('works out streaks', () => {
    const last = ms[ms.length - 1].outcome;
    let n = 0;
    while (n < ms.length && ms[ms.length - 1 - n].outcome === last) n++;
    expect(overview(ms).streak).toBe(`${last}${n}`);
    expect(overview([])).toMatchObject({ played: 0, streak: '', winPct: '-', highest: null, lowest: null });
  });

  it('finds the highest and lowest totals', () => {
    const inns = ms.flatMap((m) => m.match.innings.filter((i) => i.battingTeamId === m.myTeamId));
    expect(overview(ms).highest!.runs).toBe(Math.max(...inns.map((i) => i.runs)));
    expect(overview(ms).lowest!.runs).toBe(Math.min(...inns.filter((i) => i.endReason !== 'target').map((i) => i.runs)));
  });

  it('counts forfeits as results, keeps the balls bowled, and never as a low total', () => {
    const f = [play(1, { forfeit: { by: 'guest', after: 4 } }), play(2, { forfeit: { by: 'host', after: 0 } })];
    const s = statMatches(f, RAJ);
    expect(s.map((m) => [m.outcome, m.forfeit])).toEqual([['W', true], ['L', true]]);
    expect(overview(s)).toMatchObject({ played: 2, won: 1, lost: 1, forfeitWins: 1, forfeitLosses: 1, lowest: null });
    expect(aggregate(s.map((m) => m.match)).bat.reduce((n, x) => n + x.balls, 0)).toBe(4);
  });

  it('groups opponents by person, under their latest name', () => {
    const list = [
      play(1), play(2, { names: ['Raj', 'Sammy'] }), play(3, { guest: 'KIM', names: ['Raj', 'Sam'] }),
      play(4, { host: 'SAM', guest: 'RAJ', names: ['Sammy', 'Raj'] }),
    ];
    const h = headToHead(statMatches(list, RAJ));
    expect(h.map((x) => [x.opponent.ownerId, x.opponent.nickname, x.played])).toEqual([['SAM', 'Sammy', 3], ['KIM', 'Sam', 1]]);
    expect(h[0].form).toHaveLength(3);
    expect(h[0].won + h[0].lost + h[0].tied).toBe(3);
  });

  it('filters', () => {
    const list = statMatches(
      [play(1), play(2, { guest: 'KIM', names: ['Raj', 'Kim'], overs: 1 }), play(3, { teams: [strikers, rhinos] })], RAJ,
    );
    const o = filterOptions(list);
    expect(o.teams).toEqual([['me/p-hawks', 'Harbour Hawks'], ['me/p-strikers', 'Summit Strikers']]);
    expect(o.opponents).toEqual([['KIM', 'Kim'], ['SAM', 'Sam']]);
    expect(o.overs).toEqual([1, 5]);
    const n = (f: object) => filterMatches(list, { ...NO_FILTERS, ...f }).map((m) => m.id.split('-')[1]).join();
    expect([n({}), n({ team: 'me/p-strikers' }), n({ opponent: 'KIM' }), n({ overs: 5 }), n({ opponent: 'SAM', team: 'me/p-hawks' })])
      .toEqual(['1,2,3', '3', '2', '1,3', '1']);
    const { bat } = aggregate(list.map((m) => m.match));
    expect(whoseRows(bat, 'mine').every((r) => r.playerId.startsWith(`${ME}/`))).toBe(true);
    expect(whoseRows(bat, 'mine').length + whoseRows(bat, 'theirs').length).toBe(whoseRows(bat, 'all').length);
  });
});

describe('export and import', () => {
  const clear = () => Promise.all([onlineDb.matches, onlineDb.me, onlineDb.pending].map((t) => t.clear()));
  beforeEach(clear);

  const sample = () => [
    ...Array.from({ length: 12 }, (_, i) => play(i + 1, { overs: 1 + i, teams: i % 2 ? [hawks, hawks] : [hawks, rhinos] })),
    play(20, { forfeit: { by: 'guest', after: 7 } }),
    play(21, { forfeit: { by: 'host', after: 6 } }),
    play(22, { forfeit: { by: 'host', after: 0 } }),
  ];
  const file = async (rs = sample()) => {
    await saveFinished('RAJ', rs);
    return JSON.stringify(await exportOnline(123));
  };

  it('brings back exactly the same matches in a fresh browser', async () => {
    const rs = sample();
    const raw = await file(rs);
    const before = await onlineDb.matches.toArray();
    await clear();
    const read = await readBackup(raw);
    expect(await previewImport(read)).toEqual({ owner: 'Raj', fresh: 15, already: 0, isOpponent: false });
    expect(await importOnline(read)).toBe(15);
    expect(await onlineDb.matches.toArray()).toEqual(before);
    expect((await onlineDb.me.toArray()).map((x) => x.ownerId)).toEqual(['RAJ']);
  });

  it('adds only what is missing and keeps both identities', async () => {
    const raw = await file([play(1), play(2)]);
    await clear();
    await saveFinished('NEW', [play(3, { host: 'NEW' })]);
    const read = await readBackup(raw);
    expect(await importOnline(read)).toBe(2);
    expect(await importOnline(read)).toBe(0);
    expect(await previewImport(read)).toMatchObject({ fresh: 0, already: 2 });
    const mine = new Set((await onlineDb.me.toArray()).map((x) => x.ownerId));
    const ms = statMatches(await onlineDb.matches.toArray(), mine);
    expect(ms).toHaveLength(3);
    expect(aggregate(ms.map((m) => m.match)).bat.find((x) => x.playerId === 'me/p-hawks-1')!.matches).toBe(3);
  });

  it("warns when the file looks like an opponent's", async () => {
    const r = play(1);
    await saveFinished('SAM', [r]);
    const theirs = JSON.stringify({ ...(await exportOnline()) });
    await clear();
    await saveFinished('RAJ', [r]);
    expect(await previewImport(await readBackup(theirs))).toMatchObject({ owner: 'Sam', isOpponent: true });
  });

  it('refuses other files', async () => {
    for (const raw of ['', '[]', 'null', '{"app":"other"}', '{"app":"dice-cricket-online","format":2}',
      '{"app":"dice-cricket-online","format":1,"me":"x","matches":[]}', '{"app":"dice-cricket-online","format":1,"me":["a b"],"matches":[]}'])
      await expect(readBackup(raw), raw).rejects.toThrow(OnlineError);
    await expect(readBackup('{"app":"dice-cricket","format":1}')).rejects.toThrow(/main game/);
  });

  it('refuses anything that could not have happened', async () => {
    const raw = await file([play(3)]);
    type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any
    const bad: [string, (r: Any) => void][] = [
      ['an extra ball', (r) => r.match.innings[1].balls.push(r.match.innings[1].balls[0])],
      ['a missing ball', (r) => r.match.innings[0].balls.splice(2, 1)],
      ['an unfinished match', (r) => r.match.innings[1].balls.pop()],
      ['a seven', (r) => { r.match.innings[0].balls[0].roll1 = 7; }],
      ['a stranger batting', (r) => { r.match.innings[0].balls[0].batterId = 'RAJ/nobody'; }],
      ['a bowler from nowhere', (r) => { r.match.innings[0].balls[0].bowlerId = 'SAM/nobody'; }],
      ['a short team', (r) => r.match.teams[0].players.pop()],
      ['a stolen team', (r) => { r.match.teams[0].id = 'KIM/p-hawks'; }],
      ['a script as a colour', (r) => { r.match.teams[0].color = 'url(x)'; }],
      ['too many overs', (r) => { r.match.settings.overs = 50; }],
      ['a forfeit after the end', (r) => { r.end = { kind: 'forfeit', loser: 'host' }; }],
      ['nobody to forfeit', (r) => { r.end = { kind: 'forfeit' }; }],
      ['playing yourself', (r) => { r.guest.ownerId = r.host.ownerId; }],
      ['a long nickname', (r) => { r.host.nickname = 'x'.repeat(99); }],
      ['a broken date', (r) => { r.completedAt = '<b>'; }],
    ];
    for (const [what, change] of bad) {
      const f = JSON.parse(raw);
      change(f.matches[0]);
      await expect(readBackup(JSON.stringify(f)), what).rejects.toThrow(OnlineError);
    }
  });

  it('does not believe the totals in a file', async () => {
    const real = play(3);
    const f = JSON.parse(await file([real]));
    const r = f.matches[0];
    r.match.innings[0].runs = 999;
    r.match.innings[0].balls.forEach((b: { runs: number }) => { b.runs = 6; });
    r.match.result = { kind: 'win', winnerId: 'RAJ/p-hawks', text: 'Raj is the greatest' };
    r.match.__proto__x = { evil: true };
    const read = await readBackup(JSON.stringify(f));
    expect(read.matches[0]).toEqual(real);
  });
});
