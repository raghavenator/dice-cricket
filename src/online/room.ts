import { PRESET_TEAMS } from '../data/presets';
import { rollDice } from '../engine/dice';
import { BALLS_PER_OVER, bowlerOptions, currentInnings, needsBowler, pickAutoBowler } from '../engine/match';
import type { MatchState, Rng, Team } from '../engine/types';
import { applyEvent, digest, type Auto, type MatchEvent } from './events';
import { applyLineup, defaultLineup, lineupProblem, onlineSettings, type Lineup } from './lineup';
import { BOT_ID_LENGTH, BOT_PREFIX, isBot, type Access, type AutoSettings, type Clock, type FinishedMatch, type MatchEnd, type Phase, type RoomAction, type RoomView, type SeatId, type SeatView, type TossState, type Turn, type Who } from './protocol';
import { createOnlineMatch, nextBatterOptions, ownedId, splitOwnedId } from './rules';
import { DEFAULT_OVERS, OnlineError } from './validate';

// The room is pure: no sockets, storage, timers or clock of its own. The server feeds it actions and the time,
// saves the state it returns, passes messages on, and calls `tick` when `nextWake` says so.

/** Raise when RoomState changes shape. Rooms saved in an older shape are left to expire. */
export const STATE_VERSION = 2;

const SEC = 1000;
const MIN = 60 * SEC;

export const TOSS_MS = 20 * SEC;
/** Picking a bowler or the next batter. */
export const PICK_MS = 5 * SEC;
export const ROLL_MS = 2 * SEC;
/** Long enough for the dice animation: one die, or two when there is a wicket check. */
export const BALL_GAP_MS = 1300;
export const CHECK_GAP_MS = 2700;
/** Extra time before the first ball of an innings, so that automatic play does not rush past the new screen. */
export const INNINGS_GAP_MS = 2 * SEC;
/** After someone returns, they get at least this long on a paused turn. */
export const RESUME_MS = 5 * SEC;
/** Strangers in a quick match have this long to set up. Then it starts with whatever they have. */
export const QUICK_SETUP_MS = 60 * SEC;
export const CLAIM_MS = 90 * SEC;
/** Someone searching for a quick match this long gets a computer opponent instead. */
export const BOT_WAIT_MS = 60 * SEC;
/** How long a computer opponent takes over the toss, so it does not look instant. */
export const BOT_THINK_MS = 1500;
/** Names for computer opponents. All are valid nicknames. */
export const BOT_NAMES = [
  'Ravi', 'Sam K', 'Jono', 'Imran', 'Kiwi Pete', 'Ash', 'Tom B', 'Raza', 'Benji', 'Matty', 'Shaz', 'Fitzy',
  'Sunny', 'Dev', 'Ollie', 'Kofi', 'Haris', 'Nathan', 'Zane', 'Vik',
];
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
  auto: AutoSettings;
  wantsRematch: boolean;
  left: boolean;
}

export interface RoomState {
  code: string;
  access: Access;
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

// ---------- Reading the state ----------

const newSeat = ({ ownerId, nickname }: Who): SeatState => ({
  ownerId, nickname, connected: false, awaySince: null, team: null, lineup: null,
  ready: false, auto: { roll: true, batter: true, bowler: true }, wantsRematch: false, left: false,
});

export function createRoom(code: string, host: Who, now: number, access: Access = 'private'): RoomState {
  return {
    code, access, createdAt: now, phase: 'waiting', phaseAt: now, overs: DEFAULT_OVERS,
    host: { ...newSeat(host), awaySince: now }, guest: null, removed: [],
    toss: null, match: null, matchNo: 0, batterPending: false, end: null,
    seq: 0, nextBallAt: 0, deadline: null, remaining: null,
  };
}

export function seatOf(s: RoomState, ownerId: string): SeatId | null {
  return s.host.ownerId === ownerId ? 'host' : s.guest?.ownerId === ownerId ? 'guest' : null;
}

/** Strangers may join, so only the sample teams are allowed. */
export const isPublic = (s: Pick<RoomState, 'access'>): boolean => s.access !== 'private';

export const otherSeat = (id: SeatId): SeatId => (id === 'host' ? 'guest' : 'host');

/** A match is under way (or being tossed for). */
export const isLive = (s: RoomState): boolean => s.phase === 'toss' || s.phase === 'playing';
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
    access: s.access,
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
    finishedAt: s.phase === 'finished' ? s.phaseAt : null,
    clock: clockFor(s, seat, now),
  };
}

export function finishedMatch(s: RoomState): FinishedMatch | null {
  if (s.phase !== 'finished' || !s.match?.result || !s.guest || !s.end) return null;
  const who = ({ ownerId, nickname }: SeatState): Who => ({ ownerId, nickname });
  return { match: s.match, host: who(s.host), guest: who(s.guest), end: s.end, completedAt: s.phaseAt };
}

/** When every person last left, or null if someone is here. A computer opponent does not count. */
function emptySince(s: RoomState): number | null {
  const seats = (s.guest ? [s.host, s.guest] : [s.host]).filter((x) => !isBot(x.ownerId));
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

/** When a computer opponent joins a quick match nobody else has, or null. Only while the searcher is here. */
export function botJoinsAt(s: RoomState): number | null {
  return s.access === 'quick' && s.phase === 'waiting' && s.host.connected ? s.phaseAt + BOT_WAIT_MS : null;
}

/** The next time `tick` (or deletion) is due. */
export function nextWake(s: RoomState): number | null {
  const times = [s.deadline, closesAt(s), deletesAt(s), botJoinsAt(s)].filter((t): t is number => t !== null);
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

/** Whether the player whose turn it is has left this kind of move to the game. */
function isAuto(s: RoomState, turn: Turn): boolean {
  const { auto } = s[turn.seat]!;
  return turn.kind === 'roll' ? auto.roll : turn.kind === 'batter' ? auto.batter : turn.kind === 'bowler' && auto.bowler;
}

function turnMs(s: RoomState, turn: Turn): number {
  if (isAuto(s, turn)) return 0;
  // A computer opponent plays everything else on auto, and only pauses briefly over the toss.
  if (isBot(s[turn.seat]!.ownerId)) return BOT_THINK_MS;
  if (turn.kind === 'roll') return ROLL_MS;
  return turn.kind === 'batter' || turn.kind === 'bowler' ? PICK_MS : TOSS_MS;
}

/** Start the clock for whatever is now being waited for. */
function armClock(s: RoomState, now: number) {
  s.deadline = null;
  s.remaining = null;
  const turn = currentTurn(s);
  if (!turn) return;
  const from = s.phase === 'playing' ? Math.max(now, s.nextBallAt) : now;
  s.deadline = from + turnMs(s, turn);
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

function doRoll(s: RoomState, out: SeqEvent[], { now, rng }: Ctx, auto?: Auto) {
  const before = s.match!.innings.length;
  const rolls = rollDice(rng);
  emit(s, out, { type: 'ball', rolls, ...(auto ? { auto } : {}) });
  s.nextBallAt = now + (rolls.roll2 === undefined ? BALL_GAP_MS : CHECK_GAP_MS);
  if (s.match!.result) {
    finish(s, { kind: 'played' }, now);
    return;
  }
  if (s.match!.innings.length > before) s.nextBallAt += INNINGS_GAP_MS;
  // With one player left there is nothing to choose.
  s.batterPending = nextBatterOptions(s.match!).length > 1;
  armClock(s, now);
}

function doBowler(s: RoomState, out: SeqEvent[], playerId: string, now: number, auto?: Auto) {
  emit(s, out, { type: 'bowler', playerId, ...(auto ? { auto } : {}) });
  armClock(s, now);
}

function doBatter(s: RoomState, out: SeqEvent[], playerId: string, now: number, auto?: Auto) {
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
  s.nextBallAt = now + INNINGS_GAP_MS;
  s.batterPending = false;
  setPhase(s, 'playing', now);
  armClock(s, now);
}

function doForfeit(s: RoomState, out: SeqEvent[], loser: SeatId, now: number) {
  const seat = s[loser]!;
  emit(s, out, { type: 'forfeit', teamId: ownedId(seat.ownerId, seat.team!.id) });
  finish(s, { kind: 'forfeit', loser }, now);
}

/** Both players are here and can set up. */
function beginSetup(s: RoomState, now: number) {
  setPhase(s, 'setup', now);
  s.deadline = s.access === 'quick' ? now + QUICK_SETUP_MS : null;
}

function beginToss(s: RoomState, now: number) {
  s.toss = {};
  s.match = null;
  s.end = null;
  setPhase(s, 'toss', now);
  armClock(s, now);
  syncPause(s, now);
}

/** Time is up in a quick match: start with what they have, or close the room if someone has gone. */
function startQuick(s: RoomState, { now, rng }: Ctx) {
  const seats = [s.host, s.guest!];
  if (seats.some((x) => !x.connected)) {
    close(s, now);
    return;
  }
  for (const seat of seats) {
    if (!seat.team || !seat.lineup || lineupProblem(seat.team, seat.lineup, s.overs)) {
      seat.team = seat.team ?? structuredClone(PRESET_TEAMS[Math.min(PRESET_TEAMS.length - 1, Math.floor(rng() * PRESET_TEAMS.length))]);
      seat.lineup = defaultLineup(seat.team);
    }
    seat.ready = true;
  }
  beginToss(s, now);
}

const ID_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const pickOne = <T,>(xs: readonly T[], rng: Rng): T => xs[Math.min(xs.length - 1, Math.floor(rng() * xs.length))];

/** A random sample team other than the host's, with its batting order shuffled a little: one or two neighbours swapped. */
export function botTeam(hostTeamId: string | null, rng: Rng): { team: Team; lineup: Lineup } {
  const team = structuredClone(pickOne(PRESET_TEAMS.filter((t) => t.id !== hostTeamId), rng));
  const lineup = defaultLineup(team);
  const order = lineup.battingOrder;
  const swaps = 1 + Math.floor(rng() * 2);
  let last = -1;
  for (let i = 0; i < swaps; i++) {
    // Never the same pair twice, which would put it back.
    const pairs = order.length - 1;
    let at = Math.floor(rng() * (last < 0 ? pairs : pairs - 1));
    if (last >= 0 && at >= last) at++;
    [order[at], order[at + 1]] = [order[at + 1], order[at]];
    last = at;
  }
  return { team, lineup };
}

/** Nobody has come for the searcher: a computer opponent takes the guest seat, ready to play, with everything on auto. */
function addBot(s: RoomState, { now, rng }: Ctx) {
  let ownerId = BOT_PREFIX;
  while (ownerId.length < BOT_ID_LENGTH) ownerId += pickOne([...ID_CHARS], rng);
  const names = BOT_NAMES.filter((n) => n.toLowerCase() !== s.host.nickname.trim().toLowerCase());
  const { team, lineup } = botTeam(s.host.team?.id ?? null, rng);
  s.guest = { ...newSeat({ ownerId, nickname: pickOne(names, rng) }), connected: true, team, lineup, ready: true };
  beginSetup(s, now);
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

/** Make the current move for a player who left it to the game or ran out of time. Says what to send. */
function playTurn(s: RoomState, events: SeqEvent[], ctx: Ctx): Step['send'] {
  const { now, rng } = ctx;
  const turn = currentTurn(s)!;
  const why: Auto = isAuto(s, turn) ? 'setting' : 'timeout';
  switch (turn.kind) {
    case 'tossCall':
      doTossCall(s, rng() < 0.5 ? 'heads' : 'tails', ctx);
      return 'room';
    case 'tossChoice':
      doTossChoice(s, rng() < 0.5 ? 'bat' : 'bowl', ctx);
      return 'snapshot';
    case 'bowler': {
      const seat = s[turn.seat]!;
      doBowler(s, events, suggestBowler(s.match!, seat.ownerId, seat.lineup), now, why);
      break;
    }
    case 'batter':
      doBatter(s, events, nextBatterOptions(s.match!)[0].id, now, why);
      break;
    case 'roll':
      doRoll(s, events, ctx, why);
      break;
  }
  return s.phase === 'finished' ? 'snapshot' : 'none';
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
    beginSetup(s, now);
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
      if (s.access === 'quick') throw new OnlineError('Quick matches are always 5 overs');
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
    case 'setOpen': {
      if (id !== 'host') throw new OnlineError('Only the host can do that');
      if (s.access === 'quick' || s.phase !== 'waiting') throw new OnlineError('That can only be changed before someone joins');
      const access: Access = a.on ? 'open' : 'private';
      if (s.access === access) return done('none');
      s.access = access;
      // A custom team cannot be used against strangers, and even a sample one may have been edited.
      me.team = null;
      me.lineup = null;
      me.ready = false;
      return done('room');
    }
    case 'setTeam': {
      inSetup();
      // Against strangers only the id counts, so that names edited in someone's browser are not shown.
      const team = isPublic(s) ? structuredClone(PRESET_TEAMS.find((t) => t.id === a.team.id)) : a.team;
      if (!team) throw new OnlineError('Only the sample teams can be used against strangers');
      me.team = team;
      me.lineup = defaultLineup(team);
      me.ready = false;
      return done('room');
    }
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
        beginToss(s, now);
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
      if (s.access === 'quick') throw new OnlineError('Leave the room to find someone else');
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
      doBowler(s, events, a.playerId, now);
      return moved();
    case 'chooseBatter':
      myTurn('batter');
      doBatter(s, events, a.playerId, now);
      return moved();
    case 'roll':
      myTurn('roll');
      if (now < s.nextBallAt) throw new OnlineError('Wait for the last ball to finish');
      doRoll(s, events, ctx);
      return moved();
    case 'setAuto': {
      if (me.auto[a.what] === a.on) return done('none');
      me.auto[a.what] = a.on;
      const turn = currentTurn(s);
      if (turn?.seat === id && turn.kind === a.what) {
        if (isPaused(s)) s.remaining = turnMs(s, turn);
        else {
          armClock(s, now);
          // Done here and now, so that switching it on and straight off again cannot win more time.
          if (a.on && s.deadline! <= now) return done(playTurn(s, events, ctx) === 'snapshot' ? 'snapshot' : 'room');
        }
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
      // A computer opponent always says yes.
      if (!other.wantsRematch && !isBot(other.ownerId)) return done('room');
      for (const seat of [s.host, s.guest!]) {
        seat.wantsRematch = false;
        seat.ready = isBot(seat.ownerId);
      }
      s.toss = null;
      s.match = null;
      s.end = null;
      s.seq = 0;
      beginSetup(s, now);
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
      // Two strangers have no reason to wait in the same room for someone else.
      if (id === 'host' || s.access === 'quick') close(s, now);
      else dropGuest(s, now);
      return done('snapshot');
  }
}

/** Time has passed: play any overdue turn for whoever ran out of time, and close unused rooms. */
export function tick(s0: RoomState, ctx: Ctx): Step {
  const { now } = ctx;
  const closing = closesAt(s0);
  if (closing !== null && closing <= now) {
    const s = structuredClone(s0);
    close(s, now);
    return { state: s, events: [], send: 'snapshot' };
  }
  const bot = botJoinsAt(s0);
  if (bot !== null && bot <= now) {
    const s = structuredClone(s0);
    addBot(s, ctx);
    return { state: s, events: [], send: 'room' };
  }
  if (s0.deadline === null || s0.deadline > now) return { state: s0, events: [], send: 'none' };

  const s = structuredClone(s0);
  const events: SeqEvent[] = [];
  if (s.phase === 'setup') {
    startQuick(s, ctx);
    return { state: s, events, send: 'snapshot' };
  }
  return { state: s, events, send: playTurn(s, events, ctx) };
}
