import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Kits } from '../match3d/kits';
import type { DeliveryPlan } from '../match3d/plan';
import type { Numbers } from '../match3d/scene/cast';
import type { MatchScene, StageInfo } from '../match3d/scene/engine';
import type { Timeline } from '../match3d/timing';

/** One ball for the stage to show. `startedAt` is performance.now() at the roll, shared with the screen's timers. */
export interface StageDelivery {
  key: string;
  plan: DeliveryPlan;
  timeline: Timeline;
  startedAt: number;
  skipped?: boolean;
  numbers?: Numbers;
}

/** True when the viewer asked the system for less motion. */
export function usePrefersReducedMotion(): boolean {
  const q = '(prefers-reduced-motion: reduce)';
  const [reduced, setReduced] = useState(() => typeof matchMedia !== 'undefined' && matchMedia(q).matches);
  useEffect(() => {
    if (typeof matchMedia === 'undefined') return;
    const m = matchMedia(q);
    const on = () => setReduced(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return reduced;
}

function hasWebGL(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}

type Mode = 'loading' | '3d' | 'fallback';

/**
 * The 3D match graphic (three.js, loaded on demand) with the big result label on top.
 * Falls back to a 2D result card when WebGL isn't available. Tap or press Enter to skip to the result.
 */
export function MatchStage({
  delivery, kits, idleNumbers, onSkip, onInfo, className, children,
}: {
  delivery: StageDelivery | null;
  kits: Kits;
  idleNumbers?: Numbers;
  onSkip?: () => void;
  onInfo?: (i: StageInfo) => void;
  className?: string;
  children?: ReactNode;
}) {
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const engine = useRef<MatchScene | null>(null);
  const [mode, setMode] = useState<Mode>('loading');
  const [labelFor, setLabelFor] = useState<string | null>(null);
  const latest = useRef({ delivery, kits, idleNumbers });
  latest.current = { delivery, kits, idleNumbers };

  // Load three.js and start the scene.
  useEffect(() => {
    if (!hasWebGL()) {
      setMode('fallback');
      return;
    }
    let dead = false;
    import('../match3d/scene/engine')
      .then(({ createMatchScene }) => {
        if (dead || !canvas.current) return;
        const e = createMatchScene(canvas.current, { onLost: () => setMode('fallback') });
        engine.current = e;
        const r = box.current?.getBoundingClientRect();
        if (r) e.resize(r.width, r.height);
        const { delivery: d, kits: k, idleNumbers: n } = latest.current;
        if (d) e.play({ plan: d.plan, clip: d.timeline.clip, startedAt: d.startedAt, kits: k, numbers: d.numbers ?? {} });
        else e.idle(k, n ?? {});
        if (d?.skipped) e.skip();
        setMode('3d');
      })
      .catch(() => !dead && setMode('fallback'));
    return () => {
      dead = true;
      engine.current?.dispose();
      engine.current = null;
    };
  }, []);

  // Size, on-screen and tab visibility: only render when it can be seen.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    let onScreen = true;
    const sync = () => engine.current?.setActive(onScreen && !document.hidden);
    const io = new IntersectionObserver(([e]) => {
      onScreen = e.intersectionRatio >= 0.25;
      sync();
    }, { threshold: [0, 0.25, 0.5] });
    io.observe(el);
    const ro = new ResizeObserver(([e]) => engine.current?.resize(e.contentRect.width, e.contentRect.height));
    ro.observe(el);
    document.addEventListener('visibilitychange', sync);
    return () => {
      io.disconnect();
      ro.disconnect();
      document.removeEventListener('visibilitychange', sync);
    };
  }, []);

  // A new ball: play it, and show the label at the result moment.
  const key = delivery?.key ?? null;
  useEffect(() => {
    setLabelFor(null);
    if (!delivery) {
      engine.current?.idle(kits, idleNumbers ?? {});
      return;
    }
    engine.current?.play({ plan: delivery.plan, clip: delivery.timeline.clip, startedAt: delivery.startedAt, kits, numbers: delivery.numbers ?? {} });
    const wait = delivery.startedAt + delivery.timeline.resultAt - performance.now();
    const id = window.setTimeout(() => setLabelFor(delivery.key), Math.max(0, wait));
    return () => window.clearTimeout(id);
  }, [key]); // only when the ball changes

  // Skipped: jump to the result frame and show the label now.
  useEffect(() => {
    if (!delivery?.skipped) return;
    engine.current?.skip();
    setLabelFor(delivery.key);
  }, [delivery?.skipped, delivery?.key]);

  // Debug read-out (lab page).
  useEffect(() => {
    if (!onInfo) return;
    const id = window.setInterval(() => engine.current && onInfo(engine.current.info()), 500);
    return () => window.clearInterval(id);
  }, [onInfo]);

  const label = delivery && labelFor === delivery.key ? delivery.plan.label : null;
  const playing = !!delivery && !label;
  const skip = () => playing && onSkip?.();

  return (
    <div
      ref={box}
      className={`stage stage-${mode}${className ? ` ${className}` : ''}`}
      onClick={skip}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && playing) {
          e.preventDefault();
          skip();
        }
      }}
      tabIndex={playing && onSkip ? 0 : -1}
      aria-label={playing && onSkip ? 'Skip to the result' : undefined}
      role={playing && onSkip ? 'button' : undefined}
    >
      {mode !== 'fallback' && <canvas ref={canvas} className="stage-canvas" aria-hidden />}
      {mode === 'fallback' && (
        <div className="stage-card" aria-hidden>
          {!label && <span className="stage-card-wait">{delivery ? '🏏' : '🏟️'}</span>}
        </div>
      )}
      <div className="stage-label-wrap" aria-live="polite">
        {label && (
          <div key={delivery!.key} className={`stage-label stage-label-${label.tone}`}>
            <span className="stage-label-text">{label.text}</span>
            {label.sub && <span className="stage-label-sub">{label.sub}</span>}
          </div>
        )}
      </div>
      {children}
    </div>
  );
}
