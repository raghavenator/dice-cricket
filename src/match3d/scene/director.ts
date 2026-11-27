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

  if (plan && flight && t > C) {
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
        target.lerp(lagged, k);
        pos.lerp(new THREE.Vector3(lagged.x * 0.45, 22, lagged.z * 0.45 + 30), k * 0.85);
        break;
      }
      case 'wide': {
        if (t > C + 0.2) {
          const d = plan.hit ? dirOf(plan.hit.theta) : { x: 0, z: 1 };
          pos.set(HIT_ORIGIN.x - d.x * 26, 34, HIT_ORIGIN.z - d.z * 26);
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
      case 'stumps': {
        if (t > C) {
          pos.set(2.4, 1.3, -6.2);
          target.set(0, 0.45, -STUMPS_Z);
        }
        break;
      }
      case 'umpire': {
        if (t > C + 0.3) {
          pos.set(1.6, 2.0, -5.5);
          target.set(0.35, 1.5, 11.6);
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
