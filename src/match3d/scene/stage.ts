import * as THREE from 'three';
import { BOUNDARY_R, STUMPS_Z } from '../field';
import { addMesh, canvasTexture, texRand, type Kit } from './kit';

export const SKY = 0xbcd4ea;

export interface Wicket {
  group: THREE.Group;
  stumps: THREE.Mesh[];
  bails: THREE.Mesh[];
}

export interface Stage {
  sun: THREE.DirectionalLight;
  /** The striker's stumps (they get knocked over). */
  wicket: Wicket;
}

/** Ground, pitch, creases, stumps, boundary rope and lights. */
export function buildStage(kit: Kit, scene: THREE.Scene, mobile: boolean): Stage {
  scene.background = new THREE.Color(SKY);
  scene.fog = new THREE.Fog(SKY, 75, 170);

  scene.add(new THREE.HemisphereLight(0xe6f0ff, 0x5d7a35, 1.1));
  const sun = new THREE.DirectionalLight(0xfff2dc, 2.4);
  sun.position.set(-16, 32, 14);
  sun.castShadow = true;
  sun.shadow.mapSize.set(mobile ? 1024 : 2048, mobile ? 1024 : 2048);
  Object.assign(sun.shadow.camera, { left: -16, right: 16, top: 22, bottom: -22, near: 1, far: 90 });
  sun.shadow.camera.updateProjectionMatrix();
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.03;
  scene.add(sun);

  const rnd = texRand(7);
  const grass = canvasTexture(kit, 256, 256, (g, w, h) => {
    g.fillStyle = '#7ea24a';
    g.fillRect(0, 0, w, h / 2);
    g.fillStyle = '#719642';
    g.fillRect(0, h / 2, w, h / 2);
    for (let i = 0; i < 6000; i++) {
      g.fillStyle = rnd() < 0.5 ? 'rgba(255,255,210,0.06)' : 'rgba(20,45,0,0.08)';
      g.fillRect(rnd() * w, rnd() * h, 1 + rnd(), 1 + rnd() * 3);
    }
  }, [18, 18]);
  const ground = addMesh(scene, kit.own(new THREE.PlaneGeometry(180, 180)),
    kit.own(new THREE.MeshStandardMaterial({ map: grass, color: grass ? 0xffffff : 0x789c46, roughness: 1 })),
    [0, 0, 0], [1, 1, 1], [-Math.PI / 2, 0, 0], false);
  ground.receiveShadow = true;

  const pitchTex = canvasTexture(kit, 128, 512, (g, w, h) => {
    g.fillStyle = '#cdb58b';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 4000; i++) {
      g.fillStyle = rnd() < 0.5 ? 'rgba(255,245,220,0.14)' : 'rgba(120,95,60,0.10)';
      g.fillRect(rnd() * w, rnd() * h, 1 + rnd() * 2, 1 + rnd() * 2);
    }
    for (const y of [h * 0.1, h * 0.9]) {
      const gr = g.createRadialGradient(w / 2, y, 2, w / 2, y, 44);
      gr.addColorStop(0, 'rgba(150,118,78,0.45)');
      gr.addColorStop(1, 'rgba(150,118,78,0)');
      g.fillStyle = gr;
      g.fillRect(0, y - 60, w, 120);
    }
  });
  const pitch = addMesh(scene, kit.own(new THREE.PlaneGeometry(3.05, 24)),
    kit.own(new THREE.MeshStandardMaterial({ map: pitchTex, color: pitchTex ? 0xffffff : 0xcdb58b, roughness: 0.95 })),
    [0, 0.01, 0], [1, 1, 1], [-Math.PI / 2, 0, 0], false);
  pitch.receiveShadow = true;

  // Creases: one shared unit plane, scaled.
  const line = kit.mat('crease', 0xf6f6f0, 0.9);
  const unit = kit.memo('unitPlane', () => kit.own(new THREE.PlaneGeometry(1, 1)));
  const stripe = (x: number, z: number, w: number, d: number) => {
    const m = addMesh(scene, unit, line, [x, 0.02, z], [w, d, 1], [-Math.PI / 2, 0, 0], false);
    m.receiveShadow = true;
  };
  for (const e of [1, -1]) {
    stripe(0, e * STUMPS_Z, 2.64, 0.05);
    stripe(0, e * 8.84, 6.0, 0.05);
    for (const sx of [-1.32, 1.32]) stripe(sx, e * STUMPS_Z, 0.05, 2.44);
  }

  const wood = kit.mat('stump', 0xeadfc4, 0.55);
  const makeWicket = (z: number): Wicket => {
    const group = new THREE.Group();
    const stumps = [-0.114, 0, 0.114].map((x) => addMesh(group, kit.cyl, wood, [x, 0.355, 0], [0.018, 0.71, 0.018]));
    const bails = [-0.057, 0.057].map((x) => addMesh(group, kit.box, wood, [x, 0.72, 0], [0.11, 0.015, 0.015]));
    group.position.z = z;
    scene.add(group);
    return { group, stumps, bails };
  };
  makeWicket(STUMPS_Z);
  const wicket = makeWicket(-STUMPS_Z);

  // Boundary rope.
  const rope = new THREE.Mesh(kit.own(new THREE.TorusGeometry(BOUNDARY_R, 0.14, 4, 120)), kit.mat('rope', 0xf2f2f2, 0.6));
  rope.rotation.x = -Math.PI / 2;
  rope.position.y = 0.1;
  scene.add(rope);

  return { sun, wicket };
}

/** Put the striker's stumps and bails back. */
export function resetWicket(w: Wicket) {
  [-0.114, 0, 0.114].forEach((x, i) => {
    w.stumps[i].position.set(x, 0.355, 0);
    w.stumps[i].rotation.set(0, 0, 0);
  });
  [-0.057, 0.057].forEach((x, i) => {
    w.bails[i].position.set(x, 0.72, 0);
    w.bails[i].rotation.set(0, 0, 0);
  });
}

/** Stumps knocked back and bails flying, `tau` seconds after the ball hits. */
export function breakWicket(w: Wicket, tau: number) {
  resetWicket(w);
  if (tau <= 0) return;
  const k = Math.min(1, tau / 0.25);
  w.stumps.forEach((s, i) => {
    // Middle stump goes furthest; pivot about the base.
    const lean = (i === 1 ? 0.9 : 0.45) * k;
    const side = (i - 1) * 0.25 * k;
    s.rotation.set(-lean, 0, side);
    s.position.set(s.position.x + Math.sin(side) * 0.355, 0.355 * Math.cos(lean), -Math.sin(lean) * 0.355);
  });
  w.bails.forEach((b, i) => {
    const t = Math.min(tau, 1.1);
    const vx = (i ? 0.9 : -0.7);
    const y = 0.72 + 3.2 * t - 4.9 * t * t;
    b.position.set(b.position.x + vx * t, Math.max(0.01, y), -2.2 * t);
    b.rotation.set(9 * t * (i ? 1 : -1), 4 * t, 7 * t);
  });
}
