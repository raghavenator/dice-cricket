import { ballistic, launchVy, path, rest, roll, type Segment } from './ballPath';
import {
  BALL_R, BOWLER_FOLLOW, FIELD_POSITIONS, GRAVITY, HIT_ORIGIN, KEEPER_GLOVES, MAX_SHOT_ANGLE, NOMINAL,
  along, angleOf, boundaryDistance, dirOf, fieldSpot, nearestFielder, type Vec2, type Vec3,
} from './field';
import { labelFor, type ResultLabel } from './label';
import type { ClipKind, Outcome } from './outcome';
import { between, mulberry32, pick, type Rand } from './rng';
import { CLIP } from './timing';

export type Shot = 'broadcast' | 'follow' | 'wide' | 'catch' | 'stumps' | 'umpire';
export type SurviveVariant = 'beaten' | 'leave' | 'edgePad';

/** Where the ball goes after it reaches the batter. All randomness comes from the seed. */
export type Hit =
  | { type: 'ground'; theta: number; v0: number; dec: number; maxS: number }
  | { type: 'air'; theta: number; land: Vec2; flight: number; rollV: number; rollDec: number; rollMax: number }
  | { type: 'catch'; theta: number; catchAt: Vec3; flight: number };

export interface DeliveryPlan {
  kind: ClipKind;
  runs: number;
  cAndB: boolean;
  /** Where the ball pitches (z) and where it arrives at the batter's end (stumps, pad, edge or bat). */
  bounceZ: number;
  arrive: 'bat' | 'stumps' | 'pad' | 'edge';
  /** Line across the pitch at the batter (x). */
  lineX: number;
  hit: Hit | null;
  survive?: SurviveVariant;
  /** Fielder involved: index into FIELD_POSITIONS (chaser or catcher), -1 = the bowler, null = none. */
  fielder: number | null;
  camera: Shot;
  label: ResultLabel;
}

const GROUND_RANGE: Record<number, [number, number]> = { 1: [12, 20], 2: [25, 40], 3: [45, 56] };
const CATCH_HEIGHT = 1.3;
const CATCH_FLIGHT = 1.1;
const CAMERA: Record<ClipKind, Shot> = {
  ground: 'broadcast', four: 'follow', six: 'wide', caught: 'catch', bowled: 'stumps', lbw: 'umpire', survive: 'broadcast',
};

const shotAngle = (r: Rand) => between(r, -MAX_SHOT_ANGLE, MAX_SHOT_ANGLE);

/** A ground shot that stops after d metres (plus how long it takes to stop). */
function groundShot(theta: number, d: number): Hit {
  const tStop = Math.min(2.6, Math.max(1.2, 0.9 + d / 30));
  const v0 = (2 * d) / tStop;
  return { type: 'ground', theta, v0, dec: v0 / tStop, maxS: d };
}

/** Height of a ballistic flight at horizontal fraction f of the way (from height h0 to h1). */
const heightAt = (h0: number, h1: number, T: number, f: number) => {
  const vy = launchVy({ x: 0, y: h0, z: 0 }, { x: 0, y: h1, z: 0 }, T);
  const t = f * T;
  return h0 + vy * t - 0.5 * GRAVITY * t * t;
};

export function planDelivery(o: Outcome, seed: number): DeliveryPlan {
  const r = mulberry32(seed);
  const base = { kind: o.kind, runs: o.runs, cAndB: o.cAndB, bounceZ: between(r, -4.6, -2.8), camera: CAMERA[o.kind], label: labelFor(o) };
  const contactY = NOMINAL.contact.y;

  switch (o.kind) {
    case 'ground': {
      const theta = shotAngle(r);
      const [lo, hi] = GROUND_RANGE[o.runs];
      const d = Math.min(between(r, lo, hi), boundaryDistance(theta) - 6);
      const hit = groundShot(theta, d);
      return { ...base, arrive: 'bat', lineX: between(r, -0.25, 0.2), hit, fielder: nearestFielder(along(HIT_ORIGIN, theta, d)) };
    }
    case 'four': {
      const theta = shotAngle(r);
      const rope = boundaryDistance(theta);
      const lineX = between(r, -0.3, 0.2);
      if (r() < 0.6) {
        const tRope = between(r, 1.0, 1.4);
        const dec = 4;
        const v0 = rope / tRope + (dec * tRope) / 2;
        const hit: Hit = { type: 'ground', theta, v0, dec, maxS: rope + 3 };
        return { ...base, arrive: 'bat', lineX, hit, fielder: nearestFielder(along(HIT_ORIGIN, theta, rope * 0.6)) };
      }
      const landD = rope * between(r, 0.6, 0.78);
      const flight = between(r, 1.2, 1.5);
      const rollV = (landD / flight) * 0.6;
      const left = rope - landD + 3;
      const hit: Hit = {
        type: 'air', theta, land: along(HIT_ORIGIN, theta, landD), flight,
        rollV, rollDec: Math.min(4, (rollV * rollV) / (2 * left)), rollMax: left,
      };
      return { ...base, arrive: 'bat', lineX, hit, fielder: nearestFielder(along(HIT_ORIGIN, theta, landD)) };
    }
    case 'six': {
      const theta = shotAngle(r);
      const rope = boundaryDistance(theta);
      let landD = rope + between(r, 8, 18);
      let flight = 0;
      // Fly high enough to clear the rope by a margin: 6 m at the rope, within a 2-3.6 s flight.
      for (let i = 0; i < 10; i++) {
        const f = rope / landD;
        flight = Math.min(3.6, Math.max(2.0, Math.sqrt((2 * 6) / (GRAVITY * f * (1 - f)))));
        if (heightAt(contactY, BALL_R, flight, f) >= 4.5) break;
        landD += 4;
      }
      const hit: Hit = { type: 'air', theta, land: along(HIT_ORIGIN, theta, landD), flight, rollV: 4, rollDec: 8, rollMax: 2 };
      return { ...base, arrive: 'bat', lineX: between(r, -0.2, 0.2), hit, fielder: null };
    }
    case 'caught': {
      if (o.cAndB) {
        const hit: Hit = { type: 'catch', theta: angleOf(HIT_ORIGIN, BOWLER_FOLLOW), catchAt: { ...BOWLER_FOLLOW }, flight: 1.05 };
        return { ...base, arrive: 'bat', lineX: between(r, -0.15, 0.15), hit, fielder: -1 };
      }
      const inner = FIELD_POSITIONS.map((f, i) => ({ f, i })).filter((x) => x.f.ring === 'inner');
      const { f, i } = pick(r, inner);
      const spot = fieldSpot(f);
      const a = between(r, 0, Math.PI * 2), s = between(r, 0, 2);
      const catchAt = { x: spot.x + Math.cos(a) * s, y: CATCH_HEIGHT, z: spot.z + Math.sin(a) * s };
      const hit: Hit = { type: 'catch', theta: angleOf(HIT_ORIGIN, catchAt), catchAt, flight: CATCH_FLIGHT };
      return { ...base, arrive: 'bat', lineX: between(r, -0.3, 0.1), hit, fielder: i };
    }
    case 'bowled':
      return { ...base, arrive: 'stumps', lineX: 0, hit: null, fielder: null };
    case 'lbw':
      return { ...base, arrive: 'pad', lineX: NOMINAL.pad.x, hit: null, fielder: null };
    case 'survive': {
      const survive = pick(r, ['beaten', 'leave', 'edgePad'] as const);
      return { ...base, arrive: survive === 'edgePad' ? 'bat' : 'edge', lineX: survive === 'edgePad' ? 0.1 : -0.45, hit: null, survive, fielder: null };
    }
  }
}

export interface FlightPoints {
  /** Bowler's hand at release. */
  release: Vec3;
  /** Bat sweet spot at contact. */
  contact: Vec3;
  pad: Vec3;
  stumpsHit: Vec3;
  /** Keeper's gloves when taking a ball that beat the bat (measured from the pose; defaults to KEEPER_GLOVES). */
  gloves?: Vec3;
}

/** Time from reaching the batter to reaching the keeper's gloves. */
export const TO_KEEPER = 0.28;

/** Where the ball arrives at the batter's end, by plan. */
export function arrivalPoint(p: DeliveryPlan, pts: FlightPoints): Vec3 {
  if (p.arrive === 'stumps') return pts.stumpsHit;
  if (p.arrive === 'pad') return pts.pad;
  if (p.arrive === 'edge') return { x: p.lineX, y: 0.5, z: pts.contact.z };
  return pts.contact;
}

/**
 * The ball's full flight in clip time: release → bounce → arrival, then what happens next.
 * Pass the scene's measured points, or NOMINAL ones in tests.
 */
export function flightOf(p: DeliveryPlan, pts: FlightPoints = { ...NOMINAL }): (t: number) => Vec3 {
  const R = pts.release;
  const A = arrivalPoint(p, pts);
  // Bounce on the straight line from release to arrival, at the planned length.
  const f = (R.z - p.bounceZ) / (R.z - A.z);
  const B: Vec3 = { x: R.x + (A.x - R.x) * f, y: BALL_R, z: p.bounceZ };
  const segs: Segment[] = [ballistic(CLIP.release, R, B, CLIP.bounce - CLIP.release), ballistic(CLIP.bounce, B, A, CLIP.contact - CLIP.bounce)];
  const t = CLIP.contact;
  const h = p.hit;

  if (h?.type === 'ground') {
    const from = { x: A.x, z: A.z };
    const base = roll(t, from, dirOf(h.theta), h.v0, h.dec, h.maxS);
    // A little hop off the bat before it runs along the ground.
    const hop = 0.25;
    segs.push({ t0: t, t1: base.t1, at: (tt) => {
      const q = base.at(tt);
      const tau = tt - t;
      return tau < hop ? { ...q, y: BALL_R + (A.y - BALL_R) * (1 - tau / hop) ** 2 } : q;
    } });
  } else if (h?.type === 'air') {
    const land = { x: h.land.x, y: BALL_R, z: h.land.z };
    segs.push(ballistic(t, A, land, h.flight));
    segs.push(roll(t + h.flight, h.land, dirOf(h.theta), h.rollV, h.rollDec, h.rollMax));
  } else if (h?.type === 'catch') {
    segs.push(ballistic(t, A, h.catchAt, h.flight));
    segs.push(rest(t + h.flight, h.catchAt));
  } else if (p.arrive === 'stumps') {
    const end = { x: A.x + 0.2, y: BALL_R, z: A.z - 1.2 };
    segs.push(ballistic(t, A, end, 0.35), rest(t + 0.35, end));
  } else if (p.arrive === 'pad') {
    const end = { x: A.x + 0.5, y: BALL_R, z: A.z + 0.4 };
    segs.push(ballistic(t, A, end, 0.3), rest(t + 0.3, end));
  } else if (p.survive === 'edgePad') {
    // Inside edge onto the front pad, then it drops at the batter's feet.
    const end = { x: pts.pad.x + 0.25, y: BALL_R, z: pts.pad.z + 0.45 };
    segs.push(ballistic(t, A, pts.pad, 0.1), ballistic(t + 0.1, pts.pad, end, 0.3), rest(t + 0.4, end));
  } else {
    // Beaten or left alone: on to the keeper's gloves.
    const g = pts.gloves ?? KEEPER_GLOVES;
    segs.push(ballistic(t, A, g, TO_KEEPER), rest(t + TO_KEEPER, g));
  }
  return path(segs);
}
