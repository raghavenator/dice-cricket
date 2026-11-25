import type { LobbyRoom } from './protocol';

// Which rooms strangers can join. Pure, like room.ts: the server's Lobby object saves it and keeps the time.

/** What a room tells the lobby while it is waiting for a stranger. */
export interface Listing {
  code: string;
  kind: 'open' | 'quick';
  ownerId: string;
  nickname: string;
  overs: number;
  /** When the wait began. */
  since: number;
}

export interface Entry extends Listing {
  /** When the room last said it is still waiting. */
  seen: number;
  /** Someone is on their way in, so nobody else is sent here until then. */
  reservedUntil: number;
  /** Number of the message this came from. */
  seq: number;
}

/** Waiting rooms repeat themselves this often, so that one that died without a word drops off the list. */
export const HEARTBEAT_MS = 30_000;
export const EXPIRE_MS = 75_000;
/** Long enough to open a connection. */
export const RESERVE_MS = 10_000;
export const MAX_LISTED = 50;
const MAX_ENTRIES = 500;

/** New rooms per person (IP address) in a stretch of time. */
export const CREATE_WINDOW_MS = 10 * 60_000;
export const CREATE_MAX = 30;

export class LobbyBook {
  readonly entries: Map<string, Entry>;
  /** Rooms no longer waiting, and the number of the message that said so: an older one arriving late is ignored. */
  private ended = new Map<string, number>();

  constructor(entries: Entry[] = []) {
    this.entries = new Map(entries.map((e) => [e.code, e]));
  }

  /** Drops rooms not heard from. Returns their codes. */
  prune(now: number): string[] {
    const gone = [...this.entries.values()].filter((e) => e.seen + EXPIRE_MS <= now).map((e) => e.code);
    for (const code of gone) this.entries.delete(code);
    // Message numbers are times, so this is when the room ended.
    for (const [code, seq] of this.ended) if (seq + 2 * EXPIRE_MS <= now) this.ended.delete(code);
    return gone;
  }

  /**
   * A room says it is waiting, or (null) that it no longer is. Returns what is now held for it. Messages can arrive
   * out of order, so each room numbers its own, rising with the time.
   */
  announce(code: string, listing: Listing | null, now: number, seq: number = now): Entry | null {
    const old = this.entries.get(code);
    if (seq < (old?.seq ?? this.ended.get(code) ?? -1)) return old ?? null;
    if (!listing) {
      this.drop(code, seq);
      return null;
    }
    if (!old && this.entries.size >= MAX_ENTRIES) return null;
    this.ended.delete(code);
    const entry: Entry = { ...listing, code, seen: now, seq, reservedUntil: old?.reservedUntil ?? 0 };
    this.entries.set(code, entry);
    return entry;
  }

  /** This room turned out not to be waiting. */
  drop(code: string, seq: number): void {
    this.entries.delete(code);
    this.ended.set(code, seq);
  }

  /** Open rooms to show someone, newest first, without their own. */
  openRooms(ownerId: string, now: number): LobbyRoom[] {
    return [...this.entries.values()]
      .filter((e) => e.kind === 'open' && e.ownerId !== ownerId && e.seen + EXPIRE_MS > now)
      .sort((a, b) => b.since - a.since)
      .slice(0, MAX_LISTED)
      .map(({ code, nickname, overs, since }) => ({ code, nickname, overs, since }));
  }

  /**
   * Quick match: the room this player should go to, or null when they should start a new one and wait.
   * `current` is the room they are already waiting in. They are only ever moved to someone who has waited longer, so
   * two waiting players can never swap places, and never out of a room someone is on their way to.
   */
  pair(ownerId: string, now: number, current: string | null): string | null {
    const quick = [...this.entries.values()].filter((e) => e.kind === 'quick' && e.seen + EXPIRE_MS > now);
    const own = quick.find((e) => e.ownerId === ownerId);
    const other = quick
      .filter((e) => e.ownerId !== ownerId && e.reservedUntil <= now)
      .sort((a, b) => a.since - b.since || (a.code < b.code ? -1 : 1))[0];
    // They are waiting somewhere that is no longer listed: someone has just joined them, so they must stay.
    if (current && own?.code !== current) return current;
    if (own && (own.reservedUntil > now || !other || own.since < other.since || (own.since === other.since && own.code < other.code)))
      return own.code;
    if (!other) return null;
    other.reservedUntil = now + RESERVE_MS;
    if (own) this.entries.delete(own.code);
    return other.code;
  }
}

/** Exact count of recent new rooms per person. Held in memory only. */
export class CreateLimit {
  private times = new Map<string, number[]>();

  constructor(private max = CREATE_MAX) {}

  allow(key: string, now: number): boolean {
    const recent = (this.times.get(key) ?? []).filter((t) => t + CREATE_WINDOW_MS > now);
    const ok = recent.length < this.max;
    if (ok) recent.push(now);
    this.times.set(key, recent);
    if (this.times.size > 5000) {
      for (const [k, ts] of this.times) if (ts.every((t) => t + CREATE_WINDOW_MS <= now)) this.times.delete(k);
    }
    return ok;
  }
}
