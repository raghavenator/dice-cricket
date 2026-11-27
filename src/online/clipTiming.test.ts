import { describe, expect, it } from 'vitest';
import type { ClipKind } from '../match3d/outcome';
import { timeline } from '../match3d/timing';
import { BALL_GAP_MS, CHECK_GAP_MS } from './room';

const KINDS: ClipKind[] = ['ground', 'four', 'six', 'bowled', 'caught', 'lbw', 'survive'];
const CHECKS = new Set<ClipKind>(['bowled', 'caught', 'lbw', 'survive']);

describe('3D clips online', () => {
  it('show their result inside the server gap, so both players stay in step', () => {
    for (const k of KINDS) {
      const gap = CHECKS.has(k) ? CHECK_GAP_MS : BALL_GAP_MS;
      expect(timeline(k, 'online').resultAt).toBeLessThanOrEqual(gap - 150);
    }
  });
});
