import { create } from 'zustand';
import { db, uid, type LiveRecord, type MatchRecord } from '../data/db';
import { PRESET_TEAMS } from '../data/presets';
import { createMatch, simulate } from '../engine/match';
import { createTournament, recordResult, type Structure, type Tournament } from '../engine/tournament';
import { createSeries, recordSeriesResult, type Leg, type Series } from '../engine/series';
import type { Format, MatchSettings, MatchState, Team } from '../engine/types';
import type { StoryDetail } from '../engine/story';
import type { ScorecardOrder } from '../components/ScorecardOrder';

export type Screen =
  | { name: 'home' }
  | { name: 'localSim' }
  | { name: 'exTeams' }
  | { name: 'exSettings' }
  | { name: 'match' }
  | { name: 'tournaments' }
  | { name: 'tourNew' }
  | { name: 'tourHub'; id: string }
  | { name: 'seriesList' }
  | { name: 'seriesNew' }
  | { name: 'seriesHub'; id: string }
  | { name: 'teams' }
  | { name: 'backup' }
  | { name: 'stats'; tournamentId?: string; seriesId?: string; view?: StatsView }
  | { name: 'player'; playerId: string; scope: string; format: Format; back: Screen }
  | { name: 'matchView'; matchId: string; back: Screen };

/** Filters on the Stats screen, carried through navigation so Back restores them. */
export interface StatsView {
  scope: string;
  format: Format;
  tab: 'bat' | 'bowl' | 'matches';
  teams: string[];
}

export type RollSpeed = 'normal' | 'fast' | 'instant';

export interface Prefs {
  autoDelay: number; // ms between auto rolls
  rollSpeed: RollSpeed;
  lastSettings: MatchSettings;
  storyDetail?: StoryDetail;
  storyPrompt?: string;
  storyIncludePrompt?: boolean;
  /** Match screen: show the batting and bowling tables above the charts (default) or below them. */
  scorecardOrder?: ScorecardOrder;
}

const DEFAULT_PREFS: Prefs = {
  autoDelay: 2000,
  rollSpeed: 'normal',
  lastSettings: { format: 'limited', overs: 20, bowlerMode: 'auto' },
};

function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem('dice-cricket-prefs');
    if (raw) return { ...DEFAULT_PREFS, ...JSON.parse(raw) };
  } catch {
    /* storage unavailable */
  }
  return DEFAULT_PREFS;
}

interface GameState {
  ready: boolean;
  screen: Screen;
  teams: Team[];
  tournaments: Tournament[];
  series: Series[];
  live: LiveRecord | null;
  /** Every completed match, oldest first (used for player tooltips). */
  history: MatchRecord[];
  exPick: [string | null, string | null];
  prefs: Prefs;

  init(): Promise<void>;
  go(screen: Screen): void;
  setPrefs(p: Partial<Prefs>): void;
  setExPick(pick: [string | null, string | null]): void;

  saveTeam(t: Team): Promise<void>;
  deleteTeam(id: string): Promise<void>;
  restorePresets(): Promise<void>;

  startMatch(homeId: string, awayId: string, settings: MatchSettings, ctx?: MatchContext): void;
  updateLive(m: MatchState): void;
  closeLive(): void;

  newTournament(name: string, teamIds: string[], settings: MatchSettings, structure: Structure, legs?: 1 | 2): Promise<string>;
  deleteTournament(id: string): Promise<void>;
  simFixture(tournamentId: string, fixtureId: string): Promise<void>;

  newSeries(name: string, homeId: string, awayId: string, legs: Leg[]): Promise<string>;
  deleteSeries(id: string): Promise<void>;
  simSeriesFixture(seriesId: string, fixtureId: string): Promise<void>;
}

export interface MatchContext {
  tournamentId?: string;
  seriesId?: string;
  fixtureId?: string;
}

const teamById = (teams: Team[], id: string) => {
  const t = teams.find((x) => x.id === id);
  if (!t) throw new Error('Team not found');
  return t;
};

export const useGame = create<GameState>((set, get) => {
  /** Write a finished match to history and update its tournament. */
  async function finalize(rec: LiveRecord) {
    if (!rec.match.result || rec.saved) return;
    const record: MatchRecord = {
      id: rec.match.id,
      tournamentId: rec.tournamentId,
      fixtureId: rec.fixtureId,
      seriesId: rec.seriesId ?? null,
      completedAt: Date.now(),
      match: rec.match,
    };
    await db.matches.put(record);
    set({ history: [...get().history.filter((r) => r.id !== record.id), record] });
    if (rec.tournamentId && rec.fixtureId) {
      const t = await db.tournaments.get(rec.tournamentId);
      const f = t?.fixtures.find((x) => x.id === rec.fixtureId);
      if (t && f && !f.result) {
        const next = recordResult(t, rec.fixtureId, rec.match, Math.random);
        await db.tournaments.put(next);
        set({ tournaments: get().tournaments.map((x) => (x.id === next.id ? next : x)) });
      }
    }
    if (rec.seriesId && rec.fixtureId) {
      const s = await db.series.get(rec.seriesId);
      const f = s?.fixtures.find((x) => x.id === rec.fixtureId);
      if (s && f && !f.result) {
        const next = recordSeriesResult(s, rec.fixtureId, rec.match);
        await db.series.put(next);
        set({ series: get().series.map((x) => (x.id === next.id ? next : x)) });
      }
    }
  }

  return {
    ready: false,
    screen: { name: 'home' },
    teams: [],
    tournaments: [],
    series: [],
    live: null,
    history: [],
    exPick: [null, null],
    prefs: loadPrefs(),

    async init() {
      let teams = await db.teams.toArray();
      if (teams.length === 0) {
        await db.teams.bulkPut(PRESET_TEAMS);
        teams = PRESET_TEAMS;
      }
      const live = (await db.live.get('live')) ?? null;
      if (live && live.match.result && !live.saved) {
        await finalize(live);
        live.saved = true;
        await db.live.put(live);
      }
      const tournaments = await db.tournaments.orderBy('createdAt').reverse().toArray();
      const series = await db.series.orderBy('createdAt').reverse().toArray();
      const history = await db.matches.orderBy('completedAt').toArray();
      set({ teams, tournaments, series, live, history, ready: true });
    },

    go(screen) {
      set({ screen });
      window.scrollTo?.(0, 0);
    },

    setPrefs(p) {
      const prefs = { ...get().prefs, ...p };
      set({ prefs });
      try {
        localStorage.setItem('dice-cricket-prefs', JSON.stringify(prefs));
      } catch {
        /* ignore */
      }
    },

    setExPick(exPick) {
      set({ exPick });
    },

    async saveTeam(t) {
      await db.teams.put(t);
      const teams = get().teams.some((x) => x.id === t.id)
        ? get().teams.map((x) => (x.id === t.id ? t : x))
        : [...get().teams, t];
      set({ teams });
    },

    async deleteTeam(id) {
      await db.teams.delete(id);
      set({ teams: get().teams.filter((x) => x.id !== id) });
    },

    async restorePresets() {
      await db.teams.bulkPut(PRESET_TEAMS);
      const custom = get().teams.filter((t) => !PRESET_TEAMS.some((p) => p.id === t.id));
      set({ teams: [...PRESET_TEAMS, ...custom] });
    },

    startMatch(homeId, awayId, settings, ctx = {}) {
      const { teams } = get();
      const match = createMatch(uid('m'), teamById(teams, homeId), teamById(teams, awayId), settings, Math.random);
      const live: LiveRecord = {
        key: 'live',
        match,
        tournamentId: ctx.tournamentId ?? null,
        seriesId: ctx.seriesId ?? null,
        fixtureId: ctx.fixtureId ?? null,
        saved: false,
      };
      set({ live, screen: { name: 'match' } });
      void db.live.put(live);
    },

    updateLive(m) {
      const cur = get().live;
      if (!cur) return;
      const live: LiveRecord = { ...cur, match: m };
      set({ live });
      void (async () => {
        if (m.result && !live.saved) {
          await finalize(live);
          live.saved = true;
          if (get().live?.match.id === m.id) set({ live: { ...live } });
        }
        await db.live.put(live);
      })();
    },

    closeLive() {
      const live = get().live;
      const screen: Screen = live?.tournamentId
        ? { name: 'tourHub', id: live.tournamentId }
        : live?.seriesId
          ? { name: 'seriesHub', id: live.seriesId }
          : { name: 'home' };
      set({ live: null, screen });
      void db.live.delete('live');
    },

    async newTournament(name, teamIds, settings, structure, legs = 1) {
      const t = createTournament(uid('t'), name, teamIds, settings, structure, Math.random, legs);
      await db.tournaments.put(t);
      set({ tournaments: [t, ...get().tournaments] });
      return t.id;
    },

    async deleteTournament(id) {
      await db.tournaments.delete(id);
      await db.matches.where('tournamentId').equals(id).delete();
      set({
        tournaments: get().tournaments.filter((t) => t.id !== id),
        history: get().history.filter((r) => r.tournamentId !== id),
      });
    },

    async simFixture(tournamentId, fixtureId) {
      const t = get().tournaments.find((x) => x.id === tournamentId);
      const f = t?.fixtures.find((x) => x.id === fixtureId);
      if (!t || !f || f.result) return;
      const { teams } = get();
      const m = simulate(
        createMatch(uid('m'), teamById(teams, f.homeId), teamById(teams, f.awayId), t.settings, Math.random),
        Math.random,
        'match',
      );
      await finalize({ key: 'live', match: m, tournamentId, fixtureId, saved: false });
    },

    async newSeries(name, homeId, awayId, legs) {
      const s = createSeries(uid('s'), name, homeId, awayId, legs);
      await db.series.put(s);
      set({ series: [s, ...get().series] });
      return s.id;
    },

    async deleteSeries(id) {
      await db.series.delete(id);
      await db.matches.where('seriesId').equals(id).delete();
      set({
        series: get().series.filter((s) => s.id !== id),
        history: get().history.filter((r) => r.seriesId !== id),
      });
    },

    async simSeriesFixture(seriesId, fixtureId) {
      const s = get().series.find((x) => x.id === seriesId);
      const f = s?.fixtures.find((x) => x.id === fixtureId);
      if (!s || !f || f.result) return;
      const { teams } = get();
      const m = simulate(
        createMatch(uid('m'), teamById(teams, s.homeId), teamById(teams, s.awayId), s.legs[f.legIdx].settings, Math.random),
        Math.random,
        'match',
      );
      await finalize({ key: 'live', match: m, tournamentId: null, seriesId, fixtureId, saved: false });
    },
  };
});
