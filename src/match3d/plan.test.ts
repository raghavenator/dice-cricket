import { describe, expect, it } from 'vitest';
import { BALL_R, BOUNDARY_R, FIELD_POSITIONS, KEEPER_GLOVES, MAX_SHOT_ANGLE, NOMINAL, BOWLER_FOLLOW, fieldSpot, type Vec3 } from './field';
import type { ClipKind, Outcome } from './outcome';
import { flightOf, planDelivery } from './plan';
import { mulberry32, seedFor } from './rng';
import { CLIP } from './timing';

const out = (kind: ClipKind, runs = 0, cAndB = false): Outcome => ({ kind, runs, check: !['ground', 'four', 'six'].includes(kind), cAndB });
const seeds = (n: number) => Array.from({ length: n }, (_, i) => seedFor('test-match', i % 2, i));
const fromMiddle = (p: { x: number; z: number }) => Math.hypot(p.x, p.z);
const close = (a: Vec3, b: Vec3, eps = 1e-6) => Math.abs(a.x - b.x) < eps && Math.abs(a.y - b.y) < eps && Math.abs(a.z - b.z) < eps;

/** Sample a flight at fine steps from contact on. */
function samples(fl: (t: number) => Vec3, until = 8, dt = 0.01) {
  const pts: Vec3[] = [];
  for (let t = CLIP.contact; t <= until; t += dt) pts.push(fl(t));
  return pts;
}

describe('seeds', () => {
  it('give the same plan for the same ball, and vary between balls', () => {
    const a = planDelivery(out('ground', 1), seedFor('m1', 0, 5));
    const b = planDelivery(out('ground', 1), seedFor('m1', 0, 5));
    const c = planDelivery(out('ground', 1), seedFor('m1', 0, 6));
    expect(a).toEqual(b);
    expect(c.hit).not.toEqual(a.hit);
  });

  it('mulberry32 stays in [0, 1)', () => {
    const r = mulberry32(42);
    for (let i = 0; i < 1000; i++) {
      const x = r();
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
  });
});

describe('shot directions', () => {
  it('never go back past the keeper', () => {
    for (const kind of ['ground', 'four', 'six', 'caught'] as const)
      for (const s of seeds(2500)) {
        const p = planDelivery(out(kind, kind === 'ground' ? 1 + (s % 3) : kind === 'four' ? 4 : kind === 'six' ? 6 : 0), s);
        expect(Math.abs(p.hit!.theta)).toBeLessThanOrEqual(MAX_SHOT_ANGLE + 1e-9);
      }
  });

  it('spread all round the ground', () => {
    const thetas = seeds(400).map((s) => planDelivery(out('six', 6), s).hit!.theta);
    expect(Math.min(...thetas)).toBeLessThan(-2);
    expect(Math.max(...thetas)).toBeGreaterThan(2);
  });
});

describe('ball flights', () => {
  it('are continuous at release, bounce and contact, and bounce at ball height', () => {
    for (const kind of ['ground', 'four', 'six', 'caught', 'bowled', 'lbw', 'survive'] as const) {
      const p = planDelivery(out(kind, kind === 'four' ? 4 : kind === 'six' ? 6 : kind === 'ground' ? 2 : 0), 7);
      const fl = flightOf(p);
      for (const t of [CLIP.bounce, CLIP.contact]) expect(close(fl(t - 1e-7), fl(t + 1e-7), 1e-4)).toBe(true);
      expect(fl(CLIP.bounce).y).toBeCloseTo(BALL_R, 6);
      expect(close(fl(CLIP.release), NOMINAL.release)).toBe(true);
    }
  });

  it('stop 1, 2 and 3 run shots inside their distance bands and inside the rope', () => {
    const band: Record<number, [number, number]> = { 1: [12, 20], 2: [25, 40], 3: [45, 56] };
    for (const runs of [1, 2, 3])
      for (const s of seeds(300)) {
        const fl = flightOf(planDelivery(out('ground', runs), s));
        const end = fl(20);
        const d = Math.hypot(end.x - NOMINAL.contact.x, end.z - NOMINAL.contact.z);
        expect(d).toBeLessThanOrEqual(band[runs][1] + 1e-6);
        expect(d).toBeGreaterThan(Math.min(band[runs][0], 10));
        expect(fromMiddle(end)).toBeLessThan(BOUNDARY_R - 3);
        expect(Math.max(...samples(fl).map((q) => q.y))).toBeLessThan(0.6);
      }
  });

  it('take fours to the rope (along the ground, or bouncing inside it first)', () => {
    for (const s of seeds(300)) {
      const p = planDelivery(out('four', 4), s);
      const pts = samples(flightOf(p));
      const crossing = pts.findIndex((q) => fromMiddle(q) >= BOUNDARY_R);
      expect(crossing).toBeGreaterThan(0);
      if (p.hit!.type === 'air') {
        const firstDown = pts.findIndex((q, i) => i > 5 && q.y <= BALL_R + 1e-6);
        expect(firstDown).toBeGreaterThan(0);
        expect(firstDown).toBeLessThan(crossing);
      } else {
        expect(pts[crossing].y).toBeLessThan(0.1);
      }
    }
  });

  it('carry sixes over the rope with height to spare', () => {
    for (const s of seeds(300)) {
      const pts = samples(flightOf(planDelivery(out('six', 6), s)));
      const crossing = pts.find((q) => fromMiddle(q) >= BOUNDARY_R)!;
      expect(crossing.y).toBeGreaterThan(4);
    }
  });

  it('end catches in the catcher\'s hands, and caught-and-bowled with the bowler', () => {
    for (const s of seeds(200)) {
      const p = planDelivery(out('caught'), s);
      expect(p.fielder).not.toBeNull();
      const spot = fieldSpot(FIELD_POSITIONS[p.fielder!]);
      const end = flightOf(p)(10);
      expect(Math.hypot(end.x - spot.x, end.z - spot.z)).toBeLessThanOrEqual(2 + 1e-6);
      expect(end.y).toBeCloseTo(1.3, 6);
    }
    const cb = planDelivery(out('caught', 0, true), 3);
    expect(cb.fielder).toBe(-1);
    expect(close(flightOf(cb)(10), BOWLER_FOLLOW)).toBe(true);
  });

  it('hit the stumps when bowled, the pad when lbw, and reach the keeper when beaten', () => {
    expect(close(flightOf(planDelivery(out('bowled'), 1))(CLIP.contact), NOMINAL.stumpsHit)).toBe(true);
    expect(close(flightOf(planDelivery(out('lbw'), 1))(CLIP.contact), NOMINAL.pad)).toBe(true);
    for (const s of seeds(50)) {
      const p = planDelivery(out('survive'), s);
      if (p.survive !== 'edgePad') expect(close(flightOf(p)(10), KEEPER_GLOVES)).toBe(true);
    }
  });

  it('pick the camera for the shot', () => {
    expect(planDelivery(out('six', 6), 1).camera).toBe('wide');
    expect(planDelivery(out('four', 4), 1).camera).toBe('follow');
    expect(planDelivery(out('caught'), 1).camera).toBe('catch');
    expect(planDelivery(out('bowled'), 1).camera).toBe('stumps');
    expect(planDelivery(out('lbw'), 1).camera).toBe('umpire');
  });
});
