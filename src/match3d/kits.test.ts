import { describe, expect, it } from 'vitest';
import { DEFAULT_KITS, colourDistance, kitsFor } from './kits';

describe('kitsFor', () => {
  it('uses team colours when they are easy to tell apart', () => {
    expect(kitsFor('#c0392b', '#2980b9')).toEqual({ batting: '#c0392b', fielding: '#2980b9' });
  });

  it('falls back to blue and green when the colours are too alike, or missing', () => {
    expect(kitsFor('#1f6feb', '#2a75f0')).toEqual(DEFAULT_KITS);
    expect(kitsFor(undefined, '#2980b9')).toEqual(DEFAULT_KITS);
    expect(kitsFor('not a colour', '#2980b9')).toEqual(DEFAULT_KITS);
  });

  it('measures colour distance', () => {
    expect(colourDistance('#000000', '#000000')).toBe(0);
    expect(colourDistance('#000', '#fff')).toBeGreaterThan(600);
  });
});
