import { currentInnings, getTeam, newInnings } from '../engine/match';
import type { MatchSettings, MatchState, Player, Team } from '../engine/types';
import { OnlineError } from './validate';

/** Someone in a match: their shareable public id, their nickname, and the team (lineup already applied). */
export interface Side {
  ownerId: string;
  nickname: string;
  team: Team;
}

/** Two people may bring the same team, so ids carry their owner. They stay the same from match to match. */
export const ownedId = (ownerId: string, id: string): string => `${ownerId}/${id}`;

export function splitOwnedId(id: string): { ownerId: string; id: string } {
  const i = id.indexOf('/');
  if (i < 0) throw new OnlineError('Not an online id');
  return { ownerId: id.slice(0, i), id: id.slice(i + 1) };
}

const ownTeam = ({ ownerId, team }: Side): Team => ({
  ...team,
  id: ownedId(ownerId, team.id),
  players: team.players.map((p) => ({ ...p, id: ownedId(ownerId, p.id) })),
});

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

export interface TossResult {
  /** Public id of whoever won the toss. */
  winnerId: string;
  choice: 'bat' | 'bowl';
}

/** A normal MatchState, so the existing engine, scorecards and charts all work on it. */
export function createOnlineMatch(
  id: string,
  host: Side,
  guest: Side,
  settings: MatchSettings,
  toss: TossResult,
  createdAt: number,
): MatchState {
  if (host.ownerId === guest.ownerId) throw new OnlineError('You cannot play against yourself');
  if (settings.format !== 'limited' || settings.bowlerMode !== 'manual') throw new OnlineError('Settings are not valid');
  if (toss.winnerId !== host.ownerId && toss.winnerId !== guest.ownerId) throw new OnlineError('Unknown toss winner');
  const a = ownTeam(host);
  const b = ownTeam(guest);
  // Tell identical teams apart on the scoreboard and in the result.
  if (same(a.name, b.name)) {
    const clash = same(host.nickname, guest.nickname);
    a.name = `${a.name} (${clash ? 'host' : host.nickname})`;
    b.name = `${b.name} (${clash ? 'guest' : guest.nickname})`;
  }
  if (same(a.short, b.short)) {
    a.short = `${a.short}1`;
    b.short = `${b.short}2`;
  }
  const winner = toss.winnerId === host.ownerId ? a : b;
  const loser = winner === a ? b : a;
  const order: [string, string] = toss.choice === 'bat' ? [winner.id, loser.id] : [loser.id, winner.id];
  return {
    id,
    createdAt,
    teams: [a, b],
    settings: { ...settings },
    tossText: `${winner.name} won the toss and chose to ${toss.choice}`,
    order,
    innings: [newInnings(order[0], order[1], null)],
    result: null,
  };
}

/** Who can come in next: only straight after a wicket, before the new batter has faced a ball. Default first. */
export function nextBatterOptions(m: MatchState): Player[] {
  if (m.result) return [];
  const inn = currentInnings(m);
  const last = inn.balls[inn.balls.length - 1];
  if (inn.done || !last?.wicket) return [];
  return getTeam(m, inn.battingTeamId).players.slice(inn.nextIn - 1);
}

/**
 * Send in a different batter. The engine has already walked in the next player on the list (index nextIn - 1), so
 * the chosen player is moved to that position in this match's own copy of the team. Safe only because each team
 * bats once online: earlier scorecards read the same list.
 */
export function chooseNextBatter(m0: MatchState, playerId: string): MatchState {
  if (!nextBatterOptions(m0).some((p) => p.id === playerId)) throw new OnlineError('That player cannot bat now');
  const m = structuredClone(m0);
  const inn = currentInnings(m);
  const { players } = getTeam(m, inn.battingTeamId);
  const [chosen] = players.splice(players.findIndex((p) => p.id === playerId), 1);
  players.splice(inn.nextIn - 1, 0, chosen);
  return m;
}
