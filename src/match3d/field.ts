/**
 * Ground geometry for the 3D clips (metres). Same axes as the prototype:
 * the striker's end is at z = -10.06, the bowler's end at z = +10.06, +y is up.
 * The striker is right-handed, so +x is the leg side and -x the off side.
 *
 * Shot angles are measured at the striker in the ground plane: 0 = straight back past the bowler (+z),
 * positive towards the leg side (+x). Direction = (sin θ, cos θ) in (x, z).
 */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}
export interface Vec2 {
  x: number;
  z: number;
}

export const STUMPS_Z = 10.06;
export const BALL_R = 0.05;
export const GRAVITY = 9.8;
/** Boundary rope: a circle around the middle of the pitch. */
export const BOUNDARY_R = 64;
/** Where shots start from (in front of the striker's popping crease). */
export const HIT_ORIGIN: Vec2 = { x: 0.3, z: -8.9 };
/** Shots never go into this cone either side of straight back at the keeper. */
export const KEEPER_CONE_DEG = 25;
export const MAX_SHOT_ANGLE = Math.PI - (KEEPER_CONE_DEG * Math.PI) / 180;

export const deg = (d: number) => (d * Math.PI) / 180;
export const dirOf = (theta: number): Vec2 => ({ x: Math.sin(theta), z: Math.cos(theta) });
export const angleOf = (from: Vec2, to: Vec2) => Math.atan2(to.x - from.x, to.z - from.z);
export const dist2 = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.z - b.z);
export const along = (from: Vec2, theta: number, d: number): Vec2 => {
  const u = dirOf(theta);
  return { x: from.x + u.x * d, z: from.z + u.z * d };
};

/** Distance from `from` to the rope along angle θ. */
export function boundaryDistance(theta: number, from: Vec2 = HIT_ORIGIN): number {
  const u = dirOf(theta);
  const b = from.x * u.x + from.z * u.z;
  const c = from.x * from.x + from.z * from.z - BOUNDARY_R * BOUNDARY_R;
  return -b + Math.sqrt(b * b - c);
}

export interface FieldPosition {
  name: string;
  /** Angle from HIT_ORIGIN, as for shots. */
  theta: number;
  /** Distance from HIT_ORIGIN. */
  r: number;
  ring: 'inner' | 'outer';
}

/** The nine fielders besides the bowler and the keeper. */
export const FIELD_POSITIONS: readonly FieldPosition[] = [
  { name: 'third man', theta: deg(-148), r: 56, ring: 'outer' },
  { name: 'point', theta: deg(-96), r: 23, ring: 'inner' },
  { name: 'cover', theta: deg(-58), r: 27, ring: 'inner' },
  { name: 'mid-off', theta: deg(-17), r: 26, ring: 'inner' },
  { name: 'mid-on', theta: deg(17), r: 26, ring: 'inner' },
  { name: 'midwicket', theta: deg(58), r: 27, ring: 'inner' },
  { name: 'square leg', theta: deg(100), r: 22, ring: 'inner' },
  { name: 'deep midwicket', theta: deg(66), r: 58, ring: 'outer' },
  { name: 'fine leg', theta: deg(146), r: 56, ring: 'outer' },
];

export const fieldSpot = (p: FieldPosition): Vec2 => along(HIT_ORIGIN, p.theta, p.r);
export const KEEPER_SPOT: Vec2 = { x: -0.15, z: -12.6 };
/** Keeper's gloves, where a missed or left ball ends up. */
export const KEEPER_GLOVES: Vec3 = { x: -0.3, y: 0.7, z: -12.4 };
/** Bowler in follow-through, for caught-and-bowled. */
export const BOWLER_FOLLOW: Vec3 = { x: -1.7, y: 1.2, z: 7.2 };

/** Index of the fielder closest to a point. */
export function nearestFielder(p: Vec2): number {
  let best = 0;
  FIELD_POSITIONS.forEach((f, i) => {
    if (dist2(fieldSpot(f), p) < dist2(fieldSpot(FIELD_POSITIONS[best]), p)) best = i;
  });
  return best;
}

/** Nominal points used when the scene hasn't measured the real ones (and in tests). */
export const NOMINAL = {
  release: { x: -0.6, y: 2.2, z: 9.0 } as Vec3,
  contact: { x: 0.25, y: 0.45, z: -8.7 } as Vec3,
  stumpsHit: { x: 0, y: 0.4, z: -STUMPS_Z } as Vec3,
  pad: { x: 0.15, y: 0.35, z: -9.0 } as Vec3,
};
