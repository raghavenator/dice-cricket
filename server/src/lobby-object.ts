import { DurableObject } from 'cloudflare:workers';
import { CreateLimit, LobbyBook, type Entry, type Listing } from '../../src/online/lobby';
import type { Access, LobbyRoom, Who } from '../../src/online/protocol';
import { DEFAULT_OVERS } from '../../src/online/validate';
import { randomCode } from './code';
import type { Env } from './index';

const PREFIX = 'room:';
/** Rooms to check before giving up and making a new one. */
const MAX_TRIES = 10;

/** There is one lobby. It knows which rooms strangers can join, and makes every new room. */
export class Lobby extends DurableObject<Env> {
  private book = new LobbyBook();
  private limit: CreateLimit;
  /** Quick match requests are dealt with one at a time, or two people could each start a room and wait for ever. */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.limit = new CreateLimit(Number(env.CREATE_MAX));
    void ctx.blockConcurrencyWhile(async () => {
      this.book = new LobbyBook([...(await ctx.storage.list<Entry>({ prefix: PREFIX })).values()]);
    });
  }

  /** Called by rooms, whenever this changes and every so often while waiting. */
  async announce(code: string, listing: Listing | null, seq: number): Promise<void> {
    this.save(code, this.book.announce(code, listing, Date.now(), seq));
  }

  async list(ownerId: string): Promise<LobbyRoom[]> {
    this.prune();
    return this.book.openRooms(ownerId, Date.now());
  }

  /** A new private or open room, or null if this person has made too many lately. */
  async create(host: Who, access: Access, ip: string): Promise<string | null> {
    return this.limit.allow(ip, Date.now()) ? this.makeRoom(host, access) : null;
  }

  /** The room to go to for a quick match, or null if this person has made too many lately. */
  quick(who: Who, ip: string, current: string | null): Promise<string | null> {
    const turn = this.queue.then(() => this.pairUp(who, ip, current));
    this.queue = turn.catch(() => undefined);
    return turn;
  }

  private async pairUp(who: Who, ip: string, current: string | null): Promise<string | null> {
    this.prune();
    for (let i = 0; i < MAX_TRIES; i++) {
      const before = new Set(this.book.entries.keys());
      const code = this.book.pair(who.ownerId, Date.now(), current);
      for (const c of before) if (!this.book.entries.has(c)) this.save(c, null);
      if (!code) break;
      // They stay where they are; or the room confirms that it really is still waiting.
      if (code === current || (await this.room(code).isWaiting())) {
        const entry = this.book.entries.get(code);
        if (entry) this.save(code, entry);
        return code;
      }
      this.book.drop(code, Date.now());
      this.save(code, null);
    }
    // Already waiting somewhere: never make them a second room.
    if (current) return current;
    const now = Date.now();
    if (!this.limit.allow(ip, now)) return null;
    const made = await this.makeRoom(who, 'quick');
    // Listed at once, before its maker has even connected, so that the next person is sent here.
    await this.announce(made, {
      code: made, kind: 'quick', ownerId: who.ownerId, nickname: who.nickname, overs: DEFAULT_OVERS, since: now,
    }, 0);
    return made;
  }

  private async makeRoom(host: Who, access: Access): Promise<string> {
    for (let i = 0; i < 5; i++) {
      const code = randomCode();
      if (await this.room(code).create(code, host, access)) return code;
    }
    throw new Error('No free room code');
  }

  private room(code: string) {
    return this.env.ROOMS.get(this.env.ROOMS.idFromName(code));
  }

  private prune(): void {
    for (const code of this.book.prune(Date.now())) this.save(code, null);
  }

  private save(code: string, entry: Entry | null): void {
    void (entry ? this.ctx.storage.put(PREFIX + code, entry) : this.ctx.storage.delete(PREFIX + code));
  }
}
