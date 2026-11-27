import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { FIELD_POSITIONS, HIT_ORIGIN, KEEPER_SPOT, fieldSpot } from '../field';
import type { Kits } from '../kits';
import { makeBat } from './bat';
import { addMesh, type Kit } from './kit';
import { P_KEEPER, P_READY, P_UMPIRE } from './poses';
import { applyPose, makePlayer, setShirtNumber, type Player } from './rig';

/** Shirt numbers shown on backs (batting-order position + 1). */
export interface Numbers {
  striker?: number;
  nonStriker?: number;
  bowler?: number;
  /** Chasing fielder or catcher. */
  fielder?: number;
}

export interface Cast {
  bowler: Player;
  striker: Player;
  nonStriker: Player;
  keeper: Player;
  umpire: Player;
  /** One full rig for whichever fielder has to move (chase or catch). */
  fielder: Player;
  strikerBat: THREE.Group;
  nonStrikerBat: THREE.Group;
  /** Static, merged fielders at FIELD_POSITIONS (one is hidden while the full rig stands in for it). */
  lite: THREE.Group[];
  ball: THREE.Mesh;
  trail: THREE.Mesh[];
}

const BALL_DRAW_R = 0.05; // drawn larger than a real ball so it shows from the broadcast camera

/** Shared kit materials: recolour these to change a side's shirts everywhere. */
function sideMats(kit: Kit) {
  return {
    batShirt: kit.mat('side:bat:shirt', 0x2e47b8),
    batPants: kit.mat('side:bat:pants', 0x283f9c),
    fieldShirt: kit.mat('side:field:shirt', 0x2b7a3e),
    fieldPants: kit.mat('side:field:pants', 0x22663a),
  };
}

/** Merge a posed player into one mesh per material: a handful of draw calls instead of ~25. */
function bake(kit: Kit, P: Player): THREE.Group {
  P.root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(P.root.matrixWorld).invert();
  const byMat = new Map<THREE.Material, THREE.BufferGeometry[]>();
  P.root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || !m.visible) return;
    const g = m.geometry.clone();
    g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld));
    const mat = m.material as THREE.Material;
    if (!byMat.has(mat)) byMat.set(mat, []);
    byMat.get(mat)!.push(g);
  });
  const out = new THREE.Group();
  for (const [mat, gs] of byMat) {
    const merged = mergeGeometries(gs, false);
    gs.forEach((g) => g.dispose());
    if (!merged) continue;
    kit.own(merged);
    const mesh = new THREE.Mesh(merged, mat);
    mesh.castShadow = false;
    out.add(mesh);
  }
  P.root.removeFromParent();
  return out;
}

export function buildCast(kit: Kit, scene: THREE.Scene): Cast {
  const s = sideMats(kit);
  const field = { shirt: s.fieldShirt, pants: s.fieldPants, headColor: 0x1e5a2e };
  const bat = { shirt: s.batShirt, pants: s.batPants, headColor: 0x1d2a6e };

  const bowler = makePlayer(kit, scene, { ...field, skin: 0x8d5a3b, head: 'hair', headColor: 0x1b1410, number: true });
  const umpire = makePlayer(kit, scene, { shirt: kit.mat('ump:shirt', 0xb6cfe6), pants: kit.mat('ump:pants', 0x6e6250), shoe: 0x2a2a2a, skin: 0xa8714d, head: 'umpire', headColor: 0xf5f5f0 });
  umpire.root.position.set(0.35, 0, 11.6);
  umpire.root.rotation.y = Math.PI;
  applyPose(umpire, P_UMPIRE);
  const striker = makePlayer(kit, scene, { ...bat, skin: 0x7a4b2e, head: 'helmet', pads: true, gloves: 'bat', number: true });
  const nonStriker = makePlayer(kit, scene, { ...bat, skin: 0x6f4429, head: 'helmet', pads: true, gloves: 'bat', number: true });
  const keeper = makePlayer(kit, scene, { ...field, skin: 0x8d5a3b, head: 'cap', pads: true, gloves: 'keeper' });
  keeper.root.position.set(KEEPER_SPOT.x, 0, KEEPER_SPOT.z);
  applyPose(keeper, P_KEEPER);
  const fielder = makePlayer(kit, scene, { ...field, skin: 0x9a6a48, head: 'cap', number: true });
  fielder.root.visible = false;

  const skins = [0x8d5a3b, 0xa8714d, 0x6f4429, 0xc08a62, 0x7a4b2e];
  const lite = FIELD_POSITIONS.map((f, i) => {
    const P = makePlayer(kit, scene, { ...field, skin: skins[i % skins.length], head: i % 3 ? 'cap' : 'hair', headColor: i % 3 ? 0x1e5a2e : 0x1b1410 });
    applyPose(P, P_READY);
    const g = bake(kit, P);
    const spot = fieldSpot(f);
    g.position.set(spot.x, 0, spot.z);
    g.rotation.y = Math.atan2(HIT_ORIGIN.x - spot.x, HIT_ORIGIN.z - spot.z);
    scene.add(g);
    return g;
  });

  const ball = addMesh(scene, kit.sphere, new THREE.MeshStandardMaterial({ color: 0xb01e1e, roughness: 0.4, emissive: 0x400808 }), [0, -5, 0], [BALL_DRAW_R, BALL_DRAW_R, BALL_DRAW_R]);
  kit.own(ball.material as THREE.Material);
  const trail = Array.from({ length: 6 }, (_, i) => {
    const m = addMesh(scene, kit.sphere, kit.own(new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.3 * (1 - (i + 1) / 7), depthWrite: false })),
      [0, -5, 0], [1, 1, 1].map(() => BALL_DRAW_R * (1 - (i + 1) * 0.08)) as [number, number, number], [0, 0, 0], false);
    m.visible = false;
    return m;
  });

  return { bowler, striker, nonStriker, keeper, umpire, fielder, strikerBat: makeBat(kit, scene), nonStrikerBat: makeBat(kit, scene), lite, ball, trail };
}

const darker = (hex: string, k: number) => new THREE.Color(hex).multiplyScalar(k);

/** Recolour both sides and update shirt numbers. */
export function dressCast(kit: Kit, c: Cast, kits: Kits, n: Numbers) {
  const s = sideMats(kit);
  s.batShirt.color.set(kits.batting);
  s.batPants.color.copy(darker(kits.batting, 0.82));
  s.fieldShirt.color.set(kits.fielding);
  s.fieldPants.color.copy(darker(kits.fielding, 0.82));
  setShirtNumber(kit, c.striker, n.striker ?? null);
  setShirtNumber(kit, c.nonStriker, n.nonStriker ?? null);
  setShirtNumber(kit, c.bowler, n.bowler ?? null);
  setShirtNumber(kit, c.fielder, n.fielder ?? null);
}
