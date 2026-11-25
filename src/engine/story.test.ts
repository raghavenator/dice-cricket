import { describe, expect, it } from 'vitest';
import type { MatchRecord } from '../data/db';
import { PRESET_TEAMS } from '../data/presets';
import { createMatch, getTeam, simulate } from './match';
import { createTournament, nextFixture, pointsTable, recordResult, type Tournament } from './tournament';
import { addLeg, createSeries, nextSeriesFixture, recordSeriesResult, seriesOutcome, type Series } from './series';
import { DEFAULT_STORY_PROMPT, buildSeriesStory, buildTournamentStory, storyJson, storyText } from './story';
import type { MatchSettings } from './types';

function seeded(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const [A, B, C, D] = PRESET_TEAMS;
const team = (id: string) => PRESET_TEAMS.find((t) => t.id === id)!;
const t20: MatchSettings = { format: 'limited', overs: 10, bowlerMode: 'auto' };
const test: MatchSettings = { format: 'test', overs: 0, bowlerMode: 'auto' };
const label = (id: string) => ({ name: team(id).name, short: team(id).short });

function playTournament(stopAfter = Infinity) {
  const rng = seeded(42);
  let t: Tournament = createTournament('t1', 'Dice Cup', [A.id, B.id, C.id, D.id], t20, 'roundRobinPlayoffs', rng);
  const records: MatchRecord[] = [];
  for (let f = nextFixture(t); f && records.length < stopAfter; f = nextFixture(t)) {
    const m = simulate(createMatch(`tm${records.length}`, team(f.homeId), team(f.awayId), t.settings, rng), rng, 'match');
    t = recordResult(t, f.id, m, rng);
    records.push({ id: m.id, tournamentId: t.id, fixtureId: f.id, seriesId: null, completedAt: records.length, match: m });
  }
  return { t, records };
}

function playSeries(stopAfter = Infinity) {
  const rng = seeded(7);
  let s: Series = createSeries('s1', 'Ashes', A.id, B.id, addLeg(addLeg([], test, 1), t20, 2));
  const records: MatchRecord[] = [];
  for (let f = nextSeriesFixture(s); f && records.length < stopAfter; f = nextSeriesFixture(s)) {
    const m = simulate(createMatch(`sm${records.length}`, A, B, s.legs[f.legIdx].settings, rng), rng, 'match');
    s = recordSeriesResult(s, f.id, m);
    records.push({ id: m.id, tournamentId: null, fixtureId: f.id, seriesId: s.id, completedAt: records.length, match: m });
  }
  return { s, records };
}

describe('tournament story', () => {
  const { t, records } = playTournament();
  const full = buildTournamentStory(t, records, PRESET_TEAMS, { detail: 'full' });

  it('lists every played match in fixture order with the real result', () => {
    expect(full.matches).toHaveLength(records.length);
    const inOrder = t.fixtures.filter((f) => f.matchId).map((f) => records.find((r) => r.id === f.matchId)!.match.result!.text);
    expect(full.matches.map((m) => m.result)).toEqual(inOrder);
    expect(full.matches.at(-1)!.stage).toBe('Final');
    expect(full.competition.result).toBe(`${team(t.championId!).name} won the tournament`);
  });

  it('scorecards match the innings and fall of wickets adds up', () => {
    full.matches.forEach((entry, i) => {
      const m = records.find((r) => r.id === t.fixtures.filter((f) => f.matchId)[i].matchId)!.match;
      entry.innings.forEach((inn, j) => {
        const src = m.innings[j];
        expect(inn.total.startsWith(String(src.runs))).toBe(true);
        expect(inn.fallOfWickets).toHaveLength(src.wickets);
        const last = inn.fallOfWickets.at(-1);
        if (last) expect(Number(/^\d+-(\d+)/.exec(last)![1])).toBeLessThanOrEqual(src.runs);
        expect(inn.batting.reduce((s, b) => s + b.runs, 0)).toBe(src.runs);
        expect(inn.batting.length + inn.didNotBat!.length).toBe(getTeam(m, src.battingTeamId).players.length);
      });
    });
  });

  it('standings come from the points table, using names', () => {
    expect(full.standings!.map((r) => r.team)).toEqual(pointsTable(t).map((r) => team(r.teamId).name));
  });

  it('contains no rolls and no internal ids', () => {
    const json = storyJson(full);
    expect(json).not.toMatch(/roll1|roll2|batterId|bowlerId/);
    expect(json).not.toContain(A.players[0].id);
    expect(json).not.toContain(`"${A.id}"`);
  });

  it('compact trims scorecards and player lists', () => {
    const compact = buildTournamentStory(t, records, PRESET_TEAMS, { detail: 'compact' });
    for (const m of compact.matches)
      for (const inn of m.innings) {
        expect(inn.batting.length).toBeLessThanOrEqual(3);
        expect(inn.bowling.length).toBeLessThanOrEqual(3);
        expect('didNotBat' in inn).toBe(false);
      }
    expect(compact.playerStats[0].batting.length).toBeLessThanOrEqual(15);
    expect(storyJson(compact).length).toBeLessThan(storyJson(full).length);
  });

  it('player stats are sorted leaders with readable figures', () => {
    const { batting, bowling } = full.playerStats[0];
    expect(batting[0].runs).toBeGreaterThanOrEqual(batting[1].runs);
    expect(bowling[0].wickets).toBeGreaterThanOrEqual(bowling[1].wickets);
    expect(bowling[0].best).toMatch(/^\d+\/\d+$/);
    expect(full.highlights.mostRuns).toContain(batting[0].name);
  });

  it('an unfinished tournament lists upcoming fixtures', () => {
    const part = playTournament(2);
    const story = buildTournamentStory(part.t, part.records, PRESET_TEAMS, { detail: 'full' });
    expect(story.matches).toHaveLength(2);
    expect(story.upcoming!.length).toBeGreaterThan(0);
    expect(story.competition.status).toBe('in progress');
  });
});

describe('series story', () => {
  const { s, records } = playSeries();
  const story = buildSeriesStory(s, records, PRESET_TEAMS, { detail: 'full' });

  it('reports the series result and one stats group per format', () => {
    expect(story.competition.result).toBe(seriesOutcome(s, label).text);
    expect(story.playerStats.map((g) => g.format)).toEqual(['Test', '10-over']);
    expect(story.matches.map((m) => m.stage)).toEqual(['One-off Test', '10-over 1 of 2', '10-over 2 of 2']);
    expect(story.seriesLegs).toHaveLength(2);
  });

  it('labels Test innings by number', () => {
    expect(story.matches[0].innings[0].team).toMatch(/\(1st innings\)$/);
  });
});

describe('prompt', () => {
  const { t, records } = playTournament(3);

  it('includes instructions only when a prompt is given', () => {
    const withPrompt = buildTournamentStory(t, records, PRESET_TEAMS, { detail: 'compact', instructions: DEFAULT_STORY_PROMPT });
    const dataOnly = buildTournamentStory(t, records, PRESET_TEAMS, { detail: 'compact' });
    expect(Object.keys(withPrompt)[0]).toBe('instructions');
    expect('instructions' in dataOnly).toBe(false);
    expect(storyText(withPrompt).startsWith(`${DEFAULT_STORY_PROMPT}\n\n{`)).toBe(true);
    expect(storyText(withPrompt)).not.toContain('"instructions"');
    expect(storyText(dataOnly)).toBe(storyJson(dataOnly));
  });
});
