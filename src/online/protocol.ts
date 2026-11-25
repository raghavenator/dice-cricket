import type { MatchState, Team } from '../engine/types';
import type { MatchEvent } from './events';
import { parseLineup, type Lineup } from './lineup';
import { OnlineError, asObject, parseId, parseNickname, parseSettings, parseTeam } from './validate';

/** Raise whenever messages, or the engine rules behind them, change. Old tabs are told to refresh. */
export const PROTOCOL_VERSION = 2;

export const MAX_MESSAGE_BYTES = 16 * 1024;

// ---------- Room codes ----------

/** No 0/O, 1/I/L or similar look-alikes. */
export const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const CODE_LENGTH = 6;
const CODE_RE = new RegExp(`^[${CODE_ALPHABET}]{${CODE_LENGTH}}$`);

/** Accepts any letter case, spaces and dashes. Null when it cannot be a room code. */
export function normalizeCode(input: string): string | null {
  const code = input.toUpperCase().replace(/[\s-]/g, '');
  return CODE_RE.test(code) ? code : null;
}

// ---------- Shared shapes ----------

export type SeatId = 'host' | 'guest';
export type Phase = 'waiting' | 'setup' | 'toss' | 'playing' | 'finished' | 'closed';
export type TurnKind = 'tossCall' | 'tossChoice' | 'bowler' | 'batter' | 'roll';

/** What the game does for a player without asking. */
export interface AutoSettings {
  roll: boolean;
  batter: boolean;
  bowler: boolean;
}

export interface Turn {
  seat: SeatId;
  kind: TurnKind;
}

export interface TossState {
  call?: 'heads' | 'tails';
  face?: 'heads' | 'tails';
  winner?: SeatId;
  choice?: 'bat' | 'bowl';
}

export interface MatchEnd {
  kind: 'played' | 'forfeit';
  /** Who forfeited. */
  loser?: SeatId;
}

/** Times are the server's. `now` lets a browser work out how far its own clock is off. */
export interface Clock {
  now: number;
  turn: Turn | null;
  /** When the current turn is decided automatically. Null while paused. */
  deadline: number | null;
  /** Earliest time the next ball may be rolled, so both animations finish. */
  nextBallAt: number;
  paused: boolean;
  /** When you may claim the win, if your opponent is away. */
  claimAt: number | null;
}

export interface SeatView {
  ownerId: string;
  nickname: string;
  connected: boolean;
  ready: boolean;
  auto: AutoSettings;
  wantsRematch: boolean;
  left: boolean;
  /** Only what the opponent may see before the match. */
  team: Pick<Team, 'name' | 'short' | 'color'> | null;
}

export interface RoomView {
  code: string;
  phase: Phase;
  you: SeatId;
  overs: number;
  /** Number of the last match event included. */
  seq: number;
  host: SeatView;
  guest: SeatView | null;
  /** Your own team and lineup. The opponent's are never sent. */
  team: Team | null;
  lineup: Lineup | null;
  toss: TossState | null;
  end: MatchEnd | null;
  clock: Clock;
}

// ---------- Messages ----------

export type ClientMessage =
  | { t: 'hello'; v: number; token: string; nickname: string }
  | { t: 'sync' }
  | { t: 'leave' }
  | { t: 'removeGuest' }
  | { t: 'setSettings'; overs: number }
  | { t: 'setTeam'; team: Team }
  | { t: 'setLineup'; lineup: Lineup }
  | { t: 'ready' }
  | { t: 'unready' }
  | { t: 'callToss'; call: 'heads' | 'tails' }
  | { t: 'chooseInnings'; choice: 'bat' | 'bowl' }
  | { t: 'chooseBowler'; playerId: string }
  | { t: 'chooseBatter'; playerId: string }
  | { t: 'roll' }
  | { t: 'setAuto'; what: keyof AutoSettings; on: boolean }
  | { t: 'claimWin' }
  | { t: 'rematch' };

/** What a seated player can do. `hello` and `sync` are handled before the room sees them. */
export type RoomAction = Exclude<ClientMessage, { t: 'hello' | 'sync' }>;

export type ServerMessage =
  /** Everything. Sent on joining, reconnecting, and when the match starts or ends. */
  | { t: 'snapshot'; view: RoomView; match: MatchState | null }
  /** Room details changed, but not the match. */
  | { t: 'room'; view: RoomView }
  | { t: 'event'; seq: number; event: MatchEvent; digest: string; clock: Clock }
  /** `fatal` means the connection is of no more use, e.g. the room is full. */
  | { t: 'error'; message: string; fatal?: boolean };

const TOKEN_RE = /^[A-Za-z0-9_-]{22,64}$/;

export function parseToken(v: unknown): string {
  if (typeof v !== 'string' || !TOKEN_RE.test(v)) throw new OnlineError('Your guest ID is not valid');
  return v;
}

function pick<T extends string>(v: unknown, ...allowed: T[]): T {
  if (!allowed.includes(v as T)) throw new OnlineError('Message is not valid');
  return v as T;
}

/** Owned ids ("owner/id") are used once a match has started, so unlike `parseId` this allows one slash. */
function parseOwnedId(v: unknown): string {
  const parts = typeof v === 'string' ? v.split('/') : [];
  if (parts.length !== 2) throw new OnlineError('Player id is not valid');
  return parts.map((p) => parseId(p, 'Player id')).join('/');
}

/** Turns raw text from a browser into a checked message, or throws OnlineError. */
export function parseClientMessage(raw: string): ClientMessage {
  // A character is at least one byte, so this is checked before the exact (slower) count.
  if (raw.length > MAX_MESSAGE_BYTES || new TextEncoder().encode(raw).length > MAX_MESSAGE_BYTES)
    throw new OnlineError('Message is too big');
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new OnlineError('Message is not valid');
  }
  const o = asObject(json, 'Message');
  switch (o.t) {
    case 'hello':
      if (o.v !== PROTOCOL_VERSION) throw new OnlineError('The game has been updated. Please refresh the page.');
      return { t: 'hello', v: PROTOCOL_VERSION, token: parseToken(o.token), nickname: parseNickname(o.nickname) };
    case 'sync':
    case 'leave':
    case 'removeGuest':
    case 'ready':
    case 'unready':
    case 'roll':
    case 'claimWin':
    case 'rematch':
      return { t: o.t };
    case 'setSettings':
      return { t: 'setSettings', overs: parseSettings(o).overs };
    case 'setTeam':
      return { t: 'setTeam', team: parseTeam(o.team) };
    case 'setLineup':
      return { t: 'setLineup', lineup: parseLineup(o.lineup) };
    case 'callToss':
      return { t: 'callToss', call: pick(o.call, 'heads', 'tails') };
    case 'chooseInnings':
      return { t: 'chooseInnings', choice: pick(o.choice, 'bat', 'bowl') };
    case 'chooseBowler':
      return { t: 'chooseBowler', playerId: parseOwnedId(o.playerId) };
    case 'chooseBatter':
      return { t: 'chooseBatter', playerId: parseOwnedId(o.playerId) };
    case 'setAuto':
      if (typeof o.on !== 'boolean') throw new OnlineError('Message is not valid');
      return { t: 'setAuto', what: pick(o.what, 'roll', 'batter', 'bowler'), on: o.on };
    default:
      throw new OnlineError('Message is not valid');
  }
}
