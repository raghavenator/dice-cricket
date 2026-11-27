import type { Outcome } from './outcome';

export type LabelTone = 'run' | 'four' | 'six' | 'out' | 'dot';

export interface ResultLabel {
  text: string;
  sub?: string;
  tone: LabelTone;
}

/** The big label shown over the scene. Wording matches the ball-by-ball commentary. */
export function labelFor(o: Outcome): ResultLabel {
  switch (o.kind) {
    case 'ground':
      return { text: `${o.runs} RUN${o.runs === 1 ? '' : 'S'}`, tone: 'run' };
    case 'four':
      return { text: 'FOUR!', tone: 'four' };
    case 'six':
      return { text: 'SIX!', tone: 'six' };
    case 'bowled':
      return { text: 'OUT!', sub: 'BOWLED', tone: 'out' };
    case 'lbw':
      return { text: 'OUT!', sub: 'LBW', tone: 'out' };
    case 'caught':
      return { text: 'OUT!', sub: o.cAndB ? 'CAUGHT & BOWLED' : 'CAUGHT', tone: 'out' };
    case 'survive':
      return { text: 'DOT BALL', sub: 'SURVIVES!', tone: 'dot' };
  }
}
