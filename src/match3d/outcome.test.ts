import { describe, expect, it } from 'vitest';
import { resolveRolls } from '../engine/dice';
import { labelFor } from './label';
import { outcomeOf } from './outcome';

const ball = (roll1: number, roll2?: number, fielderId?: string) => {
  const res = resolveRolls({ roll1, roll2 });
  return { roll1, roll2, ...res, bowlerId: 'bowler', fielderId: res.how === 'caught' ? fielderId ?? 'f3' : undefined };
};

describe('outcomeOf', () => {
  it('maps every dice result to the matching clip', () => {
    expect(outcomeOf(ball(1)).kind).toBe('ground');
    expect(outcomeOf(ball(2)).kind).toBe('ground');
    expect(outcomeOf(ball(3)).kind).toBe('ground');
    expect(outcomeOf(ball(4)).kind).toBe('four');
    expect(outcomeOf(ball(6)).kind).toBe('six');
    for (const r2 of [1, 2, 3]) expect(outcomeOf(ball(5, r2))).toMatchObject({ kind: 'survive', check: true, runs: 0 });
    expect(outcomeOf(ball(5, 4))).toMatchObject({ kind: 'bowled', check: true });
    expect(outcomeOf(ball(5, 5))).toMatchObject({ kind: 'caught', check: true, cAndB: false });
    expect(outcomeOf(ball(5, 6))).toMatchObject({ kind: 'lbw', check: true });
  });

  it('keeps the runs and marks only 5s as wicket checks', () => {
    for (const r1 of [1, 2, 3, 4, 6]) expect(outcomeOf(ball(r1))).toMatchObject({ runs: r1, check: false });
  });

  it('spots caught and bowled', () => {
    expect(outcomeOf(ball(5, 5, 'bowler')).cAndB).toBe(true);
  });
});

describe('labelFor', () => {
  it('uses the same words as the commentary', () => {
    expect(labelFor(outcomeOf(ball(1))).text).toBe('1 RUN');
    expect(labelFor(outcomeOf(ball(3))).text).toBe('3 RUNS');
    expect(labelFor(outcomeOf(ball(4)))).toMatchObject({ text: 'FOUR!', tone: 'four' });
    expect(labelFor(outcomeOf(ball(6)))).toMatchObject({ text: 'SIX!', tone: 'six' });
    expect(labelFor(outcomeOf(ball(5, 4)))).toMatchObject({ text: 'OUT!', sub: 'BOWLED', tone: 'out' });
    expect(labelFor(outcomeOf(ball(5, 5)))).toMatchObject({ text: 'OUT!', sub: 'CAUGHT' });
    expect(labelFor(outcomeOf(ball(5, 5, 'bowler'))).sub).toBe('CAUGHT & BOWLED');
    expect(labelFor(outcomeOf(ball(5, 6))).sub).toBe('LBW');
    expect(labelFor(outcomeOf(ball(5, 2)))).toMatchObject({ text: 'DOT BALL', sub: 'SURVIVES!' });
  });
});
