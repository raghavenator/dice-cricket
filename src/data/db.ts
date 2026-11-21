import Dexie, { type Table } from 'dexie';
import type { MatchState, Team } from '../engine/types';
import type { Tournament } from '../engine/tournament';
import type { Series } from '../engine/series';

export interface MatchRecord {
  id: string;
  tournamentId: string | null;
  fixtureId: string | null;
  seriesId?: string | null;
  completedAt: number;
  match: MatchState;
}

export interface LiveRecord {
  key: 'live';
  match: MatchState;
  tournamentId: string | null;
  fixtureId: string | null;
  seriesId?: string | null;
  /** Set once the finished match has been written to history. */
  saved: boolean;
}

class DiceCricketDB extends Dexie {
  teams!: Table<Team, string>;
  tournaments!: Table<Tournament, string>;
  matches!: Table<MatchRecord, string>;
  live!: Table<LiveRecord, string>;
  series!: Table<Series, string>;

  constructor() {
    super('dice-cricket');
    this.version(1).stores({
      teams: 'id',
      tournaments: 'id, createdAt',
      matches: 'id, tournamentId, completedAt',
      live: 'key',
    });
    this.version(2).stores({
      matches: 'id, tournamentId, seriesId, completedAt',
      series: 'id, createdAt',
    });
  }
}

export const db = new DiceCricketDB();

export const uid = (prefix = '') =>
  prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
