import * as THREE from 'three';
import { HIT_ORIGIN, type Vec3 } from '../field';
import type { DeliveryPlan } from '../plan';
import { CLIP, RESULT } from '../timing';
import { keyedQ, qToe, setBat } from './bat';
import type { Cast } from './cast';
import {
  P_APPEAL, P_BACKLIFT, P_BLOCK, P_CATCH, P_CELEBRATE, P_CONTACT, P_DEJECTED, P_DESPAIR, P_DRIVE, P_FLICK, P_FOLLOW, P_GATHER, P_KEEPER, P_KEEP_UP,
  P_LEAVE, P_LOAD, P_NS, P_PICKUP, P_READY, P_REACH, P_RELEASE, P_STANCE, P_STAND_BAT, P_STRIDE, P_UMPIRE, P_UMPIRE_OUT,
} from './poses';
import { angDiff, applyPose, clamp01, keyed, lerpPose, runPose, smooth, STRIDE, type Player, type Pose } from './rig';
import { breakWicket, resetWicket, type Wicket } from './stage';

/**
 * Poses every player, the bat and the ball for clip time t. A pure function of (plan, t):
 * the same t always gives the same frame, so skipping and pausing are free.
 */
const C = CLIP.contact;
const v1 = new THREE.Vector3();
const v2 = new THREE.Vector3();
const q = new THREE.Quaternion();

// ---- bowler: the prototype's action, entered late in the run-up and slightly quicker ----
const OLD_RELEASE = 2.315;
const OLD_START = 1.1;
const oldTime = (t: number) =>
  t < CLIP.release ? OLD_START + (t * (OLD_RELEASE - OLD_START)) / CLIP.release : OLD_RELEASE + (t - CLIP.release);
const BZ0 = 18.5;

function bowlerAt(P: Player, plan: DeliveryPlan | null, t: number) {
  const T = oldTime(t);
  let pose: Pose;
  let x = -0.75;
  let z: number;
  let ry = Math.PI;
  if (T < 1.5) {
    z = BZ0 + (13.4 - BZ0) * (T / 1.5);
    pose = runPose((BZ0 - z) * STRIDE);
  } else if (T < 2.0) {
    const u = (T - 1.5) / 0.5;
    z = 13.4 - 2.0 * u;
    pose = lerpPose(runPose((BZ0 - 13.4) * STRIDE), P_GATHER, smooth(clamp01(u * 2)));
    pose.lift = (pose.lift || 0) + 0.35 * Math.sin(Math.PI * u);
  } else if (T < 2.45) {
    const u = (T - 2.0) / 0.45;
    z = 11.4 - 1.8 * (1 - (1 - u) * (1 - u));
    pose = keyed([[0, P_GATHER], [0.35, P_LOAD], [0.7, P_RELEASE], [1, P_FOLLOW]], u, false);
  } else {
    const u = clamp01((T - 2.45) / 1.35);
    const e = 1 - (1 - u) * (1 - u);
    z = 9.6 - 3.0 * e;
    x = -0.75 - 1.4 * e;
    ry = Math.PI + 0.44 * smooth(clamp01(u * 3));
    pose = lerpPose(P_FOLLOW, runPose(3.3 * e * STRIDE, 1 - u), smooth(clamp01(u * 4)));
  }
  if (plan) {
    const after = t - C;
    if (plan.kind === 'caught' && plan.cAndB && plan.hit?.type === 'catch') {
      // Caught and bowled: move under the return catch and take it.
      const catchT = C + plan.hit.flight;
      const k = smooth(clamp01((t - (C + 0.1)) / (plan.hit.flight - 0.1)));
      x += (plan.hit.catchAt.x - x) * k;
      z += (plan.hit.catchAt.z + 0.45 - z) * k;
      ry += angDiff(ry, Math.PI) * k;
      pose = lerpPose(pose, P_CATCH, k);
      pose = lerpPose(pose, P_CELEBRATE, smooth(clamp01((t - catchT - 0.3) / 0.35)));
    } else if (plan.kind === 'lbw' || plan.kind === 'bowled' || plan.kind === 'caught') {
      const appeal = plan.kind === 'lbw' ? P_APPEAL : P_CELEBRATE;
      pose = lerpPose(pose, appeal, smooth(clamp01((after - 0.15) / 0.35)));
    } else if (plan.survive === 'beaten' || plan.survive === 'edgePad') {
      pose = lerpPose(pose, P_DESPAIR, smooth(clamp01((after - 0.2) / 0.35)));
    }
  }
  P.root.position.set(x, 0, z);
  P.root.rotation.y = ry;
  applyPose(P, pose);
}

// ---- striker ----
const S_FROM = new THREE.Vector3(0.4, 0, -9.2);
const S_TO = new THREE.Vector3(-1.1, 0, 8.2);
const S_ROT = -Math.PI / 2 + 0.2;
const N_FROM = new THREE.Vector3(2.1, 0, 8.7);
const N_TO = new THREE.Vector3(1.6, 0, -8.2);
const N_ROT = Math.PI + 0.15;
const N_IDLE_Q = qToe(0.45, -0.85, -0.3);
const Q_STANCE = qToe(0.05, -1, -0.2);
const Q_BACKLIFT = qToe(0.1, 0.5, -0.86);
const Q_STRIDE = qToe(0, 0.75, -0.66);
const Q_CONTACT = qToe(-0.1, -0.95, 0.25);
const Q_FLICK = qToe(0.55, 0.5, 0.67);
const Q_DRIVE = qToe(0.35, 0.85, -0.35);
const Q_LEAVE = qToe(0.3, 0.9, -0.2);
const Q_BLOCK = qToe(-0.25, -0.9, 0.35);

/** The striker's swing for this plan: [pose keys, bat keys]. */
function swing(plan: DeliveryPlan | null): [[number, Pose][], [number, THREE.Quaternion][]] {
  if (plan?.kind === 'lbw') {
    // Pads up: front leg across, bat held high, no shot.
    const pad = lerpPose(P_STRIDE, P_BACKLIFT, 0.5);
    return [
      [[0, P_STANCE], [C - 0.85, P_STANCE], [C - 0.3, P_BACKLIFT], [C - 0.05, pad], [C + 0.6, pad]],
      [[0, Q_STANCE], [C - 0.85, Q_STANCE], [C - 0.3, Q_BACKLIFT], [C - 0.05, Q_STRIDE], [C + 0.6, Q_STRIDE]],
    ];
  }
  if (plan?.kind === 'bowled') {
    // Too late: the bat is still coming down as the ball hits the stumps.
    const late = 0.14;
    return [
      [[0, P_STANCE], [C - 0.85, P_STANCE], [C - 0.3 + late, P_BACKLIFT], [C - 0.12 + late, P_STRIDE], [C + late, P_CONTACT], [C + 0.27 + late, P_DRIVE], [C + 0.6, P_DRIVE]],
      [[0, Q_STANCE], [C - 0.85, Q_STANCE], [C - 0.3 + late, Q_BACKLIFT], [C - 0.12 + late, Q_STRIDE], [C + late, Q_CONTACT], [C + 0.27 + late, Q_DRIVE], [C + 0.6, Q_DRIVE]],
    ];
  }
  if (plan?.survive === 'beaten' || plan?.survive === 'edgePad') {
    // Forward push (play and miss) or a defensive block (inside edge onto the pad): short, no follow-through.
    const end = plan.survive === 'edgePad' ? P_BLOCK : P_CONTACT;
    const qEnd = plan.survive === 'edgePad' ? Q_BLOCK : Q_CONTACT;
    return [
      [[0, P_STANCE], [C - 0.85, P_STANCE], [C - 0.3, P_BACKLIFT], [C - 0.12, P_STRIDE], [C, end], [C + 0.6, end]],
      [[0, Q_STANCE], [C - 0.85, Q_STANCE], [C - 0.3, Q_BACKLIFT], [C - 0.12, Q_STRIDE], [C, qEnd], [C + 0.6, qEnd]],
    ];
  }
  if (plan?.survive === 'leave') {
    return [
      [[0, P_STANCE], [C - 0.85, P_STANCE], [C - 0.3, P_BACKLIFT], [C - 0.12, P_STRIDE], [C + 0.05, P_LEAVE], [C + 0.6, P_LEAVE]],
      [[0, Q_STANCE], [C - 0.85, Q_STANCE], [C - 0.3, Q_BACKLIFT], [C - 0.12, Q_STRIDE], [C + 0.05, Q_LEAVE], [C + 0.6, Q_LEAVE]],
    ];
  }
  const leg = plan?.hit ? plan.hit.theta > 0.35 : false;
  const finish = leg ? P_FLICK : P_DRIVE;
  const qFinish = leg ? Q_FLICK : Q_DRIVE;
  return [
    [[0, P_STANCE], [C - 0.85, P_STANCE], [C - 0.3, P_BACKLIFT], [C - 0.12, P_STRIDE], [C, P_CONTACT], [C + 0.27, finish], [C + 0.5, finish]],
    [[0, Q_STANCE], [C - 0.85, Q_STANCE], [C - 0.3, Q_BACKLIFT], [C - 0.12, Q_STRIDE], [C, Q_CONTACT], [C + 0.27, qFinish], [C + 0.5, qFinish]],
  ];
}

/** Run a batter from one end to the other between r0 and r1, grounding the bat at the end. */
function runner(P: Player, bat: THREE.Group, t: number, from: THREE.Vector3, to: THREE.Vector3, rot0: number, startPose: Pose, startQ: THREE.Quaternion, r0: number, r1: number) {
  const d = v2.copy(to).sub(from);
  const L = d.length();
  d.divideScalar(L);
  const runRot = Math.atan2(d.x, d.z);
  const u = clamp01((t - r0) / (r1 - r0));
  const e = 0.5 * u + 0.5 * smooth(u);
  const bi = smooth(clamp01((t - r0) / 0.25));
  const bo = smooth(clamp01((u - 0.82) / 0.18));
  P.root.position.copy(from).addScaledVector(d, L * e);
  P.root.rotation.y = rot0 + angDiff(rot0, runRot) * bi;
  const ph = L * e * STRIDE;
  const rp = runPose(ph);
  rp.shRX = -0.35 - 0.2 * Math.sin(ph);
  rp.elR = -0.6;
  rp.shRZ = -0.12;
  applyPose(P, lerpPose(lerpPose(startPose, rp, bi), P_REACH, bo));
  P.root.updateMatrixWorld(true);
  q.slerpQuaternions(startQ, qToe(d.x * 0.5, -0.86, d.z * 0.5), bi).slerp(qToe(d.x * 0.8, -0.6, d.z * 0.8), bo);
  P.armR.hand.getWorldPosition(v1);
  setBat(bat, v1, q);
}

/** Sweet spot of the striker's bat this frame (written by strikerAt). */
export const sweetSpot = new THREE.Vector3();

function strikerAt(c: Cast, plan: DeliveryPlan | null, t: number) {
  const P = c.striker;
  const [poses, bats] = swing(plan);
  const runs = plan?.kind === 'ground';
  const r0 = C + 0.4;
  if (runs && t >= r0) {
    runner(P, c.strikerBat, t, S_FROM, S_TO, S_ROT, poses[poses.length - 1][1], bats[bats.length - 1][1], r0, r0 + 2.0);
    return;
  }
  P.root.position.copy(S_FROM);
  P.root.rotation.y = S_ROT;
  let pose = keyed(poses, t);
  if (plan && plan.kind !== 'ground') {
    const out = plan.kind === 'bowled' || plan.kind === 'lbw' || plan.kind === 'caught';
    const settle = out ? RESULT[plan.kind] - 0.1 : C + 1.0;
    pose = lerpPose(pose, out ? P_DEJECTED : P_STAND_BAT, smooth(clamp01((t - settle) / 0.5)));
  }
  applyPose(P, pose);
  P.root.updateMatrixWorld(true);
  P.armL.hand.getWorldPosition(v1);
  P.armR.hand.getWorldPosition(v2);
  const up = setBat(c.strikerBat, v1.add(v2).multiplyScalar(0.5), keyedQ(bats, t, q));
  sweetSpot.copy(c.strikerBat.position).addScaledVector(up, 0.2);
}

function nonStrikerAt(c: Cast, plan: DeliveryPlan | null, t: number) {
  const P = c.nonStriker;
  const r0 = C + 0.4;
  if (plan?.kind === 'ground' && t >= r0) {
    runner(P, c.nonStrikerBat, t, N_FROM, N_TO, N_ROT, P_NS, N_IDLE_Q, r0, r0 + 2.0);
    return;
  }
  let z = 9.4;
  let pose = P_NS;
  const b0 = CLIP.release - 0.25;
  if (t >= b0) {
    const u = clamp01((t - b0) / 0.7);
    z = 9.4 - 0.7 * smooth(u);
    pose = lerpPose(P_NS, runPose(0.7 * smooth(u) * STRIDE * 1.5, 0.4), Math.sin(Math.PI * u));
  }
  P.root.position.set(2.1, 0, z);
  P.root.rotation.y = N_ROT;
  applyPose(P, pose);
  P.root.updateMatrixWorld(true);
  P.armR.hand.getWorldPosition(v1);
  setBat(c.nonStrikerBat, v1, N_IDLE_Q);
}

function keeperAt(P: Player, plan: DeliveryPlan | null, t: number) {
  const gather = plan?.kind === 'survive' && plan.survive !== 'edgePad';
  const up = smooth(clamp01((t - (C - (gather ? 0.1 : -0.05))) / (gather ? 0.25 : 0.5)));
  applyPose(P, lerpPose(P_KEEPER, P_KEEP_UP, up));
}

function umpireAt(P: Player, plan: DeliveryPlan | null, t: number) {
  const finger = plan?.kind === 'lbw' ? smooth(clamp01((t - (RESULT.lbw - 0.35)) / 0.25)) : 0;
  applyPose(P, lerpPose(P_UMPIRE, P_UMPIRE_OUT, finger));
}

/** Where the hands are, relative to the feet, in the catching pose facing ry. */
function handsOffset(P: Player, ry: number): THREE.Vector3 {
  P.root.position.set(0, 0, 0);
  P.root.rotation.y = ry;
  applyPose(P, P_CATCH);
  P.root.updateMatrixWorld(true);
  const a = P.armL.hand.getWorldPosition(new THREE.Vector3());
  const b = P.armR.hand.getWorldPosition(new THREE.Vector3());
  return a.add(b).multiplyScalar(0.5);
}

/** The one fielder who moves: chases a ground shot or takes a catch. */
function fielderAt(c: Cast, plan: DeliveryPlan | null, flight: ((t: number) => Vec3) | null, spots: THREE.Vector3[], t: number) {
  const idx = plan?.fielder ?? null;
  c.lite.forEach((g, i) => (g.visible = i !== idx));
  const P = c.fielder;
  if (!plan || !flight || idx === null || idx < 0) {
    P.root.visible = false;
    return;
  }
  P.root.visible = true;
  const start = spots[idx];
  const face = Math.atan2(HIT_ORIGIN.x - start.x, HIT_ORIGIN.z - start.z);
  let pos = v1.copy(start);
  let ry = face;
  let pose: Pose = P_READY;

  if (plan.hit?.type === 'catch') {
    const ct = plan.hit.catchAt;
    const toStriker = new THREE.Vector3(HIT_ORIGIN.x - ct.x, 0, HIT_ORIGIN.z - ct.z).normalize();
    // Stand so the hands (in the catching pose) are where the ball arrives.
    const hands = handsOffset(P, Math.atan2(toStriker.x, toStriker.z));
    const end = new THREE.Vector3(ct.x - hands.x, 0, ct.z - hands.z);
    const k = smooth(clamp01((t - C) / (plan.hit.flight - 0.05)));
    pos = v1.copy(start).lerp(end, k);
    const moving = k > 0 && k < 1;
    pose = moving ? lerpPose(P_READY, runPose((t - C) * 9, 0.6), 0.8) : P_READY;
    pose = lerpPose(pose, P_CATCH, smooth(clamp01((t - (C + plan.hit.flight - 0.3)) / 0.3)));
    pose = lerpPose(pose, P_CELEBRATE, smooth(clamp01((t - (C + plan.hit.flight + 0.3)) / 0.35)));
    ry = Math.atan2(toStriker.x, toStriker.z);
  } else {
    // Chase: run at the ball's resting point (or where it crosses the rope) and stop just short.
    const goal = flight(12);
    const g = new THREE.Vector3(goal.x, 0, goal.z);
    const total = Math.max(0, start.distanceTo(g) - 0.8);
    const dir = g.clone().sub(start).normalize();
    const run = Math.max(0, t - (C + 0.2));
    const s = Math.min(total, run * 6.5);
    pos = v1.copy(start).addScaledVector(dir, s);
    const arrived = s >= total - 1e-6 && total > 0;
    ry = face + angDiff(face, Math.atan2(dir.x, dir.z)) * smooth(clamp01(run / 0.25));
    pose = run > 0 && !arrived ? runPose(s * STRIDE) : arrived && plan.kind === 'ground' ? P_PICKUP : P_READY;
  }
  P.root.position.copy(pos);
  P.root.rotation.y = ry;
  applyPose(P, pose);
}

export interface Scene3d {
  cast: Cast;
  wicket: Wicket;
  spots: THREE.Vector3[];
}

/** Pose everything for clip time t. */
export function poseAt(s: Scene3d, plan: DeliveryPlan | null, flight: ((t: number) => Vec3) | null, t: number) {
  const c = s.cast;
  bowlerAt(c.bowler, plan, t);
  strikerAt(c, plan, t);
  nonStrikerAt(c, plan, t);
  keeperAt(c.keeper, plan, t);
  umpireAt(c.umpire, plan, t);
  fielderAt(c, plan, flight, s.spots, t);
  if (plan?.kind === 'bowled') breakWicket(s.wicket, t - C);
  else resetWicket(s.wicket);

  c.bowler.root.updateMatrixWorld(true);
  const inHand = !flight || t < CLIP.release;
  if (inHand) c.bowler.armR.hand.getWorldPosition(c.ball.position);
  else {
    const p = flight(t);
    c.ball.position.set(p.x, p.y, p.z);
  }
  c.trail.forEach((g, i) => {
    const tt = t - (i + 1) * 0.025;
    g.visible = !!flight && tt > CLIP.release && tt < C + 1.4;
    if (g.visible && flight) {
      const p = flight(tt);
      g.position.set(p.x, p.y, p.z);
    }
  });
}
