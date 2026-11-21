import { BALLS_PER_OVER, getTeam } from './match';
import type { Ball, MatchState } from './types';

export const formatOvers = (balls: number) =>
  balls % BALLS_PER_OVER === 0 ? `${balls / BALLS_PER_OVER}` : `${Math.floor(balls / BALLS_PER_OVER)}.${balls % BALLS_PER_OVER}`;

export const ratio = (a: number, b: number, digits = 2) => (b > 0 ? (a / b).toFixed(digits) : '-');

export interface BatRow {
  playerId: string;
  name: string;
  batted: boolean;
  out: boolean;
  dismissal: string;
  runs: number;
  balls: number;
  fours: number;
  sixes: number;
  faced: Ball[];
  onStrike: boolean;
  atCrease: boolean;
}

export function battingCard(m: MatchState, innIdx: number): BatRow[] {
  const inn = m.innings[innIdx];
  const bat = getTeam(m, inn.battingTeamId);
  const fld = getTeam(m, inn.bowlingTeamId);
  const nameOf = (id?: string) => fld.players.find((p) => p.id === id)?.name ?? '?';
  return bat.players.map((p, i) => {
    const faced = inn.balls.filter((b) => b.batterId === p.id);
    const outBall = faced.find((b) => b.wicket);
    const batted = i < inn.nextIn;
    let dismissal = batted ? 'not out' : '';
    if (outBall) {
      const bowler = nameOf(outBall.bowlerId);
      if (outBall.how === 'caught') {
        dismissal = outBall.fielderId === outBall.bowlerId ? `c & b ${bowler}` : `c ${nameOf(outBall.fielderId)} b ${bowler}`;
      } else if (outBall.how === 'lbw') dismissal = `lbw b ${bowler}`;
      else dismissal = `b ${bowler}`;
    }
    const atCrease = !inn.done && batted && !outBall && (i === inn.striker || i === inn.nonStriker);
    return {
      playerId: p.id,
      name: p.name,
      batted,
      out: !!outBall,
      dismissal,
      runs: faced.reduce((s, b) => s + b.runs, 0),
      balls: faced.length,
      fours: faced.filter((b) => b.runs === 4).length,
      sixes: faced.filter((b) => b.runs === 6).length,
      faced,
      onStrike: atCrease && i === inn.striker,
      atCrease,
    };
  });
}

export interface BowlRow {
  playerId: string;
  name: string;
  balls: number;
  maidens: number;
  runs: number;
  wickets: number;
  overs: Ball[][];
  current: boolean;
}

export function bowlingCard(m: MatchState, innIdx: number): BowlRow[] {
  const inn = m.innings[innIdx];
  const fld = getTeam(m, inn.bowlingTeamId);
  const order: string[] = [];
  for (const b of inn.balls) if (!order.includes(b.bowlerId)) order.push(b.bowlerId);
  if (inn.bowlerId && !order.includes(inn.bowlerId)) order.push(inn.bowlerId);
  return order.map((id) => {
    const balls = inn.balls.filter((b) => b.bowlerId === id);
    const byOver = new Map<number, Ball[]>();
    for (const b of balls) byOver.set(b.over, [...(byOver.get(b.over) ?? []), b]);
    const overs = [...byOver.values()];
    return {
      playerId: id,
      name: fld.players.find((p) => p.id === id)?.name ?? '?',
      balls: balls.length,
      maidens: overs.filter((o) => o.length === BALLS_PER_OVER && o.every((b) => b.runs === 0)).length,
      runs: balls.reduce((s, b) => s + b.runs, 0),
      wickets: balls.filter((b) => b.wicket).length,
      overs,
      current: !inn.done && inn.bowlerId === id,
    };
  });
}

// ---------- Career / tournament aggregation ----------

export interface CareerBat {
  playerId: string;
  name: string;
  team: string;
  matches: number;
  innings: number;
  notOuts: number;
  runs: number;
  balls: number;
  fours: number;
  sixes: number;
  high: number;
  highNotOut: boolean;
  fifties: number;
  hundreds: number;
}

export interface CareerBowl {
  playerId: string;
  name: string;
  team: string;
  matches: number;
  innings: number;
  balls: number;
  maidens: number;
  runs: number;
  wickets: number;
  bestW: number;
  bestR: number;
  fiveFors: number;
}

export function aggregate(matches: MatchState[]): { bat: CareerBat[]; bowl: CareerBowl[] } {
  const bat = new Map<string, CareerBat>();
  const bowl = new Map<string, CareerBowl>();
  const sorted = [...matches].sort((a, b) => a.createdAt - b.createdAt);

  for (const m of sorted) {
    const appearedBowl = new Set<string>();
    for (const t of m.teams) {
      for (const p of t.players) {
        const b = bat.get(p.id) ?? {
          playerId: p.id, name: p.name, team: t.name, matches: 0, innings: 0, notOuts: 0, runs: 0, balls: 0,
          fours: 0, sixes: 0, high: 0, highNotOut: false, fifties: 0, hundreds: 0,
        };
        b.name = p.name; // latest name wins
        b.team = t.name;
        b.matches++;
        bat.set(p.id, b);
      }
    }
    m.innings.forEach((_, idx) => {
      for (const r of battingCard(m, idx)) {
        if (!r.batted) continue;
        const c = bat.get(r.playerId)!;
        c.innings++;
        if (!r.out) c.notOuts++;
        c.runs += r.runs;
        c.balls += r.balls;
        c.fours += r.fours;
        c.sixes += r.sixes;
        if (r.runs > c.high || (r.runs === c.high && !r.out)) {
          c.high = r.runs;
          c.highNotOut = !r.out;
        }
        if (r.runs >= 100) c.hundreds++;
        else if (r.runs >= 50) c.fifties++;
      }
      const fldTeam = getTeam(m, m.innings[idx].bowlingTeamId);
      for (const r of bowlingCard(m, idx)) {
        if (r.balls === 0) continue;
        const c = bowl.get(r.playerId) ?? {
          playerId: r.playerId, name: r.name, team: fldTeam.name, matches: 0, innings: 0, balls: 0, maidens: 0,
          runs: 0, wickets: 0, bestW: -1, bestR: 0, fiveFors: 0,
        };
        c.name = r.name;
        c.team = fldTeam.name;
        if (!appearedBowl.has(r.playerId)) {
          c.matches++;
          appearedBowl.add(r.playerId);
        }
        c.innings++;
        c.balls += r.balls;
        c.maidens += r.maidens;
        c.runs += r.runs;
        c.wickets += r.wickets;
        if (r.wickets >= 5) c.fiveFors++;
        if (r.wickets > c.bestW || (r.wickets === c.bestW && r.runs < c.bestR)) {
          c.bestW = r.wickets;
          c.bestR = r.runs;
        }
        bowl.set(r.playerId, c);
      }
    });
  }
  return { bat: [...bat.values()], bowl: [...bowl.values()] };
}

export const battingAverage = (c: CareerBat) => ratio(c.runs, c.innings - c.notOuts);
export const strikeRate = (runs: number, balls: number) => (balls > 0 ? ((runs / balls) * 100).toFixed(1) : '-');

// ---------- Recent performances ----------

export interface BatPerf {
  matchId: string;
  runs: number;
  balls: number;
  out: boolean;
  vs: string;
  date: number;
}

export interface BowlPerf {
  matchId: string;
  wickets: number;
  runs: number;
  balls: number;
  vs: string;
  date: number;
}

const newestFirst = (matches: MatchState[]) => [...matches].sort((a, b) => b.createdAt - a.createdAt);

/** A player's last `n` innings with the bat, newest first (Test matches can give two per match). */
export function recentBatting(matches: MatchState[], playerId: string, n = 5): BatPerf[] {
  const out: BatPerf[] = [];
  for (const m of newestFirst(matches)) {
    for (let idx = m.innings.length - 1; idx >= 0; idx--) {
      const inn = m.innings[idx];
      if (!getTeam(m, inn.battingTeamId).players.some((p) => p.id === playerId)) continue;
      const row = battingCard(m, idx).find((r) => r.playerId === playerId);
      if (!row?.batted) continue;
      out.push({ matchId: m.id, runs: row.runs, balls: row.balls, out: row.out, vs: getTeam(m, inn.bowlingTeamId).short, date: m.createdAt });
      if (out.length >= n) return out;
    }
  }
  return out;
}

/** A player's last `n` bowling innings, newest first. */
export function recentBowling(matches: MatchState[], playerId: string, n = 5): BowlPerf[] {
  const out: BowlPerf[] = [];
  for (const m of newestFirst(matches)) {
    for (let idx = m.innings.length - 1; idx >= 0; idx--) {
      const inn = m.innings[idx];
      if (!getTeam(m, inn.bowlingTeamId).players.some((p) => p.id === playerId)) continue;
      const row = bowlingCard(m, idx).find((r) => r.playerId === playerId && r.balls > 0);
      if (!row) continue;
      out.push({ matchId: m.id, wickets: row.wickets, runs: row.runs, balls: row.balls, vs: getTeam(m, inn.battingTeamId).short, date: m.createdAt });
      if (out.length >= n) return out;
    }
  }
  return out;
}
