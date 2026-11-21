import { resolveRolls, rollDice } from './dice';
import type { Innings, MatchSettings, MatchState, Player, Result, Rng, Rolls, Team } from './types';

export const BALLS_PER_OVER = 6;

export const inningsPerMatch = (s: MatchSettings) => (s.format === 'test' ? 4 : 2);

/** Limited overs: no bowler may exceed a fifth of the overs (rounded up). Tests: no cap. */
export function maxOversPerBowler(s: MatchSettings): number | null {
  if (s.format !== 'limited') return null;
  return Math.max(1, Math.ceil(s.overs / 5));
}

/** Overs limit for an innings, or null when unlimited. */
export function oversLimit(s: MatchSettings): number | null {
  return s.overs > 0 ? s.overs : null;
}

export const getTeam = (m: MatchState, id: string): Team => {
  const t = m.teams.find((x) => x.id === id);
  if (!t) throw new Error(`Unknown team ${id}`);
  return t;
};

export const currentInnings = (m: MatchState): Innings => m.innings[m.innings.length - 1];

export function newInnings(battingTeamId: string, bowlingTeamId: string, target: number | null): Innings {
  return {
    battingTeamId,
    bowlingTeamId,
    balls: [],
    runs: 0,
    wickets: 0,
    legalBalls: 0,
    striker: 0,
    nonStriker: 1,
    nextIn: 2,
    bowlerId: null,
    prevOverBowlerId: null,
    target,
    done: false,
  };
}

export function createMatch(
  id: string,
  teamA: Team,
  teamB: Team,
  settings: MatchSettings,
  rng: Rng,
): MatchState {
  if (teamA.id === teamB.id) throw new Error('A team cannot play itself');
  const tossWinner = rng() < 0.5 ? teamA : teamB;
  const loser = tossWinner === teamA ? teamB : teamA;
  const bat = rng() < 0.5;
  const order: [string, string] = bat ? [tossWinner.id, loser.id] : [loser.id, tossWinner.id];
  const m: MatchState = {
    id,
    createdAt: Date.now(),
    teams: [structuredClone(teamA), structuredClone(teamB)],
    settings: { ...settings },
    tossText: `${tossWinner.name} won the toss and chose to ${bat ? 'bat' : 'bowl'}`,
    order,
    innings: [newInnings(order[0], order[1], null)],
    result: null,
  };
  autoBowlerIfNeeded(m);
  return m;
}

export const needsBowler = (m: MatchState): boolean => {
  if (m.result) return false;
  const inn = currentInnings(m);
  return !inn.done && inn.bowlerId === null;
};

export function ballsBowledBy(inn: Innings, playerId: string): number {
  let n = 0;
  for (const b of inn.balls) if (b.bowlerId === playerId) n++;
  return n;
}

export interface BowlerOption {
  player: Player;
  eligible: boolean;
  reason?: string;
}

/** Every player on the fielding side, with whether they may bowl the next over. */
export function bowlerOptions(m: MatchState): BowlerOption[] {
  const inn = currentInnings(m);
  const team = getTeam(m, inn.bowlingTeamId);
  const cap = maxOversPerBowler(m.settings);
  const why = (p: Player): string | undefined => {
    if (p.id === inn.prevOverBowlerId) return 'Bowled last over';
    if (cap !== null && ballsBowledBy(inn, p.id) >= cap * BALLS_PER_OVER) return `Max ${cap} overs`;
    return undefined;
  };
  let opts: BowlerOption[] = team.players.map((p) => {
    const reason = why(p);
    return { player: p, eligible: !reason, reason };
  });
  // Safety net: if the caps leave nobody (custom teams can be odd), only forbid consecutive overs.
  if (!opts.some((o) => o.eligible)) {
    opts = team.players.map((p) =>
      p.id === inn.prevOverBowlerId
        ? { player: p, eligible: false, reason: 'Bowled last over' }
        : { player: p, eligible: true },
    );
  }
  return opts;
}

/** Auto selection: the designated bowler with the fewest balls so far (falls back to anyone eligible). */
export function pickAutoBowler(m: MatchState): string {
  const inn = currentInnings(m);
  const eligible = bowlerOptions(m).filter((o) => o.eligible).map((o) => o.player);
  const designated = eligible.filter((p) => p.bowler);
  const pool = designated.length ? designated : eligible;
  let best = pool[0];
  let bestBalls = ballsBowledBy(inn, best.id);
  for (const p of pool) {
    const b = ballsBowledBy(inn, p.id);
    if (b < bestBalls) {
      best = p;
      bestBalls = b;
    }
  }
  return best.id;
}

function autoBowlerIfNeeded(m: MatchState, force = false) {
  if ((force || m.settings.bowlerMode === 'auto') && needsBowler(m)) {
    currentInnings(m).bowlerId = pickAutoBowler(m);
  }
}

export function setBowler(m0: MatchState, playerId: string): MatchState {
  const opt = bowlerOptions(m0).find((o) => o.player.id === playerId);
  if (!opt || !opt.eligible) throw new Error('That player cannot bowl this over');
  const m = structuredClone(m0);
  currentInnings(m).bowlerId = playerId;
  return m;
}

/** Apply one delivery. Pure: returns a new state. */
export function applyBall(m0: MatchState, rolls: Rolls): MatchState {
  if (m0.result) throw new Error('Match is over');
  const m = structuredClone(m0);
  applyBallMut(m, rolls);
  return m;
}

function applyBallMut(m: MatchState, rolls: Rolls) {
  const inn = currentInnings(m);
  if (inn.done) throw new Error('Innings is over');
  if (!inn.bowlerId) throw new Error('Choose a bowler first');
  const batting = getTeam(m, inn.battingTeamId);
  const fielding = getTeam(m, inn.bowlingTeamId);
  const out = resolveRolls(rolls);

  inn.balls.push({
    over: Math.floor(inn.legalBalls / BALLS_PER_OVER),
    ball: (inn.legalBalls % BALLS_PER_OVER) + 1,
    batterId: batting.players[inn.striker].id,
    bowlerId: inn.bowlerId,
    roll1: rolls.roll1,
    ...(rolls.roll2 !== undefined ? { roll2: rolls.roll2 } : {}),
    runs: out.runs,
    wicket: out.wicket,
    ...(out.how ? { how: out.how } : {}),
    ...(out.how === 'caught' ? { fielderId: fielding.players[rolls.fielderIdx % fielding.players.length].id } : {}),
  });
  inn.legalBalls++;
  inn.runs += out.runs;

  if (out.wicket) {
    inn.wickets++;
    if (inn.wickets >= batting.players.length - 1) {
      inn.done = true;
      inn.endReason = 'allOut';
    } else {
      inn.striker = inn.nextIn++;
    }
  }
  if (!inn.done && out.runs % 2 === 1) [inn.striker, inn.nonStriker] = [inn.nonStriker, inn.striker];
  if (!inn.done && inn.target !== null && inn.runs >= inn.target) {
    inn.done = true;
    inn.endReason = 'target';
  }
  if (inn.legalBalls % BALLS_PER_OVER === 0) {
    inn.prevOverBowlerId = inn.bowlerId;
    inn.bowlerId = null;
    if (!inn.done) {
      [inn.striker, inn.nonStriker] = [inn.nonStriker, inn.striker];
      const limit = oversLimit(m.settings);
      if (limit !== null && inn.legalBalls >= limit * BALLS_PER_OVER) {
        inn.done = true;
        inn.endReason = 'overs';
      }
    }
  }
  if (inn.done) endInnings(m);
  autoBowlerIfNeeded(m);
}

const totalFor = (m: MatchState, teamId: string) =>
  m.innings.filter((i) => i.battingTeamId === teamId).reduce((s, i) => s + i.runs, 0);

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

function endInnings(m: MatchState) {
  const idx = m.innings.length - 1;
  const [A, B] = m.order;
  const last = idx === inningsPerMatch(m.settings) - 1;

  if (m.settings.format === 'test' && idx === 2) {
    const a = totalFor(m, A);
    const b = totalFor(m, B);
    if (a < b) {
      m.result = {
        kind: 'win',
        winnerId: B,
        text: `${getTeam(m, B).name} won by an innings and ${plural(b - a, 'run')}`,
      };
      return;
    }
    m.innings.push(newInnings(B, A, a - b + 1));
    return;
  }
  if (!last) {
    const target = m.settings.format === 'limited' ? m.innings[0].runs + 1 : null;
    const nextBat = idx % 2 === 0 ? B : A;
    const nextBowl = nextBat === A ? B : A;
    m.innings.push(newInnings(nextBat, nextBowl, target));
    return;
  }
  m.result = decideChase(m);
}

function decideChase(m: MatchState): Result {
  const inn = currentInnings(m);
  const [A, B] = m.order;
  const chasing = getTeam(m, B);
  const defending = getTeam(m, A);
  const target = inn.target!;
  if (inn.runs >= target) {
    const wktsLeft = chasing.players.length - 1 - inn.wickets;
    let text = `${chasing.name} won by ${plural(wktsLeft, 'wicket')}`;
    const limit = oversLimit(m.settings);
    if (m.settings.format === 'limited' && limit !== null) {
      const left = limit * BALLS_PER_OVER - inn.legalBalls;
      if (left > 0) text += ` (${plural(left, 'ball')} left)`;
    }
    return { kind: 'win', winnerId: B, text };
  }
  if (m.settings.format === 'test' && inn.endReason !== 'allOut') {
    return { kind: 'draw', text: 'Match drawn' };
  }
  const margin = target - 1 - inn.runs;
  if (margin === 0) return { kind: 'tie', text: 'Match tied' };
  return { kind: 'win', winnerId: defending.id, text: `${defending.name} won by ${plural(margin, 'run')}` };
}

export type SimUntil = 'over' | 'innings' | 'match';

/** Play balls instantly (auto-picking bowlers) until the given point. */
export function simulate(m0: MatchState, rng: Rng, until: SimUntil): MatchState {
  const m = structuredClone(m0);
  const startInn = m.innings.length;
  const startOver = Math.floor(currentInnings(m).legalBalls / BALLS_PER_OVER);
  let guard = 0;
  while (!m.result && guard++ < 100000) {
    autoBowlerIfNeeded(m, true);
    applyBallMut(m, rollDice(rng));
    if (m.result) break;
    if (until === 'innings' && m.innings.length !== startInn) break;
    if (
      until === 'over' &&
      (m.innings.length !== startInn || Math.floor(currentInnings(m).legalBalls / BALLS_PER_OVER) !== startOver)
    )
      break;
  }
  return m;
}

/** Combined total of a team across the match (for Test leads). */
export const matchTotal = totalFor;
