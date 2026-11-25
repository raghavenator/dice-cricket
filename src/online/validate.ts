import type { MatchSettings, Player, Team } from '../engine/types';

/** Thrown when something received from the other side is not acceptable. The message is safe to show. */
export class OnlineError extends Error {}

export const PLAYERS_PER_TEAM = 11;
export const MIN_OVERS = 1;
export const MAX_OVERS = 20;
export const DEFAULT_OVERS = 5;
export const MAX_NAME = 40;
export const MAX_SHORT = 4;
export const MAX_NICKNAME = 20;

// Control characters and text-direction overrides. Joiners stay allowed: many scripts need them.
const UNSAFE = /[\p{Cc}‎‏‪-‮⁦-⁩]/u;
const HEX = /^#[0-9a-fA-F]{6}$/;

export function asObject(v: unknown, what: string): Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new OnlineError(`${what} is not valid`);
  return v as Record<string, unknown>;
}

function text(v: unknown, max: number, what: string): string {
  if (typeof v !== 'string') throw new OnlineError(`${what} must be text`);
  const s = v.trim();
  if (s === '') throw new OnlineError(`${what} cannot be empty`);
  if (s.length > max) throw new OnlineError(`${what} can be at most ${max} characters`);
  if (UNSAFE.test(s)) throw new OnlineError(`${what} contains characters that are not allowed`);
  return s;
}

/** Ids get an owner prefix later ("owner/id"), so a slash is reserved. */
export function parseId(v: unknown, what: string): string {
  if (typeof v !== 'string' || v === '' || v.length > 64 || v.includes('/') || UNSAFE.test(v))
    throw new OnlineError(`${what} is not valid`);
  return v;
}

export const parseNickname = (v: unknown): string => text(v, MAX_NICKNAME, 'Nickname');

function parsePlayer(v: unknown): Player {
  const o = asObject(v, 'Player');
  if (typeof o.bowler !== 'boolean') throw new OnlineError('Player is not valid');
  return { id: parseId(o.id, 'Player id'), name: text(o.name, MAX_NAME, 'Player name'), bowler: o.bowler };
}

/** Builds a fresh team from known keys only, so nothing unexpected is stored or passed on. */
export function parseTeam(v: unknown): Team {
  const o = asObject(v, 'Team');
  if (typeof o.color !== 'string' || !HEX.test(o.color)) throw new OnlineError('Team colour is not valid');
  if (!Array.isArray(o.players) || o.players.length !== PLAYERS_PER_TEAM)
    throw new OnlineError(`A team needs exactly ${PLAYERS_PER_TEAM} players`);
  const players = o.players.map(parsePlayer);
  if (new Set(players.map((p) => p.id)).size !== players.length) throw new OnlineError('Two players share an id');
  return {
    id: parseId(o.id, 'Team id'),
    name: text(o.name, MAX_NAME, 'Team name'),
    short: text(o.short, MAX_SHORT, 'Short name'),
    color: o.color,
    players,
  };
}

/** Online matches are always limited overs, with captains choosing their bowlers. */
export function parseSettings(v: unknown): MatchSettings {
  const { overs } = asObject(v, 'Settings');
  if (typeof overs !== 'number' || !Number.isInteger(overs) || overs < MIN_OVERS || overs > MAX_OVERS)
    throw new OnlineError(`Overs must be a whole number from ${MIN_OVERS} to ${MAX_OVERS}`);
  return { format: 'limited', overs, bowlerMode: 'manual' };
}
