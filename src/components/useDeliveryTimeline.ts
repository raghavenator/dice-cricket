import { useCallback, useEffect, useRef, useState } from 'react';
import type { DeliveryPlan } from '../match3d/plan';
import type { Numbers } from '../match3d/scene/cast';
import type { Timeline } from '../match3d/timing';
import type { StageDelivery } from './MatchStage';

export interface DeliveryStart {
  key: string;
  plan: DeliveryPlan;
  timeline: Timeline;
  numbers?: Numbers;
  /** Die 2 starts spinning (wicket checks only). */
  onCheck?: () => void;
  /** The result moment: apply the ball to the score and commentary. */
  onResult: () => void;
}

/**
 * Runs one ball on one clock: the dice, the 3D clip and the result all key off the same start time,
 * so the label, scoreboard and commentary change together. skip() jumps straight to the result.
 */
export function useDeliveryTimeline() {
  const [delivery, setDelivery] = useState<StageDelivery | null>(null);
  const timers = useRef<number[]>([]);
  const pending = useRef<{ check?: () => void; result: () => void } | null>(null);

  const clear = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  };
  useEffect(() => clear, []);

  const start = useCallback((d: DeliveryStart) => {
    clear();
    const startedAt = performance.now();
    const t = d.timeline;
    const p: { check?: () => void; result: () => void } = {
      check: d.onCheck,
      result: () => {
        pending.current = null;
        d.onResult();
      },
    };
    pending.current = p;
    if (t.die2At !== null && d.onCheck) {
      timers.current.push(window.setTimeout(() => {
        p.check = undefined;
        d.onCheck!();
      }, t.die1At));
    }
    timers.current.push(window.setTimeout(p.result, t.resultAt));
    setDelivery({ key: d.key, plan: d.plan, timeline: t, startedAt, numbers: d.numbers });
  }, []);

  /** Jump to the result now (tap on the stage). */
  const skip = useCallback(() => {
    const p = pending.current;
    if (!p) return;
    clear();
    p.check?.();
    p.result();
    setDelivery((d) => (d ? { ...d, skipped: true } : d));
  }, []);

  /** Drop any ball in progress without applying it (e.g. the match was replaced). */
  const cancel = useCallback((keepStage = false) => {
    clear();
    pending.current = null;
    if (!keepStage) setDelivery(null);
  }, []);

  return { delivery, start, skip, cancel };
}
