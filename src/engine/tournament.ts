import { BALLS_PER_OVER, getTeam, oversLimit } from './match';
import type { MatchSettings, MatchState, Rng } from './types';

export type Structure = 'roundRobin' | 'roundRobinPlayoffs' | 'knockout';
export type Stage = 'group' | 'semi' | 'final' | 'knockout';

export const STRUCTURE_LABEL: Record<Structure, string> = {
  roundRobin: 'Round robin (league)',
  roundRobinPlayoffs: 'League + playoffs',
  knockout: 'Knockout',
};

export interface SideSummary {
  runs: number;
  /** Balls faced for net run rate (full quota if all out). */
  balls: number;
}

export interface FixtureResult {
  kind: 'win' | 'tie' | 'draw';
  winnerId?: string;
  /** Team that goes through in a knockout tie (winner, or coin toss on tie/draw). */
  advancedId?: string;
  text: string;
  sides: Record<string, SideSummary>;
}

export interface Fixture {
  id: string;
  stage: Stage;
  round: number;
  label: string;
  homeId: string;
  awayId: string;
  matchId?: string;
  result?: FixtureResult;
}

export interface Tournament {
  id: string;
  name: string;
  createdAt: number;
  teamIds: string[];
  settings: MatchSettings;
  structure: Structure;
  /** League stage: play each opponent once or twice. Missing on older saves = 1. */
  legs?: 1 | 2;
  fixtures: Fixture[];
  byes: string[];
  status: 'active' | 'complete';
  championId?: string;
}

let seq = 0;
const fid = () => `f${Date.now().toString(36)}${(seq++).toString(36)}`;

function shuffle<T>(arr: T[], rng: Rng): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Circle-method round robin: every team plays every other team once, or twice (home and away) when `legs` is 2. */
export function roundRobin(teamIds: string[], legs: 1 | 2 = 1): Fixture[] {
  const arr: (string | null)[] = [...teamIds];
  if (arr.length % 2) arr.push(null);
  const n = arr.length;
  const pairs: { round: number; homeId: string; awayId: string }[] = [];
  for (let r = 0; r < n - 1; r++) {
    for (let i = 0; i < n / 2; i++) {
      const a = arr[i];
      const b = arr[n - 1 - i];
      if (a && b) {
        const [h, w] = r % 2 ? [b, a] : [a, b];
        pairs.push({ round: r + 1, homeId: h, awayId: w });
      }
    }
    arr.splice(1, 0, arr.pop()!);
  }
  const second = legs === 2 ? pairs.map((p) => ({ round: p.round + n - 1, homeId: p.awayId, awayId: p.homeId })) : [];
  return [...pairs, ...second].map((p): Fixture => ({ id: fid(), stage: 'group', label: `Round ${p.round}`, ...p }));
}

export const leagueLabel = (t: Pick<Tournament, 'structure' | 'legs'>) =>
  t.structure !== 'knockout' && t.legs === 2 ? ' · double round robin' : '';

const koLabel = (slots: number) =>
  slots === 2 ? 'Final' : slots === 4 ? 'Semi-final' : slots === 8 ? 'Quarter-final' : `Round of ${slots}`;

function pairUp(ids: string[], round: number, slots: number): Fixture[] {
  const out: Fixture[] = [];
  for (let i = 0; i + 1 < ids.length; i += 2) {
    out.push({
      id: fid(),
      stage: slots === 2 ? 'final' : 'knockout',
      round,
      label: koLabel(slots),
      homeId: ids[i],
      awayId: ids[i + 1],
    });
  }
  return out;
}

export function createTournament(
  id: string,
  name: string,
  teamIds: string[],
  settings: MatchSettings,
  structure: Structure,
  rng: Rng,
  legs: 1 | 2 = 1,
): Tournament {
  if (teamIds.length < 2) throw new Error('Need at least 2 teams');
  const t: Tournament = {
    id, name, createdAt: Date.now(), teamIds: [...teamIds], settings: { ...settings }, structure,
    legs: structure === 'knockout' ? 1 : legs, fixtures: [], byes: [], status: 'active',
  };
  if (structure === 'knockout') {
    const order = shuffle(teamIds, rng);
    let size = 1;
    while (size < order.length) size *= 2;
    t.byes = order.slice(0, size - order.length);
    t.fixtures = pairUp(order.slice(t.byes.length), 1, size);
  } else {
    t.fixtures = roundRobin(shuffle(teamIds, rng), t.legs);
  }
  return t;
}

export const nextFixture = (t: Tournament) => t.fixtures.find((f) => !f.result);

export function summarize(m: MatchState): Record<string, SideSummary> {
  const sides: Record<string, SideSummary> = {};
  const limit = oversLimit(m.settings);
  for (const team of m.teams) sides[team.id] = { runs: 0, balls: 0 };
  for (const inn of m.innings) {
    const s = sides[inn.battingTeamId];
    s.runs += inn.runs;
    s.balls += inn.endReason === 'allOut' && limit !== null ? limit * BALLS_PER_OVER : inn.legalBalls;
  }
  return sides;
}

/** Record a finished match against a fixture and create any follow-on fixtures. Pure. */
export function recordResult(t0: Tournament, fixtureId: string, m: MatchState, rng: Rng): Tournament {
  if (!m.result) throw new Error('Match not finished');
  const t = structuredClone(t0);
  const f = t.fixtures.find((x) => x.id === fixtureId);
  if (!f) throw new Error('Unknown fixture');
  const res: FixtureResult = { kind: m.result.kind, winnerId: m.result.winnerId, text: m.result.text, sides: summarize(m) };
  if (f.stage !== 'group') {
    if (res.winnerId) res.advancedId = res.winnerId;
    else {
      res.advancedId = rng() < 0.5 ? f.homeId : f.awayId;
      res.text += ` — ${getTeam(m, res.advancedId).name} go through on a coin toss`;
    }
  }
  f.matchId = m.id;
  f.result = res;
  advance(t);
  return t;
}

function advance(t: Tournament) {
  if (t.fixtures.some((f) => !f.result)) return;
  if (t.structure === 'roundRobin') {
    t.status = 'complete';
    t.championId = pointsTable(t)[0]?.teamId;
    return;
  }
  const last = t.fixtures[t.fixtures.length - 1];
  if (last.stage === 'final') {
    t.status = 'complete';
    t.championId = last.result!.advancedId;
    return;
  }
  if (t.structure === 'roundRobinPlayoffs') {
    if (last.stage === 'group') {
      const top = pointsTable(t).map((r) => r.teamId);
      if (top.length >= 4) {
        t.fixtures.push(
          { id: fid(), stage: 'semi', round: 100, label: 'Semi-final 1', homeId: top[0], awayId: top[3] },
          { id: fid(), stage: 'semi', round: 100, label: 'Semi-final 2', homeId: top[1], awayId: top[2] },
        );
      } else {
        t.fixtures.push({ id: fid(), stage: 'final', round: 101, label: 'Final', homeId: top[0], awayId: top[1] });
      }
    } else if (last.stage === 'semi') {
      const semis = t.fixtures.filter((f) => f.stage === 'semi');
      t.fixtures.push({
        id: fid(), stage: 'final', round: 101, label: 'Final',
        homeId: semis[0].result!.advancedId!, awayId: semis[1].result!.advancedId!,
      });
    }
    return;
  }
  // knockout
  const round = last.round;
  const winners = [...(round === 1 ? t.byes : []), ...t.fixtures.filter((f) => f.round === round).map((f) => f.result!.advancedId!)];
  if (winners.length === 1) {
    t.status = 'complete';
    t.championId = winners[0];
    return;
  }
  t.fixtures.push(...pairUp(winners, round + 1, winners.length));
}

export interface TableRow {
  teamId: string;
  played: number;
  won: number;
  lost: number;
  tied: number;
  drawn: number;
  points: number;
  nrr: number;
}

export function pointsTable(t: Tournament): TableRow[] {
  const test = t.settings.format === 'test';
  const rows = new Map<string, TableRow & { rf: number; bf: number; ra: number; bb: number }>();
  for (const id of t.teamIds)
    rows.set(id, { teamId: id, played: 0, won: 0, lost: 0, tied: 0, drawn: 0, points: 0, nrr: 0, rf: 0, bf: 0, ra: 0, bb: 0 });
  for (const f of t.fixtures) {
    if (f.stage !== 'group' || !f.result) continue;
    const r = f.result;
    for (const [me, opp] of [[f.homeId, f.awayId], [f.awayId, f.homeId]]) {
      const row = rows.get(me)!;
      row.played++;
      if (r.kind === 'tie') { row.tied++; row.points += test ? 6 : 1; }
      else if (r.kind === 'draw') { row.drawn++; row.points += 4; }
      else if (r.winnerId === me) { row.won++; row.points += test ? 12 : 2; }
      else row.lost++;
      row.rf += r.sides[me]?.runs ?? 0;
      row.bf += r.sides[me]?.balls ?? 0;
      row.ra += r.sides[opp]?.runs ?? 0;
      row.bb += r.sides[opp]?.balls ?? 0;
    }
  }
  const out = [...rows.values()].map((r) => {
    const forRate = r.bf ? (r.rf / r.bf) * BALLS_PER_OVER : 0;
    const agRate = r.bb ? (r.ra / r.bb) * BALLS_PER_OVER : 0;
    return {
      teamId: r.teamId, played: r.played, won: r.won, lost: r.lost, tied: r.tied, drawn: r.drawn,
      points: r.points, nrr: test ? 0 : forRate - agRate,
    };
  });
  return out.sort((a, b) => b.points - a.points || b.nrr - a.nrr || b.won - a.won);
}
