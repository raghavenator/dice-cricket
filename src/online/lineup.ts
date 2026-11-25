import { maxOversPerBowler } from '../engine/match';
import type { MatchSettings, Team } from '../engine/types';
import { MAX_OVERS, OnlineError, PLAYERS_PER_TEAM, asObject, parseId } from './validate';

/** A captain's choices for one match. Never written back to the saved team. Holds player ids. */
export interface Lineup {
  battingOrder: string[];
  /** Marked bowlers, in order of preference. */
  bowlers: string[];
  /** Optional: who bowls each over. */
  bowlingPlan?: string[];
}

export const onlineSettings = (overs: number): MatchSettings => ({ format: 'limited', overs, bowlerMode: 'manual' });

export const bowlerCap = (overs: number): number => maxOversPerBowler(onlineSettings(overs))!;

/** Fewest bowlers that can legally get through the innings. */
export const minBowlers = (overs: number): number =>
  overs === 1 ? 1 : Math.max(2, Math.ceil(overs / bowlerCap(overs)));

export function defaultLineup(team: Team): Lineup {
  return {
    battingOrder: team.players.map((p) => p.id),
    bowlers: team.players.filter((p) => p.bowler).map((p) => p.id),
  };
}

/** Reads a lineup received from a client. Only checks its shape; see `lineupProblem` for the rules. */
export function parseLineup(v: unknown): Lineup {
  const o = asObject(v, 'Lineup');
  const ids = (x: unknown, max: number): string[] => {
    if (!Array.isArray(x) || x.length > max) throw new OnlineError('Lineup is not valid');
    return x.map((id) => parseId(id, 'Player id'));
  };
  return {
    battingOrder: ids(o.battingOrder, PLAYERS_PER_TEAM),
    bowlers: ids(o.bowlers, PLAYERS_PER_TEAM),
    ...(o.bowlingPlan === undefined ? {} : { bowlingPlan: ids(o.bowlingPlan, MAX_OVERS) }),
  };
}

/** Why this bowling plan is illegal, or null. */
export function planProblem(plan: string[], bowlers: string[], overs: number): string | null {
  if (plan.length !== overs) return 'Choose a bowler for every over';
  const cap = bowlerCap(overs);
  const count = new Map<string, number>();
  for (let i = 0; i < plan.length; i++) {
    const id = plan[i];
    if (!bowlers.includes(id)) return `Over ${i + 1}: that player is not marked as a bowler`;
    if (i > 0 && plan[i - 1] === id) return `Over ${i + 1}: no one can bowl two overs in a row`;
    const n = (count.get(id) ?? 0) + 1;
    if (n > cap) return `Over ${i + 1}: that bowler is past the limit of ${cap} over${cap === 1 ? '' : 's'}`;
    count.set(id, n);
  }
  return null;
}

/** Why this lineup cannot be used, in words for the player, or null when it is fine. */
export function lineupProblem(team: Team, l: Lineup, overs: number): string | null {
  const squad = new Set(team.players.map((p) => p.id));
  const order = new Set(l.battingOrder);
  if (l.battingOrder.length !== squad.size || order.size !== squad.size || !l.battingOrder.every((id) => squad.has(id)))
    return 'The batting order must list every player once';
  if (new Set(l.bowlers).size !== l.bowlers.length || !l.bowlers.every((id) => squad.has(id)))
    return 'The bowlers must be different players from this team';
  const need = minBowlers(overs);
  if (l.bowlers.length < need)
    return `Mark at least ${need} bowler${need === 1 ? '' : 's'} for ${overs} over${overs === 1 ? '' : 's'}`;
  return l.bowlingPlan ? planProblem(l.bowlingPlan, l.bowlers, overs) : null;
}

/** A legal plan sharing the overs evenly, or null if there are too few bowlers. */
export function autoPlan(bowlers: string[], overs: number): string[] | null {
  if (bowlers.length < minBowlers(overs)) return null;
  const bowled = new Map(bowlers.map((id) => [id, 0]));
  const plan: string[] = [];
  while (plan.length < overs) {
    let best: string | null = null;
    for (const id of bowlers) {
      if (id === plan[plan.length - 1]) continue;
      if (best === null || bowled.get(id)! < bowled.get(best)!) best = id;
    }
    if (best === null) return null;
    bowled.set(best, bowled.get(best)! + 1);
    plan.push(best);
  }
  return plan;
}

/** A copy of the team in this batting order with these bowlers marked. The original is not touched. */
export function applyLineup(team: Team, l: Lineup): Team {
  return {
    ...team,
    players: l.battingOrder.map((id) => {
      const p = team.players.find((x) => x.id === id);
      if (!p) throw new OnlineError('The batting order must list every player once');
      return { ...p, bowler: l.bowlers.includes(id) };
    }),
  };
}
