import { db, type LiveRecord, type MatchRecord } from './db';
import type { Team } from '../engine/types';
import type { Tournament } from '../engine/tournament';
import { pointsTable } from '../engine/tournament';
import type { Series } from '../engine/series';
import { aggregate, battingCard, bowlingCard } from '../engine/stats';
import type { Prefs } from '../store/useGameStore';
import * as V from './validate';
import { downloadText } from './download';
import { BackupError } from './validate';

export { BackupError };

export const BACKUP_APP = 'dice-cricket';
export const BACKUP_FORMAT = 1;
export const MAX_BACKUP_BYTES = 25 * 1024 * 1024;
const PREFS_KEY = 'dice-cricket-prefs';

export interface BackupData {
  teams: Team[];
  tournaments: Tournament[];
  series: Series[];
  matches: MatchRecord[];
  live: LiveRecord[];
}

export interface Backup {
  app: typeof BACKUP_APP;
  format: typeof BACKUP_FORMAT;
  dbVersion: number;
  exportedAt: number;
  data: BackupData;
  prefs?: Partial<Prefs>;
}

export type Counts = Record<keyof BackupData, number>;

const tables = () => [db.teams, db.tournaments, db.series, db.matches, db.live];

export async function exportBackup(): Promise<Backup> {
  const [teams, tournaments, series, matches, live] = await db.transaction('r', tables(), () =>
    Promise.all([db.teams.toArray(), db.tournaments.toArray(), db.series.toArray(), db.matches.toArray(), db.live.toArray()]),
  );
  let prefs: Partial<Prefs> | undefined;
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (raw) prefs = V.prefs(JSON.parse(raw));
  } catch {
    /* storage unavailable or unreadable */
  }
  return {
    app: BACKUP_APP,
    format: BACKUP_FORMAT,
    dbVersion: db.verno,
    exportedAt: Date.now(),
    data: { teams, tournaments, series, matches, live },
    ...(prefs ? { prefs } : {}),
  };
}

export const downloadBackup = (b: Backup, filename: string) => downloadText(JSON.stringify(b), filename);

export const backupFilename = (label = 'backup', when = new Date()) =>
  `dice-cricket-${label}-${when.toLocaleDateString('en-CA')}.json`;

/** Parses and fully validates a backup file. Throws BackupError with a readable message. */
export function parseBackup(text: string): Backup {
  if (text.length > MAX_BACKUP_BYTES) throw new BackupError('File is too large to be a Dice Cricket backup.');
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new BackupError('This file is not valid JSON.');
  }
  if (typeof raw !== 'object' || raw === null || (raw as { app?: unknown }).app !== BACKUP_APP)
    throw new BackupError('Not a Dice Cricket backup file.');
  const o = raw as Record<string, unknown>;
  if (o.format !== BACKUP_FORMAT) throw new BackupError('This backup was made by a different version of the app.');
  if (typeof o.data !== 'object' || o.data === null) throw new BackupError('The backup has no data section.');
  const d = o.data as Record<string, unknown>;
  const data: BackupData = {
    teams: V.list(V.team, 0, 5000)(d.teams, 'teams'),
    tournaments: V.list(V.tournament, 0, 5000)(d.tournaments, 'tournaments'),
    series: V.list(V.series, 0, 5000)(d.series, 'series'),
    matches: V.list(V.matchRecord, 0, 100000)(d.matches, 'matches'),
    live: V.list(V.liveRecord, 0, 1)(d.live, 'live'),
  };
  const backup: Backup = {
    app: BACKUP_APP,
    format: BACKUP_FORMAT,
    dbVersion: typeof o.dbVersion === 'number' ? o.dbVersion : 0,
    exportedAt: typeof o.exportedAt === 'number' && Number.isFinite(o.exportedAt) ? o.exportedAt : 0,
    data,
    ...(V.prefs(o.prefs) ? { prefs: V.prefs(o.prefs) } : {}),
  };
  trialRun(data);
  return backup;
}

/** Runs the real stats code over the data so a file that would crash the app is rejected up front. */
function trialRun(d: BackupData) {
  try {
    const all = [...d.matches.map((r) => r.match), ...d.live.map((l) => l.match)];
    aggregate(d.matches.map((r) => r.match));
    for (const m of all)
      m.innings.forEach((_, i) => {
        battingCard(m, i);
        bowlingCard(m, i);
      });
    d.tournaments.forEach((t) => pointsTable(t));
  } catch {
    throw new BackupError("This backup can't be read by this version of the app.");
  }
}

export const backupCounts = (d: BackupData): Counts => ({
  teams: d.teams.length,
  tournaments: d.tournaments.length,
  series: d.series.length,
  matches: d.matches.length,
  live: d.live.length,
});

const played = (x: { fixtures: { result?: unknown }[] }) => x.fixtures.filter((f) => f.result).length;

/** Keeps the existing copy of a tournament/series when it has more results, so an old backup can't undo progress. */
async function mergeProgressed<T extends { id: string; fixtures: { result?: unknown }[] }>(
  table: { bulkGet(ids: string[]): Promise<(T | undefined)[]>; bulkPut(items: T[]): Promise<unknown> },
  incoming: T[],
) {
  const existing = await table.bulkGet(incoming.map((x) => x.id));
  await table.bulkPut(incoming.filter((x, i) => !existing[i] || played(x) >= played(existing[i]!)));
}

export async function importBackup(b: Backup, mode: 'merge' | 'replace'): Promise<Counts> {
  const { teams, tournaments, series, matches, live } = b.data;
  await db.transaction('rw', tables(), async () => {
    if (mode === 'replace') {
      await Promise.all(tables().map((t) => t.clear()));
      await db.tournaments.bulkPut(tournaments);
      await db.series.bulkPut(series);
      await db.live.bulkPut(live);
    } else {
      await mergeProgressed(db.tournaments, tournaments);
      await mergeProgressed(db.series, series);
      const cur = await db.live.get('live');
      if (live.length && (!cur || cur.match.result)) await db.live.bulkPut(live);
    }
    await db.teams.bulkPut(teams);
    await db.matches.bulkPut(matches);
  });
  if (mode === 'replace' && b.prefs) {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(b.prefs));
    } catch {
      /* ignore */
    }
  }
  return backupCounts(b.data);
}
