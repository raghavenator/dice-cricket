import { useEffect, useState } from 'react';
import { useOnline } from './useOnlineStore';

/** The server's time, refreshed a few times a second. */
export function useServerNow(): number {
  const offset = useOnline((s) => s.offset);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 150);
    return () => clearInterval(t);
  }, []);
  return now + offset;
}

export const secondsLeft = (deadline: number, now: number): number => Math.max(0, Math.ceil((deadline - now) / 1000));

/** `max` hides the moment before a turn really starts, while the dice settle. */
export function Countdown({ to, max = Infinity }: { to: number | null; max?: number }) {
  const now = useServerNow();
  return to === null ? null : <span className="on-count">{Math.min(max, secondsLeft(to, now))}s</span>;
}
