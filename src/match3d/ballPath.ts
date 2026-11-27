import { BALL_R, GRAVITY, type Vec2, type Vec3 } from './field';

/** One piece of the ball's flight, valid for clip time t0..t1. */
export interface Segment {
  t0: number;
  t1: number;
  at(t: number): Vec3;
}

/** Fly from p0 to p1 in T seconds under gravity (straight line over the ground, parabola in height). */
export function ballistic(t0: number, p0: Vec3, p1: Vec3, T: number): Segment {
  const vy = (p1.y - p0.y + 0.5 * GRAVITY * T * T) / T;
  return {
    t0,
    t1: t0 + T,
    at(t) {
      const tau = Math.min(Math.max(t - t0, 0), T);
      const u = tau / T;
      return { x: p0.x + (p1.x - p0.x) * u, y: p0.y + vy * tau - 0.5 * GRAVITY * tau * tau, z: p0.z + (p1.z - p0.z) * u };
    },
  };
}

/** Vertical speed at the start of a ballistic flight (for apex/height checks). */
export const launchVy = (p0: Vec3, p1: Vec3, T: number) => (p1.y - p0.y + 0.5 * GRAVITY * T * T) / T;

/** Roll along the ground from p0 in direction dir, starting at speed v0 and slowing at dec, stopping after maxS metres. */
export function roll(t0: number, p0: Vec2, dir: Vec2, v0: number, dec: number, maxS = Infinity): Segment {
  const tStop = v0 / dec;
  const sStop = Math.min((v0 * v0) / (2 * dec), maxS);
  return {
    t0,
    t1: t0 + tStop,
    at(t) {
      const tau = Math.min(Math.max(t - t0, 0), tStop);
      const s = Math.min(v0 * tau - 0.5 * dec * tau * tau, sStop);
      return { x: p0.x + dir.x * s, y: BALL_R, z: p0.z + dir.z * s };
    },
  };
}

/** Stay at p from t0 on. */
export const rest = (t0: number, p: Vec3): Segment => ({ t0, t1: Infinity, at: () => ({ ...p }) });

/** A whole flight: the segment for time t (before the first: its start; after the last: its end). */
export function path(segments: Segment[]): (t: number) => Vec3 {
  return (t) => {
    if (t <= segments[0].t0) return segments[0].at(segments[0].t0);
    for (const s of segments) if (t <= s.t1) return s.at(t);
    const last = segments[segments.length - 1];
    return last.at(last.t1);
  };
}

/** Speed (m/s) on the ground at time t of a roll segment that started at v0. */
export const rollSpeedAt = (v0: number, dec: number, tau: number) => Math.max(0, v0 - dec * tau);
