import * as THREE from 'three';
import { HIT_ORIGIN, STUMPS_Z, dirOf, type Vec3 } from '../field';
import type { DeliveryPlan } from '../plan';
import { CLIP } from '../timing';
import { clamp01, smooth } from './rig';

/**
 * Camera shots as a pure function of clip time, so skipping to any moment shows the same frame.
 * Before contact it's always the broadcast camera behind the bowler; after contact, the plan's shot.
 */
const BROADCAST_POS = new THREE.Vector3(0.6, 8, 24);
const BROADCAST_TARGET = new THREE.Vector3(0, 0, 4);
/** Horizontal field of view to keep on any screen shape, and the vertical limits. */
const HFOV = 44;
const VFOV_MIN = 30;
const VFOV_MAX = 62;

const v = (p: Vec3) => new THREE.Vector3(p.x, p.y, p.z);
const tmpA = new THREE.Vector3();
const tmpB = new THREE.Vector3();

export function fovFor(aspect: number) {
  const vf = (2 * Math.atan(Math.tan(((HFOV / 2) * Math.PI) / 180) / Math.max(aspect, 0.1)) * 180) / Math.PI;
  return Math.min(VFOV_MAX, Math.max(VFOV_MIN, vf));
}

export function aimCamera(cam: THREE.PerspectiveCamera, plan: DeliveryPlan | null, flight: ((t: number) => Vec3) | null, t: number, aspect: number) {
  const fov = fovFor(aspect);
  // Narrow screens: pull back a little so the striker's end still fits.
  const back = aspect < 1 ? 1 + (1 - aspect) * 0.35 : 1;
  const pos = tmpA.copy(BROADCAST_POS).sub(BROADCAST_TARGET).multiplyScalar(back).add(BROADCAST_TARGET);
  const target = tmpB.copy(BROADCAST_TARGET);
  const C = CLIP.contact;

  // Bowled: cut to the stumps just before the ball arrives, so the hit is seen.
  if (plan?.camera === 'stumps' && t > C - 0.12) {
    pos.set(-2.7, 0.9, -7.4);
    target.set(0, 0.4, -STUMPS_Z);
  } else if (plan && flight && t > C) {
    const ball = v(flight(t));
    const lagged = v(flight(Math.max(C, t - 0.15)));
    const k = smooth(clamp01((t - C) / 0.45));
    switch (plan.camera) {
      case 'broadcast': {
        // Gentle pan towards the ball.
        target.lerp(lagged.setY(0), 0.35 * k);
        break;
      }
      case 'follow': {
        // Rise up behind the striker, looking down the line of the shot: ball, chaser and rope in frame.
        const d = plan.hit ? dirOf(plan.hit.theta) : { x: 0, z: 1 };
        const behind = new THREE.Vector3(HIT_ORIGIN.x - d.x * 16, 15, HIT_ORIGIN.z - d.z * 16);
        pos.lerp(behind, k);
        target.lerp(lagged.setY(Math.min(lagged.y, 2)), k);
        break;
      }
      case 'wide': {
        // Cut to a high wide shot that tracks the ball over the rope.
        if (t > C + 0.2) {
          const d = plan.hit ? dirOf(plan.hit.theta) : { x: 0, z: 1 };
          const side = { x: d.z, z: -d.x };
          pos.set(HIT_ORIGIN.x - d.x * 22 + side.x * 10, 30, HIT_ORIGIN.z - d.z * 22 + side.z * 10);
          target.copy(lagged);
        }
        break;
      }
      case 'catch': {
        if (t > C + 0.25 && plan.hit?.type === 'catch') {
          const c = plan.hit.catchAt;
          const mid = new THREE.Vector3((c.x + HIT_ORIGIN.x) / 2, 0, (c.z + HIT_ORIGIN.z) / 2);
          const side = new THREE.Vector3(-(c.z - HIT_ORIGIN.z), 0, c.x - HIT_ORIGIN.x).normalize();
          const span = Math.hypot(c.x - HIT_ORIGIN.x, c.z - HIT_ORIGIN.z);
          pos.copy(mid).addScaledVector(side, Math.max(10, span * 0.9)).setY(6 + span * 0.15);
          target.copy(ball).lerp(v(c), 0.5);
        }
        break;
      }
      case 'umpire': {
        // Close on the umpire (facing the striker) for the decision.
        if (t > C + 0.3) {
          pos.set(1.3, 1.8, 7.6);
          target.set(0.35, 1.45, 11.6);
        }
        break;
      }
    }
  }
  cam.position.copy(pos);
  if (cam.fov !== fov || cam.aspect !== aspect) {
    cam.fov = fov;
    cam.aspect = aspect;
    cam.updateProjectionMatrix();
  }
  cam.lookAt(target);
}
