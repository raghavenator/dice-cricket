import { describe, expect, it } from 'vitest';
import { PRESET_TEAMS } from '../data/presets';
import { applyBall, createMatch } from '../engine/match';
import type { MatchState, Rolls } from '../engine/types';
import { deliveryFor, waitingFor } from './fromMatch';

const [A, B] = PRESET_TEAMS;
const fresh = (): MatchState => {
  let n = 0;
  return createMatch('m-test', A, B, { format: 'limited', overs: 5, bowlerMode: 'auto' }, () => ((n += 0.37) % 1));
};
const r = (roll1: number, roll2?: number, fielderIdx = 3): Rolls => ({ roll1, roll2, fielderIdx });

describe('deliveryFor', () => {
  it('builds the clip for the ball just bowled, and the same one every time', () => {
    const m = fresh();
    const next = applyBall(m, r(4));
    const d = deliveryFor(m, next, 'normal')!;
    expect(d.plan.kind).toBe('four');
    expect(d.plan.label.text).toBe('FOUR!');
    expect(deliveryFor(m, next, 'normal')).toEqual(d);
    expect(d.key).toBe(`${m.id}:0:0`);
  });

  it('numbers the striker, bowler and catcher from the teams', () => {
    const m = fresh();
    const next = applyBall(m, r(5, 5, 3));
    const d = deliveryFor(m, next, 'normal')!;
    const ball = next.innings[0].balls[0];
    const bowl = next.teams.find((t) => t.id === next.innings[0].bowlingTeamId)!;
    const bat = next.teams.find((t) => t.id === next.innings[0].battingTeamId)!;
    expect(d.plan.kind).toBe('caught');
    expect(d.numbers.fielder).toBe(bowl.players.findIndex((p) => p.id === ball.fielderId) + 1);
    expect(d.numbers.bowler).toBe(bowl.players.findIndex((p) => p.id === ball.bowlerId) + 1);
    expect(d.numbers.striker).toBe(bat.players.findIndex((p) => p.id === ball.batterId) + 1);
    expect(d.numbers.nonStriker).not.toBe(d.numbers.striker);
  });

  it('returns null when no ball was added', () => {
    const m = fresh();
    expect(deliveryFor(m, m, 'normal')).toBeNull();
  });

  it('gives the waiting players and kits', () => {
    const w = waitingFor(fresh());
    expect(w.numbers.striker).toBe(1);
    expect(w.numbers.nonStriker).toBe(2);
    expect(w.kits.batting).toMatch(/^#/);
  });
});
