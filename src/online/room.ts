import { rollDice } from '../engine/dice';
import { BALLS_PER_OVER, bowlerOptions, currentInnings, needsBowler, pickAutoBowler } from '../engine/match';
import type { MatchState, Rng, Team } from '../engine/types';
import { applyEvent, digest, type MatchEvent } from './events';
import { applyLineup, defaultLineup, lineupProblem, onlineSettings, type Lineup } from './lineup';
import type { Clock, MatchEnd, Phase, RoomAction, RoomView, SeatId, SeatView, TossState, Turn } from './protocol';
import { createOnlineMatch, nextBatterOptions, ownedId, splitOwnedId } from './rules';
import { DEFAULT_OVERS, OnlineError } from './validate';

// The room is pure: no sockets, storage, timers or clock of its own. The server feeds it actions and the time,
// saves the state it returns, passes messages on, and calls `tick` when `nextWake` says so.

const SEC = 1000;
const MIN = 60 * SEC;

export const TOSS_MS = 20 * SEC;
export const BOWLER_MS = 20 * SEC;
export const BATTER_MS = 10 * SEC;
export const ROLL_MS = 10 * SEC;
/** Long enough for the dice animation: one die, or two when there is a wicket check. */
export const BALL_GAP_MS = 1300;
export const CHECK_GAP_MS = 2700;
/** After someone returns, they get at least this long on a paused turn. */
export const RESUME_MS = 5 * SEC;
export const CLAIM_MS = 90 * SEC;
/** Rooms with nobody to play close after this. */
export const IDLE_MS = 30 * MIN;
/** Finished matches stay this long, so a player who lost connection can collect the result. */
export const KEEP_FINISHED_MS = 7 * 24 * 60 * MIN;

const MAX_REMOVED = 50;

export interface SeatState {
  ownerId: string;
  nickname: string;
  connected: boolean;
  /** Last time this player was seen leaving, while away. */
  awaySince: number | null;
  team: Team | null;
  lineup: Lineup | null;
  ready: boolean;
  auto: boolean;
  wantsRematch: boolean;
  left: boolean;
}

export interface RoomState {
  code: string;
  createdAt: number;
  phase: Phase;
  /** When the current phase began. */
  phaseAt: number;
  overs: number;
  host: SeatState;
  guest: SeatState | null;
  /** Players the host removed. */
  removed: string[];
  toss: TossState | null;
  match: MatchState | null;
  matchNo: number;
  /** A new batter is at the crease and their captain may still swap them. */
  batterPending: boolean;
  end: MatchEnd | null;
  seq: number;
  nextBallAt: number;
  deadline: number | null;
  /** Time left on the turn when the clock was paused. */
  remaining: number | null;
}

export interface SeqEvent {
  seq: number;
  event: MatchEvent;
  digest: string;
}

export interface Step {
  state: RoomState;
  /** Match events, in order. */
  events: SeqEvent[];
  /** What to send besides the events: everything, room details only, or nothing. */
  send: 'snapshot' | 'room' | 'none';
}

export interface Ctx {
  now: number;
  rng: Rng;
}

export interface Who {
  ownerId: string;
  nickname: string;
}

/** A finished match, as each browser records it. */
export interface FinishedMatch {
  match: MatchState;
  host: Who;
  guest: Who;
  end: MatchEnd;
  completedAt: number;
}

// ---------- Reading the state ----------

const newSeat = ({ ownerId, nickname }: Who): SeatState => ({
  ownerId, nickname, connected: false, awaySince: null, team: null, lineup: null,
  ready: false, auto: false, wantsRematch: false, left: false,
});

export function createRoom(code: string, host: Who, now: number): RoomState {
  return {
    code, createdAt: now, phase: 'waiting', phaseAt: now, overs: DEFAULT_OVERS,
    host: { ...newSeat(host), awaySince: now }, guest: null, removed: [],
    toss: null, match: null, matchNo: 0, batterPending: false, end: null,
    seq: 0, nextBallAt: 0, deadline: null, remaining: null,
  };
}

export function seatOf(s: RoomState, ownerId: string): SeatId | null {
  return s.host.ownerId === ownerId ? 'host' : s.guest?.ownerId === ownerId ? 'guest' : null;
}

export const otherSeat = (id: SeatId): SeatId => (id === 'host' ? 'guest' : 'host');

const isLive = (s: RoomState) => s.phase === 'toss' || s.phase === 'playing';
const isOpen = (s: RoomState) => s.phase === 'waiting' || s.phase === 'setup';

const seatOfTeam = (s: RoomState, teamId: string): SeatId => seatOf(s, splitOwnedId(teamId).ownerId)!;

/** Whose move it is, or null when nothing is being waited for. */
export function currentTurn(s: RoomState): Turn | null {
  if (s.phase === 'toss') {
    return s.toss?.winner ? { seat: s.toss.winner, kind: 'tossChoice' } : { seat: 'guest', kind: 'tossCall' };
  }
  if (s.phase !== 'playing' || !s.match || s.match.result) return null;
  const inn = currentInnings(s.match);
  if (s.batterPending) return { seat: seatOfTeam(s, inn.battingTeamId), kind: 'batter' };
  if (needsBowler(s.match)) return { seat: seatOfTeam(s, inn.bowlingTeamId), kind: 'bowler' };
  return { seat: seatOfTeam(s, inn.battingTeamId), kind: 'roll' };
}

/** The planned bowler for the coming over if they can bowl it, otherwise the usual automatic choice. */
export function suggestBowler(m: MatchState, ownerId: string, lineup: Lineup | null): string {
  const inn = currentInnings(m);
  const planned = lineup?.bowlingPlan?.[Math.floor(inn.legalBalls / BALLS_PER_OVER)];
  if (planned) {
    const id = ownedId(ownerId, planned);
    if (bowlerOptions(m).some((o) => o.eligible && o.player.id === id)) return id;
  }
  return pickAutoBowler(m);
}

const isPaused = (s: RoomState) => isLive(s) && !(s.host.connected && s.guest?.connected);

function claimAt(s: RoomState, seat: SeatId): number | null {
  const other = s[otherSeat(seat)];
  return s.phase === 'playing' && other && !other.connected && other.awaySince !== null ? other.awaySince + CLAIM_MS : null;
}

export function clockFor(s: RoomState, seat: SeatId, now: number): Clock {
  return {
    now,
    turn: currentTurn(s),
    deadline: s.deadline,
    nextBallAt: s.nextBallAt,
    paused: isPaused(s),
    claimAt: claimAt(s, seat),
  };
}

const seatView = (x: SeatState): SeatView => ({
  ownerId: x.ownerId,
  nickname: x.nickname,
  connected: x.connected,
  ready: x.ready,
  auto: x.auto,
  wantsRematch: x.wantsRematch,
  left: x.left,
  team: x.team && { name: x.team.name, short: x.team.short, color: x.team.color },
});

/** What one player may see. The opponent's team sheet and bowling plan stay out of it. */
export function viewFor(s: RoomState, seat: SeatId, now: number): RoomView {
  const me = s[seat]!;
  return {
    code: s.code,
    phase: s.phase,
    you: seat,
    overs: s.overs,
    seq: s.seq,
    host: seatView(s.host),
    guest: s.guest && seatView(s.guest),
    team: me.team,
    lineup: me.lineup,
    toss: s.toss,
    end: s.end,
    clock: clockFor(s, seat, now),
  };
}

export function finishedMatch(s: RoomState): FinishedMatch | null {
  if (s.phase !== 'finished' || !s.match?.result || !s.guest || !s.end) return null;
  const who = ({ ownerId, nickname }: SeatState): Who => ({ ownerId, nickname });
  return { match: s.match, host: who(s.host), guest: who(s.guest), end: s.end, completedAt: s.phaseAt };
}

/** When everyone last left, or null if someone is here. */
function emptySince(s: RoomState): number | null {
  const seats = s.guest ? [s.host, s.guest] : [s.host];
  if (seats.some((x) => x.connected)) return null;
  return Math.max(...seats.map((x) => x.awaySince ?? s.phaseAt));
}

/** When an unused room closes itself, or null. */
function closesAt(s: RoomState): number | null {
  if (s.phase === 'waiting') return s.phaseAt + IDLE_MS;
  if (s.phase === 'setup' || isLive(s)) {
    const t = emptySince(s);
    return t === null ? null : t + IDLE_MS;
  }
  return null;
}

/** When the server may delete the room altogether, or null while it is in use. */
export function deletesAt(s: RoomState): number | null {
  if (s.phase === 'closed') return s.phaseAt;
  return s.phase === 'finished' ? s.phaseAt + KEEP_FINISHED_MS : null;
}

/** The next time `tick` (or deletion) is due. */
export function nextWake(s: RoomState): number | null {
  const times = [s.deadline, closesAt(s), deletesAt(s)].filter((t): t is number => t !== null);
  return times.length ? Math.min(...times) : null;
}

// ---------- Changing the state (these work on a private copy) ----------

function setPhase(s: RoomState, phase: Phase, now: number) {
  s.phase = phase;
  s.phaseAt = now;
}

function close(s: RoomState, now: number) {
  setPhase(s, 'closed', now);
  s.deadline = null;
  s.remaining = null;
}

/** Start the clock for whatever is now being waited for. */
function armClock(s: RoomState, now: number) {
  s.deadline = null;
  s.remaining = null;
  const turn = currentTurn(s);
  if (!turn) return;
  const from = s.phase === 'playing' ? Math.max(now, s.nextBallAt) : now;
  const ms =
    turn.kind === 'roll' ? (s[turn.seat]!.auto ? 0 : ROLL_MS)
    : turn.kind === 'batter' ? BATTER_MS
    : turn.kind === 'bowler' ? BOWLER_MS
    : TOSS_MS;
  s.deadline = from + ms;
}

/** Stop the clock while someone is away, and restart it when both are here. */
function syncPause(s: RoomState, now: number) {
  if (!isLive(s)) return;
  if (isPaused(s)) {
    if (s.deadline !== null) {
      s.remaining = Math.max(0, s.deadline - now);
      s.deadline = null;
    }
  } else if (s.remaining !== null) {
    s.deadline = now + Math.max(s.remaining, RESUME_MS);
    s.remaining = null;
  }
}

function finish(s: RoomState, end: MatchEnd, now: number) {
  setPhase(s, 'finished', now);
  s.end = end;
  s.batterPending = false;
  s.deadline = null;
  s.remaining = null;
  s.host.auto = false;
  s.guest!.auto = false;
}

/** Apply a match event and number it. */
function emit(s: RoomState, out: SeqEvent[], event: MatchEvent) {
  let next: MatchState;
  try {
    next = applyEvent(s.match!, event);
  } catch (e) {
    throw new OnlineError(e instanceof Error ? e.message : 'That is not allowed');
  }
  s.match = next;
  s.seq++;
  out.push({ seq: s.seq, event, digest: digest(next) });
}

function doRoll(s: RoomState, out: SeqEvent[], { now, rng }: Ctx, auto: boolean) {
  const rolls = rollDice(rng);
  emit(s, out, { type: 'ball', rolls, ...(auto ? { auto } : {}) });
  s.nextBallAt = now + (rolls.roll2 === undefined ? BALL_GAP_MS : CHECK_GAP_MS);
  if (s.match!.result) {
    finish(s, { kind: 'played' }, now);
    return;
  }
  // With one player left there is nothing to choose.
  s.batterPending = nextBatterOptions(s.match!).length > 1;
  armClock(s, now);
}

function doBowler(s: RoomState, out: SeqEvent[], playerId: string, now: number, auto: boolean) {
  emit(s, out, { type: 'bowler', playerId, ...(auto ? { auto } : {}) });
  armClock(s, now);
}

function doBatter(s: RoomState, out: SeqEvent[], playerId: string, now: number, auto: boolean) {
  emit(s, out, { type: 'batter', playerId, ...(auto ? { auto } : {}) });
  s.batterPending = false;
  armClock(s, now);
}

function doTossCall(s: RoomState, call: 'heads' | 'tails', { now, rng }: Ctx) {
  const face = rng() < 0.5 ? 'heads' : 'tails';
  s.toss = { call, face, winner: call === face ? 'guest' : 'host' };
  armClock(s, now);
}

function doTossChoice(s: RoomState, choice: 'bat' | 'bowl', { now }: Ctx) {
  const toss = s.toss!;
  const side = (x: SeatState) => ({ ownerId: x.ownerId, nickname: x.nickname, team: applyLineup(x.team!, x.lineup!) });
  toss.choice = choice;
  s.matchNo++;
  // Codes get reused over time, so the id also carries when the room was made.
  const id = `${s.code}-${s.createdAt.toString(36)}-${s.matchNo}`;
  s.match = createOnlineMatch(
    id, side(s.host), side(s.guest!), onlineSettings(s.overs), { winnerId: s[toss.winner!]!.ownerId, choice }, now,
  );
  s.seq = 0;
  s.nextBallAt = now;
  s.batterPending = false;
  setPhase(s, 'playing', now);
  armClock(s, now);
}

function doForfeit(s: RoomState, out: SeqEvent[], loser: SeatId, now: number) {
  const seat = s[loser]!;
  emit(s, out, { type: 'forfeit', teamId: ownedId(seat.ownerId, seat.team!.id) });
  finish(s, { kind: 'forfeit', loser }, now);
}

function dropGuest(s: RoomState, now: number) {
  s.guest = null;
  s.host.ready = false;
  s.host.wantsRematch = false;
  s.toss = null;
  s.deadline = null;
  s.remaining = null;
  setPhase(s, 'waiting', now);
}

// ---------- The four ways a room changes ----------

/** A player arrives or comes back. Throws if they cannot have a seat. */
export function connect(s0: RoomState, who: Who, now: number): Step {
  if (s0.phase === 'closed') throw new OnlineError('Room not found');
  const s = structuredClone(s0);
  let id = seatOf(s, who.ownerId);
  if (!id) {
    if (s.removed.includes(who.ownerId)) throw new OnlineError('The host removed you from this room');
    if (s.guest || s.phase !== 'waiting') throw new OnlineError('This room is full');
    s.guest = newSeat(who);
    id = 'guest';
    setPhase(s, 'setup', now);
  }
  const seat = s[id]!;
  seat.connected = true;
  seat.awaySince = null;
  seat.left = false;
  // Names are fixed during a match, because they can be part of a team's name in it.
  if (isOpen(s)) seat.nickname = who.nickname;
  syncPause(s, now);
  return { state: s, events: [], send: 'room' };
}

/** A player's last connection dropped. */
export function disconnect(s0: RoomState, ownerId: string, now: number): Step {
  const id = seatOf(s0, ownerId);
  if (!id || !s0[id]!.connected) return { state: s0, events: [], send: 'none' };
  const s = structuredClone(s0);
  const seat = s[id]!;
  seat.connected = false;
  seat.awaySince = now;
  if (s.phase === 'setup') seat.ready = false;
  seat.wantsRematch = false;
  syncPause(s, now);
  return { state: s, events: [], send: 'room' };
}

/** A seated player does something. Throws OnlineError, changing nothing, when it is not allowed. */
export function act(s0: RoomState, ownerId: string, a: RoomAction, ctx: Ctx): Step {
  const id = seatOf(s0, ownerId);
  if (!id) throw new OnlineError('You are not in this room');
  if (s0.phase === 'closed') throw new OnlineError('Room not found');
  const s = structuredClone(s0);
  const me = s[id]!;
  const { now } = ctx;
  const events: SeqEvent[] = [];
  const done = (send: Step['send']): Step => ({ state: s, events, send });
  // Match moves send only events, unless the match just ended.
  const moved = () => done(s.phase === 'finished' ? 'snapshot' : 'none');

  const inSetup = () => {
    if (!isOpen(s)) throw new OnlineError('That can only be changed before the match');
  };
  const myTurn = (kind: Turn['kind']) => {
    if (isPaused(s)) throw new OnlineError('Waiting for your opponent to reconnect');
    const turn = currentTurn(s);
    if (turn?.kind !== kind || turn.seat !== id) throw new OnlineError('It is not your turn to do that');
  };

  switch (a.t) {
    case 'setSettings': {
      inSetup();
      if (id !== 'host') throw new OnlineError('Only the host can change the overs');
      if (a.overs === s.overs) return done('none');
      s.overs = a.overs;
      for (const seat of [s.host, s.guest]) {
        if (!seat) continue;
        seat.ready = false;
        // Bowler limits depend on the overs.
        if (seat.lineup) delete seat.lineup.bowlingPlan;
      }
      return done('room');
    }
    case 'setTeam':
      inSetup();
      me.team = a.team;
      me.lineup = defaultLineup(a.team);
      me.ready = false;
      return done('room');
    case 'setLineup': {
      inSetup();
      if (!me.team) throw new OnlineError('Choose a team first');
      const problem = lineupProblem(me.team, a.lineup, s.overs);
      if (problem) throw new OnlineError(problem);
      me.lineup = a.lineup;
      me.ready = false;
      return done('room');
    }
    case 'ready': {
      if (s.phase !== 'setup') throw new OnlineError('You can get ready once your opponent has joined');
      if (!me.team || !me.lineup) throw new OnlineError('Choose a team first');
      const problem = lineupProblem(me.team, me.lineup, s.overs);
      if (problem) throw new OnlineError(problem);
      me.ready = true;
      if (s.host.ready && s.guest!.ready) {
        s.toss = {};
        s.match = null;
        s.end = null;
        setPhase(s, 'toss', now);
        armClock(s, now);
        syncPause(s, now);
        return done('snapshot');
      }
      return done('room');
    }
    case 'unready':
      inSetup();
      me.ready = false;
      return done('room');
    case 'removeGuest':
      if (id !== 'host') throw new OnlineError('Only the host can do that');
      if (s.phase !== 'setup') throw new OnlineError('It is too late to remove your opponent');
      s.removed = [...s.removed, s.guest!.ownerId].slice(-MAX_REMOVED);
      dropGuest(s, now);
      return done('snapshot');
    case 'callToss':
      myTurn('tossCall');
      doTossCall(s, a.call, ctx);
      return done('room');
    case 'chooseInnings':
      myTurn('tossChoice');
      doTossChoice(s, a.choice, ctx);
      return done('snapshot');
    case 'chooseBowler':
      myTurn('bowler');
      doBowler(s, events, a.playerId, now, false);
      return moved();
    case 'chooseBatter':
      myTurn('batter');
      doBatter(s, events, a.playerId, now, false);
      return moved();
    case 'roll':
      myTurn('roll');
      if (now < s.nextBallAt) throw new OnlineError('Wait for the last ball to finish');
      doRoll(s, events, ctx, false);
      return moved();
    case 'setAuto': {
      if (s.phase !== 'playing') throw new OnlineError('There is no match in progress');
      if (me.auto === a.on) return done('none');
      me.auto = a.on;
      const turn = currentTurn(s);
      if (turn?.kind === 'roll' && turn.seat === id) {
        if (isPaused(s)) s.remaining = a.on ? 0 : ROLL_MS;
        else armClock(s, now);
      }
      return done('room');
    }
    case 'claimWin': {
      const at = claimAt(s, id);
      if (at === null) throw new OnlineError('Your opponent is still here');
      if (!me.connected || now < at) throw new OnlineError('Your opponent still has time to come back');
      doForfeit(s, events, otherSeat(id), now);
      return moved();
    }
    case 'rematch': {
      if (s.phase !== 'finished') throw new OnlineError('The match is not over');
      const other = s[otherSeat(id)]!;
      if (other.left) throw new OnlineError('Your opponent has left');
      me.wantsRematch = true;
      if (!other.wantsRematch) return done('room');
      for (const seat of [s.host, s.guest!]) {
        seat.wantsRematch = false;
        seat.ready = false;
      }
      s.toss = null;
      s.match = null;
      s.end = null;
      s.seq = 0;
      setPhase(s, 'setup', now);
      return done('snapshot');
    }
    case 'leave':
      if (s.phase === 'playing') {
        doForfeit(s, events, id, now);
        me.left = true;
        return moved();
      }
      if (s.phase === 'finished') {
        me.left = true;
        me.wantsRematch = false;
        return done('room');
      }
      if (id === 'host') close(s, now);
      else dropGuest(s, now);
      return done('snapshot');
  }
}

/** Time has passed: play any overdue turn for whoever ran out of time, and close unused rooms. */
export function tick(s0: RoomState, ctx: Ctx): Step {
  const { now, rng } = ctx;
  const closing = closesAt(s0);
  if (closing !== null && closing <= now) {
    const s = structuredClone(s0);
    close(s, now);
    return { state: s, events: [], send: 'snapshot' };
  }
  if (s0.deadline === null || s0.deadline > now) return { state: s0, events: [], send: 'none' };

  const s = structuredClone(s0);
  const events: SeqEvent[] = [];
  const turn = currentTurn(s)!;
  switch (turn.kind) {
    case 'tossCall':
      doTossCall(s, rng() < 0.5 ? 'heads' : 'tails', ctx);
      return { state: s, events, send: 'room' };
    case 'tossChoice':
      doTossChoice(s, rng() < 0.5 ? 'bat' : 'bowl', ctx);
      return { state: s, events, send: 'snapshot' };
    case 'bowler': {
      const seat = s[turn.seat]!;
      doBowler(s, events, suggestBowler(s.match!, seat.ownerId, seat.lineup), now, true);
      break;
    }
    case 'batter':
      doBatter(s, events, nextBatterOptions(s.match!)[0].id, now, true);
      break;
    case 'roll':
      doRoll(s, events, ctx, true);
      break;
  }
  return { state: s, events, send: s.phase === 'finished' ? 'snapshot' : 'none' };
}
