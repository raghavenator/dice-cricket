import * as THREE from 'three';
import { afterAll, describe, expect, it } from 'vitest';
import { BOUNDARY_R, FIELD_POSITIONS, fieldSpot, STUMPS_Z } from '../field';
import { DEFAULT_KITS } from '../kits';
import type { ClipKind, Outcome } from '../outcome';
import { planDelivery } from '../plan';
import { CLIP, HOLD, RESULT } from '../timing';
import { createWorld } from './world';

// Builds the real scene graph in node (no WebGL, no canvas textures) and steps every clip.
const world = createWorld();
afterAll(() => world.dispose());

const KINDS: ClipKind[] = ['ground', 'four', 'six', 'bowled', 'caught', 'lbw', 'survive'];
const runsOf = (k: ClipKind) => (k === 'four' ? 4 : k === 'six' ? 6 : k === 'ground' ? 2 : 0);
const out = (kind: ClipKind, cAndB = false): Outcome => ({ kind, runs: runsOf(kind), check: !['ground', 'four', 'six'].includes(kind), cAndB });

function finite(o: THREE.Object3D) {
  let ok = true;
  o.traverse((x) => {
    if (![x.position.x, x.position.y, x.position.z, x.rotation.x, x.rotation.y, x.rotation.z].every(Number.isFinite)) ok = false;
  });
  return ok;
}

describe('3D world', () => {
  it('plays every clip without NaNs, for many seeds', () => {
    for (const kind of KINDS)
      for (const seed of [1, 2, 3, 17, 99]) {
        world.setDelivery(planDelivery(out(kind, kind === 'caught' && seed === 3), seed), DEFAULT_KITS, { striker: 1, nonStriker: 2, bowler: 9, fielder: 4 });
        const end = RESULT[kind] + HOLD;
        for (let i = 0; i <= 60; i++) world.update((end * i) / 60, i % 2 ? 0.5 : 16 / 9);
        expect(finite(world.scene)).toBe(true);
        expect(finite(world.camera)).toBe(true);
      }
  });

  it('meets the bat at contact, hits the stumps when bowled and the pad when lbw', () => {
    world.setDelivery(planDelivery(out('ground'), 5), DEFAULT_KITS, {});
    world.update(CLIP.contact, 1.6);
    const sweet = world.flight!(CLIP.contact);
    expect(world.cast.ball.position.distanceTo(new THREE.Vector3(sweet.x, sweet.y, sweet.z))).toBeLessThan(1e-6);

    world.setDelivery(planDelivery(out('bowled'), 5), DEFAULT_KITS, {});
    world.update(CLIP.contact, 1.6);
    expect(world.cast.ball.position.z).toBeCloseTo(-STUMPS_Z, 5);

    world.setDelivery(planDelivery(out('lbw'), 5), DEFAULT_KITS, {});
    world.update(CLIP.contact, 1.6);
    const pad = world.cast.striker.legL.kn.getWorldPosition(new THREE.Vector3());
    expect(world.cast.ball.position.distanceTo(pad)).toBeLessThan(0.4);
  });

  it('draws a far-away ball bigger so it stays visible', () => {
    world.setDelivery(planDelivery(out('six'), 21), DEFAULT_KITS, {});
    world.update(CLIP.release + 0.05, 1.6);
    const near = world.cast.ball.scale.x;
    world.update(CLIP.contact + 2.0, 1.6);
    expect(world.cast.ball.scale.x).toBeGreaterThan(near);
  });

  it('never lets the chasing fielder reach a four before it crosses the rope', () => {
    for (const seed of [2, 5, 8, 13, 21, 34, 55, 89]) {
      const p = planDelivery(out('four'), seed);
      world.setDelivery(p, DEFAULT_KITS, {});
      let t = CLIP.contact;
      while (Math.hypot(world.flight!(t).x, world.flight!(t).z) < BOUNDARY_R && t < 8) t += 0.01;
      world.update(t, 1.6);
      expect(world.cast.fielder.root.position.distanceTo(world.cast.ball.position)).toBeGreaterThan(1);
    }
  });

  it('raises the umpire\'s finger for lbw', () => {
    world.setDelivery(planDelivery(out('lbw'), 8), DEFAULT_KITS, {});
    world.update(RESULT.lbw + 0.2, 1.6);
    expect(world.cast.umpire.armR.sh.rotation.x).toBeLessThan(-2.5);
  });

  it('puts the catcher under a catch, and the bowler under caught and bowled', () => {
    const p = planDelivery(out('caught'), 11);
    world.setDelivery(p, DEFAULT_KITS, {});
    const catchT = CLIP.contact + (p.hit?.type === 'catch' ? p.hit.flight : 0);
    world.update(catchT, 1.6);
    const hands = world.cast.fielder.armL.hand.getWorldPosition(new THREE.Vector3())
      .add(world.cast.fielder.armR.hand.getWorldPosition(new THREE.Vector3())).multiplyScalar(0.5);
    expect(hands.distanceTo(world.cast.ball.position)).toBeLessThan(0.9);
    expect(world.cast.fielder.root.visible).toBe(true);
    expect(world.cast.lite[p.fielder!].visible).toBe(false);
    const spot = fieldSpot(FIELD_POSITIONS[p.fielder!]);
    expect(Math.hypot(world.cast.ball.position.x - spot.x, world.cast.ball.position.z - spot.z)).toBeLessThan(2.5);

    const cb = planDelivery(out('caught', true), 4);
    world.setDelivery(cb, DEFAULT_KITS, {});
    world.update(CLIP.contact + (cb.hit?.type === 'catch' ? cb.hit.flight : 0), 1.6);
    const bh = world.cast.bowler.armR.hand.getWorldPosition(new THREE.Vector3());
    expect(bh.distanceTo(world.cast.ball.position)).toBeLessThan(1.0);
  });
});
