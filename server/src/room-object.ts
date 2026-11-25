import { DurableObject } from 'cloudflare:workers';
import { parseClientMessage, type ServerMessage } from '../../src/online/protocol';
import {
  act, clockFor, connect, createRoom, deletesAt, disconnect, nextWake, seatOf, tick, viewFor,
  type Ctx, type RoomState, type Step, type Who,
} from '../../src/online/room';
import { OnlineError } from '../../src/online/validate';
import { ownerIdFor, secureRandom } from './identity';
import type { Env } from './index';

const MAX_SOCKETS = 12;
/** Browsers ping every 5 seconds. One that has been silent this long has gone, even if nobody said so. */
const STALE_MS = 35_000;
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
  private budgets = new Map<WebSocket, { tokens: number; at: number }>();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
    void ctx.blockConcurrencyWhile(async () => {
      this.state = (await ctx.storage.get<RoomState>('room')) ?? null;
      this.alarmAt = await ctx.storage.getAlarm();
      // After a restart, sockets may be gone without anyone having been told.
      for (const seat of this.state ? [this.state.host, this.state.guest] : []) {
        if (this.state && seat?.connected && !this.socketsOf(seat.ownerId).length)
          this.publish(disconnect(this.state, seat.ownerId, Date.now()));
      }
    });
  }

  /** Called by the Worker. False when the code is already in use. */
  async create(code: string, host: Who): Promise<boolean> {
    if (this.state) return false;
    this.publish({ state: createRoom(code, host, Date.now()), events: [], send: 'none' });
    return true;
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
    for (const ws of this.ctx.getWebSockets()) {
      const seen = this.ctx.getWebSocketAutoResponseTimestamp(ws)?.getTime() ?? this.attachment(ws).openedAt;
      if (now - seen > STALE_MS) {
        this.close(ws, 'No reply');
        this.gone(ws);
      }
    }
    if (this.state) this.publish(tick(this.state, ctxNow()));
  }

  // ---------- Helpers ----------

  /** Save the new state, tell everyone what changed (`except` gets its own snapshot), and set the next alarm. */
  private publish(step: Step, except?: WebSocket): void {
    const changed = step.state !== this.state;
    this.state = step.state;
    const now = Date.now();
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
      this.alarmAt = null;
      void this.ctx.storage.deleteAlarm();
      void this.ctx.storage.deleteAll();
      return;
    }
    // Writes are not awaited: the runtime holds outgoing messages back until they are safely stored.
    if (changed) void this.ctx.storage.put('room', step.state);
    const wake = nextWake(step.state);
    if (wake !== this.alarmAt) {
      this.alarmAt = wake;
      void (wake === null ? this.ctx.storage.deleteAlarm() : this.ctx.storage.setAlarm(wake));
    }
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
