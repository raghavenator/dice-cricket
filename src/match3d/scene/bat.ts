import * as THREE from 'three';
import { addMesh, type Kit } from './kit';
import { smooth } from './rig';

const Y = new THREE.Vector3(0, 1, 0);

/** Rotation for a bat whose toe points along (x, y, z) from the grip. */
export const qToe = (x: number, y: number, z: number) =>
  new THREE.Quaternion().setFromUnitVectors(Y, new THREE.Vector3(-x, -y, -z).normalize());

export function keyedQ(keys: [number, THREE.Quaternion][], t: number, out = new THREE.Quaternion()) {
  if (t <= keys[0][0]) return out.copy(keys[0][1]);
  for (let i = 0; i < keys.length - 1; i++) {
    const [t0, a] = keys[i];
    const [t1, b] = keys[i + 1];
    if (t <= t1) return out.slerpQuaternions(a, b, smooth((t - t0) / (t1 - t0)));
  }
  return out.copy(keys[keys.length - 1][1]);
}

export function makeBat(kit: Kit, parent: THREE.Object3D): THREE.Group {
  const g = new THREE.Group();
  const wood = kit.mat('bat-wood', 0xe3cf9e, 0.55);
  const grip = kit.mat('bat-grip', 0x222222, 0.8);
  addMesh(g, kit.box, wood, [0, 0.29, 0], [0.108, 0.56, 0.045]);
  addMesh(g, kit.box, wood, [0, 0.25, -0.025], [0.06, 0.4, 0.03]);
  addMesh(g, kit.capsule(0.016, 0.26), grip, [0, 0.72, 0]);
  parent.add(g);
  return g;
}

const u = new THREE.Vector3();
/** Place the bat with its grip at `grip`, rotated by q. Returns the bat's up direction (toe → handle). */
export function setBat(bat: THREE.Object3D, grip: THREE.Vector3, q: THREE.Quaternion): THREE.Vector3 {
  u.copy(Y).applyQuaternion(q);
  bat.quaternion.copy(q);
  bat.position.copy(grip).addScaledVector(u, -0.74);
  return u;
}
