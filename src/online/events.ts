import { applyBall, currentInnings, getTeam, setBowler } from '../engine/match';
import type { MatchState, Rolls } from '../engine/types';
import { chooseNextBatter } from './rules';

/** Everything that can change a match once it has started. */
export type MatchEvent =
  | { type: 'ball'; rolls: Rolls; auto?: boolean }
  | { type: 'bowler'; playerId: string; auto?: boolean }
  | { type: 'batter'; playerId: string; auto?: boolean }
  /** The losing side's team id. */
  | { type: 'forfeit'; teamId: string };

/** The server and both browsers all move a match forward with this, so they cannot disagree. */
export function applyEvent(m: MatchState, e: MatchEvent): MatchState {
  switch (e.type) {
    case 'ball':
      return applyBall(m, e.rolls);
    case 'bowler':
      return setBowler(m, e.playerId);
    case 'batter':
      return chooseNextBatter(m, e.playerId);
    case 'forfeit': {
      if (m.result) throw new Error('Match is over');
      const winner = m.teams.find((t) => t.id !== getTeam(m, e.teamId).id)!;
      return { ...structuredClone(m), result: { kind: 'win', winnerId: winner.id, text: `${winner.name} won by forfeit` } };
    }
  }
}

/** A short fingerprint sent with each event, so a browser that has drifted notices and asks for a fresh copy. */
export function digest(m: MatchState): string {
  const inns = m.innings.map((i) => `${i.runs}/${i.wickets}/${i.legalBalls}/${i.striker}/${i.nonStriker}`);
  const inn = currentInnings(m);
  const batting = getTeam(m, inn.battingTeamId).players;
  return [...inns, batting[inn.striker]?.id, inn.bowlerId ?? '-', m.result?.text ?? '-'].join('|');
}
