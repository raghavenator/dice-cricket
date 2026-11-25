import type { MatchRecord } from '../data/db';
import type { MatchState, Team } from './types';
import { getTeam } from './match';
import { aggregate, battingAverage, battingCard, bowlingCard, formatOvers, ratio, strikeRate, type CareerBat, type CareerBowl } from './stats';
import { STRUCTURE_LABEL, leagueLabel, pointsTable, type Tournament } from './tournament';
import { formatKey, legLabel, legStanding, seriesOutcome, type Series } from './series';

export type StoryDetail = 'full' | 'compact';
export interface StoryOptions {
  detail: StoryDetail;
  /** When set, included as the first field so the file is self-explanatory to an LLM. */
  instructions?: string;
}

export const DEFAULT_STORY_PROMPT =
  'You are a cricket journalist. Using only the data below, write an engaging story of this competition: how it unfolded ' +
  'match by match, the turning points, standout batting and bowling performances, and how the winner got there. Quote real ' +
  'scores and figures from the data. Do not invent players, scores or results that are not in the data.';

const COMPACT_ROWS = 3;
const COMPACT_PLAYERS = 15;

interface Played {
  number: number;
  stage: string;
  record: MatchRecord;
}

type Names = (id: string) => string;

function teamNames(teams: Team[], records: MatchRecord[]): Names {
  const map = new Map<string, string>();
  for (const r of records) for (const t of r.match.teams) map.set(t.id, t.name);
  for (const t of teams) map.set(t.id, t.name);
  return (id) => map.get(id) ?? 'Unknown team';
}

const ordinal = (n: number) => `${n}${n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th'}`;

function fallOfWickets(m: MatchState, idx: number): string[] {
  const inn = m.innings[idx];
  const bat = getTeam(m, inn.battingTeamId);
  const out: string[] = [];
  let score = 0;
  let wkts = 0;
  inn.balls.forEach((b, i) => {
    score += b.runs;
    if (!b.wicket) return;
    wkts++;
    const name = bat.players.find((p) => p.id === b.batterId)?.name ?? '?';
    out.push(`${wkts}-${score} (${name}, ${formatOvers(i + 1)} ov)`);
  });
  return out;
}

const total = (runs: number, wickets: number, allOut: boolean) => (allOut ? `${runs} all out` : `${runs}/${wickets}`);

function inningsEntry(m: MatchState, idx: number, detail: StoryDetail) {
  const inn = m.innings[idx];
  const team = getTeam(m, inn.battingTeamId).name;
  const nth = m.innings.slice(0, idx + 1).filter((x) => x.battingTeamId === inn.battingTeamId).length;
  const card = battingCard(m, idx);
  const batted = card
    .map((r, order) => ({ r, order }))
    .filter(({ r }) => r.batted);
  const shownBat = detail === 'full'
    ? batted
    : [...batted].sort((a, b) => b.r.runs - a.r.runs || a.r.balls - b.r.balls).slice(0, COMPACT_ROWS).sort((a, b) => a.order - b.order);
  const bowlers = bowlingCard(m, idx).filter((b) => b.balls > 0);
  const shownBowl = detail === 'full'
    ? bowlers
    : [...bowlers].sort((a, b) => b.wickets - a.wickets || a.runs - b.runs).slice(0, COMPACT_ROWS);
  return {
    team: m.settings.format === 'test' ? `${team} (${ordinal(nth)} innings)` : team,
    total: total(inn.runs, inn.wickets, inn.endReason === 'allOut'),
    overs: formatOvers(inn.legalBalls),
    ...(inn.target != null ? { target: inn.target } : {}),
    batting: shownBat.map(({ r }) => ({ name: r.name, runs: r.runs, balls: r.balls, fours: r.fours, sixes: r.sixes, how: r.dismissal })),
    ...(detail === 'full' ? { didNotBat: card.filter((r) => !r.batted).map((r) => r.name) } : {}),
    bowling: shownBowl.map((b) => ({ name: b.name, overs: formatOvers(b.balls), maidens: b.maidens, runs: b.runs, wickets: b.wickets })),
    fallOfWickets: fallOfWickets(m, idx),
  };
}

function matchEntry({ number, stage, record }: Played, detail: StoryDetail) {
  const m = record.match;
  return {
    number,
    stage,
    format: legLabel(m.settings),
    teams: `${m.teams[0].name} v ${m.teams[1].name}`,
    toss: m.tossText,
    result: m.result?.text ?? 'No result',
    innings: m.innings.map((_, i) => inningsEntry(m, i, detail)),
  };
}

const batRow = (c: CareerBat) => ({
  name: c.name,
  team: c.team,
  matches: c.matches,
  innings: c.innings,
  notOuts: c.notOuts,
  runs: c.runs,
  high: `${c.high}${c.highNotOut ? '*' : ''}`,
  average: battingAverage(c),
  strikeRate: strikeRate(c.runs, c.balls),
  fifties: c.fifties,
  hundreds: c.hundreds,
  fours: c.fours,
  sixes: c.sixes,
});

const bowlRow = (c: CareerBowl) => ({
  name: c.name,
  team: c.team,
  matches: c.matches,
  overs: formatOvers(c.balls),
  maidens: c.maidens,
  runs: c.runs,
  wickets: c.wickets,
  average: ratio(c.runs, c.wickets),
  economy: ratio(c.runs * 6, c.balls),
  best: `${c.bestW}/${c.bestR}`,
  fiveFors: c.fiveFors,
});

const sortBat = (a: CareerBat, b: CareerBat) => b.runs - a.runs || a.innings - b.innings;
const sortBowl = (a: CareerBowl, b: CareerBowl) => b.wickets - a.wickets || a.runs - b.runs;

function playerStats(played: Played[], detail: StoryDetail) {
  const groups = new Map<string, { format: string; matches: MatchState[] }>();
  for (const { record } of played) {
    const key = formatKey(record.match.settings);
    const g = groups.get(key) ?? { format: legLabel(record.match.settings), matches: [] };
    g.matches.push(record.match);
    groups.set(key, g);
  }
  const limit = detail === 'full' ? Infinity : COMPACT_PLAYERS;
  return [...groups.values()].map(({ format, matches }) => {
    const { bat, bowl } = aggregate(matches);
    return {
      format,
      batting: bat.filter((c) => c.innings > 0).sort(sortBat).slice(0, limit).map(batRow),
      bowling: bowl.filter((c) => c.balls > 0).sort(sortBowl).slice(0, limit).map(bowlRow),
    };
  });
}

function highlights(played: Played[]) {
  if (!played.length) return {};
  const where = (p: Played) => `Match ${p.number}, ${p.stage}`;
  const { bat, bowl } = aggregate(played.map((p) => p.record.match));
  const topBat = [...bat].sort(sortBat)[0];
  const topBowl = [...bowl].filter((c) => c.balls > 0).sort(sortBowl)[0];

  let hiScore: { text: string; runs: number; balls: number } | null = null;
  let bestFig: { text: string; w: number; r: number } | null = null;
  let hiTotal: { text: string; runs: number } | null = null;
  let loTotal: { text: string; runs: number } | null = null;
  let byRuns: { text: string; n: number } | null = null;
  let byWkts: { text: string; n: number } | null = null;

  for (const p of played) {
    const m = p.record.match;
    m.innings.forEach((inn, i) => {
      const team = getTeam(m, inn.battingTeamId).name;
      const opp = getTeam(m, inn.bowlingTeamId).name;
      for (const r of battingCard(m, i))
        if (r.batted && (!hiScore || r.runs > hiScore.runs || (r.runs === hiScore.runs && r.balls < hiScore.balls)))
          hiScore = { runs: r.runs, balls: r.balls, text: `${r.name} ${r.runs}${r.out ? '' : '*'} (${r.balls} balls) for ${team} v ${opp}, ${where(p)}` };
      for (const b of bowlingCard(m, i))
        if (b.balls > 0 && (!bestFig || b.wickets > bestFig.w || (b.wickets === bestFig.w && b.runs < bestFig.r)))
          bestFig = { w: b.wickets, r: b.runs, text: `${b.name} ${b.wickets}/${b.runs} for ${opp} v ${team}, ${where(p)}` };
      const t = `${team} ${total(inn.runs, inn.wickets, inn.endReason === 'allOut')} v ${opp}, ${where(p)}`;
      if (!hiTotal || inn.runs > hiTotal.runs) hiTotal = { runs: inn.runs, text: t };
      // Only innings that ran their full course count as a low total, not successful chases.
      if ((inn.endReason === 'allOut' || inn.endReason === 'overs') && (!loTotal || inn.runs < loTotal.runs)) loTotal = { runs: inn.runs, text: t };
    });
    const text = m.result?.text ?? '';
    const inningsWin = /innings and (\d+) run/.exec(text);
    const runs = inningsWin ? 10000 + Number(inningsWin[1]) : Number(/won by (\d+) run/.exec(text)?.[1] ?? NaN);
    const wkts = Number(/won by (\d+) wicket/.exec(text)?.[1] ?? NaN);
    if (runs > (byRuns?.n ?? -1)) byRuns = { n: runs, text: `${text}, ${where(p)}` };
    if (wkts > (byWkts?.n ?? -1)) byWkts = { n: wkts, text: `${text}, ${where(p)}` };
  }

  const h: Record<string, string> = {};
  if (topBat) h.mostRuns = `${topBat.name} (${topBat.team}): ${topBat.runs} runs in ${topBat.innings} innings`;
  if (topBowl) h.mostWickets = `${topBowl.name} (${topBowl.team}): ${topBowl.wickets} wickets in ${formatOvers(topBowl.balls)} overs`;
  const put = (k: string, v: { text: string } | null) => v && (h[k] = v.text);
  put('highestScore', hiScore);
  put('bestBowling', bestFig);
  put('highestTotal', hiTotal);
  put('lowestTotal', loTotal);
  put('biggestWinByRuns', byRuns);
  put('biggestWinByWickets', byWkts);
  return h;
}

/** Pairs fixtures with their saved matches in fixture order; unplayed fixtures become "upcoming". */
function collect<F extends { matchId?: string; result?: unknown }>(
  fixtures: F[],
  records: MatchRecord[],
  stage: (f: F) => string,
  teams: (f: F) => string,
) {
  const byId = new Map(records.map((r) => [r.id, r]));
  const played: Played[] = [];
  const upcoming: { stage: string; teams: string }[] = [];
  for (const f of fixtures) {
    const rec = f.matchId ? byId.get(f.matchId) : undefined;
    if (rec) played.push({ number: played.length + 1, stage: stage(f), record: rec });
    else if (!f.result) upcoming.push({ stage: stage(f), teams: teams(f) });
  }
  return { played, upcoming };
}

const squads = (ids: string[], teams: Team[], records: MatchRecord[]) =>
  ids.map((id) => {
    const t = teams.find((x) => x.id === id) ?? records.flatMap((r) => r.match.teams).find((x) => x.id === id);
    return t ? { name: t.name, short: t.short, squad: t.players.map((p) => p.name) } : { name: 'Unknown team', short: '?', squad: [] };
  });

const head = (opts: StoryOptions) => (opts.instructions?.trim() ? { instructions: opts.instructions.trim() } : {});

export function buildTournamentStory(t: Tournament, records: MatchRecord[], teams: Team[], opts: StoryOptions) {
  const recs = records.filter((r) => r.tournamentId === t.id);
  const name = teamNames(teams, recs);
  const { played, upcoming } = collect(
    t.fixtures,
    recs,
    (f) => (f.stage === 'group' ? `Group stage, ${f.label}` : f.label),
    (f) => `${name(f.homeId)} v ${name(f.awayId)}`,
  );
  const total = t.fixtures.length;
  return {
    ...head(opts),
    competition: {
      type: 'tournament',
      name: t.name,
      format: legLabel(t.settings),
      structure: STRUCTURE_LABEL[t.structure] + leagueLabel(t),
      status: t.status === 'complete' ? 'complete' : 'in progress',
      result: t.status === 'complete' && t.championId
        ? `${name(t.championId)} won the tournament`
        : `In progress: ${played.length} of ${total} matches played`,
    },
    teams: squads(t.teamIds, teams, recs),
    ...(t.structure !== 'knockout'
      ? {
          standings: pointsTable(t).map((r) => ({
            team: name(r.teamId), played: r.played, won: r.won, lost: r.lost, tied: r.tied, drawn: r.drawn, points: r.points,
            nrr: r.nrr.toFixed(3),
          })),
        }
      : {}),
    matches: played.map((p) => matchEntry(p, opts.detail)),
    ...(upcoming.length ? { upcoming } : {}),
    playerStats: playerStats(played, opts.detail),
    highlights: highlights(played),
  };
}

export function buildSeriesStory(s: Series, records: MatchRecord[], teams: Team[], opts: StoryOptions) {
  const recs = records.filter((r) => r.seriesId === s.id);
  const name = teamNames(teams, recs);
  const label = (id: string) => ({ name: name(id), short: teams.find((t) => t.id === id)?.short ?? name(id) });
  const multi = s.legs.length > 1;
  const { played, upcoming } = collect(
    s.fixtures,
    recs,
    (f) => {
      const leg = s.legs[f.legIdx];
      const n = s.fixtures.filter((x) => x.legIdx === f.legIdx).length;
      return n === 1 ? `One-off ${legLabel(leg.settings)}` : `${legLabel(leg.settings)} ${f.game} of ${n}`;
    },
    () => `${name(s.homeId)} v ${name(s.awayId)}`,
  );
  const outcome = seriesOutcome(s, label);
  return {
    ...head(opts),
    competition: {
      type: 'bilateral series',
      name: s.name,
      format: multi ? s.legs.map((l) => legLabel(l.settings)) : legLabel(s.legs[0].settings),
      hosts: name(s.homeId),
      status: s.status === 'complete' ? 'complete' : 'in progress',
      result: outcome.text,
    },
    teams: squads([s.homeId, s.awayId], teams, recs),
    seriesLegs: s.legs.map((_, i) => {
      const st = legStanding(s, i, label);
      return { format: st.label, games: st.games, played: st.played, score: `${name(s.homeId)} ${st.winsHome}-${st.winsAway} ${name(s.awayId)}`, summary: st.text };
    }),
    matches: played.map((p) => matchEntry(p, opts.detail)),
    ...(upcoming.length ? { upcoming } : {}),
    playerStats: playerStats(played, opts.detail),
    highlights: highlights(played),
  };
}

export type Story = ReturnType<typeof buildTournamentStory> | ReturnType<typeof buildSeriesStory>;

export const storyJson = (story: Story) => JSON.stringify(story, null, 2);

/** Text for pasting into a chat: the prompt in plain words first, then the data. */
export function storyText(story: Story) {
  const { instructions, ...data } = story as Story & { instructions?: string };
  return instructions ? `${instructions}\n\n${JSON.stringify(data, null, 2)}` : storyJson(story);
}
