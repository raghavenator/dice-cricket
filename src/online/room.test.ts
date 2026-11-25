import { PRESET_TEAMS } from '../data/presets';
import { bowlerOptions, currentInnings, getTeam } from '../engine/match';
import { battingCard } from '../engine/stats';
import type { MatchState, Rng, Team } from '../engine/types';
import { applyEvent, digest } from './events';
import { autoPlan, defaultLineup } from './lineup';
import { MAX_MESSAGE_BYTES, PROTOCOL_VERSION, normalizeCode, parseClientMessage, type RoomAction, type SeatId } from './protocol';
import {
  BALL_GAP_MS, CHECK_GAP_MS, CLAIM_MS, IDLE_MS, INNINGS_GAP_MS, KEEP_FINISHED_MS, PICK_MS, RESUME_MS, ROLL_MS, TOSS_MS,
  act, connect, createRoom, currentTurn, deletesAt, disconnect, finishedMatch, nextWake, tick, viewFor,
  type RoomState, type Step,
} from './room';
import { nextBatterOptions } from './rules';
import { OnlineError } from './validate';

const [hawks, rhinos] = PRESET_TEAMS;
const IDS: Record<SeatId, string> = { host: 'HHH', guest: 'GGG' };

function seeded(seed: number): Rng {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** An rng that gives these dice faces in order, then 1s. */
const dice = (...faces: number[]): Rng => {
  let i = 0;
  return () => ((faces[i++] ?? 1) - 0.5) / 6;
};

/** A room plus a browser that only knows what it has been sent. */
class Sim {
  now = 1_000_000;
  state: RoomState;
  rng: Rng;
  client: MatchState | null = null;
  clientSeq = 0;
  sent: Step[] = [];

  constructor(seed = 1) {
    this.rng = seeded(seed);
    this.state = createRoom('K7M4QP', { ownerId: IDS.host, nickname: 'Raj' }, this.now);
  }

  private take(step: Step): Step {
    // A Durable Object stores and reloads the state, so it must survive JSON.
    expect(JSON.parse(JSON.stringify(step.state))).toEqual(step.state);
    this.state = step.state;
    for (const e of step.events) {
      expect(e.seq).toBe(this.clientSeq + 1);
      this.client = applyEvent(this.client!, e.event);
      this.clientSeq = e.seq;
      expect(digest(this.client)).toBe(e.digest);
    }
    if (step.send === 'snapshot') {
      if (step.events.length) expect(this.client).toEqual(this.state.match);
      this.client = this.state.match;
      this.clientSeq = this.state.seq;
    }
    this.sent.push(step);
    return step;
  }

  connect(seat: SeatId, nickname = seat === 'host' ? 'Raj' : 'Sam') {
    return this.take(connect(this.state, { ownerId: IDS[seat], nickname }, this.now));
  }
  disconnect(seat: SeatId) {
    return this.take(disconnect(this.state, IDS[seat], this.now));
  }
  act(seat: SeatId, a: RoomAction) {
    return this.take(act(this.state, IDS[seat], a, { now: this.now, rng: this.rng }));
  }
  fails(seat: SeatId, a: RoomAction, message?: RegExp) {
    const before = structuredClone(this.state);
    const run = () => act(this.state, IDS[seat], a, { now: this.now, rng: this.rng });
    expect(run).toThrow(OnlineError);
    if (message) expect(run).toThrow(message);
    expect(this.state).toEqual(before);
  }
  tick() {
    return this.take(tick(this.state, { now: this.now, rng: this.rng }));
  }
  wait(ms: number) {
    this.now += ms;
    return this.tick();
  }

  /** Everything starts on auto, but most tests make their own moves. */
  toSetup(host: Team = hawks, guest: Team = rhinos) {
    this.connect('host');
    this.connect('guest');
    for (const seat of ['host', 'guest'] as const)
      for (const what of ['roll', 'batter', 'bowler'] as const) this.act(seat, { t: 'setAuto', what, on: false });
    this.act('host', { t: 'setTeam', team: host });
    this.act('guest', { t: 'setTeam', team: guest });
    return this;
  }
  toToss(overs = 5, host: Team = hawks, guest: Team = rhinos) {
    this.toSetup(host, guest);
    this.act('host', { t: 'setSettings', overs });
    this.act('host', { t: 'ready' });
    this.act('guest', { t: 'ready' });
    expect(this.state.phase).toBe('toss');
    return this;
  }
  /** To the first over, with the host batting. */
  toPlay(overs = 5, host: Team = hawks, guest: Team = rhinos) {
    this.toToss(overs, host, guest);
    this.act('guest', { t: 'callToss', call: 'heads' });
    const winner = this.state.toss!.winner!;
    this.act(winner, { t: 'chooseInnings', choice: winner === 'host' ? 'bat' : 'bowl' });
    expect(this.state.phase).toBe('playing');
    return this;
  }
  bowlerPick() {
    const turn = currentTurn(this.state)!;
    expect(turn.kind).toBe('bowler');
    const o = bowlerOptions(this.state.match!).filter((x) => x.eligible);
    return this.act(turn.seat, { t: 'chooseBowler', playerId: o[Math.floor(this.rng() * o.length)].player.id });
  }
  /** Roll these dice, after any animation and choosing a bowler if needed. */
  roll(...faces: number[]) {
    if (currentTurn(this.state)?.kind === 'bowler') this.bowlerPick();
    this.now = Math.max(this.now, this.state.nextBallAt);
    const rng = this.rng;
    this.rng = dice(...faces);
    const step = this.act(currentTurn(this.state)!.seat, { t: 'roll' });
    this.rng = rng;
    return step;
  }
  /** Both captains play sensibly to the end. */
  playOut() {
    let guard = 0;
    while (this.state.phase === 'playing' && guard++ < 2000) {
      const turn = currentTurn(this.state)!;
      const opts = nextBatterOptions(this.state.match!);
      if (turn.kind === 'bowler') this.bowlerPick();
      else if (turn.kind === 'batter')
        this.act(turn.seat, { t: 'chooseBatter', playerId: opts[Math.floor(this.rng() * opts.length)].id });
      else {
        this.now = Math.max(this.now, this.state.nextBallAt);
        this.act(turn.seat, { t: 'roll' });
      }
    }
    expect(this.state.phase).toBe('finished');
    return this;
  }
  idle(seat: SeatId) {
    return viewFor(this.state, seat, this.now);
  }
}

describe('messages', () => {
  it('reads room codes as people type them', () => {
    expect(normalizeCode(' k7m-4qp ')).toBe('K7M4QP');
    for (const bad of ['', 'K7M4Q', 'K7M4QPX', 'K7M4Q0', 'K7M4QI', '<b>a</b>']) expect(normalizeCode(bad)).toBeNull();
  });

  it('accepts good messages and drops unknown keys', () => {
    const token = 'a'.repeat(32);
    expect(parseClientMessage(JSON.stringify({ t: 'hello', v: PROTOCOL_VERSION, token, nickname: ' Raj ', x: 1 }))).toEqual({
      t: 'hello', v: PROTOCOL_VERSION, token, nickname: 'Raj',
    });
    expect(parseClientMessage('{"t":"roll","rolls":{"roll1":6}}')).toEqual({ t: 'roll' });
    expect(parseClientMessage('{"t":"chooseBowler","playerId":"HHH/p-1"}')).toEqual({ t: 'chooseBowler', playerId: 'HHH/p-1' });
    expect(parseClientMessage(JSON.stringify({ t: 'setTeam', team: hawks }))).toEqual({ t: 'setTeam', team: hawks });
    expect(parseClientMessage(JSON.stringify({ t: 'setLineup', lineup: defaultLineup(hawks) }))).toEqual({
      t: 'setLineup', lineup: defaultLineup(hawks),
    });
  });

  it('asks an outdated tab to refresh', () => {
    const hello = JSON.stringify({ t: 'hello', v: 0, token: 'a'.repeat(32), nickname: 'Raj' });
    expect(() => parseClientMessage(hello)).toThrow(/refresh/);
  });

  it('rejects everything else', () => {
    const bad = [
      '', 'null', '[]', '{', '"roll"', '{}', '{"t":"win"}', '{"t":"__proto__"}', '{"t":"setSettings","overs":500}',
      '{"t":"callToss","call":"edge"}', '{"t":"chooseInnings"}', '{"t":"setAuto","what":"roll","on":1}', '{"t":"setAuto","what":"win","on":true}', '{"t":"setAuto","on":true}', '{"t":"chooseBowler","playerId":"a"}',
      '{"t":"chooseBowler","playerId":"a/b/c"}', '{"t":"chooseBatter","playerId":{}}',
      JSON.stringify({ t: 'hello', v: PROTOCOL_VERSION, token: 'short', nickname: 'Raj' }),
      JSON.stringify({ t: 'roll', pad: 'x'.repeat(MAX_MESSAGE_BYTES) }),
      JSON.stringify({ t: 'roll', pad: 'é'.repeat(MAX_MESSAGE_BYTES / 2) }),
    ];
    for (const raw of bad) expect(() => parseClientMessage(raw), raw.slice(0, 40)).toThrow(OnlineError);
  });

  it('fits the biggest team a player can send', () => {
    const wide = '\u{1F3CF}'.repeat(20);
    const id = (n: number) => `${n}`.padEnd(64, 'x');
    const team: Team = { id: id(99), name: wide, short: 'ABCD', color: '#ffffff',
      players: hawks.players.map((p, i) => ({ ...p, id: id(i), name: wide })) };
    expect(parseClientMessage(JSON.stringify({ t: 'setTeam', team })).t).toBe('setTeam');
    const l = { ...defaultLineup(team), bowlers: team.players.map((p) => p.id) };
    const lineup = { ...l, bowlingPlan: autoPlan(l.bowlers, 20)! };
    expect(parseClientMessage(JSON.stringify({ t: 'setLineup', lineup })).t).toBe('setLineup');
  });
});

describe('joining', () => {
  it('seats two players and turns a third away', () => {
    const s = new Sim();
    s.connect('host');
    expect(s.state.phase).toBe('waiting');
    s.connect('guest');
    expect(s.state.phase).toBe('setup');
    expect(() => connect(s.state, { ownerId: 'XXX', nickname: 'Eve' }, s.now)).toThrow(/full/);
    expect(() => act(s.state, 'XXX', { t: 'ready' }, { now: s.now, rng: s.rng })).toThrow(/not in this room/);
  });

  it('gives the host their own seat when they open their own link', () => {
    const s = new Sim();
    s.connect('host');
    s.connect('host');
    expect(s.state.guest).toBeNull();
    expect(s.state.phase).toBe('waiting');
  });

  it('lets players return to their seat in every phase', () => {
    const at: [string, (s: Sim) => void][] = [
      ['setup', (s) => s.toSetup()],
      ['toss', (s) => s.toToss()],
      ['playing', (s) => s.toPlay()],
      ['finished', (s) => s.toPlay(1).playOut()],
    ];
    for (const [phase, go] of at) {
      for (const seat of ['host', 'guest'] as const) {
        const s = new Sim();
        go(s);
        s.disconnect(seat);
        expect(s.state[seat]!.connected).toBe(false);
        s.connect(seat);
        expect(s.state.phase).toBe(phase);
        expect(s.state[seat]!.connected).toBe(true);
        expect(s.idle(seat).you).toBe(seat);
        expect(s.idle(seat).team).not.toBeNull();
      }
    }
  });

  it('can remove a guest before the toss, who then cannot come back', () => {
    const s = new Sim().toSetup();
    s.fails('guest', { t: 'removeGuest' });
    s.act('host', { t: 'removeGuest' });
    expect(s.state.phase).toBe('waiting');
    expect(() => s.connect('guest')).toThrow(/removed/);
    expect(connect(s.state, { ownerId: 'NEW', nickname: 'Kim' }, s.now).state.guest!.nickname).toBe('Kim');
    new Sim().toToss().fails('host', { t: 'removeGuest' });
    new Sim().toPlay().fails('host', { t: 'removeGuest' });
  });

  it('handles leaving before the match', () => {
    const g = new Sim().toToss();
    g.act('guest', { t: 'leave' });
    expect(g.state).toMatchObject({ phase: 'waiting', guest: null, toss: null, deadline: null });
    g.connect('guest');
    expect(g.state.phase).toBe('setup');
    const h = new Sim().toSetup();
    h.act('host', { t: 'leave' });
    expect(h.state.phase).toBe('closed');
    expect(() => h.connect('guest')).toThrow(/not found/);
    expect(deletesAt(h.state)).toBe(h.now);
  });

  it('closes a room nobody joins, and one everybody has left', () => {
    const s = new Sim();
    s.connect('host');
    expect(nextWake(s.state)).toBe(s.now + IDLE_MS);
    s.wait(IDLE_MS - 1);
    expect(s.state.phase).toBe('waiting');
    s.wait(1);
    expect(s.state.phase).toBe('closed');

    for (const go of [(x: Sim) => x.toSetup(), (x: Sim) => x.toToss(), (x: Sim) => x.toPlay()]) {
      const e = new Sim();
      go(e);
      e.disconnect('host');
      e.now += 1000;
      e.disconnect('guest');
      e.wait(IDLE_MS - 1);
      expect(e.state.phase).not.toBe('closed');
      e.wait(1);
      expect(e.state.phase).toBe('closed');
      // Nobody won, so there is nothing to record.
      expect(finishedMatch(e.state)).toBeNull();
    }
  });
});

describe('setup', () => {
  it('needs a team and a legal lineup before getting ready', () => {
    const s = new Sim();
    s.connect('host');
    s.act('host', { t: 'setTeam', team: hawks });
    s.fails('host', { t: 'ready' }, /opponent/);
    s.connect('guest');
    s.fails('guest', { t: 'ready' }, /team/);
    s.fails('guest', { t: 'setLineup', lineup: defaultLineup(rhinos) }, /team/);
    s.fails('host', { t: 'setLineup', lineup: defaultLineup(rhinos) });
    const none = { ...rhinos, players: rhinos.players.map((p) => ({ ...p, bowler: false })) };
    s.act('guest', { t: 'setTeam', team: none });
    s.fails('guest', { t: 'ready' }, /at least 5 bowlers/);
  });

  it('lets only the host change the overs, which clears plans and readiness', () => {
    const s = new Sim().toSetup();
    const l = defaultLineup(rhinos);
    s.act('guest', { t: 'setLineup', lineup: { ...l, bowlingPlan: autoPlan(l.bowlers, 5)! } });
    s.act('guest', { t: 'ready' });
    s.fails('guest', { t: 'setSettings', overs: 10 }, /host/);
    s.act('host', { t: 'setSettings', overs: 5 });
    expect(s.state.guest!.ready).toBe(true);
    s.act('host', { t: 'setSettings', overs: 10 });
    expect(s.state.guest).toMatchObject({ ready: false, lineup: l });
    expect(s.state.guest!.lineup!.bowlingPlan).toBeUndefined();
  });

  it('un-readies a player who edits or drops out', () => {
    const s = new Sim().toSetup();
    const ready = () => s.act('host', { t: 'ready' });
    ready();
    s.act('host', { t: 'unready' });
    expect(s.state.host.ready).toBe(false);
    ready();
    s.act('host', { t: 'setLineup', lineup: defaultLineup(hawks) });
    expect(s.state.host.ready).toBe(false);
    ready();
    s.act('host', { t: 'setTeam', team: rhinos });
    expect(s.state.host.ready).toBe(false);
    ready();
    s.disconnect('host');
    expect(s.state.host.ready).toBe(false);
    s.act('guest', { t: 'ready' });
    expect(s.state.phase).toBe('setup');
  });

  it('locks everything once both are ready', () => {
    const s = new Sim().toToss();
    s.fails('host', { t: 'setSettings', overs: 2 });
    s.fails('host', { t: 'setTeam', team: rhinos });
    s.fails('guest', { t: 'setLineup', lineup: defaultLineup(rhinos) });
    s.fails('guest', { t: 'unready' });
  });

  it('never shows the opponent a team sheet or a bowling plan', () => {
    const s = new Sim().toSetup();
    const l = defaultLineup(rhinos);
    const plan = autoPlan(l.bowlers, 5)!;
    s.act('guest', { t: 'setLineup', lineup: { ...l, bowlingPlan: plan } });
    const seen = () => JSON.stringify(s.idle('host'));
    const hidden = () => {
      for (const p of rhinos.players) expect(seen()).not.toContain(p.name);
      for (const id of plan) expect(seen()).not.toContain(id);
    };
    hidden();
    expect(s.idle('host').guest!.team).toEqual({ name: rhinos.name, short: rhinos.short, color: rhinos.color });
    expect(s.idle('guest').lineup!.bowlingPlan).toEqual(plan);
    s.act('host', { t: 'ready' });
    s.act('guest', { t: 'ready' });
    hidden();
    s.act('guest', { t: 'callToss', call: 'tails' });
    s.act(s.state.toss!.winner!, { t: 'chooseInnings', choice: 'bat' });
    hidden();
    expect(JSON.stringify(s.state.match)).not.toContain('bowlingPlan');
  });
});

describe('toss', () => {
  it('is called by the guest and decided by the winner', () => {
    const s = new Sim().toToss();
    s.fails('host', { t: 'callToss', call: 'heads' });
    s.fails('guest', { t: 'chooseInnings', choice: 'bat' });
    s.rng = () => 0.1; // heads
    s.act('guest', { t: 'callToss', call: 'tails' });
    expect(s.state.toss).toEqual({ call: 'tails', face: 'heads', winner: 'host' });
    s.fails('guest', { t: 'chooseInnings', choice: 'bat' });
    s.act('host', { t: 'chooseInnings', choice: 'bowl' });
    expect(s.state.match!.order).toEqual(['GGG/p-rhinos', 'HHH/p-hawks']);
    expect(s.state.match!.tossText).toBe('Harbour Hawks won the toss and chose to bowl');
  });

  it('uses the lineups', () => {
    const s = new Sim().toSetup();
    const battingOrder = hawks.players.map((p) => p.id).reverse();
    s.act('host', { t: 'setLineup', lineup: { ...defaultLineup(hawks), battingOrder } });
    s.act('host', { t: 'ready' });
    s.act('guest', { t: 'ready' });
    s.wait(TOSS_MS);
    s.wait(TOSS_MS);
    expect(getTeam(s.state.match!, 'HHH/p-hawks').players.map((p) => p.id)).toEqual(battingOrder.map((x) => `HHH/${x}`));
  });

  it('is settled at random when nobody acts', () => {
    const s = new Sim().toToss();
    s.wait(TOSS_MS - 1);
    expect(s.state.toss).toEqual({});
    s.wait(1);
    expect(s.state.toss!.winner).toBeDefined();
    s.wait(TOSS_MS);
    expect(s.state.phase).toBe('playing');
  });

  it('is fair', () => {
    let guestWins = 0;
    for (let seed = 1; seed <= 1000; seed++) {
      const s = new Sim(seed).toToss();
      s.act('guest', { t: 'callToss', call: 'heads' });
      if (s.state.toss!.winner === 'guest') guestWins++;
    }
    expect(guestWins).toBeGreaterThan(430);
    expect(guestWins).toBeLessThan(570);
  });
});

describe('playing', () => {
  it('only accepts the right move from the right captain', () => {
    const s = new Sim().toPlay();
    expect(currentTurn(s.state)).toEqual({ seat: 'guest', kind: 'bowler' });
    s.fails('host', { t: 'roll' });
    const pick = s.state.match!.teams[1].players[10].id;
    s.fails('host', { t: 'chooseBowler', playerId: pick });
    s.fails('guest', { t: 'chooseBowler', playerId: s.state.match!.teams[0].players[0].id });
    s.fails('guest', { t: 'chooseBowler', playerId: 'GGG/stranger' });
    s.act('guest', { t: 'chooseBowler', playerId: pick });
    expect(currentTurn(s.state)).toEqual({ seat: 'host', kind: 'roll' });
    s.fails('guest', { t: 'roll' });
    s.fails('guest', { t: 'chooseBowler', playerId: pick });
    s.fails('host', { t: 'chooseBatter', playerId: s.state.match!.teams[0].players[4].id });
    s.now = s.state.nextBallAt;
    s.act('host', { t: 'roll' });
    s.fails('host', { t: 'rematch' });
    s.fails('host', { t: 'claimWin' });
  });

  it('makes players wait for the dice', () => {
    const s = new Sim().toPlay();
    s.roll(4);
    expect(s.state.nextBallAt).toBe(s.now + BALL_GAP_MS);
    s.now += BALL_GAP_MS - 1;
    s.fails('host', { t: 'roll' }, /last ball/);
    s.now += 1;
    s.roll(5, 2);
    expect(s.state.nextBallAt).toBe(s.now + CHECK_GAP_MS);
  });

  it('refuses back-to-back overs', () => {
    const s = new Sim().toPlay();
    s.bowlerPick();
    const first = currentInnings(s.state.match!).bowlerId!;
    for (let i = 0; i < 6; i++) s.roll(2);
    s.fails('guest', { t: 'chooseBowler', playerId: first }, /cannot bowl/);
  });

  it('asks for the next batter after a wicket', () => {
    const s = new Sim().toPlay();
    s.roll(5, 4);
    expect(currentTurn(s.state)).toEqual({ seat: 'host', kind: 'batter' });
    s.fails('host', { t: 'roll' });
    const { players } = s.state.match!.teams[0];
    s.fails('host', { t: 'chooseBatter', playerId: players[0].id });
    s.act('host', { t: 'chooseBatter', playerId: players[7].id });
    expect(currentTurn(s.state)!.kind).toBe('roll');
    s.roll(6);
    expect(battingCard(s.state.match!, 0).find((r) => r.playerId === players[7].id)!.runs).toBe(6);
  });

  it('asks for the batter before the bowler when a wicket ends the over', () => {
    const s = new Sim().toPlay();
    for (let i = 0; i < 5; i++) s.roll(2);
    s.roll(5, 6);
    expect(currentTurn(s.state)).toEqual({ seat: 'host', kind: 'batter' });
    s.act('host', { t: 'chooseBatter', playerId: s.state.match!.teams[0].players[5].id });
    expect(currentTurn(s.state)).toEqual({ seat: 'guest', kind: 'bowler' });
  });

  it('does not ask when only one batter is left', () => {
    const s = new Sim().toPlay();
    for (let i = 0; i < 8; i++) {
      s.roll(5, 4);
      s.act('host', { t: 'chooseBatter', playerId: nextBatterOptions(s.state.match!)[0].id });
    }
    s.roll(5, 4);
    expect(currentTurn(s.state)!.kind).not.toBe('batter');
    s.roll(5, 4);
    expect(s.state.match!.innings[0].endReason).toBe('allOut');
    expect(currentTurn(s.state)).toEqual({ seat: 'host', kind: 'bowler' });
  });

  it('plays whole matches that both browsers agree on', () => {
    const kinds = new Set<string>();
    for (let seed = 1; seed <= 24; seed++) {
      const s = new Sim(seed).toPlay(1 + (seed % 20), hawks, seed % 2 ? hawks : rhinos).playOut();
      const f = finishedMatch(s.state)!;
      expect(f.end).toEqual({ kind: 'played' });
      expect(f.match).toEqual(s.client);
      expect(f.match.innings).toHaveLength(2);
      kinds.add(f.match.result!.kind);
      expect(nextWake(s.state)).toBe(s.state.phaseAt + KEEP_FINISHED_MS);
      s.fails('host', { t: 'roll' });
    }
    expect(kinds.has('win')).toBe(true);
  });

  it('plays itself out on the clock if both captains do nothing', () => {
    const s = new Sim(3).toPlay(3);
    let guard = 0;
    while (s.state.phase === 'playing' && guard++ < 500) {
      const wake = nextWake(s.state)!;
      expect(wake).toBeGreaterThan(s.now);
      s.now = wake;
      s.tick();
    }
    expect(s.state.phase).toBe('finished');
    expect(s.client).toEqual(s.state.match);
  });
});

describe('clocks', () => {
  it('gives five seconds to pick, and both players the same countdown', () => {
    const s = new Sim().toPlay();
    const same = () => {
      const [h, g] = [s.idle('host').clock, s.idle('guest').clock];
      expect(h).toEqual(g);
      return h.deadline! - Math.max(s.now, h.nextBallAt);
    };
    expect(currentTurn(s.state)!.kind).toBe('bowler');
    expect(same()).toBe(5000);
    s.bowlerPick();
    s.roll(5, 4);
    expect(currentTurn(s.state)!.kind).toBe('batter');
    expect(same()).toBe(5000);
  });

  it('chooses the planned bowler when time runs out', () => {
    const s = new Sim().toSetup();
    const l = defaultLineup(rhinos);
    const plan = autoPlan(l.bowlers, 5)!.reverse();
    s.act('guest', { t: 'setLineup', lineup: { ...l, bowlingPlan: plan } });
    s.act('host', { t: 'ready' });
    s.act('guest', { t: 'ready' });
    s.act('guest', { t: 'callToss', call: 'heads' });
    const w = s.state.toss!.winner!;
    s.act(w, { t: 'chooseInnings', choice: w === 'host' ? 'bat' : 'bowl' });
    const bowling = () => currentInnings(s.state.match!).bowlerId;
    s.wait(INNINGS_GAP_MS + PICK_MS - 1);
    expect(bowling()).toBeNull();
    s.wait(1);
    expect(bowling()).toBe(`GGG/${plan[0]}`);
    expect(s.sent[s.sent.length - 1].events[0].event).toMatchObject({ type: 'bowler', auto: 'timeout' });
    for (let i = 0; i < 6; i++) s.roll(2);
    // The captain goes off plan and uses the next planned bowler early, so over 3 falls back to a legal choice.
    s.act('guest', { t: 'chooseBowler', playerId: `GGG/${plan[2]}` });
    for (let i = 0; i < 6; i++) s.roll(2);
    s.now = s.state.deadline!;
    s.tick();
    expect(bowling()).not.toBeNull();
    expect(bowling()).not.toBe(`GGG/${plan[2]}`);
  });

  it('rolls, and sends in the next batter, when time runs out', () => {
    const s = new Sim().toPlay();
    s.bowlerPick();
    s.wait(INNINGS_GAP_MS + ROLL_MS - 1);
    expect(s.state.match!.innings[0].balls).toHaveLength(0);
    s.rng = dice(5, 4);
    s.wait(1);
    expect(s.state.match!.innings[0].wickets).toBe(1);
    const third = s.state.match!.teams[0].players[2].id;
    expect(s.state.deadline).toBe(s.now + CHECK_GAP_MS + PICK_MS);
    s.wait(CHECK_GAP_MS + PICK_MS);
    expect(currentTurn(s.state)!.kind).toBe('roll');
    expect(s.state.match!.teams[0].players[2].id).toBe(third);
  });

  it('starts each clock after the dice have settled', () => {
    const s = new Sim().toPlay();
    s.roll(2);
    expect(s.state.deadline).toBe(s.now + BALL_GAP_MS + ROLL_MS);
  });

  it('gives two seconds to roll', () => {
    const s = new Sim().toPlay();
    s.roll(2);
    expect(s.state.deadline! - s.state.nextBallAt).toBe(2000);
  });

  it('leaves a breather at the start of each innings', () => {
    const s = new Sim().toPlay(1);
    expect(s.state.nextBallAt).toBe(s.now + INNINGS_GAP_MS);
    for (let i = 0; i < 6; i++) s.roll(2);
    expect(s.state.match!.innings).toHaveLength(2);
    expect(s.state.nextBallAt).toBe(s.now + BALL_GAP_MS + INNINGS_GAP_MS);
  });

  it('ignores early and repeated ticks', () => {
    const s = new Sim().toPlay();
    const before = s.state;
    s.tick();
    expect(s.state).toBe(before);
    s.now = s.state.deadline!;
    s.tick();
    const { seq } = s.state;
    s.tick();
    expect(s.state.seq).toBe(seq);
  });

  it('copes with waking up very late', () => {
    const s = new Sim().toPlay();
    s.wait(60 * 60 * 1000);
    expect(s.state.seq).toBe(1);
    expect(s.state.deadline).toBe(s.now + ROLL_MS);
  });
});

describe('auto settings', () => {
  it('all start on', () => {
    const s = new Sim();
    s.connect('host');
    s.connect('guest');
    for (const seat of [s.state.host, s.state.guest!]) expect(seat.auto).toEqual({ roll: true, batter: true, bowler: true });
  });

  it('can be changed before the match, without losing readiness, and last through it and a rematch', () => {
    const s = new Sim().toSetup();
    s.act('guest', { t: 'ready' });
    s.act('guest', { t: 'setAuto', what: 'bowler', on: true });
    expect(s.state.guest!.ready).toBe(true);
    expect(s.idle('host').guest!.auto.bowler).toBe(true);
    s.act('host', { t: 'setSettings', overs: 1 });
    s.act('host', { t: 'ready' });
    s.act('guest', { t: 'ready' });
    s.act('guest', { t: 'callToss', call: 'heads' });
    s.act(s.state.toss!.winner!, { t: 'chooseInnings', choice: 'bat' });
    s.playOut();
    s.act('host', { t: 'rematch' });
    s.act('guest', { t: 'rematch' });
    expect(s.state.guest!.auto).toEqual({ roll: false, batter: false, bowler: true });
  });

  it('roll as soon as each ball is done, and only for the captain who asked', () => {
    const s = new Sim().toPlay();
    s.act('guest', { t: 'setAuto', what: 'roll', on: true });
    s.bowlerPick();
    expect(s.state.deadline).toBe(s.state.nextBallAt + ROLL_MS);
    s.act('host', { t: 'setAuto', what: 'roll', on: true });
    expect(s.state.deadline).toBe(s.state.nextBallAt);
    s.rng = dice(2, 1, 3);
    s.now = s.state.deadline!;
    expect(s.tick().events[0].event).toMatchObject({ type: 'ball', auto: 'setting' });
    expect(s.state.deadline).toBe(s.now + BALL_GAP_MS);
    s.act('host', { t: 'setAuto', what: 'roll', on: false });
    expect(s.state.deadline).toBe(s.now + BALL_GAP_MS + ROLL_MS);
  });

  it('pick the bowler from the plan, and the next batter in order, without waiting', () => {
    const s = new Sim().toSetup();
    const l = defaultLineup(rhinos);
    const plan = autoPlan(l.bowlers, 5)!.reverse();
    s.act('guest', { t: 'setLineup', lineup: { ...l, bowlingPlan: plan } });
    s.act('guest', { t: 'setAuto', what: 'bowler', on: true });
    s.act('host', { t: 'setAuto', what: 'batter', on: true });
    s.act('host', { t: 'ready' });
    s.act('guest', { t: 'ready' });
    s.act('guest', { t: 'callToss', call: 'heads' });
    const w = s.state.toss!.winner!;
    s.act(w, { t: 'chooseInnings', choice: w === 'host' ? 'bat' : 'bowl' });
    expect(s.state.deadline).toBe(s.state.nextBallAt);
    s.now = s.state.deadline!;
    expect(s.tick().events[0].event).toEqual({ type: 'bowler', playerId: `GGG/${plan[0]}`, auto: 'setting' });
    s.roll(5, 4);
    const third = s.state.match!.teams[0].players[2].id;
    expect(s.state.deadline).toBe(s.state.nextBallAt);
    s.now = s.state.deadline!;
    expect(s.tick().events[0].event).toEqual({ type: 'batter', playerId: third, auto: 'setting' });
    expect(currentTurn(s.state)!.kind).toBe('roll');
  });

  it('can be switched on or off in the middle of a pick', () => {
    const s = new Sim().toPlay();
    s.now = s.state.nextBallAt + 1000;
    // Someone else's setting, or a different kind of move, changes nothing.
    const { deadline } = s.state;
    s.now += 500;
    s.act('host', { t: 'setAuto', what: 'bowler', on: true });
    s.act('guest', { t: 'setAuto', what: 'roll', on: true });
    s.act('guest', { t: 'setAuto', what: 'bowler', on: false });
    expect(s.state.deadline).toBe(deadline);
    // Switching it on picks at once, so on-and-off cannot be used to stall.
    const step = s.act('guest', { t: 'setAuto', what: 'bowler', on: true });
    expect(step.events[0].event).toMatchObject({ type: 'bowler', auto: 'setting' });
    s.act('guest', { t: 'setAuto', what: 'bowler', on: false });
    expect(currentTurn(s.state)).toEqual({ seat: 'host', kind: 'roll' });
  });

  it('cannot be used to stall before the dice settle either', () => {
    const s = new Sim().toPlay();
    const end = s.state.deadline!;
    for (let i = 0; i < 50; i++) {
      s.now += 10;
      for (const on of [true, false]) s.act('guest', { t: 'setAuto', what: 'bowler', on });
    }
    expect(s.state.deadline).toBe(end);
  });

  it('wait while someone is away', () => {
    const s = new Sim().toPlay();
    s.disconnect('host');
    s.act('guest', { t: 'setAuto', what: 'bowler', on: true });
    expect(s.state).toMatchObject({ deadline: null, remaining: 0 });
    s.wait(30_000);
    expect(s.state.seq).toBe(0);
    s.connect('host');
    expect(s.state.deadline).toBe(s.now + RESUME_MS);
  });

  it('can play a whole match on their own', () => {
    for (let seed = 1; seed <= 10; seed++) {
      const s = new Sim(seed).toPlay(3);
      for (const seat of ['host', 'guest'] as const)
        for (const what of ['roll', 'batter', 'bowler'] as const) s.act(seat, { t: 'setAuto', what, on: true });
      const start = s.now;
      let guard = 0;
      while (s.state.phase === 'playing' && guard++ < 500) {
        s.now = nextWake(s.state)!;
        s.tick();
      }
      expect(s.state.phase).toBe('finished');
      expect(s.client).toEqual(s.state.match);
      const balls = s.state.match!.innings.reduce((n, i) => n + i.legalBalls, 0);
      expect(s.now - start).toBeLessThan(balls * CHECK_GAP_MS + 3 * INNINGS_GAP_MS);
    }
  });
});

describe('disconnects', () => {
  it('pauses the clock and blocks moves until both are back', () => {
    const s = new Sim().toPlay();
    s.bowlerPick();
    s.now = s.state.nextBallAt + 500;
    s.disconnect('guest');
    expect(s.state).toMatchObject({ deadline: null, remaining: ROLL_MS - 500 });
    expect(s.idle('host').clock).toMatchObject({ paused: true, deadline: null });
    s.fails('host', { t: 'roll' }, /reconnect/);
    s.wait(60_000);
    expect(s.state.match!.innings[0].balls).toHaveLength(0);
    s.connect('guest');
    expect(s.state).toMatchObject({ deadline: s.now + RESUME_MS, remaining: null });
    s.act('host', { t: 'roll' });
  });

  it('gives a returning player a moment', () => {
    const s = new Sim().toPlay();
    s.now += PICK_MS - 100;
    s.disconnect('guest');
    s.now += 1000;
    s.connect('guest');
    expect(s.state.deadline).toBe(s.now + RESUME_MS);
  });

  it('stays paused until both return when both drop', () => {
    const s = new Sim().toPlay();
    s.disconnect('host');
    s.now += 10;
    s.disconnect('guest');
    s.connect('guest');
    expect(s.state.deadline).toBeNull();
    s.connect('host');
    expect(s.state.deadline).not.toBeNull();
  });

  it('ignores a disconnect from someone already gone or never here', () => {
    const s = new Sim().toPlay();
    s.disconnect('host');
    const before = s.state;
    s.now += 5000;
    s.disconnect('host');
    expect(s.state).toBe(before);
    expect(disconnect(s.state, 'XXX', s.now).state).toBe(before);
  });

  it('can be claimed as a win, but only after 90 seconds and only while they are away', () => {
    const s = new Sim().toPlay();
    s.roll(4);
    s.fails('guest', { t: 'claimWin' }, /still here/);
    s.disconnect('host');
    expect(s.idle('guest').clock.claimAt).toBe(s.now + CLAIM_MS);
    expect(s.idle('host').clock.claimAt).toBeNull();
    s.now += CLAIM_MS - 1;
    s.fails('guest', { t: 'claimWin' }, /still has time/);
    s.connect('host');
    s.now += 1;
    s.fails('guest', { t: 'claimWin' }, /still here/);
    s.disconnect('host');
    s.now += CLAIM_MS;
    s.act('guest', { t: 'claimWin' });
    const f = finishedMatch(s.state)!;
    expect(f.end).toEqual({ kind: 'forfeit', loser: 'host' });
    expect(f.match.result).toEqual({ kind: 'win', winnerId: 'GGG/p-rhinos', text: 'Riverside Rhinos won by forfeit' });
    expect(f.match.innings[0].runs).toBe(4);
    expect(s.client).toEqual(f.match);
    // The absent player can still come back for the result.
    s.connect('host');
    expect(finishedMatch(s.state)).toEqual(f);
  });

  it('counts leaving during a match as a forfeit', () => {
    const s = new Sim().toPlay();
    s.act('guest', { t: 'leave' });
    expect(finishedMatch(s.state)!.end).toEqual({ kind: 'forfeit', loser: 'guest' });
    expect(s.state.match!.result!.winnerId).toBe('HHH/p-hawks');
    s.fails('host', { t: 'rematch' }, /left/);
  });
});

describe('rematch', () => {
  it('needs both players, keeps teams, and is a new match', () => {
    const s = new Sim().toPlay(1).playOut();
    const first = finishedMatch(s.state)!.match.id;
    s.act('host', { t: 'rematch' });
    expect(s.state.phase).toBe('finished');
    s.act('guest', { t: 'rematch' });
    expect(s.state).toMatchObject({ phase: 'setup', match: null, seq: 0, end: null });
    expect(s.state.host).toMatchObject({ team: hawks, ready: false, wantsRematch: false });
    s.act('host', { t: 'ready' });
    s.act('guest', { t: 'ready' });
    s.act('guest', { t: 'callToss', call: 'heads' });
    s.act(s.state.toss!.winner!, { t: 'chooseInnings', choice: 'bat' });
    s.playOut();
    expect(finishedMatch(s.state)!.match.id).not.toBe(first);
  });

  it('is withdrawn by dropping out', () => {
    const s = new Sim().toPlay(1).playOut();
    s.act('host', { t: 'rematch' });
    s.disconnect('host');
    s.act('guest', { t: 'rematch' });
    expect(s.state.phase).toBe('finished');
  });
});

describe('random play', () => {
  it('never breaks, whatever players and connections do', () => {
    const seats: SeatId[] = ['host', 'guest'];
    const phases = new Set<string>();
    for (let seed = 1; seed <= 120; seed++) {
      const s = new Sim(seed);
      const r = seeded(seed * 7919);
      const any = <T,>(xs: T[]): T => xs[Math.floor(r() * xs.length)];
      for (let i = 0; i < 250; i++) {
        phases.add(s.state.phase);
        const seat = any(seats);
        const m = s.state.match;
        const players = m ? m.teams.flatMap((t) => t.players) : [{ id: 'HHH/x' }];
        const actions: RoomAction[] = [
          { t: 'ready' }, { t: 'ready' }, { t: 'ready' }, { t: 'unready' }, { t: 'setTeam', team: any([hawks, rhinos]) },
          { t: 'setSettings', overs: 1 + Math.floor(r() * 3) }, { t: 'callToss', call: 'heads' },
          { t: 'chooseInnings', choice: any(['bat', 'bowl']) }, { t: 'chooseBowler', playerId: any(players).id },
          { t: 'chooseBatter', playerId: any(players).id }, { t: 'roll' }, { t: 'roll' }, { t: 'setAuto', what: any(['roll', 'batter', 'bowler']), on: r() < 0.5 },
          { t: 'claimWin' }, { t: 'rematch' },
          ...(r() < 0.02 ? [{ t: 'leave' as const }, { t: 'removeGuest' as const }] : []),
        ];
        try {
          const x = r();
          if (x < 0.12) s.connect(seat);
          else if (x < 0.14) s.disconnect(seat);
          else if (x < 0.4) s.wait(Math.floor(r() * 25_000));
          else s.act(seat, any(actions));
        } catch (e) {
          // Refusals are expected; anything else (including a failed expectation) is a bug.
          if (!(e instanceof OnlineError)) throw e;
        }
        const { state } = s;
        if (state.phase === 'playing' || state.phase === 'toss') {
          const here = state.host.connected && state.guest!.connected;
          expect(currentTurn(state)).not.toBeNull();
          expect(state.deadline !== null).toBe(here);
        } else expect(state.deadline).toBeNull();
        if (state.phase === 'finished') expect(state.match!.result).not.toBeNull();
        if (state.phase === 'playing') expect(s.client).toEqual(state.match);
      }
    }
    expect([...phases].sort()).toEqual(['closed', 'finished', 'playing', 'setup', 'toss', 'waiting']);
  });
});
