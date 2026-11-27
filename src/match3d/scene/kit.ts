import * as THREE from 'three';

/**
 * Shared geometry, materials and textures for the whole scene. Everything is created once here and
 * disposed together, so WebGL memory is freed when the stage unmounts.
 */
export class Kit {
  readonly sphere = new THREE.SphereGeometry(1, 14, 10);
  readonly dome = new THREE.SphereGeometry(1, 14, 7, 0, Math.PI * 2, 0, Math.PI / 2);
  readonly box = new THREE.BoxGeometry(1, 1, 1);
  readonly cyl = new THREE.CylinderGeometry(1, 1, 1, 14);
  private caps = new Map<string, THREE.CapsuleGeometry>();
  private mats = new Map<string, THREE.MeshStandardMaterial>();
  private extra: { dispose(): void }[] = [];

  capsule(r: number, l: number): THREE.CapsuleGeometry {
    const k = `${r}/${l}`;
    let g = this.caps.get(k);
    if (!g) this.caps.set(k, (g = new THREE.CapsuleGeometry(r, l, 3, 10)));
    return g;
  }

  /** One material per (name, colour); a named material can be recoloured for every player that uses it. */
  mat(key: string, color: THREE.ColorRepresentation, roughness = 0.8): THREE.MeshStandardMaterial {
    let m = this.mats.get(key);
    if (!m) this.mats.set(key, (m = new THREE.MeshStandardMaterial({ color, roughness })));
    return m;
  }

  private memos = new Map<string, unknown>();
  /** Make something once per kit (e.g. a number texture), keyed by name. */
  memo<T>(key: string, make: () => T): T {
    if (!this.memos.has(key)) this.memos.set(key, make());
    return this.memos.get(key) as T;
  }

  /** Keep something (a texture, geometry or material made elsewhere) to dispose with the kit. */
  own<T extends { dispose(): void }>(x: T): T {
    this.extra.push(x);
    return x;
  }

  dispose() {
    for (const g of [this.sphere, this.dome, this.box, this.cyl, ...this.caps.values()]) g.dispose();
    for (const m of this.mats.values()) m.dispose();
    for (const x of this.extra) x.dispose();
    this.caps.clear();
    this.mats.clear();
    this.memos.clear();
    this.extra = [];
  }
}

/** A texture drawn on a canvas, or null where there is no DOM (tests). */
export function canvasTexture(
  kit: Kit, w: number, h: number, draw: (g: CanvasRenderingContext2D, w: number, h: number) => void, repeat: [number, number] = [1, 1],
): THREE.CanvasTexture | null {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  if (!g) return null;
  draw(g, w, h);
  const t = kit.own(new THREE.CanvasTexture(c));
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat[0], repeat[1]);
  return t;
}

/** Seeded noise for textures, so the ground looks the same every time. */
export function texRand(seed = 1) {
  let a = seed;
  return () => {
    a = (a * 1664525 + 1013904223) >>> 0;
    return a / 4294967296;
  };
}

export function addMesh(
  parent: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material,
  pos: [number, number, number] = [0, 0, 0], scale: [number, number, number] = [1, 1, 1], rot: [number, number, number] = [0, 0, 0],
  shadow = true,
): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(...pos);
  m.scale.set(...scale);
  m.rotation.set(...rot);
  m.castShadow = shadow;
  parent.add(m);
  return m;
}
