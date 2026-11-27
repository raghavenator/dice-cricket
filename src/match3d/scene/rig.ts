import * as THREE from 'three';
import { addMesh, canvasTexture, type Kit } from './kit';

/**
 * Low-poly capsule players with a jointed rig, ported from the prototype.
 * A pose is a flat set of joint angles. Local +z is the player's front, local +x the player's left.
 * Negative hip/shoulder X swings a limb forward; positive knee X bends the knee.
 */
export type Pose = Record<string, number>;

export interface Limb {
  sh: THREE.Group;
  el: THREE.Group;
  hand: THREE.Group;
}
export interface Leg {
  hp: THREE.Group;
  kn: THREE.Group;
  ft: THREE.Group;
}
export interface Player {
  root: THREE.Group;
  hips: THREE.Group;
  torso: THREE.Group;
  head: THREE.Group;
  armL: Limb;
  armR: Limb;
  legL: Leg;
  legR: Leg;
  /** Shirt number plate (its texture is swapped when numbers change). */
  numberPlate?: THREE.Mesh;
}

export interface PlayerLook {
  /** Material keys so a whole side can be recoloured at once. */
  shirt: THREE.Material;
  pants: THREE.Material;
  skin: THREE.ColorRepresentation;
  head: 'cap' | 'helmet' | 'umpire' | 'hair';
  headColor: THREE.ColorRepresentation;
  shoe?: THREE.ColorRepresentation;
  pads?: boolean;
  gloves?: 'bat' | 'keeper';
  number?: boolean;
}

export function makePlayer(kit: Kit, parent: THREE.Object3D, o: PlayerLook): Player {
  const skin = kit.mat(`skin:${o.skin}`, o.skin, 0.65);
  const shoe = kit.mat(`shoe:${o.shoe ?? 0xf0f0f0}`, o.shoe ?? 0xf0f0f0, 0.6);
  const glove = o.gloves ? kit.mat('glove', 0xf3f1ea, 0.7) : skin;
  const padMat = kit.mat('pad', 0xf4f4f0, 0.7);
  const metal = kit.mat('metal', 0x8c9196, 0.4);
  const hw = kit.mat(`hat:${o.headColor}`, o.headColor, 0.6);

  const root = new THREE.Group();
  const hips = new THREE.Group();
  root.add(hips);
  addMesh(hips, kit.capsule(0.12, 0.12), o.pants, [0, 0.02, 0], [1, 1, 0.85], [0, 0, Math.PI / 2]);
  const torso = new THREE.Group();
  torso.position.y = 0.07;
  hips.add(torso);
  addMesh(torso, kit.capsule(0.16, 0.3), o.shirt, [0, 0.28, 0], [1.3, 1, 0.8]);
  let numberPlate: THREE.Mesh | undefined;
  if (o.number) {
    numberPlate = addMesh(torso, plateGeo(kit), new THREE.MeshStandardMaterial({ transparent: true, roughness: 0.8 }), [0, 0.33, -0.131], [1, 1, 1], [0, Math.PI, 0], false);
    kit.own(numberPlate.material as THREE.Material);
    numberPlate.visible = false;
  }
  const neck = new THREE.Group();
  neck.position.y = 0.56;
  torso.add(neck);
  addMesh(neck, kit.capsule(0.05, 0.05), skin, [0, 0.03, 0]);
  const head = new THREE.Group();
  head.position.y = 0.1;
  head.rotation.order = 'YXZ';
  neck.add(head);
  addMesh(head, kit.sphere, skin, [0, 0.08, 0], [0.1, 0.118, 0.11]);
  if (o.head === 'cap') {
    addMesh(head, kit.dome, hw, [0, 0.1, 0], [0.112, 0.1, 0.118]);
    addMesh(head, kit.cyl, hw, [0, 0.1, 0.1], [0.1, 0.012, 0.09]);
  } else if (o.head === 'helmet') {
    addMesh(head, kit.dome, hw, [0, 0.06, -0.005], [0.13, 0.13, 0.138]);
    addMesh(head, kit.cyl, hw, [0, 0.07, 0.1], [0.11, 0.012, 0.08]);
    for (const y of [-0.02, 0.03]) addMesh(head, kit.box, metal, [0, y, 0.13], [0.19, 0.008, 0.008], [0, 0, 0], false);
    addMesh(head, kit.box, metal, [0, 0.005, 0.13], [0.008, 0.07, 0.008], [0, 0, 0], false);
  } else if (o.head === 'umpire') {
    addMesh(head, kit.cyl, hw, [0, 0.12, 0], [0.2, 0.012, 0.2]);
    addMesh(head, kit.cyl, hw, [0, 0.17, 0], [0.112, 0.09, 0.115]);
  } else {
    addMesh(head, kit.dome, hw, [0, 0.1, -0.005], [0.106, 0.085, 0.115]);
  }
  const arm = (side: number): Limb => {
    const sh = new THREE.Group();
    sh.position.set(0.22 * side, 0.5, 0);
    torso.add(sh);
    addMesh(sh, kit.capsule(0.055, 0.2), o.shirt, [0, -0.14, 0]);
    const el = new THREE.Group();
    el.position.y = -0.3;
    sh.add(el);
    addMesh(el, kit.capsule(0.045, 0.18), o.shirt, [0, -0.13, 0]);
    const hand = new THREE.Group();
    hand.position.y = -0.29;
    el.add(hand);
    addMesh(hand, kit.sphere, glove, [0, -0.02, 0], o.gloves === 'keeper' ? [0.075, 0.065, 0.09] : [0.05, 0.05, 0.055]);
    return { sh, el, hand };
  };
  const leg = (side: number): Leg => {
    const hp = new THREE.Group();
    hp.position.set(0.1 * side, -0.02, 0);
    hips.add(hp);
    addMesh(hp, kit.capsule(0.075, 0.3), o.pants, [0, -0.22, 0]);
    const kn = new THREE.Group();
    kn.position.y = -0.45;
    hp.add(kn);
    addMesh(kn, kit.capsule(0.06, 0.3), o.pants, [0, -0.21, 0]);
    if (o.pads) {
      addMesh(kn, kit.box, padMat, [0, -0.2, 0.045], [0.15, 0.5, 0.12]);
      addMesh(kn, kit.box, padMat, [0, 0.03, 0.06], [0.15, 0.13, 0.11]);
    }
    const ft = new THREE.Group();
    ft.position.y = -0.44;
    kn.add(ft);
    addMesh(ft, kit.box, shoe, [0, 0, 0.05], [0.1, 0.07, 0.26]);
    return { hp, kn, ft };
  };
  const P: Player = { root, hips, torso, head, armL: arm(1), armR: arm(-1), legL: leg(1), legR: leg(-1), numberPlate };
  parent.add(root);
  return P;
}

const plateGeo = (kit: Kit) => kit.memo('plate', () => kit.own(new THREE.PlaneGeometry(0.22, 0.22)));

/** Show a shirt number (one texture per number and colour, shared). */
export function setShirtNumber(kit: Kit, P: Player, n: number | null, color = '#f4d530') {
  if (!P.numberPlate) return;
  if (n == null) {
    P.numberPlate.visible = false;
    return;
  }
  const tex = kit.memo(`num:${n}/${color}`, () =>
    canvasTexture(kit, 128, 128, (g) => {
      g.font = 'bold 92px Arial, sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.lineWidth = 6;
      g.strokeStyle = 'rgba(0,0,0,0.35)';
      g.strokeText(String(n), 64, 70);
      g.fillStyle = color;
      g.fillText(String(n), 64, 70);
    }),
  );
  const m = P.numberPlate.material as THREE.MeshStandardMaterial;
  if (m.map !== tex) {
    m.map = tex;
    m.needsUpdate = true;
  }
  P.numberPlate.visible = tex !== null;
}

const gv = (s: Pose, k: string) => s[k] || 0;

export function applyPose(P: Player, s: Pose) {
  const drop = (sd: string) =>
    (0.45 * Math.cos(gv(s, 'hip' + sd + 'X')) + 0.44 * Math.cos(gv(s, 'hip' + sd + 'X') + gv(s, 'knee' + sd))) * Math.cos(gv(s, 'hip' + sd + 'Z'));
  P.hips.position.y = Math.max(drop('L'), drop('R')) + 0.055 + gv(s, 'lift');
  P.hips.rotation.set(0, gv(s, 'hipTwist'), 0);
  P.torso.rotation.set(gv(s, 'torsoX'), gv(s, 'torsoY'), gv(s, 'torsoZ'));
  P.head.rotation.set(gv(s, 'headX'), gv(s, 'headY'), 0);
  for (const [lg, sd] of [[P.legL, 'L'], [P.legR, 'R']] as const) {
    lg.hp.rotation.set(gv(s, 'hip' + sd + 'X'), 0, gv(s, 'hip' + sd + 'Z'));
    lg.kn.rotation.x = gv(s, 'knee' + sd);
    lg.ft.rotation.x = -(gv(s, 'hip' + sd + 'X') + gv(s, 'knee' + sd)) + gv(s, 'toe' + sd);
  }
  for (const [am, sd] of [[P.armL, 'L'], [P.armR, 'R']] as const) {
    am.sh.rotation.set(gv(s, 'sh' + sd + 'X'), 0, gv(s, 'sh' + sd + 'Z'));
    am.el.rotation.x = gv(s, 'el' + sd);
  }
}

export const smooth = (u: number) => u * u * (3 - 2 * u);
export const clamp01 = (u: number) => Math.max(0, Math.min(1, u));

export function lerpPose(a: Pose, b: Pose, t: number): Pose {
  const out: Pose = {};
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) out[k] = gv(a, k) + (gv(b, k) - gv(a, k)) * t;
  return out;
}

/** Pose at time t from [time, pose] keys. */
export function keyed(keys: [number, Pose][], t: number, ease = true): Pose {
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 0; i < keys.length - 1; i++) {
    const [t0, a] = keys[i];
    const [t1, b] = keys[i + 1];
    if (t <= t1) {
      const u = (t - t0) / (t1 - t0);
      return lerpPose(a, b, ease ? smooth(u) : u);
    }
  }
  return keys[keys.length - 1][1];
}

/** Running stride at phase ph (radians); amp scales it down for a jog or a stop. */
export function runPose(ph: number, amp = 1): Pose {
  const s = Math.sin(ph) * amp;
  const c = Math.cos(ph);
  return {
    hipLX: -0.75 * s, hipRX: 0.75 * s,
    kneeL: (0.25 + 1.1 * Math.max(0, c)) * amp, kneeR: (0.25 + 1.1 * Math.max(0, -c)) * amp,
    shLX: 0.7 * s, shRX: -0.7 * s, elL: -1.4 * amp, elR: -1.4 * amp, shLZ: 0.08 * amp, shRZ: -0.08 * amp,
    torsoX: 0.22 * amp, hipTwist: 0.12 * s, torsoY: -0.12 * s, lift: 0.06 * Math.abs(s),
  };
}

/** Run-cycle radians per metre. */
export const STRIDE = (2 * Math.PI) / 2.4;

export const angDiff = (a: number, b: number) => {
  let d = (b - a) % (2 * Math.PI);
  if (d > Math.PI) d -= 2 * Math.PI;
  if (d < -Math.PI) d += 2 * Math.PI;
  return d;
};
