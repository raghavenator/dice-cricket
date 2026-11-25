import type { MatchRecord } from '../data/db';
import type { FormLetter } from '../engine/stats';
import type { Innings, MatchState } from '../engine/types';
import type { OnlineRecord } from './onlineDb';
import type { SeatId, Who } from './protocol';
import { ownedId, splitOwnedId } from './rules';

// Everything here is pure. Player figures come from the engine's own `aggregate` and friends, unchanged: this only
// prepares the matches for them.

/** Stands for the player in stats, whichever of their public ids a match was played under. */
export const ME = 'me';

/** A match with every team and player id moved to a new owner. The original is not changed. */
export function remapOwners(m: MatchState, owner: (ownerId: string) => string): MatchState {
  const id = (x: string) => {
    const o = splitOwnedId(x);
    return ownedId(owner(o.ownerId), o.id);
  };
  const maybe = (x: string | null) => (x === null ? null : id(x));
  const innings = (i: Innings): Innings => ({
    ...i,
    battingTeamId: id(i.battingTeamId),
    bowlingTeamId: id(i.bowlingTeamId),
    bowlerId: maybe(i.bowlerId),
    prevOverBowlerId: maybe(i.prevOverBowlerId),
    balls: i.balls.map((b) => ({
      ...b,
      batterId: id(b.batterId),
      bowlerId: id(b.bowlerId),
      ...(b.fielderId === undefined ? {} : { fielderId: id(b.fielderId) }),
    })),
  });
  const [a, b] = m.teams.map((t) => ({ ...t, id: id(t.id), players: t.players.map((p) => ({ ...p, id: id(p.id) })) }));
  return {
    ...m,
    teams: [a, b],
    order: [id(m.order[0]), id(m.order[1])],
    innings: m.innings.map(innings),
    result: m.result && { ...m.result, ...(m.result.winnerId ? { winnerId: id(m.result.winnerId) } : {}) },
  };
}

/** Which side was the player's. "both" happens when someone plays themselves from two browsers and merges them. */
export function sideOf(r: Pick<OnlineRecord, 'host' | 'guest'>, mine: Set<string>): SeatId | 'both' | null {
  const host = mine.has(r.host.ownerId);
  const guest = mine.has(r.guest.ownerId);
  return host && guest ? 'both' : host ? 'host' : guest ? 'guest' : null;
}

/** Ids moved to ME (or another id) for the player's side, so that a career is not split between browsers. */
export const asMine = (m: MatchState, mine: Set<string>, me = ME): MatchState =>
  remapOwners(m, (o) => (mine.has(o) ? me : o));

/** Identical teams were given "(Sam)" names and numbered short names for the match. This takes that off again. */
function plainNames(m: MatchState): { name: string; short: string }[] {
  const parts = m.teams.map((t) => /^(.*) \(([^()]*)\)$/.exec(t.name));
  const [a, b] = parts;
  const clash = a && b && a[1].toLowerCase() === b[1].toLowerCase();
  const shorts = m.teams.map((t) => t.short);
  const numbered =
    shorts[0].endsWith('1') && shorts[1].endsWith('2') && shorts[0].slice(0, -1).toLowerCase() === shorts[1].slice(0, -1).toLowerCase();
  return m.teams.map((t, i) => ({
    name: clash ? parts[i]![1] : t.name,
    short: numbered ? t.short.slice(0, -1) : t.short,
  }));
}

/** One of the player's matches, ready for stats. */
export interface StatMatch {
  id: string;
  completedAt: number;
  /** Your ids are under ME, and the opponent's team is named after them: "Harbour Hawks (Sam)". */
  match: MatchState;
  myTeamId: string;
  opponent: Who;
  overs: number;
  outcome: FormLetter;
  forfeit: boolean;
}

/** The player's matches, oldest first. Leaves out any that are not theirs, or that they played against themselves. */
export function statMatches(records: OnlineRecord[], mine: Set<string>): StatMatch[] {
  const out: StatMatch[] = [];
  for (const r of records) {
    const you = sideOf(r, mine);
    if (you === null || you === 'both' || !r.match.result) continue;
    const opponent = you === 'host' ? r.guest : r.host;
    const match = asMine(r.match, mine);
    const names = plainNames(r.match);
    const [a, b] = match.teams.map((t, i) =>
      splitOwnedId(t.id).ownerId === ME ? { ...t, ...names[i] } : { ...t, ...names[i], name: `${names[i].name} (${opponent.nickname})` },
    );
    match.teams = [a, b];
    const myTeamId = (splitOwnedId(a.id).ownerId === ME ? a : b).id;
    const { kind, winnerId } = r.match.result;
    out.push({
      id: r.id,
      completedAt: r.completedAt,
      match,
      myTeamId,
      opponent,
      overs: r.match.settings.overs,
      outcome: kind === 'tie' ? 'T' : kind === 'draw' ? 'D' : match.result!.winnerId === myTeamId && winnerId ? 'W' : 'L',
      forfeit: r.end.kind === 'forfeit',
    });
  }
  return out.sort((x, y) => x.completedAt - y.completedAt);
}

// ---------- Filters ----------

export interface Filters {
  whose: 'mine' | 'theirs' | 'all';
  /** My team's id, or '' for any. */
  team: string;
  /** Opponent's public id, or '' for any. */
  opponent: string;
  /** 0 for any. */
  overs: number;
}

export const NO_FILTERS: Filters = { whose: 'mine', team: '', opponent: '', overs: 0 };

export const filterMatches = (ms: StatMatch[], f: Filters): StatMatch[] =>
  ms.filter(
    (m) => (!f.team || m.myTeamId === f.team) && (!f.opponent || m.opponent.ownerId === f.opponent) && (!f.overs || m.overs === f.overs),
  );

export const isMine = (id: string): boolean => splitOwnedId(id).ownerId === ME;

export const whoseRows = <T extends { playerId: string }>(rows: T[], whose: Filters['whose']): T[] =>
  whose === 'all' ? rows : rows.filter((r) => isMine(r.playerId) === (whose === 'mine'));

/** What there is to choose from, with the latest name for each. */
export function filterOptions(ms: StatMatch[]) {
  const teams = new Map<string, string>();
  const opponents = new Map<string, string>();
  const overs = new Set<number>();
  for (const m of ms) {
    teams.set(m.myTeamId, m.match.teams.find((t) => t.id === m.myTeamId)!.name);
    opponents.set(m.opponent.ownerId, m.opponent.nickname);
    overs.add(m.overs);
  }
  const byName = (x: [string, string], y: [string, string]) => x[1].localeCompare(y[1]);
  return { teams: [...teams].sort(byName), opponents: [...opponents].sort(byName), overs: [...overs].sort((x, y) => x - y) };
}

// ---------- Records ----------

export interface Tally {
  played: number;
  won: number;
  lost: number;
  tied: number;
}

export interface Total {
  runs: number;
  wickets: number;
  matchId: string;
  opponent: string;
}

export interface Overview extends Tally {
  winPct: string;
  /** e.g. "W3", or "" before any match. */
  streak: string;
  forfeitWins: number;
  forfeitLosses: number;
  highest: Total | null;
  /** Only innings that ran their course: an innings cut short by a win or a forfeit is not a low total. */
  lowest: Total | null;
}

function tally(ms: StatMatch[]): Tally {
  const n = (o: FormLetter) => ms.filter((m) => m.outcome === o).length;
  return { played: ms.length, won: n('W'), lost: n('L'), tied: n('T') + n('D') };
}

export const winPct = (t: Tally): string => (t.played ? `${Math.round((t.won / t.played) * 100)}%` : '-');

export function overview(ms: StatMatch[]): Overview {
  const t = tally(ms);
  const last = ms[ms.length - 1]?.outcome;
  let run = 0;
  for (let i = ms.length - 1; i >= 0 && ms[i].outcome === last; i--) run++;
  let highest: Total | null = null;
  let lowest: Total | null = null;
  for (const m of ms) {
    for (const inn of m.match.innings) {
      if (inn.battingTeamId !== m.myTeamId || !inn.balls.length) continue;
      const total = { runs: inn.runs, wickets: inn.wickets, matchId: m.id, opponent: m.opponent.nickname };
      if (!highest || total.runs > highest.runs) highest = total;
      if ((inn.endReason === 'allOut' || inn.endReason === 'overs') && (!lowest || total.runs < lowest.runs)) lowest = total;
    }
  }
  return {
    ...t,
    winPct: winPct(t),
    streak: last ? `${last}${run}` : '',
    forfeitWins: ms.filter((m) => m.forfeit && m.outcome === 'W').length,
    forfeitLosses: ms.filter((m) => m.forfeit && m.outcome === 'L').length,
    highest,
    lowest,
  };
}

export interface HeadToHead extends Tally {
  opponent: Who;
  lastPlayed: number;
  /** Newest first. */
  form: FormLetter[];
}

/** Your record against each opponent, most played first. */
export function headToHead(ms: StatMatch[]): HeadToHead[] {
  const by = new Map<string, StatMatch[]>();
  for (const m of ms) by.set(m.opponent.ownerId, [...(by.get(m.opponent.ownerId) ?? []), m]);
  return [...by.values()]
    .map((list) => {
      const last = list[list.length - 1];
      return {
        ...tally(list),
        opponent: last.opponent,
        lastPlayed: last.completedAt,
        form: list.slice(-5).reverse().map((m) => m.outcome),
      };
    })
    .sort((x, y) => y.played - x.played || y.lastPlayed - x.lastPlayed);
}

/** What the scorecards' hover cards read: online matches only, with your side under the id used on screen. */
export function hoverHistory(records: OnlineRecord[], mine: Set<string>, me: string): MatchRecord[] {
  return records
    .filter((r) => sideOf(r, mine) !== 'both')
    .map((r) => ({
      id: r.id,
      tournamentId: null,
      fixtureId: null,
      seriesId: null,
      completedAt: r.completedAt,
      match: asMine(r.match, mine, me),
    }));
}
