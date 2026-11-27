import { describe, expect, it } from 'vitest';
import type { ClipKind } from './outcome';
import { CLIP, FIT_GAP_MS, RESULT, fitTimeline, timeline, type Speed } from './timing';

const KINDS: ClipKind[] = ['ground', 'four', 'six', 'bowled', 'caught', 'lbw', 'survive'];
const CHECKS = new Set<ClipKind>(['bowled', 'caught', 'lbw', 'survive']);
const SPEEDS: Speed[] = ['normal', 'fast', 'online', 'instant', 'reduced'];

describe('timeline', () => {
  it('keeps the clip phases in order', () => {
    expect(CLIP.gather).toBeLessThan(CLIP.release);
    expect(CLIP.release).toBeLessThan(CLIP.bounce);
    expect(CLIP.bounce).toBeLessThan(CLIP.contact);
    for (const k of KINDS) expect(RESULT[k]).toBeGreaterThan(CLIP.contact);
  });

  it('lands the dice no later than the result, with a second die only for wicket checks', () => {
    for (const k of KINDS)
      for (const s of SPEEDS) {
        const t = timeline(k, s);
        expect(t.die1At).toBeLessThanOrEqual(t.resultAt);
        expect(t.die2At === null).toBe(!CHECKS.has(k));
        if (t.die2At !== null) expect(t.die2At).toBeGreaterThanOrEqual(t.die1At);
        if (t.die2At !== null) expect(t.die2At).toBeLessThanOrEqual(t.resultAt);
        expect(t.endAt).toBeGreaterThanOrEqual(t.resultAt);
      }
  });

  it('shows the result in 2-3 seconds at normal speed, sooner when fast, at once when instant', () => {
    for (const k of KINDS) {
      const normal = timeline(k, 'normal').resultAt;
      expect(normal).toBeGreaterThanOrEqual(1500);
      expect(normal).toBeLessThanOrEqual(3000);
      expect(timeline(k, 'fast').resultAt).toBeLessThan(normal);
      expect(timeline(k, 'instant')).toMatchObject({ resultAt: 0, clip: null });
      expect(timeline(k, 'reduced').resultAt).toBeLessThan(600);
    }
  });

  it('fits auto-roll clips inside the roll-to-roll period', () => {
    for (const k of KINDS)
      for (let period = 300; period <= 5000; period += 100) {
        const t = fitTimeline(k, period);
        if (t.clip) expect(t.endAt).toBeLessThanOrEqual(period - FIT_GAP_MS + 1);
        expect(t.resultAt).toBeLessThan(period);
      }
    // Long periods play at normal pace; very short ones show the label only.
    expect(fitTimeline('six', 5000)).toEqual(timeline('six', 'normal'));
    expect(fitTimeline('six', 300).clip).toBeNull();
    expect(fitTimeline('ground', 1500).clip!.rate).toBeGreaterThan(1);
  });
});
// The online gaps check lives in src/online/clipTiming.test.ts: code outside src/online must not import online code.
