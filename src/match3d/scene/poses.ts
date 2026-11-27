import type { Pose } from './rig';

// Joint-angle poses, from the prototype unless marked new. Right-arm bowler over the wicket, right-handed batters.

// ---- bowler: the bowling arm's shRX increases through the action ----
export const P_GATHER: Pose = { hipLX: -1.2, kneeL: 1.5, hipRX: 0.25, kneeR: 0.6, toeR: 0.4, torsoX: -0.05, torsoY: -0.6, hipTwist: -0.35, headY: 0.85,
  shLX: -2.6, shLZ: 0.1, elL: -0.4, shRX: -1.3, shRZ: 0.25, elR: -1.9 };
export const P_LOAD: Pose = { hipLX: -0.8, kneeL: 0.4, hipRX: 0.3, kneeR: 0.5, torsoX: -0.15, torsoY: -0.9, hipTwist: -0.5, headY: 1.2,
  shLX: -2.9, shLZ: 0.2, elL: 0, shRX: 0.6, shRZ: -0.1, elR: 0 };
export const P_RELEASE: Pose = { hipLX: -0.6, kneeL: 0.1, hipRX: 0.55, kneeR: 0.3, toeR: 0.5, torsoX: 0.35, torsoY: -0.1, hipTwist: -0.15, headY: 0.2,
  shLX: -0.3, shLZ: 0.4, elL: -0.6, shRX: Math.PI + 0.3, shRZ: -0.1, elR: 0 };
export const P_FOLLOW: Pose = { hipLX: -0.4, kneeL: 0.35, hipRX: 0.9, kneeR: 0.9, torsoX: 0.75, torsoY: 0.5, hipTwist: 0.2, headX: -0.3, headY: -0.3,
  shLX: 0.5, shLZ: 0.3, elL: -0.5, shRX: 2 * Math.PI + 0.4, shRZ: 0.5, elR: -0.2 };
/** New: both arms up, appealing. */
export const P_APPEAL: Pose = { hipLX: -0.2, kneeL: 0.2, hipRX: 0.2, kneeR: 0.2, torsoX: -0.1, headX: -0.25,
  shLX: -2.7, shLZ: 0.35, elL: -0.2, shRX: -2.7, shRZ: -0.35, elR: -0.2 };
/** New: catching ball at chest height, hands together in front. */
export const P_CATCH: Pose = { hipLX: -0.45, hipRX: -0.45, kneeL: 0.6, kneeR: 0.6, torsoX: 0.25, headX: 0.1,
  shLX: -1.35, shRX: -1.35, shLZ: -0.25, shRZ: 0.25, elL: -0.5, elR: -0.5 };
/** New: celebration, one arm punched up. */
export const P_CELEBRATE: Pose = { hipLX: -0.1, hipRX: 0.1, torsoX: -0.1, headX: -0.3,
  shRX: -2.9, shRZ: -0.2, elR: -0.1, shLX: -0.3, shLZ: 0.4, elL: -1.2 };
/** New: fielder ready, crouched a little. */
export const P_READY: Pose = { hipLX: -0.35, hipRX: -0.35, kneeL: 0.55, kneeR: 0.55, hipLZ: 0.15, hipRZ: -0.15, torsoX: 0.35, headX: -0.25,
  shLX: -0.4, shRX: -0.4, shLZ: 0.2, shRZ: -0.2, elL: -0.6, elR: -0.6 };
/** New: bending to pick the ball up. */
export const P_PICKUP: Pose = { hipLX: -1.1, hipRX: 0.2, kneeL: 1.2, kneeR: 0.5, torsoX: 1.0, headX: -0.4,
  shRX: -1.4, shRZ: 0.05, elR: -0.1, shLX: -0.4, shLZ: 0.2, elL: -0.6 };

// ---- striker ----
export const P_STANCE: Pose = { hipLZ: 0.17, hipRZ: -0.17, hipLX: -0.28, hipRX: -0.28, kneeL: 0.5, kneeR: 0.5, torsoX: 0.38, torsoY: 0.15, headY: 1.15, headX: -0.3,
  shLX: -0.55, shRX: -0.55, shLZ: -0.28, shRZ: 0.28, elL: -0.45, elR: -0.45 };
export const P_BACKLIFT: Pose = { hipLZ: 0.2, hipRZ: -0.17, hipLX: -0.4, kneeL: 0.7, hipRX: -0.28, kneeR: 0.5, torsoX: 0.35, headY: 1.2, headX: -0.3,
  shLX: -1.1, shLZ: -0.7, elL: -0.4, shRX: -1.0, shRZ: -0.3, elR: -1.5 };
export const P_STRIDE: Pose = { hipLZ: 0.55, hipLX: -0.2, kneeL: 0.45, hipRZ: -0.15, kneeR: 0.35, torsoX: 0.5, torsoZ: -0.2, headY: 1.1, headX: -0.35,
  shLX: -1.0, shLZ: -0.6, elL: -0.3, shRX: -0.9, shRZ: -0.2, elR: -1.3 };
export const P_CONTACT: Pose = { hipLZ: 0.55, hipLX: -0.2, kneeL: 0.5, hipRZ: -0.15, kneeR: 0.35, torsoX: 0.55, torsoZ: -0.25, torsoY: 0.3, headY: 0.9, headX: -0.45,
  shLX: -0.45, shLZ: 0.15, elL: -0.1, shRX: -0.5, shRZ: 0.35, elR: -0.4 };
/** Leg-side finish (flick / pull). */
export const P_FLICK: Pose = { hipLZ: 0.55, hipLX: -0.2, kneeL: 0.5, hipRZ: -0.15, kneeR: 0.35, torsoX: 0.35, torsoY: 0.8, headY: 0.3, headX: -0.2,
  shLX: -1.3, shLZ: 0.5, elL: -0.9, shRX: -1.4, shRZ: 0.5, elR: -0.6 };
/** New: off-side / straight finish (drive), bat high. */
export const P_DRIVE: Pose = { hipLZ: 0.5, hipLX: -0.35, kneeL: 0.55, hipRZ: -0.15, kneeR: 0.3, torsoX: 0.3, torsoY: 0.1, headY: 0.9, headX: -0.2,
  shLX: -2.3, shLZ: -0.2, elL: -0.7, shRX: -2.1, shRZ: 0.1, elR: -0.9 };
/** New: shouldering arms (leave): bat held up high, out of the way. */
export const P_LEAVE: Pose = { hipLZ: 0.45, hipLX: -0.15, kneeL: 0.45, hipRZ: -0.15, kneeR: 0.35, torsoX: 0.3, torsoY: 0.2, headY: 1.0, headX: -0.4,
  shLX: -2.6, shLZ: -0.3, elL: -0.8, shRX: -2.5, shRZ: -0.1, elR: -1.0 };
export const P_REACH: Pose = { hipLX: -0.95, kneeL: 0.75, hipRX: 0.55, kneeR: 0.35, torsoX: 0.7, headX: -0.3,
  shRX: -1.35, shRZ: -0.1, elR: -0.05, shLX: 0.4, shLZ: 0.15, elL: -0.6 };
export const P_STAND_BAT: Pose = { hipLZ: 0.06, hipRZ: -0.06, shRZ: -0.15, shRX: -0.3, elR: -0.3, shLZ: 0.1, elL: -0.2 };
/** New: walking off, head down. */
export const P_DEJECTED: Pose = { hipLZ: 0.05, hipRZ: -0.05, torsoX: 0.15, headX: 0.45, shRX: -0.2, shRZ: -0.12, elR: -0.3, shLZ: 0.08, elL: -0.1 };

// ---- others ----
export const P_NS: Pose = { hipLZ: 0.08, hipRZ: -0.1, kneeL: 0.08, torsoX: 0.05, shRZ: -0.3, shRX: -0.35, elR: -0.25, shLZ: 0.12, shLX: 0.05, elL: -0.3 };
export const P_KEEPER: Pose = { hipLX: -1.45, hipRX: -1.45, kneeL: 2.3, kneeR: 2.3, hipLZ: 0.32, hipRZ: -0.32, torsoX: 0.6, headX: -0.5,
  shLX: -1.0, shRX: -1.0, shLZ: -0.12, shRZ: 0.12, elL: -0.25, elR: -0.25 };
export const P_KEEP_UP: Pose = { hipLX: -0.3, hipRX: -0.3, kneeL: 0.5, kneeR: 0.5, hipLZ: 0.15, hipRZ: -0.15, torsoX: 0.25, headY: -0.6,
  shLX: -0.5, shRX: -0.5, elL: -0.6, elR: -0.6 };
export const P_UMPIRE: Pose = { hipLZ: 0.06, hipRZ: -0.06, shLZ: 0.07, shRZ: -0.07, elL: -0.25, elR: -0.25, torsoX: 0.04 };
/** New: umpire's finger raised (right arm straight up). */
export const P_UMPIRE_OUT: Pose = { hipLZ: 0.06, hipRZ: -0.06, shLZ: 0.07, elL: -0.25, torsoX: -0.02, headX: -0.1,
  shRX: -2.95, shRZ: -0.05, elR: -0.05 };
