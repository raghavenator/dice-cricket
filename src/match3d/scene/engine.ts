import * as THREE from 'three';
import type { Kits } from '../kits';
import type { DeliveryPlan } from '../plan';
import { HOLD, RESULT, type Timeline } from '../timing';
import type { Numbers } from './cast';
import { createWorld } from './world';

/**
 * The 3D match stage: a WebGL renderer drawing the World. Loaded lazily (this module pulls in three.js).
 * Renders only while a clip is playing and the stage is on screen; otherwise the last frame stays up.
 */
export interface PlayInput {
  plan: DeliveryPlan;
  clip: Timeline['clip'];
  /** performance.now() when the ball was rolled. */
  startedAt: number;
  kits: Kits;
  numbers: Numbers;
}

export interface StageInfo {
  calls: number;
  triangles: number;
  fps: number;
}

export interface MatchScene {
  play(d: PlayInput): void;
  /** Jump to the result frame. */
  skip(): void;
  /** Show a neutral frame (no delivery): players waiting. */
  idle(kits: Kits, numbers: Numbers): void;
  setActive(on: boolean): void;
  resize(w: number, h: number): void;
  info(): StageInfo;
  dispose(): void;
}

export function createMatchScene(canvas: HTMLCanvasElement, opts: { onLost?: () => void } = {}): MatchScene {
  const coarse = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
  const dpr = typeof devicePixelRatio === 'number' ? devicePixelRatio : 1;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: dpr < 2, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(dpr, coarse ? 1.5 : 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = coarse ? THREE.PCFShadowMap : THREE.PCFSoftShadowMap;

  const world = createWorld(coarse);
  let aspect = 16 / 9;
  let active = true;
  let raf = 0;
  let current: PlayInput | null = null;
  let skippedAt: number | null = null;
  let frames = 0;
  let fpsT = performance.now();
  let fps = 0;

  const lost = (e: Event) => {
    e.preventDefault();
    cancelAnimationFrame(raf);
    opts.onLost?.();
  };
  canvas.addEventListener('webglcontextlost', lost);

  /** Clip time now, or null when there's no clip (label-only speeds). */
  function clipTime(now: number): number | null {
    const c = current?.clip;
    if (!current || !c) return null;
    const t = c.skip + ((now - current.startedAt) / 1000) * c.rate;
    return skippedAt !== null ? Math.max(t, c.result) : t;
  }

  function draw(t: number) {
    world.update(t, aspect);
    renderer.render(world.scene, world.camera);
    frames++;
    const now = performance.now();
    if (now - fpsT > 1000) {
      fps = Math.round((frames * 1000) / (now - fpsT));
      frames = 0;
      fpsT = now;
    }
  }

  function loop() {
    raf = 0;
    if (!active || !current) return;
    const t = clipTime(performance.now());
    if (t === null) {
      draw(RESULT[current.plan.kind]);
      return;
    }
    const end = current.clip!.result + HOLD;
    draw(Math.min(t, end));
    if (t < end) raf = requestAnimationFrame(loop);
  }

  const kick = () => {
    if (!raf && active) raf = requestAnimationFrame(loop);
  };

  return {
    play(d) {
      current = d;
      skippedAt = null;
      world.setDelivery(d.plan, d.kits, d.numbers);
      kick();
    },
    skip() {
      if (!current) return;
      skippedAt = performance.now();
      kick();
    },
    idle(kits, numbers) {
      current = null;
      world.setDelivery(null, kits, numbers);
      if (active) draw(0);
    },
    setActive(on) {
      active = on;
      if (!on) {
        cancelAnimationFrame(raf);
        raf = 0;
      } else if (current) kick();
      else draw(0);
    },
    resize(w, h) {
      if (w < 1 || h < 1) return;
      aspect = w / h;
      renderer.setSize(w, h, false);
      if (!active) return;
      const t = clipTime(performance.now());
      if (current && t !== null) draw(Math.min(t, current.clip!.result + HOLD));
      else if (current) draw(RESULT[current.plan.kind]);
      else draw(0);
    },
    info() {
      return { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, fps };
    },
    dispose() {
      cancelAnimationFrame(raf);
      canvas.removeEventListener('webglcontextlost', lost);
      world.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
    },
  };
}
