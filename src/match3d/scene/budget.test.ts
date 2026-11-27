import * as THREE from 'three';
import { afterAll, describe, expect, it } from 'vitest';
import { DEFAULT_KITS } from '../kits';
import { planDelivery } from '../plan';
import { CLIP } from '../timing';
import { createWorld } from './world';

/**
 * Per-frame cost as the renderer sees it: one draw call per visible mesh inside the camera's view, plus one per
 * shadow-casting mesh inside the sun's shadow camera (three.js culls the rest of both passes).
 */
function cost(scene: THREE.Scene, camera: THREE.Camera) {
  scene.updateMatrixWorld(true);
  camera.updateMatrixWorld(true);
  const sun = scene.children.find((o) => (o as THREE.DirectionalLight).isDirectionalLight) as THREE.DirectionalLight;
  sun.shadow.camera.position.copy(sun.position);
  sun.shadow.camera.lookAt(sun.target.position);
  sun.shadow.camera.updateMatrixWorld(true);
  const frustum = (c: THREE.Camera) =>
    new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(c.projectionMatrix, c.matrixWorldInverse));
  const view = frustum(camera);
  const shadowView = frustum(sun.shadow.camera);
  let calls = 0;
  let shadow = 0;
  let triangles = 0;
  scene.traverseVisible((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const inView = !m.frustumCulled || view.intersectsObject(m);
    if (inView) {
      calls++;
      const g = m.geometry;
      triangles += (g.index ? g.index.count : g.attributes.position.count) / 3;
    }
    if (m.castShadow && shadowView.intersectsObject(m)) shadow++;
  });
  return { calls, shadow, total: calls + shadow, triangles: Math.round(triangles) };
}

const world = createWorld(true);
afterAll(() => world.dispose());

describe('3D performance budget', () => {
  it('stays within the draw-call and triangle budget for phones', () => {
    // The busiest moment: broadcast camera before contact, everyone in shot, on a portrait phone.
    for (const [t, aspect] of [[CLIP.release, 0.46], [CLIP.release, 16 / 9], [CLIP.contact + 0.6, 0.46]] as const) {
      world.setDelivery(planDelivery({ kind: 'caught', runs: 0, check: true, cAndB: false }, 3), DEFAULT_KITS, { striker: 4, nonStriker: 7, bowler: 10, fielder: 3 });
      world.update(t, aspect);
      const c = cost(world.scene, world.camera);
      // Measured at 145 (+3 shirt-number plates in a browser, which have no texture in node).
      expect(c.total).toBeLessThan(147);
      expect(c.triangles).toBeLessThan(60000);
    }
  });
});
