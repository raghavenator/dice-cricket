import { ALIAS } from './alias';
import { OnlineError, parseNickname } from './validate';
import { parseToken } from './protocol';

export interface Guest {
  /** Secret: proves this browser is this player. Never shown, and never part of a backup. */
  token: string;
  nickname: string;
}

const KEY = `dice-cricket-online-guest${ALIAS}`;

/** crypto.randomUUID only exists on https and localhost, so this uses getRandomValues. */
function newToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_');
}

function load(): Guest {
  try {
    const o = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Guest>;
    return { token: parseToken(o.token), nickname: typeof o.nickname === 'string' ? o.nickname : '' };
  } catch {
    const g = { token: newToken(), nickname: '' };
    save(g);
    return g;
  }
}

function save(g: Guest) {
  try {
    localStorage.setItem(KEY, JSON.stringify(g));
  } catch {
    // Storage is unavailable: they keep this identity until the page is closed.
  }
}

let guest: Guest | null = null;

export function getGuest(): Guest {
  guest ??= load();
  return guest;
}

/** Saves the name, or throws OnlineError saying what is wrong with it. */
export function setNickname(input: string): string {
  const nickname = parseNickname(input);
  guest = { ...getGuest(), nickname };
  save(guest);
  return nickname;
}

export function nicknameProblem(input: string): string | null {
  try {
    parseNickname(input);
    return null;
  } catch (e) {
    return e instanceof OnlineError ? e.message : 'Nickname is not valid';
  }
}
