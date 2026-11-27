import type { MatchState, Team } from '../engine/types';
import { kitsFor, type Kits } from './kits';
import { outcomeOf } from './outcome';
import { planDelivery, type DeliveryPlan } from './plan';
import { seedFor } from './rng';
import type { Numbers } from './scene/cast';
import { timeline, type Speed, type Timeline } from './timing';

export interface MatchDelivery {
  key: string;
  plan: DeliveryPlan;
  timeline: Timeline;
  numbers: Numbers;
  kits: Kits;
}

const teamById = (m: MatchState, id: string): Team => m.teams.find((t) => t.id === id)!;
const shirt = (team: Team, playerId: string | undefined) => {
  const i = playerId ? team.players.findIndex((p) => p.id === playerId) : -1;
  return i >= 0 ? i + 1 : undefined;
};

/** Kits and numbers for the players waiting for the next ball. */
export function waitingFor(m: MatchState): { kits: Kits; numbers: Numbers } {
  const inn = m.innings[m.innings.length - 1];
  const bat = teamById(m, inn.battingTeamId);
  const bowl = teamById(m, inn.bowlingTeamId);
  return {
    kits: kitsFor(bat.color, bowl.color),
    numbers: { striker: inn.striker + 1, nonStriker: inn.nonStriker + 1, bowler: shirt(bowl, inn.bowlerId ?? undefined) },
  };
}

/**
 * The 3D delivery for the ball that turned `before` into `after` (both modes call this with the same states,
 * so online players get the same seed and the same shot). Null if no ball was added.
 */
export function deliveryFor(before: MatchState, after: MatchState, speed: Speed): MatchDelivery | null {
  const innIdx = before.innings.length - 1;
  const was = before.innings[innIdx];
  const inn = after.innings[innIdx];
  if (!inn || inn.balls.length !== was.balls.length + 1) return null;
  const ballIdx = inn.balls.length - 1;
  const ball = inn.balls[ballIdx];
  const outcome = outcomeOf(ball);
  const plan = planDelivery(outcome, seedFor(after.id, innIdx, ballIdx));
  const bat = teamById(after, inn.battingTeamId);
  const bowl = teamById(after, inn.bowlingTeamId);
  // The non-striker as the ball was bowled (strike may have changed since).
  const nonStrikerId = was.striker === bat.players.findIndex((p) => p.id === ball.batterId) ? bat.players[was.nonStriker]?.id : bat.players[was.striker]?.id;
  // Catcher: the real fielder from the scorecard. Chaser: a stand-in from the fielding side (not the bowler).
  let fielder: number | undefined;
  if (outcome.kind === 'caught') fielder = shirt(bowl, ball.fielderId);
  else if (plan.fielder !== null && plan.fielder >= 0) {
    const others = bowl.players.filter((p) => p.id !== ball.bowlerId);
    fielder = shirt(bowl, others[plan.fielder % others.length]?.id);
  }
  return {
    key: `${after.id}:${innIdx}:${ballIdx}`,
    plan,
    timeline: timeline(outcome.kind, speed),
    numbers: { striker: shirt(bat, ball.batterId), nonStriker: shirt(bat, nonStrikerId), bowler: shirt(bowl, ball.bowlerId), fielder },
    kits: kitsFor(bat.color, bowl.color),
  };
}
