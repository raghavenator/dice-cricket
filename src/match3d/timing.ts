import type { ClipKind } from './outcome';

/**
 * Every timing for the 3D clips, in one place. Tune here.
 *
 * Clips are authored in "clip time" (seconds) at normal speed. A speed profile can skip the start of the clip
 * (the run-up) and play it faster; wall time = (clipTime - skip) / rate.
 */
export const CLIP = {
  /** Bowler lets go of the ball. Die 1 lands here. */
  release: 0.75,
  /** Ball pitches. */
  bounce: 1.13,
  /** Ball reaches the bat (or pad, stumps, or passes the edge). Die 2 lands here. */
  contact: 1.27,
  /** Run-up start that "fast" and "online" skip, so they open at the gather. */
  gather: 0.45,
} as const;

/** When the big result label appears, in clip time at normal speed. */
export const RESULT: Record<ClipKind, number> = {
  ground: 1.9,
  four: 2.3,
  six: 2.5,
  bowled: 1.8,
  lbw: 2.1,
  caught: 2.5,
  survive: 1.8,
};

/** How long the clip keeps playing after the label appears. */
export const HOLD = 0.5;

/** Online one-die balls must finish inside the server's BALL_GAP_MS, so they label shortly after contact. */
const ONLINE_EARLY: Partial<Record<ClipKind, number>> = {
  ground: CLIP.contact + 0.45,
  four: CLIP.contact + 0.5,
  six: CLIP.contact + 0.55,
};

export type Speed = 'normal' | 'fast' | 'instant' | 'online' | 'reduced';

interface Profile {
  skip: number;
  rate: number;
  result?: number;
}

function profile(kind: ClipKind, speed: Speed): Profile | null {
  switch (speed) {
    case 'normal':
      return { skip: 0, rate: 1 };
    case 'fast':
      return { skip: CLIP.gather, rate: 1.8 };
    case 'online':
      // Wicket-check balls have CHECK_GAP_MS (2.7 s), enough for the full clip.
      return kind in ONLINE_EARLY ? { skip: CLIP.gather, rate: 1.35, result: ONLINE_EARLY[kind] } : { skip: 0, rate: 1 };
    default:
      return null;
  }
}

const isCheck = (kind: ClipKind) => kind === 'bowled' || kind === 'caught' || kind === 'lbw' || kind === 'survive';

export interface Timeline {
  /** Milliseconds after the roll. */
  die1At: number;
  /** Only for wicket checks. */
  die2At: number | null;
  /** Label appears, and the ball is applied to the score and commentary. */
  resultAt: number;
  /** The clip stops rendering. */
  endAt: number;
  /** 3D clip playback; null means no clip (label only). */
  clip: { skip: number; rate: number; result: number } | null;
}

export function timeline(kind: ClipKind, speed: Speed): Timeline {
  const check = isCheck(kind);
  if (speed === 'instant') return { die1At: 0, die2At: check ? 0 : null, resultAt: 0, endAt: 900, clip: null };
  if (speed === 'reduced') return { die1At: 200, die2At: check ? 350 : null, resultAt: 500, endAt: 1400, clip: null };
  const p = profile(kind, speed)!;
  const result = p.result ?? RESULT[kind];
  const wall = (t: number) => Math.round((Math.max(0, t - p.skip) / p.rate) * 1000);
  return {
    die1At: wall(CLIP.release),
    die2At: check ? wall(CLIP.contact) : null,
    resultAt: wall(result),
    endAt: wall(result + HOLD),
    clip: { skip: p.skip, rate: p.rate, result },
  };
}
