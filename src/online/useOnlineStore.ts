import ReconnectingWebSocket from 'partysocket/ws';
import { create } from 'zustand';
import type { MatchState } from '../engine/types';
import { applyEvent, digest, type MatchEvent } from './events';
import { getGuest } from './guest';
import { expectResult, resultSettled, saveFinished } from './onlineDb';
import { PROTOCOL_VERSION, type ClientMessage, type Clock, type RoomView, type ServerMessage } from './protocol';

const PING_MS = 5_000;
/** No reply to a ping for this long means the connection is dead, even if the browser has not noticed. */
const PONG_MS = 8_000;
/** A turn this far past its deadline means the server's timer is late, so remind it. */
const OVERDUE_MS = 2_500;

/** Where the rooms are. "same" means the same address as this page. */
export function serverUrl(): string | null {
  const url = import.meta.env.VITE_ONLINE_URL as string | undefined;
  if (!url) return null;
  return url === 'same' ? window.location.origin : url.replace(/\/$/, '');
}

export async function createRoom(nickname: string): Promise<string> {
  const base = serverUrl();
  if (!base) throw new Error('Online play is not set up on this site.');
  let res: Response;
  try {
    res = await fetch(`${base}/rooms`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ v: PROTOCOL_VERSION, token: getGuest().token, nickname }),
    });
  } catch {
    throw new Error('Cannot reach the game server. Check your connection and try again.');
  }
  const body = (await res.json().catch(() => ({}))) as { code?: string; error?: string };
  if (!body.code) throw new Error(body.error ?? 'Could not create a room. Try again.');
  return body.code;
}

/** Match updates wait here while the dice for earlier ones are still rolling. */
export type QueueItem =
  | { kind: 'event'; seq: number; event: MatchEvent; digest: string }
  | { kind: 'snapshot'; view: RoomView; match: MatchState | null };

interface OnlineState {
  status: 'idle' | 'connecting' | 'open' | 'lost';
  view: RoomView | null;
  /** The match as shown on screen; it trails the server by whatever is in the queue. */
  match: MatchState | null;
  /** The last event included in `match`. (`view.seq` can be ahead of it.) */
  shownSeq: number;
  queue: QueueItem[];
  clock: Clock | null;
  /** Server time minus this computer's time. */
  offset: number;
  /** The room is of no more use, and why. */
  fatal: string | null;
  toast: { id: number; text: string } | null;
  /** Whether the finished match on screen has been recorded in this browser. */
  saved: 'no' | 'yes' | 'failed';

  join(code: string): void;
  quit(): void;
  /** Leave the room for good, waiting briefly for the server to confirm (and send any result). */
  leave(): Promise<void>;
  send(m: ClientMessage): void;
  /** Apply the first queued item. */
  advance(): void;
}

let socket: ReconnectingWebSocket | null = null;
let stopPings: (() => void) | null = null;

/** Background tabs slow ordinary timers to one a minute, but not timers in a worker. */
function every(ms: number, fn: () => void): () => void {
  try {
    const url = URL.createObjectURL(new Blob([`setInterval(() => postMessage(0), ${ms})`], { type: 'text/javascript' }));
    const worker = new Worker(url);
    URL.revokeObjectURL(url);
    worker.onmessage = fn;
    return () => worker.terminate();
  } catch {
    const t = window.setInterval(fn, ms);
    return () => window.clearInterval(t);
  }
}

const EMPTY = { view: null, match: null, shownSeq: 0, queue: [], clock: null, offset: 0, fatal: null, toast: null, saved: 'no' as const };

export const useOnline = create<OnlineState>((set, get) => {
  const raw = (m: ClientMessage) => {
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(m));
  };

  function applySnapshot(view: RoomView, match: MatchState | null) {
    set({ view, match, shownSeq: view.seq, clock: view.clock });
  }

  /** Record a finished match, or note that one is under way so that its result can be collected later. */
  async function record(view: RoomView, match: MatchState | null) {
    const me = view[view.you]!;
    try {
      if (view.phase === 'toss' || view.phase === 'playing') {
        set({ saved: 'no' });
        await expectResult(view.code, me.ownerId);
      } else if (view.phase === 'finished' && match?.result && view.guest && view.end && view.finishedAt !== null) {
        const who = ({ ownerId, nickname }: typeof me) => ({ ownerId, nickname });
        await saveFinished(me.ownerId, [
          { match, host: who(view.host), guest: who(view.guest), end: view.end, completedAt: view.finishedAt },
        ]);
        await resultSettled(view.code);
        set({ saved: 'yes' });
      }
    } catch (e) {
      console.error(e);
      if (view.phase === 'finished') set({ saved: 'failed' });
    }
  }

  function receive(m: ServerMessage) {
    if (m.t === 'error') {
      if (m.fatal) {
        set({ fatal: m.message });
        hangUp();
      } else set({ toast: { id: Date.now(), text: m.message } });
      return;
    }
    if (m.t === 'event') {
      set({
        queue: [...get().queue, { kind: 'event', seq: m.seq, event: m.event, digest: m.digest }],
        clock: m.clock,
        offset: m.clock.now - Date.now(),
      });
      return;
    }
    set({ offset: m.view.clock.now - Date.now() });
    const { queue, view } = get();
    if (m.t === 'room') {
      // Who is here and who is ready can be shown at once; only the match itself waits for the dice.
      if (view && view.phase === m.view.phase) set({ view: m.view, clock: m.view.clock });
      else if (!queue.length) applySnapshot(m.view, get().match);
      else set({ queue: [...queue, { kind: 'snapshot', view: m.view, match: null }] });
      return;
    }
    // Recorded as soon as it arrives, even if the last ball is still being played out on screen.
    void record(m.view, m.match);
    // The snapshot that follows the last ball waits for that ball. Any other replaces whatever we had.
    const last = [...queue].reverse().find((q) => q.kind === 'event');
    if (last?.kind === 'event' && last.seq === m.view.seq && get().match?.id === m.match?.id)
      set({ queue: [...queue, { kind: 'snapshot', view: m.view, match: m.match }], clock: m.view.clock });
    else {
      set({ queue: [] });
      applySnapshot(m.view, m.match);
    }
    if (get().status !== 'open') set({ status: 'open' });
  }

  function hangUp() {
    stopPings?.();
    stopPings = null;
    const s = socket;
    socket = null;
    s?.close();
  }

  return {
    status: 'idle',
    ...EMPTY,

    join(code) {
      hangUp();
      const base = serverUrl();
      if (!base) {
        set({ ...EMPTY, status: 'idle', fatal: 'Online play is not set up on this site.' });
        return;
      }
      set({ ...EMPTY, status: 'connecting' });
      const ws = new ReconnectingWebSocket(`${base.replace(/^http/, 'ws')}/rooms/${code}/ws`, [], {
        maxEnqueuedMessages: 0,
        minReconnectionDelay: 500,
        maxReconnectionDelay: 5000,
        connectionTimeout: 8000,
      });
      socket = ws;
      let pingedAt = 0;
      ws.addEventListener('open', () => {
        if (socket !== ws) return;
        pingedAt = 0;
        const { token, nickname } = getGuest();
        raw({ t: 'hello', v: PROTOCOL_VERSION, token, nickname });
      });
      ws.addEventListener('close', () => {
        if (socket === ws) set({ status: get().view ? 'lost' : 'connecting' });
      });
      ws.addEventListener('message', (e: MessageEvent) => {
        if (socket !== ws) return;
        if (e.data === 'pong') {
          pingedAt = 0;
          return;
        }
        try {
          receive(JSON.parse(String(e.data)) as ServerMessage);
        } catch (err) {
          console.error(err);
          raw({ t: 'sync' });
        }
      });
      stopPings = every(PING_MS, () => {
        if (socket !== ws || ws.readyState !== WebSocket.OPEN) return;
        const { clock, offset } = get();
        if (clock?.deadline && !clock.paused && Date.now() + offset > clock.deadline + OVERDUE_MS) raw({ t: 'sync' });
        if (pingedAt && Date.now() - pingedAt > PONG_MS) {
          pingedAt = 0;
          ws.reconnect();
        } else if (!pingedAt) {
          pingedAt = Date.now();
          ws.send('ping');
        }
      });
    },

    quit() {
      hangUp();
      set({ status: 'idle', ...EMPTY });
    },

    async leave() {
      raw({ t: 'leave' });
      for (let i = 0; i < 30 && get().status === 'open' && !get().fatal; i++) await new Promise((r) => setTimeout(r, 50));
    },

    send(m) {
      if (get().status === 'open') raw(m);
      else set({ toast: { id: Date.now(), text: 'Not connected right now' } });
    },

    advance() {
      const { queue, match, shownSeq } = get();
      const [item, ...rest] = queue;
      if (!item) return;
      set({ queue: rest });
      if (item.kind === 'snapshot') {
        applySnapshot(item.view, item.match ?? match);
        return;
      }
      // Already included in a snapshot.
      if (item.seq <= shownSeq) return;
      try {
        if (!match || item.seq !== shownSeq + 1) throw new Error('Missed an event');
        const next = applyEvent(match, item.event);
        if (digest(next) !== item.digest) throw new Error('Out of step with the server');
        set({ match: next, shownSeq: item.seq });
      } catch (e) {
        console.warn(e);
        set({ queue: [] });
        raw({ t: 'sync' });
      }
    },
  };
});

/** What this computer's clock would read when the server's reads `t`. */
export const localTime = (t: number): number => t - useOnline.getState().offset;
