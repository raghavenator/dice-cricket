import { DurableObject } from 'cloudflare:workers';
import { HEARTBEAT_MS, type Listing } from '../../src/online/lobby';
import { parseClientMessage, type Access, type FinishedMatch, type RoomResults, type ServerMessage, type Who } from '../../src/online/protocol';
import {
  KEEP_FINISHED_MS, STATE_VERSION, act, clockFor, connect, createRoom, deletesAt, disconnect, finishedMatch, isLive,
  nextWake, seatOf, tick, viewFor, type Ctx, type RoomState, type Step,
} from '../../src/online/room';
import { OnlineError } from '../../src/online/validate';
import { ownerIdFor, secureRandom } from './identity';
import type { Env } from './index';
import type { Lobby } from './lobby-object';

const ROOM_KEY = `room-v${STATE_VERSION}`;
/** Finished matches are kept apart from the room, so that a rematch or closing the room does not lose them. */
const RESULT_PREFIX = 'result:';
const MAX_RESULTS = 20;
const MAX_SOCKETS = 12;
/** Browsers ping every 5 seconds. One that has been silent this long has gone, even if nobody said so. */
const STALE_MS = 35_000;
/**
 * Alarms are set at least this far ahead. On Cloudflare, an alarm set for the same millisecond as the one now running
 * is taken to be that one, and is lost or badly delayed.
 */
const ALARM_LEAD_MS = 10;
/** More moves than could ever be due at once. */
const MAX_CATCH_UP = 20;
/** Messages: a burst of this many, refilled at this many a second. */
const BURST = 20;
const PER_SECOND = 5;

/** Who a socket belongs to, once it has said hello. Kept with the socket while the room sleeps. */
interface Attachment {
  ownerId?: string;
  openedAt: number;
}

const ctxNow = (): Ctx => ({ now: Date.now(), rng: secureRandom });

/** One room: saves the state, passes messages, and keeps time. The rules are all in src/online/room.ts. */
export class Room extends DurableObject<Env> {
  private state: RoomState | null = null;
  private alarmAt: number | null = null;
  /** What the lobby was last told, as JSON. */
  private announced = 'null';
  /** Number of the last message to the lobby. */
  private lobbySeq = 0;
  /** Kept, because messages through one stub arrive in the order they were sent. */
  private lobby?: DurableObjectStub<Lobby>;
  /** Results being kept: match id and when it finished, oldest first. */
  private results = new Map<string, number>();
  private budgets = new Map<WebSocket, { tokens: number; at: number }>();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
    void ctx.blockConcurrencyWhile(async () => {
      const saved = await ctx.storage.get<RoomState>(ROOM_KEY);
      // Rooms from before open rooms existed are all private.
      this.state = saved ? { ...saved, access: saved.access ?? 'private' } : null;
      this.announced = JSON.stringify(this.listing());
      this.alarmAt = await ctx.storage.getAlarm();
      const kept = [...(await ctx.storage.list<FinishedMatch>({ prefix: RESULT_PREFIX })).values()];
      kept.sort((a, b) => a.completedAt - b.completedAt);
      for (const r of kept) this.results.set(r.match.id, r.completedAt);
      // After a restart, sockets may be gone without anyone having been told.
      for (const seat of this.state ? [this.state.host, this.state.guest] : []) {
        if (this.state && seat?.connected && !this.socketsOf(seat.ownerId).length)
          this.publish(disconnect(this.state, seat.ownerId, Date.now()));
      }
    });
  }

  /** Called by the Worker. False when the code is already in use. */
  async create(code: string, host: Who, access: Access): Promise<boolean> {
    if (this.state || this.results.size) return false;
    this.publish({ state: createRoom(code, host, Date.now(), access), events: [], send: 'none' });
    return true;
  }

  /** Called by the lobby before it sends a stranger here. */
  async isWaiting(): Promise<boolean> {
    this.dropStale();
    return this.state?.phase === 'waiting' && this.state.access === 'quick';
  }

  /** Called by the Worker: what this player may have missed. */
  async missed(ownerId: string): Promise<RoomResults> {
    const kept = [...(await this.ctx.storage.list<FinishedMatch>({ prefix: RESULT_PREFIX })).values()];
    return {
      ownerId,
      live: this.state !== null && isLive(this.state) && seatOf(this.state, ownerId) !== null,
      results: kept.filter((r) => r.host.ownerId === ownerId || r.guest.ownerId === ownerId),
    };
  }

  async fetch(): Promise<Response> {
    const { 0: client, 1: server } = new WebSocketPair();
    const crowded = this.ctx.getWebSockets().length >= MAX_SOCKETS;
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ openedAt: Date.now() } satisfies Attachment);
    if (!this.state) this.refuse(server, 'Room not found');
    else if (crowded) this.refuse(server, 'Too many connections to this room');
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    if (!this.withinBudget(ws)) {
      this.refuse(ws, 'Too many messages');
      return;
    }
    try {
      if (typeof raw !== 'string') throw new OnlineError('Message is not valid');
      const msg = parseClientMessage(raw);
      // Hashing pauses this call, so it comes before anything looks at the room.
      const helloId = msg.t === 'hello' ? await ownerIdFor(msg.token) : '';
      if (!this.state) {
        this.refuse(ws, 'Room not found');
        return;
      }
      // In case an alarm is late. Any message will do, and browsers send one when a turn is overdue.
      this.catchUp();
      if (!this.state) return;
      const { ownerId } = this.attachment(ws);

      if (msg.t === 'hello') {
        if (ownerId) throw new OnlineError('Already connected');
        let step: Step;
        try {
          step = connect(this.state, { ownerId: helloId, nickname: msg.nickname }, Date.now());
        } catch (e) {
          if (!(e instanceof OnlineError)) throw e;
          this.refuse(ws, e.message);
          return;
        }
        ws.serializeAttachment({ ...this.attachment(ws), ownerId: helloId } satisfies Attachment);
        this.publish(step, ws);
        this.sendSnapshot(ws);
        return;
      }
      if (!ownerId) throw new OnlineError('Say hello first');
      if (msg.t === 'sync') {
        this.sendSnapshot(ws);
        return;
      }
      this.publish(act(this.state, ownerId, msg, ctxNow()));
      if (msg.t === 'leave') {
        for (const s of this.socketsOf(ownerId)) this.refuse(s, 'You left the room');
        if (this.state) this.publish(disconnect(this.state, ownerId, Date.now()));
      }
    } catch (e) {
      if (e instanceof OnlineError) this.send(ws, { t: 'error', message: e.message });
      else {
        console.error(e);
        this.send(ws, { t: 'error', message: 'Something went wrong' });
      }
    }
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    this.gone(ws);
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    this.gone(ws);
  }

  async alarm(): Promise<void> {
    this.alarmAt = null;
    const now = Date.now();
    for (const [id, at] of this.results) if (at + KEEP_FINISHED_MS <= now) this.dropResult(id);
    if (!this.state) {
      this.rest();
      return;
    }
    this.dropStale();
    this.catchUp();
    // Deletes the room if its time has come, and otherwise sets the next alarm.
    if (this.state) this.publish({ state: this.state, events: [], send: 'none' });
    // Still waiting for a stranger: say so again, or the lobby will forget this room.
    if (this.listing()) this.tellLobby(true);
  }

  // ---------- Helpers ----------

  /** Let go of connections that have gone quiet. */
  private dropStale(): void {
    const now = Date.now();
    for (const ws of this.ctx.getWebSockets()) {
      const seen = this.ctx.getWebSocketAutoResponseTimestamp(ws)?.getTime() ?? this.attachment(ws).openedAt;
      if (now - seen <= STALE_MS) continue;
      this.close(ws, 'No reply');
      this.gone(ws);
    }
  }

  /** What the lobby should show for this room, if anything. */
  private listing(): Listing | null {
    const s = this.state;
    if (!s || s.access === 'private' || s.phase !== 'waiting' || !s.host.connected) return null;
    return {
      code: s.code, kind: s.access, ownerId: s.host.ownerId, nickname: s.host.nickname, overs: s.overs, since: s.phaseAt,
    };
  }

  private tellLobby(again = false, code = this.state?.code): void {
    const listing = this.listing();
    const json = JSON.stringify(listing);
    if (!code || (json === this.announced && !again)) return;
    this.announced = json;
    this.lobby ??= this.env.LOBBY.get(this.env.LOBBY.idFromName('main'));
    this.lobbySeq = Math.max(Date.now(), this.lobbySeq + 1);
    this.ctx.waitUntil(
      this.lobby.announce(code, listing, this.lobbySeq).catch((e) => {
        // A stub that has failed may stay broken, so get a new one next time.
        this.lobby = undefined;
        console.error(e);
      }),
    );
  }

  /** Make every move that is due. One can make the next due at once, such as an automatic bowler and then the roll. */
  private catchUp(): void {
    for (let i = 0; i < MAX_CATCH_UP && this.state; i++) {
      const step = tick(this.state, ctxNow());
      if (step.state === this.state) return;
      this.publish(step);
    }
  }

  /** Save the new state, tell everyone what changed (`except` gets its own snapshot), and set the next alarm. */
  private publish(step: Step, except?: WebSocket): void {
    const changed = step.state !== this.state;
    // The lobby lists a quick room before its maker has connected, so it must hear when the wait ends regardless.
    const waitOver = this.state?.phase === 'waiting' && step.state.phase !== 'waiting' && step.state.access !== 'private';
    this.state = step.state;
    const now = Date.now();
    const result = finishedMatch(step.state);
    if (result && !this.results.has(result.match.id)) {
      void this.ctx.storage.put(RESULT_PREFIX + result.match.id, result);
      this.results.set(result.match.id, result.completedAt);
      const [oldest] = this.results.keys();
      if (this.results.size > MAX_RESULTS) this.dropResult(oldest);
    }
    const due = deletesAt(step.state);
    const over = due !== null && due <= now;

    for (const ws of this.ctx.getWebSockets()) {
      const { ownerId } = this.attachment(ws);
      if (!ownerId || ws.readyState !== WebSocket.OPEN) continue;
      const seat = seatOf(step.state, ownerId);
      if (!seat) {
        // A guest who left is told so by their own `leave`.
        if (step.state.removed.includes(ownerId)) this.refuse(ws, 'The host removed you from this room');
        continue;
      }
      for (const e of step.events) this.send(ws, { t: 'event', ...e, clock: clockFor(step.state, seat, now) });
      if (ws !== except) {
        if (step.send === 'snapshot') this.sendSnapshot(ws);
        else if (step.send === 'room') this.send(ws, { t: 'room', view: viewFor(step.state, seat, now) });
      }
      if (over) this.refuse(ws, 'This room has closed');
    }

    if (over) {
      this.state = null;
      this.tellLobby(waitOver, step.state.code);
      void this.ctx.storage.delete(ROOM_KEY);
      this.rest();
      return;
    }
    // Writes are not awaited: the runtime holds outgoing messages back until they are safely stored.
    if (changed) void this.ctx.storage.put(ROOM_KEY, step.state);
    this.tellLobby(waitOver);
    // While listed, wake to repeat the listing, and to notice if the host has silently gone.
    const wake = nextWake(step.state);
    const beat = this.listing() ? now + HEARTBEAT_MS : null;
    this.wakeAt(wake === null ? beat : beat === null ? wake : Math.min(wake, beat));
  }

  /** The room itself has gone. Keep only results still to be collected, if any. */
  private rest(): void {
    this.wakeAt(null);
    if (this.results.size === 0) void this.ctx.storage.deleteAll();
  }

  /** Set the alarm for this time, or for the first result to expire if that is sooner. */
  private wakeAt(time: number | null): void {
    const expiry = this.results.size ? Math.min(...this.results.values()) + KEEP_FINISHED_MS : null;
    const times = [time, expiry].filter((t): t is number => t !== null);
    const wake = times.length ? Math.min(...times) : null;
    if (wake === this.alarmAt) return;
    this.alarmAt = wake;
    void (wake === null ? this.ctx.storage.deleteAlarm() : this.ctx.storage.setAlarm(Math.max(wake, Date.now() + ALARM_LEAD_MS)));
  }

  private dropResult(id: string): void {
    this.results.delete(id);
    void this.ctx.storage.delete(RESULT_PREFIX + id);
  }

  private attachment(ws: WebSocket): Attachment {
    return ws.deserializeAttachment() as Attachment;
  }

  private socketsOf(ownerId: string): WebSocket[] {
    return this.ctx
      .getWebSockets()
      .filter((ws) => ws.readyState === WebSocket.OPEN && this.attachment(ws).ownerId === ownerId);
  }

  private gone(ws: WebSocket): void {
    this.budgets.delete(ws);
    const { ownerId } = this.attachment(ws);
    if (!this.state || !ownerId) return;
    // Another tab may still be open.
    if (this.socketsOf(ownerId).some((s) => s !== ws)) return;
    this.publish(disconnect(this.state, ownerId, Date.now()));
  }

  private sendSnapshot(ws: WebSocket): void {
    const { ownerId } = this.attachment(ws);
    const seat = this.state && ownerId ? seatOf(this.state, ownerId) : null;
    if (this.state && seat)
      this.send(ws, { t: 'snapshot', view: viewFor(this.state, seat, Date.now()), match: this.state.match });
  }

  private send(ws: WebSocket, msg: ServerMessage): void {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      // Already closed; webSocketClose will deal with it.
    }
  }

  private refuse(ws: WebSocket, message: string): void {
    this.send(ws, { t: 'error', message, fatal: true });
    this.close(ws, message);
  }

  private close(ws: WebSocket, reason: string): void {
    try {
      ws.close(4000, reason);
    } catch {
      // Already closed.
    }
  }

  private withinBudget(ws: WebSocket): boolean {
    const now = Date.now();
    const b = this.budgets.get(ws) ?? { tokens: BURST, at: now };
    b.tokens = Math.min(BURST, b.tokens + ((now - b.at) / 1000) * PER_SECOND) - 1;
    b.at = now;
    this.budgets.set(ws, b);
    return b.tokens >= 0;
  }
}
