import type {
  Ball, BowlerMode, DismissalHow, Format, Innings, InningsEnd, MatchSettings, MatchState, Player, Result, Team,
} from '../engine/types';
import type { Fixture, FixtureResult, SideSummary, Stage, Structure, Tournament } from '../engine/tournament';
import type { Leg, Series, SeriesFixture } from '../engine/series';
import type { LiveRecord, MatchRecord } from './db';
import type { Prefs, RollSpeed } from '../store/useGameStore';

export class BackupError extends Error {}

// Validators build fresh objects from known keys only, so unexpected keys (including __proto__) never get stored.

type V<T> = (v: unknown, path: string) => T;

const fail = (path: string, msg: string): never => {
  throw new BackupError(`${path}: ${msg}`);
};

function obj(v: unknown, path: string): Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) fail(path, 'expected an object');
  return v as Record<string, unknown>;
}

const str = (max: number): V<string> => (v, path) => {
  if (typeof v !== 'string') fail(path, 'expected text');
  if ((v as string).length > max) fail(path, `text longer than ${max} characters`);
  return v as string;
};

const int = (min: number, max: number): V<number> => (v, path) => {
  if (typeof v !== 'number' || !Number.isInteger(v)) fail(path, 'expected a whole number');
  if ((v as number) < min || (v as number) > max) fail(path, `number outside ${min}–${max}`);
  return v as number;
};

const bool: V<boolean> = (v, path) => (typeof v === 'boolean' ? v : fail(path, 'expected true/false'));

const oneOf = <T extends string | number>(...values: T[]): V<T> => (v, path) =>
  values.includes(v as T) ? (v as T) : fail(path, `expected one of ${values.join(', ')}`);

const nullable = <T>(f: V<T>): V<T | null> => (v, path) => (v === null ? null : f(v, path));

const arr = <T>(f: V<T>, min: number, max: number): V<T[]> => (v, path) => {
  if (!Array.isArray(v)) fail(path, 'expected a list');
  const a = v as unknown[];
  if (a.length < min || a.length > max) fail(path, `list must have ${min}–${max} items`);
  return a.map((x, i) => f(x, `${path}[${i}]`));
};

/** Reads an optional field; omits the key entirely when absent. */
function opt<K extends string, T>(o: Record<string, unknown>, key: K, f: V<T>, path: string): { [P in K]?: T } {
  return o[key] === undefined ? {} : ({ [key]: f(o[key], `${path}.${key}`) } as { [P in K]?: T });
}

const id = str(64);
const name = str(200);
const text = str(500);
const time = int(0, 8.64e15);
const HEX = /^#[0-9a-fA-F]{6}$/;
const color: V<string> = (v, path) =>
  typeof v === 'string' && HEX.test(v) ? v : fail(path, 'not a hex colour like #1f6feb');

const format = oneOf<Format>('limited', 'test');
const bowlerMode = oneOf<BowlerMode>('auto', 'manual');
const how = oneOf<DismissalHow>('bowled', 'caught', 'lbw');
const inningsEnd = oneOf<InningsEnd>('allOut', 'overs', 'target');
const resultKind = oneOf<Result['kind']>('win', 'tie', 'draw');
const structure = oneOf<Structure>('roundRobin', 'roundRobinPlayoffs', 'knockout');
const stage = oneOf<Stage>('group', 'semi', 'final', 'knockout');
const status = oneOf<'active' | 'complete'>('active', 'complete');
const rollSpeed = oneOf<RollSpeed>('normal', 'fast', 'instant');

export const player: V<Player> = (v, p) => {
  const o = obj(v, p);
  return { id: id(o.id, `${p}.id`), name: name(o.name, `${p}.name`), bowler: bool(o.bowler, `${p}.bowler`) };
};

export const team: V<Team> = (v, p) => {
  const o = obj(v, p);
  return {
    id: id(o.id, `${p}.id`),
    name: name(o.name, `${p}.name`),
    short: str(20)(o.short, `${p}.short`),
    color: color(o.color, `${p}.color`),
    players: arr(player, 1, 30)(o.players, `${p}.players`),
  };
};

export const settings: V<MatchSettings> = (v, p) => {
  const o = obj(v, p);
  return {
    format: format(o.format, `${p}.format`),
    overs: int(0, 1000)(o.overs, `${p}.overs`),
    bowlerMode: bowlerMode(o.bowlerMode, `${p}.bowlerMode`),
  };
};

const result: V<Result> = (v, p) => {
  const o = obj(v, p);
  return { kind: resultKind(o.kind, `${p}.kind`), ...opt(o, 'winnerId', id, p), text: text(o.text, `${p}.text`) };
};

const ball: V<Ball> = (v, p) => {
  const o = obj(v, p);
  return {
    over: int(0, 100000)(o.over, `${p}.over`),
    ball: int(1, 6)(o.ball, `${p}.ball`),
    batterId: id(o.batterId, `${p}.batterId`),
    bowlerId: id(o.bowlerId, `${p}.bowlerId`),
    roll1: int(1, 6)(o.roll1, `${p}.roll1`),
    ...opt(o, 'roll2', int(1, 6), p),
    runs: int(0, 6)(o.runs, `${p}.runs`),
    wicket: bool(o.wicket, `${p}.wicket`),
    ...opt(o, 'how', how, p),
    ...opt(o, 'fielderId', id, p),
  };
};

const innings: V<Innings> = (v, p) => {
  const o = obj(v, p);
  const idx = int(0, 31);
  return {
    battingTeamId: id(o.battingTeamId, `${p}.battingTeamId`),
    bowlingTeamId: id(o.bowlingTeamId, `${p}.bowlingTeamId`),
    balls: arr(ball, 0, 6000)(o.balls, `${p}.balls`),
    runs: int(0, 1e6)(o.runs, `${p}.runs`),
    wickets: int(0, 30)(o.wickets, `${p}.wickets`),
    legalBalls: int(0, 1e6)(o.legalBalls, `${p}.legalBalls`),
    striker: idx(o.striker, `${p}.striker`),
    nonStriker: idx(o.nonStriker, `${p}.nonStriker`),
    nextIn: idx(o.nextIn, `${p}.nextIn`),
    bowlerId: nullable(id)(o.bowlerId, `${p}.bowlerId`),
    prevOverBowlerId: nullable(id)(o.prevOverBowlerId, `${p}.prevOverBowlerId`),
    target: nullable(int(0, 1e6))(o.target, `${p}.target`),
    done: bool(o.done, `${p}.done`),
    ...opt(o, 'endReason', inningsEnd, p),
  };
};

export const matchState: V<MatchState> = (v, p) => {
  const o = obj(v, p);
  const teams = arr(team, 2, 2)(o.teams, `${p}.teams`) as [Team, Team];
  const order = arr(id, 2, 2)(o.order, `${p}.order`) as [string, string];
  const inns = arr(innings, 0, 4)(o.innings, `${p}.innings`);
  const ids = teams.map((t) => t.id);
  const known = (tid: string, path: string) => (ids.includes(tid) ? tid : fail(path, 'refers to a team not in this match'));
  order.forEach((tid, i) => known(tid, `${p}.order[${i}]`));
  inns.forEach((inn, i) => {
    known(inn.battingTeamId, `${p}.innings[${i}].battingTeamId`);
    known(inn.bowlingTeamId, `${p}.innings[${i}].bowlingTeamId`);
  });
  return {
    id: id(o.id, `${p}.id`),
    createdAt: time(o.createdAt, `${p}.createdAt`),
    teams,
    settings: settings(o.settings, `${p}.settings`),
    tossText: text(o.tossText, `${p}.tossText`),
    order,
    innings: inns,
    result: nullable(result)(o.result, `${p}.result`),
  };
};

export const matchRecord: V<MatchRecord> = (v, p) => {
  const o = obj(v, p);
  return {
    id: id(o.id, `${p}.id`),
    tournamentId: nullable(id)(o.tournamentId, `${p}.tournamentId`),
    fixtureId: nullable(id)(o.fixtureId, `${p}.fixtureId`),
    ...opt(o, 'seriesId', nullable(id), p),
    completedAt: time(o.completedAt, `${p}.completedAt`),
    match: matchState(o.match, `${p}.match`),
  };
};

export const liveRecord: V<LiveRecord> = (v, p) => {
  const o = obj(v, p);
  return {
    key: oneOf<'live'>('live')(o.key, `${p}.key`),
    match: matchState(o.match, `${p}.match`),
    tournamentId: nullable(id)(o.tournamentId, `${p}.tournamentId`),
    fixtureId: nullable(id)(o.fixtureId, `${p}.fixtureId`),
    ...opt(o, 'seriesId', nullable(id), p),
    saved: bool(o.saved, `${p}.saved`),
  };
};

const side: V<SideSummary> = (v, p) => {
  const o = obj(v, p);
  return { runs: int(0, 1e7)(o.runs, `${p}.runs`), balls: int(0, 1e7)(o.balls, `${p}.balls`) };
};

const fixtureResult: V<FixtureResult> = (v, p) => {
  const o = obj(v, p);
  const sides = obj(o.sides, `${p}.sides`);
  const keys = Object.keys(sides);
  if (keys.length > 2) fail(`${p}.sides`, 'more than two sides');
  return {
    kind: resultKind(o.kind, `${p}.kind`),
    ...opt(o, 'winnerId', id, p),
    ...opt(o, 'advancedId', id, p),
    text: text(o.text, `${p}.text`),
    // fromEntries defines own properties, so a "__proto__" key can't change the prototype.
    sides: Object.fromEntries(keys.map((k) => [id(k, `${p}.sides`), side(sides[k], `${p}.sides.${k}`)])),
  };
};

const fixture: V<Fixture> = (v, p) => {
  const o = obj(v, p);
  return {
    id: id(o.id, `${p}.id`),
    stage: stage(o.stage, `${p}.stage`),
    round: int(0, 10000)(o.round, `${p}.round`),
    label: name(o.label, `${p}.label`),
    homeId: id(o.homeId, `${p}.homeId`),
    awayId: id(o.awayId, `${p}.awayId`),
    ...opt(o, 'matchId', id, p),
    ...opt(o, 'result', fixtureResult, p),
  };
};

export const tournament: V<Tournament> = (v, p) => {
  const o = obj(v, p);
  return {
    id: id(o.id, `${p}.id`),
    name: name(o.name, `${p}.name`),
    createdAt: time(o.createdAt, `${p}.createdAt`),
    teamIds: arr(id, 0, 1000)(o.teamIds, `${p}.teamIds`),
    settings: settings(o.settings, `${p}.settings`),
    structure: structure(o.structure, `${p}.structure`),
    ...opt(o, 'legs', oneOf<1 | 2>(1, 2), p),
    fixtures: arr(fixture, 0, 50000)(o.fixtures, `${p}.fixtures`),
    byes: arr(id, 0, 1000)(o.byes, `${p}.byes`),
    status: status(o.status, `${p}.status`),
    ...opt(o, 'championId', id, p),
  };
};

const leg: V<Leg> = (v, p) => {
  const o = obj(v, p);
  return {
    key: str(64)(o.key, `${p}.key`),
    settings: settings(o.settings, `${p}.settings`),
    games: int(0, 1000)(o.games, `${p}.games`),
  };
};

const seriesFixture: V<SeriesFixture> = (v, p) => {
  const o = obj(v, p);
  return {
    id: id(o.id, `${p}.id`),
    legIdx: int(0, 100)(o.legIdx, `${p}.legIdx`),
    game: int(1, 1000)(o.game, `${p}.game`),
    ...opt(o, 'matchId', id, p),
    ...opt(o, 'result', result, p),
  };
};

export const series: V<Series> = (v, p) => {
  const o = obj(v, p);
  const legs = arr(leg, 1, 100)(o.legs, `${p}.legs`);
  const fixtures = arr(seriesFixture, 0, 10000)(o.fixtures, `${p}.fixtures`);
  fixtures.forEach((f, i) => f.legIdx < legs.length || fail(`${p}.fixtures[${i}].legIdx`, 'refers to a missing leg'));
  return {
    id: id(o.id, `${p}.id`),
    name: name(o.name, `${p}.name`),
    createdAt: time(o.createdAt, `${p}.createdAt`),
    homeId: id(o.homeId, `${p}.homeId`),
    awayId: id(o.awayId, `${p}.awayId`),
    legs,
    fixtures,
    status: status(o.status, `${p}.status`),
  };
};

/** Lenient: invalid preference fields are dropped rather than rejecting the whole backup. */
export function prefs(v: unknown): Partial<Prefs> | undefined {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return undefined;
  const o = v as Record<string, unknown>;
  const out: Partial<Prefs> = {};
  const tryField = <K extends keyof Prefs>(key: K, f: V<Prefs[K]>) => {
    try {
      if (o[key] !== undefined) out[key] = f(o[key], key);
    } catch {
      /* drop invalid field */
    }
  };
  tryField('autoDelay', int(0, 10000));
  tryField('rollSpeed', rollSpeed);
  tryField('lastSettings', settings);
  return Object.keys(out).length ? out : undefined;
}

export const list = arr;
