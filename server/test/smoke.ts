// Plays real matches against a running server (`npx wrangler dev` in server/), over real connections.
// From the repo root:  npx vite-node server/test/smoke.ts
import { readFileSync, writeFileSync } from 'node:fs';
import { PRESET_TEAMS } from '../../src/data/presets';
import type { MatchState } from '../../src/engine/types';
import { applyEvent, digest } from '../../src/online/events';
import { PROTOCOL_VERSION, type ClientMessage, type RoomView, type ServerMessage } from '../../src/online/protocol';

const BASE = process.env.SERVER ?? 'http://localhost:8787';
const ORIGIN = 'http://localhost:5179';
const token = (name: string) => `${name}-${crypto.randomUUID()}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function check(ok: unknown, what: string): asserts ok {
  if (!ok) throw new Error(`FAILED: ${what}`);
}

async function until(what: string, test: () => unknown, ms = 15_000) {
  const end = Date.now() + ms;
  while (!test()) {
    if (Date.now() > end) throw new Error(`TIMED OUT: ${what}`);
    await sleep(10);
  }
}

async function create(tok: string, nickname = 'Raj', origin: string | null = ORIGIN) {
  const res = await fetch(`${BASE}/rooms`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(origin ? { Origin: origin } : {}) },
    body: JSON.stringify({ v: PROTOCOL_VERSION, token: tok, nickname }),
  });
  return { status: res.status, body: (await res.json()) as { code?: string; error?: string } };
}

class Player {
  ws!: WebSocket;
  view: RoomView | null = null;
  match: MatchState | null = null;
  seq = 0;
  events = 0;
  errors: string[] = [];
  fatal: string | null = null;
  open = false;

  constructor(readonly code: string, readonly tok: string, readonly nickname: string) {
    this.dial();
    setInterval(() => this.ws.readyState === 1 && this.ws.send('ping'), 10_000);
  }
  dial() {
    this.open = false;
    this.fatal = null;
    const url = `${BASE.replace('http', 'ws')}/rooms/${this.code}/ws`;
    const ws = new (WebSocket as any)(url, { headers: { Origin: ORIGIN } }) as WebSocket;
    this.ws = ws;
    ws.onopen = () => this.send({ t: 'hello', v: PROTOCOL_VERSION, token: this.tok, nickname: this.nickname });
    ws.onclose = () => {
      if (this.ws === ws) this.open = false;
    };
    ws.onerror = () => {};
    ws.onmessage = (e) => {
      if (e.data !== 'pong') this.receive(JSON.parse(String(e.data)) as ServerMessage);
    };
  }
  receive(m: ServerMessage) {
    if (m.t === 'error') {
      if (m.fatal) this.fatal = m.message;
      else this.errors.push(m.message);
    } else if (m.t === 'event') {
      check(m.seq === this.seq + 1, `${this.nickname} got event ${m.seq} after ${this.seq}`);
      this.match = applyEvent(this.match!, m.event);
      check(digest(this.match) === m.digest, `${this.nickname} agrees with the server at event ${m.seq}`);
      this.seq = m.seq;
      this.events++;
      this.view!.clock = m.clock;
    } else {
      this.view = m.view;
      if (m.t === 'snapshot') {
        this.match = m.match;
        this.seq = m.view.seq;
        this.open = true;
      }
    }
  }
  send(m: ClientMessage) {
    this.ws.send(JSON.stringify(m));
  }
  async ready(team = PRESET_TEAMS[0]) {
    this.send({ t: 'setTeam', team });
    this.send({ t: 'ready' });
  }
}

async function toPlay(overs: number) {
  const tokens = [token('host'), token('guest')];
  const { body } = await create(tokens[0]);
  check(body.code, 'room created');
  const host = new Player(body.code, tokens[0], 'Raj');
  await until('host seated', () => host.view);
  check(host.view!.phase === 'waiting', 'host waits');
  const guest = new Player(body.code.toLowerCase(), tokens[1], 'Sam');
  await until('both seated', () => host.view!.phase === 'setup' && guest.view);
  host.send({ t: 'setSettings', overs });
  await until('overs shared', () => guest.view!.overs === overs);
  await host.ready();
  await guest.ready();
  await until('toss', () => host.view!.phase === 'toss' && guest.view!.phase === 'toss');
  guest.send({ t: 'callToss', call: 'heads' });
  await until('toss called', () => host.view!.toss?.winner && guest.view!.toss?.winner);
  const winner = host.view!.toss!.winner === 'host' ? host : guest;
  winner.send({ t: 'chooseInnings', choice: 'bat' });
  await until('started', () => host.match && guest.match);
  return { host, guest, code: body.code };
}

/** Both use auto-roll; bowlers and batters are chosen as soon as they are asked for. */
async function playOn(players: Player[], stop: () => boolean) {
  for (const p of players) p.send({ t: 'setAuto', on: true });
  const asked = new Map<Player, number>();
  const end = Date.now() + 240_000;
  while (!stop()) {
    check(Date.now() < end, 'match finished in time');
    for (const p of players) {
      const turn = p.view!.clock.turn;
      if (!p.open || turn?.seat !== p.view!.you || asked.get(p) === p.seq) continue;
      const m = p.match!;
      const inn = m.innings[m.innings.length - 1];
      if (turn.kind === 'bowler') {
        const t = m.teams.find((x) => x.id === inn.bowlingTeamId)!;
        const bowler = t.players.find((x) => x.bowler && x.id !== inn.prevOverBowlerId && !inn.balls.some((b) => b.bowlerId === x.id));
        asked.set(p, p.seq);
        p.send({ t: 'chooseBowler', playerId: bowler!.id });
      } else if (turn.kind === 'batter') {
        const t = m.teams.find((x) => x.id === inn.battingTeamId)!;
        asked.set(p, p.seq);
        p.send({ t: 'chooseBatter', playerId: t.players[10].id });
      }
    }
    await sleep(20);
  }
}

const tests: Record<string, () => Promise<void>> = {
  async 'refuses other sites, bad requests and unknown rooms'() {
    check((await create(token('x'), 'Raj', null)).status === 403, 'no origin');
    check((await create(token('x'), 'Raj', 'https://evil.example')).status === 403, 'other origin');
    check((await create('short')).status === 400, 'bad token');
    check((await create(token('x'), '   ')).status === 400, 'empty nickname');
    const lost = new Player('ZZZZZZ', token('x'), 'Eve');
    await until('unknown room', () => lost.fatal === 'Room not found');
    await sleep(100);
    const again = new Player('ZZZZZZ', token('x'), 'Eve');
    await until('still unknown', () => again.fatal === 'Room not found');
  },

  async 'plays a whole match, with the same team on both sides'() {
    const { host, guest } = await toPlay(1);
    check(host.match!.teams[0].name === 'Harbour Hawks (Raj)', 'teams told apart');
    await playOn([host, guest], () => host.view!.phase === 'finished' && guest.view!.phase === 'finished');
    check(host.events > 12 && host.events === guest.events, 'both saw every event');
    check(JSON.stringify(host.match) === JSON.stringify(guest.match), 'identical scorecards');
    check(host.match!.result, 'has a result');
    host.send({ t: 'rematch' });
    guest.send({ t: 'rematch' });
    await until('rematch', () => host.view!.phase === 'setup' && guest.view!.phase === 'setup');
    host.send({ t: 'leave' });
    await until('closed for both', () => host.fatal && guest.fatal);
  },

  async 'keeps strangers out and ignores cheating'() {
    const { host, guest, code } = await toPlay(1);
    const eve = new Player(code, token('eve'), 'Eve');
    await until('full', () => eve.fatal === 'This room is full');
    // A public id is not a token.
    const thief = new Player(code, host.view!.host.ownerId.padEnd(32, 'A'), 'Raj');
    await until('thief refused', () => thief.fatal);
    const bat = host.view!.clock.turn!.seat === 'host' ? guest : host;
    bat.send({ t: 'roll' });
    bat.ws.send('{"t":"ball","rolls":{"roll1":6}}');
    bat.ws.send('nonsense');
    await until('told off', () => bat.errors.length === 3);
    check(host.seq === 0, 'nothing happened');
    for (let i = 0; i < 60; i++) bat.ws.send('{"t":"roll"}');
    await until('flood cut off', () => bat.fatal === 'Too many messages');
    host.send({ t: 'leave' });
  },

  async 'comes back to the same seat, and pauses meanwhile'() {
    const { host, guest } = await toPlay(2);
    let cut = false;
    await playOn([host, guest], () => (cut = host.seq >= 5));
    check(cut, 'reached event 5');
    guest.ws.close();
    await until('pause seen', () => host.view!.clock.paused && !host.view![guest.view!.you]!.connected);
    const { seq } = host;
    await sleep(2500);
    check(host.seq === seq, 'paused');
    guest.dial();
    await until('back', () => guest.open && !host.view!.clock.paused);
    check(JSON.stringify(host.match) === JSON.stringify(guest.match), 'caught up');
    await playOn([host, guest], () => host.view!.phase === 'finished' && guest.view!.phase === 'finished');
    check(JSON.stringify(host.match) === JSON.stringify(guest.match), 'identical scorecards');
  },

  async 'counts leaving as a forfeit'() {
    const { host, guest } = await toPlay(1);
    guest.send({ t: 'leave' });
    await until('forfeit', () => host.view!.phase === 'finished');
    check(host.view!.end!.kind === 'forfeit' && /won by forfeit/.test(host.match!.result!.text), 'host wins');
    guest.dial();
    await until('can still see the result', () => guest.match?.result);
  },

  async 'survives the server restarting mid-match'() {
    const { host, guest } = await toPlay(2);
    await playOn([host, guest], () => host.seq >= 6);
    // Rewriting the file makes `wrangler dev` reload, which drops every connection and restarts the room.
    const file = 'server/src/index.ts';
    const src = readFileSync(file, 'utf8');
    writeFileSync(file, `${src}\n// reload`);
    try {
      await until('connections dropped', () => !host.open && !guest.open, 30_000);
    } finally {
      writeFileSync(file, src);
    }
    await sleep(6000);
    const before = host.seq;
    for (const p of [host, guest]) {
      p.dial();
      await until('reconnected', () => p.open);
    }
    check(host.seq >= before && host.match!.innings[0].balls.length > 0, 'kept the match');
    await playOn([host, guest], () => host.view!.phase === 'finished' && guest.view!.phase === 'finished');
    check(JSON.stringify(host.match) === JSON.stringify(guest.match), 'identical scorecards');
  },
};

let failed = 0;
for (const [name, run] of Object.entries(tests)) {
  if (process.env.ONLY && !name.includes(process.env.ONLY)) continue;
  const t = Date.now();
  try {
    await run();
    console.log(`ok    ${name} (${((Date.now() - t) / 1000).toFixed(1)}s)`);
  } catch (e) {
    failed++;
    console.log(`FAIL  ${name}: ${(e as Error).message}`);
  }
}
process.exit(failed ? 1 : 0);
