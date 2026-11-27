import * as THREE from 'three';
import { FIELD_POSITIONS, STUMPS_Z, fieldSpot, type Vec3 } from '../field';
import type { Kits } from '../kits';
import { flightOf, type DeliveryPlan, type FlightPoints } from '../plan';
import { CLIP } from '../timing';
import { buildCast, dressCast, type Cast, type Numbers } from './cast';
import { poseAt, sweetSpot, type Scene3d } from './clips';
import { aimCamera } from './director';
import { Kit } from './kit';
import { buildStage } from './stage';

/** The whole 3D scene without a renderer (so it can be built and stepped in tests). */
export interface World {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  cast: Cast;
  /** Set up a delivery: measures release and contact points and computes the ball's flight. */
  setDelivery(plan: DeliveryPlan | null, kits: Kits, numbers: Numbers): void;
  /** Pose everything and aim the camera for clip time t. */
  update(t: number, aspect: number): void;
  readonly plan: DeliveryPlan | null;
  readonly flight: ((t: number) => Vec3) | null;
  dispose(): void;
}

export function createWorld(mobile = false): World {
  const kit = new Kit();
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 16 / 9, 0.1, 400);
  const stage = buildStage(kit, scene, mobile);
  const cast = buildCast(kit, scene);
  const spots = FIELD_POSITIONS.map((f) => {
    const s = fieldSpot(f);
    return new THREE.Vector3(s.x, 0, s.z);
  });
  const s3: Scene3d = { cast, wicket: stage.wicket, spots };
  let plan: DeliveryPlan | null = null;
  let flight: ((t: number) => Vec3) | null = null;
  const tmp = new THREE.Vector3();

  function measure(p: DeliveryPlan): FlightPoints {
    poseAt(s3, p, null, CLIP.release);
    cast.bowler.root.updateMatrixWorld(true);
    const release = cast.bowler.armR.hand.getWorldPosition(new THREE.Vector3());
    poseAt(s3, p, null, CLIP.contact);
    const contact = sweetSpot.clone();
    contact.y = Math.max(contact.y, 0.12);
    cast.striker.root.updateMatrixWorld(true);
    // Front (left) pad, just below the knee.
    const pad = cast.striker.legL.kn.localToWorld(tmp.set(0, -0.15, 0.1)).clone();
    return {
      release: { x: release.x, y: release.y, z: release.z },
      contact: { x: contact.x, y: contact.y, z: contact.z },
      pad: { x: pad.x, y: pad.y, z: pad.z },
      stumpsHit: { x: 0, y: 0.4, z: -STUMPS_Z },
    };
  }

  return {
    scene,
    camera,
    cast,
    get plan() {
      return plan;
    },
    get flight() {
      return flight;
    },
    setDelivery(p, kits, numbers) {
      dressCast(kit, cast, kits, numbers);
      plan = p;
      flight = p ? flightOf(p, measure(p)) : null;
    },
    update(t, aspect) {
      poseAt(s3, plan, flight, t);
      aimCamera(camera, plan, flight, t, aspect);
    },
    dispose() {
      kit.dispose();
      scene.clear();
    },
  };
}
