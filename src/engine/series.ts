import type { MatchSettings, MatchState, Result } from './types';

export interface Leg {
  key: string;
  settings: MatchSettings;
  games: number;
}

export interface SeriesFixture {
  id: string;
  legIdx: number;
  /** 1-based game number within its leg. */
  game: number;
  matchId?: string;
  result?: Result;
}

export interface Series {
  id: string;
  name: string;
  createdAt: number;
  homeId: string;
  awayId: string;
  legs: Leg[];
  fixtures: SeriesFixture[];
  status: 'active' | 'complete';
}

export interface TeamLabel {
  name: string;
  short: string;
}

export const formatKey = (s: MatchSettings) =>
  s.format === 'test' ? (s.overs ? `test:${s.overs}` : 'test') : `limited:${s.overs}`;

/** "Test" or "10-over". */
export const legLabel = (s: MatchSettings) => (s.format === 'test' ? 'Test' : `${s.overs}-over`);

const oneOff = (s: MatchSettings) => (s.format === 'test' ? 'one-off Test' : `one-off ${s.overs}-over match`);

/** Adds `games` of `settings` to the schedule, merging into an existing leg of the same format. */
export function addLeg(legs: Leg[], settings: MatchSettings, games: number): Leg[] {
  const key = formatKey(settings);
  return legs.some((l) => l.key === key)
    ? legs.map((l) => (l.key === key ? { ...l, games: l.games + games } : l))
    : [...legs, { key, settings, games }];
}

export function createSeries(id: string, name: string, homeId: string, awayId: string, legs: Leg[]): Series {
  if (homeId === awayId) throw new Error('A team cannot play itself');
  const fixtures: SeriesFixture[] = legs.flatMap((leg, legIdx) =>
    Array.from({ length: leg.games }, (_, g) => ({ id: `${id}-L${legIdx}G${g + 1}`, legIdx, game: g + 1 })),
  );
  if (!fixtures.length) throw new Error('A series needs at least one match');
  return { id, name, createdAt: Date.now(), homeId, awayId, legs, fixtures, status: 'active' };
}

export const nextSeriesFixture = (s: Series) => s.fixtures.find((f) => !f.result);

export function recordSeriesResult(s: Series, fixtureId: string, m: MatchState): Series {
  if (!m.result) throw new Error('Match is not finished');
  const fixtures = s.fixtures.map((f) => (f.id === fixtureId ? { ...f, matchId: m.id, result: m.result! } : f));
  return { ...s, fixtures, status: fixtures.every((f) => f.result) ? 'complete' : 'active' };
}

export interface LegStanding {
  label: string;
  games: number;
  played: number;
  winsHome: number;
  winsAway: number;
  complete: boolean;
  /** Set when the completed leg has a winner. */
  winnerId: string | null;
  /** Winner's score first when there is a winner, otherwise home first. */
  score: string;
  text: string;
}

export function legStanding(s: Series, legIdx: number, team: (id: string) => TeamLabel): LegStanding {
  const leg = s.legs[legIdx];
  const fs = s.fixtures.filter((f) => f.legIdx === legIdx);
  const done = fs.filter((f) => f.result);
  const winsHome = done.filter((f) => f.result!.winnerId === s.homeId).length;
  const winsAway = done.filter((f) => f.result!.winnerId === s.awayId).length;
  const complete = done.length === fs.length;
  const lead = winsHome === winsAway ? null : winsHome > winsAway ? s.homeId : s.awayId;
  const hi = Math.max(winsHome, winsAway);
  const lo = Math.min(winsHome, winsAway);
  const label = legLabel(leg.settings);
  const winnerId = complete ? lead : null;
  const score = lead ? `${hi}-${lo}` : `${winsHome}-${winsAway}`;

  let text: string;
  if (complete) {
    if (fs.length === 1) {
      const r = done[0].result!;
      text = winnerId
        ? `${team(winnerId).name} won the ${oneOff(leg.settings)}`
        : `The ${oneOff(leg.settings)} was ${r.kind === 'tie' ? 'tied' : 'drawn'}`;
    } else {
      text = winnerId
        ? `${team(winnerId).name} won the ${fs.length}-match ${label} series ${score}`
        : `The ${fs.length}-match ${label} series was drawn ${score}`;
    }
  } else if (!done.length) {
    text = fs.length === 1 ? `${oneOff(leg.settings)[0].toUpperCase()}${oneOff(leg.settings).slice(1)}` : `${fs.length}-match ${label} series`;
  } else {
    text = lead ? `${team(lead).short} lead ${score}` : `Level ${score}`;
  }

  return { label, games: fs.length, played: done.length, winsHome, winsAway, complete, winnerId, score, text };
}

export interface SeriesOutcome {
  complete: boolean;
  winnerId: string | null;
  /** Mini-series won by each side (equals match wins when there is only one format). */
  home: number;
  away: number;
  score: string;
  multi: boolean;
  text: string;
}

export function seriesOutcome(s: Series, team: (id: string) => TeamLabel): SeriesOutcome {
  const legs = s.legs.map((_, i) => legStanding(s, i, team));
  if (legs.length === 1) {
    const l = legs[0];
    return {
      complete: l.complete, winnerId: l.winnerId, home: l.winsHome, away: l.winsAway, score: l.score, multi: false, text: l.text,
    };
  }
  const home = legs.filter((l) => l.winnerId === s.homeId).length;
  const away = legs.filter((l) => l.winnerId === s.awayId).length;
  const complete = legs.every((l) => l.complete);
  const lead = home === away ? null : home > away ? s.homeId : s.awayId;
  const winnerId = complete ? lead : null;
  const score = lead ? `${Math.max(home, away)}-${Math.min(home, away)}` : `${home}-${away}`;
  const decided = legs.filter((l) => l.complete).length;
  const text = complete
    ? winnerId
      ? `${team(winnerId).name} won the multi-format series ${score}`
      : `The multi-format series was drawn ${score}`
    : `${decided} of ${legs.length} series decided${lead ? ` · ${team(lead).short} lead ${score}` : decided ? ` · level ${score}` : ''}`;
  return { complete, winnerId, home, away, score, multi: true, text };
}
