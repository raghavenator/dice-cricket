import { applyBall, currentInnings, getTeam, needsBowler, newInnings, setBowler } from '../engine/match';
import type { MatchState, Team } from '../engine/types';
import { applyEvent } from './events';
import { onlineDb, type OnlineRecord } from './onlineDb';
import type { MatchEnd, Who } from './protocol';
import { splitOwnedId } from './rules';
import { HEX, MAX_NAME, MAX_NICKNAME, OnlineError, PLAYERS_PER_TEAM, asObject, parseId, parseNickname, parseSettings, text } from './validate';

export const ONLINE_BACKUP_APP = 'dice-cricket-online';
export const ONLINE_BACKUP_FORMAT = 1;
export const MAX_ONLINE_BACKUP_BYTES = 25 * 1024 * 1024;
const MAX_MATCHES = 20_000;
const MAX_IDS = 200;

/** Online matches and the public ids that are "me". The secret token is never part of it. */
export interface OnlineBackup {
  app: typeof ONLINE_BACKUP_APP;
  format: typeof ONLINE_BACKUP_FORMAT;
  exportedAt: number;
  me: string[];
  matches: OnlineRecord[];
}

export async function exportOnline(now = Date.now()): Promise<OnlineBackup> {
  const [me, matches] = await Promise.all([onlineDb.me.toArray(), onlineDb.matches.orderBy('completedAt').toArray()]);
  return { app: ONLINE_BACKUP_APP, format: ONLINE_BACKUP_FORMAT, exportedAt: now, me: me.map((x) => x.ownerId), matches };
}

// ---------- Reading a file: nothing in it is trusted ----------

const OWNER_RE = /^[A-Za-z0-9_-]{1,32}$/;

function ownerId(v: unknown): string {
  if (typeof v !== 'string' || !OWNER_RE.test(v)) throw new OnlineError('A player id is not valid');
  return v;
}

function int(v: unknown, min: number, max: number, what: string): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) throw new OnlineError(`${what} is not valid`);
  return v;
}

const when = (v: unknown) => int(v, 0, 8.64e15, 'A date');

function list(v: unknown, max: number, what: string): unknown[] {
  if (!Array.isArray(v) || v.length > max) throw new OnlineError(`${what} is not valid`);
  return v;
}

function who(v: unknown): Who {
  const o = asObject(v, 'A player');
  return { ownerId: ownerId(o.ownerId), nickname: parseNickname(o.nickname) };
}

/** "owner/id", belonging to this owner. */
function owned(v: unknown, owner: string): string {
  if (typeof v !== 'string' || !v.startsWith(`${owner}/`)) throw new OnlineError('An id is not valid');
  parseId(splitOwnedId(v).id, 'An id');
  return v;
}

function matchTeam(v: unknown, owner: string): Team {
  const o = asObject(v, 'A team');
  if (typeof o.color !== 'string' || !HEX.test(o.color)) throw new OnlineError('A team colour is not valid');
  const players = list(o.players, PLAYERS_PER_TEAM, 'A team').map((p) => {
    const q = asObject(p, 'A player');
    if (typeof q.bowler !== 'boolean') throw new OnlineError('A player is not valid');
    return { id: owned(q.id, owner), name: text(q.name, MAX_NAME, 'A player name'), bowler: q.bowler };
  });
  if (players.length !== PLAYERS_PER_TEAM || new Set(players.map((p) => p.id)).size !== PLAYERS_PER_TEAM)
    throw new OnlineError('A team is not valid');
  return {
    id: owned(o.id, owner),
    // Room for " (nickname)", added when both teams had the same name.
    name: text(o.name, MAX_NAME + MAX_NICKNAME + 3, 'A team name'),
    short: text(o.short, 6, 'A short name'),
    color: o.color,
    players,
  };
}

/**
 * Plays the match again from its dice, under the real rules, rather than believing the totals in the file. Anything
 * that could not have happened is refused, and what is kept is the replayed match.
 */
function replay(v: unknown, host: Who, guest: Who, end: MatchEnd): MatchState {
  const o = asObject(v, 'A match');
  const teams = list(o.teams, 2, 'A match');
  const a = matchTeam(teams[0], host.ownerId);
  const b = matchTeam(teams[1], guest.ownerId);
  const order = list(o.order, 2, 'A match');
  if (!(order[0] === a.id && order[1] === b.id) && !(order[0] === b.id && order[1] === a.id))
    throw new OnlineError('A batting order is not valid');
  const [first, second] = order as [string, string];
  const settings = parseSettings(o.settings);
  let m: MatchState = {
    id: text(o.id, 64, 'A match id'),
    createdAt: when(o.createdAt),
    teams: [a, b],
    settings,
    tossText: text(o.tossText, 200, 'A toss'),
    order: [first, second],
    innings: [newInnings(first, second, null)],
    result: null,
  };
  const innings = list(o.innings, 2, 'An innings').map((i) => asObject(i, 'An innings'));
  innings.forEach((inn, idx) => {
    for (const raw of list(inn.balls, settings.overs * 6, 'An innings')) {
      const ball = asObject(raw, 'A ball');
      if (m.result || m.innings.length !== idx + 1) throw new OnlineError('A match has balls after the end');
      if (typeof ball.bowlerId !== 'string') throw new OnlineError('A ball is not valid');
      if (needsBowler(m)) m = setBowler(m, ball.bowlerId);
      const now = currentInnings(m);
      const batting = getTeam(m, now.battingTeamId);
      if (now.bowlerId !== ball.bowlerId || batting.players[now.striker].id !== ball.batterId)
        throw new OnlineError('A ball does not fit the match');
      const roll1 = int(ball.roll1, 1, 6, 'A roll');
      const fielders = getTeam(m, now.bowlingTeamId).players;
      const at = ball.fielderId === undefined ? 0 : fielders.findIndex((p) => p.id === ball.fielderId);
      if (at < 0) throw new OnlineError('A catch is not valid');
      m = applyBall(m, { roll1, ...(roll1 === 5 ? { roll2: int(ball.roll2, 1, 6, 'A roll') } : {}), fielderIdx: at });
    }
  });
  if (end.kind === 'forfeit') {
    if (m.result) throw new OnlineError('A forfeit came after the match was over');
    // The bowler had been chosen but had not bowled yet.
    const given = innings[m.innings.length - 1]?.bowlerId;
    if (needsBowler(m) && typeof given === 'string') m = setBowler(m, given);
    m = applyEvent(m, { type: 'forfeit', teamId: (end.loser === 'host' ? a : b).id });
  }
  if (!m.result) throw new OnlineError('A match is not finished');
  return m;
}

function record(v: unknown): OnlineRecord {
  const o = asObject(v, 'A match');
  const host = who(o.host);
  const guest = who(o.guest);
  if (host.ownerId === guest.ownerId) throw new OnlineError('A match has the same player on both sides');
  const e = asObject(o.end, 'A match ending');
  let end: MatchEnd;
  if (e.kind === 'played') end = { kind: 'played' };
  else if (e.kind === 'forfeit' && (e.loser === 'host' || e.loser === 'guest')) end = { kind: 'forfeit', loser: e.loser };
  else throw new OnlineError('A match ending is not valid');
  const match = replay(o.match, host, guest, end);
  return { id: match.id, match, host, guest, end, completedAt: when(o.completedAt) };
}

export interface ReadBackup {
  me: string[];
  matches: OnlineRecord[];
}

/** Reads and checks a file's text, or throws OnlineError saying what is wrong. Pauses now and then so the page stays responsive. */
export async function readBackup(raw: string): Promise<ReadBackup> {
  if (raw.length > MAX_ONLINE_BACKUP_BYTES) throw new OnlineError('That file is too big');
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new OnlineError('That is not an online stats file');
  }
  const o = asObject(json, 'That file');
  if (o.app === 'dice-cricket')
    throw new OnlineError('That is a backup of the main game. Use Backup & Restore there to import it.');
  if (o.app !== ONLINE_BACKUP_APP) throw new OnlineError('That is not an online stats file');
  if (o.format !== ONLINE_BACKUP_FORMAT) throw new OnlineError('That file is from a newer version of the game');
  const me = [...new Set(list(o.me, MAX_IDS, 'That file').map(ownerId))];
  const matches = new Map<string, OnlineRecord>();
  const items = list(o.matches, MAX_MATCHES, 'That file');
  for (let i = 0; i < items.length; i++) {
    try {
      const r = record(items[i]);
      matches.set(r.id, r);
    } catch (e) {
      throw new OnlineError(`Match ${i + 1}: ${e instanceof Error ? e.message : 'not valid'}`);
    }
    if (i % 10 === 9) await new Promise((r) => setTimeout(r, 0));
  }
  return { me, matches: [...matches.values()] };
}

export interface ImportPreview {
  /** Latest name used by whoever made the file. */
  owner: string | null;
  fresh: number;
  already: number;
  /** The file's player is someone you have played against here, so it may not be yours. */
  isOpponent: boolean;
}

export async function previewImport(b: ReadBackup): Promise<ImportPreview> {
  const have = new Set((await onlineDb.matches.toCollection().primaryKeys()) as string[]);
  const mine = new Set((await onlineDb.me.toArray()).map((x) => x.ownerId));
  const theirs = new Set(b.me.filter((id) => !mine.has(id)));
  let isOpponent = false;
  await onlineDb.matches.each((r) => {
    if (theirs.has(r.host.ownerId) || theirs.has(r.guest.ownerId)) isOpponent = true;
  });
  const latest = [...b.matches].sort((x, y) => y.completedAt - x.completedAt);
  const named = latest.flatMap((r) => [r.host, r.guest]).find((w) => b.me.includes(w.ownerId));
  const already = b.matches.filter((r) => have.has(r.id)).length;
  return { owner: named?.nickname ?? null, fresh: b.matches.length - already, already, isOpponent };
}

/** Adds what is missing. Matches already here are left as they are. */
export async function importOnline(b: ReadBackup): Promise<number> {
  return onlineDb.transaction('rw', onlineDb.matches, onlineDb.me, async () => {
    const have = new Set((await onlineDb.matches.toCollection().primaryKeys()) as string[]);
    const fresh = b.matches.filter((r) => !have.has(r.id));
    await onlineDb.me.bulkPut(b.me.map((id) => ({ ownerId: id })));
    await onlineDb.matches.bulkAdd(fresh);
    return fresh.length;
  });
}
