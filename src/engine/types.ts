export type Rng = () => number;

export interface Player {
  id: string;
  name: string;
  /** Designated bowler — preferred when picking who bowls. */
  bowler: boolean;
}

export interface Team {
  id: string;
  name: string;
  short: string;
  color: string;
  /** Batting order, always 11 players. */
  players: Player[];
}

export type Format = 'limited' | 'test';
export type BowlerMode = 'auto' | 'manual';

export interface MatchSettings {
  format: Format;
  /** Limited: overs per innings. Test: max overs per innings (0 = unlimited). */
  overs: number;
  bowlerMode: BowlerMode;
}

export type DismissalHow = 'bowled' | 'caught' | 'lbw';

export interface Ball {
  /** 0-based over index within the innings. */
  over: number;
  /** 1-based ball number within the over. */
  ball: number;
  batterId: string;
  bowlerId: string;
  roll1: number;
  /** Only present when roll1 was a 5 (the wicket check). */
  roll2?: number;
  runs: number;
  wicket: boolean;
  how?: DismissalHow;
  fielderId?: string;
}

export type InningsEnd = 'allOut' | 'overs' | 'target';

export interface Innings {
  battingTeamId: string;
  bowlingTeamId: string;
  balls: Ball[];
  runs: number;
  wickets: number;
  legalBalls: number;
  /** Indices into the batting team's batting order. */
  striker: number;
  nonStriker: number;
  nextIn: number;
  bowlerId: string | null;
  prevOverBowlerId: string | null;
  /** Runs needed in this innings to win, if chasing. */
  target: number | null;
  done: boolean;
  endReason?: InningsEnd;
}

export interface Result {
  kind: 'win' | 'tie' | 'draw';
  winnerId?: string;
  text: string;
}

export interface MatchState {
  id: string;
  createdAt: number;
  teams: [Team, Team];
  settings: MatchSettings;
  tossText: string;
  /** [team batting first, team bowling first] */
  order: [string, string];
  innings: Innings[];
  result: Result | null;
}

/** The raw dice for a single delivery, decided before it is animated and applied. */
export interface Rolls {
  roll1: number;
  roll2?: number;
  /** Random index used to pick a catcher when the dismissal is "caught". */
  fielderIdx: number;
}
