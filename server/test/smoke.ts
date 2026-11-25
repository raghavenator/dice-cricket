// Plays real matches against a running server (`npx wrangler dev` in server/), over real connections.
// From the repo root:  npx vite-node server/test/smoke.ts
import { readFileSync, writeFileSync } from 'node:fs';
import { PRESET_TEAMS } from '../../src/data/presets';
import type { MatchState } from '../../src/engine/types';
import { applyEvent, digest } from '../../src/online/events';
import { PROTOCOL_VERSION, type ClientMessage, type LobbyRoom, type RoomResults, type RoomView, type ServerMessage } from '../../src/online/protocol';

const BASE = process.env.SERVER ?? 'http://localhost:8787';
const ORIGIN = process.env.ORIGIN ?? 'http://localhost:5179';
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

async function create(tok: string, nickname = 'Raj', origin: string | null = ORIGIN, open = false) {
  const res = await fetch(`${BASE}/rooms`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(origin ? { Origin: origin } : {}) },
    body: JSON.stringify({ v: PROTOCOL_VERSION, token: tok, nickname, open }),
  });
  return { status: res.status, body: (await res.json()) as { code?: string; error?: string } };
}

async function ask<T>(path: string, tok: string, body: object = {}): Promise<T> {
  const res = await fetch(BASE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
    body: JSON.stringify({ v: PROTOCOL_VERSION, token: tok, ...body }),
  });
  check(res.status === 200, `${path} status ${res.status}`);
  return (await res.json()) as T;
}

const listed = async (code: string, tok: string) =>
  (await ask<{ rooms: LobbyRoom[] }>('/lobby', tok)).rooms.find((r) => r.code === code);
const quick = async (tok: string, nickname: string, current?: string) =>
  (await ask<{ code: string }>('/quick', tok, { nickname, current })).code;

async function eventually(what: string, test: () => Promise<unknown>, ms = 10_000) {
  const end = Date.now() + ms;
  while (!(await test())) {
    if (Date.now() > end) throw new Error(`TIMED OUT: ${what}`);
    await sleep(250);
  }
}

async function missed(code: string, tok: string): Promise<RoomResults> {
  const res = await fetch(`${BASE}/rooms/${code}/results`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
    body: JSON.stringify({ v: PROTOCOL_VERSION, token: tok }),
  });
  check(res.status === 200, `results status ${res.status}`);
  return (await res.json()) as RoomResults;
}

/** Times a turn was overdue and the server had to be reminded, as browsers do. Should stay at 0. */
let nudges = 0;

class Player {
  ws!: WebSocket;
  view: RoomView | null = null;
  match: MatchState | null = null;
  seq = 0;
  events = 0;
  offset = 0;
  errors: string[] = [];
  fatal: string | null = null;
  open = false;

  constructor(readonly code: string, readonly tok: string, readonly nickname: string) {
    this.dial();
    setInterval(() => {
      if (this.ws.readyState !== 1) return;
      this.ws.send('ping');
      const c = this.open ? this.view?.clock : null;
      if (c?.deadline && !c.paused && Date.now() + this.offset > c.deadline + 2500) {
        nudges++;
        this.send({ t: 'sync' });
      }
    }, 5000);
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
      this.offset = m.clock.now - Date.now();
    } else {
      this.view = m.view;
      this.offset = m.view.clock.now - Date.now();
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

/** Both use auto-roll (the default); bowlers and batters are chosen as soon as they are asked for. */
async function playOn(players: Player[], stop: () => boolean) {
  for (const p of players) p.send({ t: 'setAuto', what: 'roll', on: true });
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
    // Every event, in order, and the same for both. A one-over match can be as short as 8 (two bowlers, six balls).
    check(host.events >= 8 && host.events === host.seq && guest.events === guest.seq && host.seq === guest.seq, `both saw every event: ${host.events}/${host.seq} and ${guest.events}/${guest.seq}`);
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

  async 'keeps results for a player who was away, through rematches and closing'() {
    const { host, guest, code } = await toPlay(1);
    check((await missed(code, guest.tok)).live, 'live during the match');
    check((await missed(code, guest.tok)).results.length === 0, 'nothing yet');
    await playOn([host, guest], () => host.view!.phase === 'finished' && guest.view!.phase === 'finished');
    const first = host.match!;
    const got = await missed(code, guest.tok);
    check(!got.live && got.results.length === 1, 'one result');
    check(JSON.stringify(got.results[0].match) === JSON.stringify(first), 'the same match');
    check(got.results[0].completedAt === host.view!.finishedAt, 'the same time');
    check(got.results[0].host.nickname === 'Raj' && got.results[0].guest.nickname === 'Sam', 'names');
    const eve = await missed(code, token('eve'));
    check(!eve.live && eve.results.length === 0, 'strangers get nothing');
    // A rematch that ends with the guest gone, after which the host leaves and the room closes.
    host.send({ t: 'rematch' });
    guest.send({ t: 'rematch' });
    await until('rematch', () => host.view!.phase === 'setup' && guest.view!.phase === 'setup');
    host.send({ t: 'ready' });
    guest.send({ t: 'ready' });
    await until('toss', () => host.view!.phase === 'toss');
    guest.send({ t: 'callToss', call: 'heads' });
    await until('called', () => host.view!.toss?.winner);
    (host.view!.toss!.winner === 'host' ? host : guest).send({ t: 'chooseInnings', choice: 'bat' });
    await until('started', () => host.match && host.view!.phase === 'playing');
    host.send({ t: 'leave' });
    await until('forfeit', () => guest.view!.phase === 'finished');
    const two = await missed(code, host.tok);
    check(two.results.length === 2 && two.results.some((r) => r.end.kind === 'forfeit' && r.end.loser === 'host'), 'both results');
    const none = await missed('ZZZZZZ', host.tok);
    check(!none.live && none.results.length === 0, 'unknown room');
  },

  async 'lists open rooms, and only while they wait'() {
    const [h, g, e] = [token('host'), token('guest'), token('eve')];
    const { body } = await create(h, 'Open Raj', ORIGIN, true);
    const code = body.code!;
    check(!(await listed(code, g)), 'not listed before its maker connects');
    const host = new Player(code, h, 'Open Raj');
    await eventually('listed', () => listed(code, g));
    const entry = (await listed(code, g))!;
    check(entry.nickname === 'Open Raj' && entry.overs === 5 && Object.keys(entry).length === 4, 'only what is needed');
    check(!(await listed(code, h)), 'not shown to its own maker');
    host.send({ t: 'setSettings', overs: 2 });
    await eventually('overs updated', async () => (await listed(code, g))?.overs === 2);
    host.send({ t: 'setOpen', on: false });
    await eventually('private now', async () => !(await listed(code, g)));
    host.send({ t: 'setOpen', on: true });
    await eventually('open again', () => listed(code, g));
    host.ws.close();
    await eventually('off the list when its maker goes', async () => !(await listed(code, g)));
    host.dial();
    await eventually('and back', () => listed(code, g));
    const guest = new Player(code, g, 'Sam');
    await until('joined', () => guest.view?.phase === 'setup');
    await eventually('off the list once full', async () => !(await listed(code, e)));
    guest.send({ t: 'setTeam', team: { ...PRESET_TEAMS[0], id: 't-mine', name: 'Mine' } });
    await until('custom refused', () => guest.errors.some((x) => /sample teams/.test(x)));
    host.send({ t: 'removeGuest' });
    await eventually('listed again after removing', () => listed(code, e));
    host.send({ t: 'leave' });
    await eventually('gone', async () => !(await listed(code, e)));
    const secret = await create(token('private'), 'Quiet');
    const p = new Player(secret.body.code!, token('x'), 'X');
    await sleep(800);
    check(!(await listed(secret.body.code!, e)), 'private rooms are never listed');
    p.ws.close();
  },

  async 'pairs strangers, even when they all ask at once'() {
    const toks = Array.from({ length: 5 }, (_, i) => token(`quick${i}`));
    const codes = await Promise.all(toks.map((t, i) => quick(t, `Q${i}`)));
    const players = codes.map((c, i) => new Player(c, toks[i], `Q${i}`));
    // As browsers do, anyone left waiting keeps asking.
    await eventually('two pairs and one waiting', async () => {
      for (const p of players) {
        if (p.view?.phase !== 'waiting') continue;
        const c = await quick(p.tok, p.nickname, p.code);
        if (c !== p.code) {
          p.send({ t: 'leave' });
          (p as { code: string }).code = c;
          p.view = null;
          p.dial();
        }
      }
      await sleep(300);
      const refused = players.find((p) => p.fatal);
      check(!refused, `sent to a room that refused: ${refused?.fatal}`);
      return players.filter((p) => p.view?.phase === 'setup').length === 4 && players.every((p) => p.view);
    }, 30_000);
    const rooms = new Map<string, number>();
    for (const p of players) rooms.set(p.code, (rooms.get(p.code) ?? 0) + 1);
    check([...rooms.values()].sort().join() === '1,2,2', `rooms ${[...rooms.values()].join()}`);
    const [a] = players.filter((p) => p.view!.phase === 'setup');
    check(a.view!.overs === 5 && a.view!.access === 'quick' && a.view!.clock.deadline !== null, 'five overs with a clock');
    const b = players.find((p) => p !== a && p.code === a.code)!;
    a.send({ t: 'leave' });
    await until('told their opponent left', () => b.fatal === 'This room has closed');
    for (const p of players) if (p.open && !p.fatal) p.send({ t: 'leave' });
  },

  async 'starts a quick match by itself when nobody presses anything'() {
    const [x, y] = [token('x'), token('y')];
    // Earlier tests may have left someone waiting, so ask until these two are together.
    const px = new Player(await quick(x, 'Xan'), x, 'Xan');
    await until('in a room', () => px.view || px.fatal);
    check(px.view, `sent to a room that refused: ${px.fatal}`);
    const py = new Player(await quick(y, 'Yas'), y, 'Yas');
    await until('paired', () => px.view!.phase === 'setup' && py.view?.phase === 'setup' && px.code === py.code, 20_000);
    await until('toss after a minute', () => px.view!.phase === 'toss', 70_000);
    try {
      await until('match under way', () => px.seq > 5 && py.seq > 5, 70_000);
    } catch (e) {
      const at = (p: Player) => JSON.stringify([p.code, p.seq, p.ws.readyState, p.fatal, p.errors, p.view?.phase, p.view?.clock]);
      throw new Error(`${(e as Error).message} ${at(px)} ${at(py)}`);
    }
    check(JSON.stringify(px.match) === JSON.stringify(py.match) || px.seq !== py.seq, 'in step');
    px.send({ t: 'leave' });
    await until('forfeit', () => py.view!.phase === 'finished');
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
    const finished = host.view!.phase === 'finished';
    await playOn([host, guest], () => host.view!.phase === 'finished' && guest.view!.phase === 'finished');
    check(JSON.stringify(host.match) === JSON.stringify(guest.match), 'identical scorecards');
    check(finished || (await missed(host.code, host.tok)).results.length === 1, 'result kept');
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
if (nudges) console.log(`NOTE  the server had to be reminded of an overdue turn ${nudges} time(s)`);
process.exit(failed ? 1 : 0);
