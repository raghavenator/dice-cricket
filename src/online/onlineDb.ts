import Dexie, { type Table } from 'dexie';
import { ALIAS } from './alias';
import type { Lineup } from './lineup';
import type { FinishedMatch } from './protocol';

interface SavedLineup {
  teamId: string;
  lineup: Lineup;
}

/** A finished online match. Both players keep the same one; whose side was yours comes from `me`. */
export interface OnlineRecord extends FinishedMatch {
  id: string;
}

/** A room with a match whose result has not been saved here yet. */
interface PendingRoom {
  code: string;
  since: number;
}

/** A public id that this player has used, so matches under it are theirs. */
interface MyId {
  ownerId: string;
}

/** The online mode's own database. The main game's database is never written to from here. */
class OnlineDB extends Dexie {
  lineups!: Table<SavedLineup, string>;
  matches!: Table<OnlineRecord, string>;
  pending!: Table<PendingRoom, string>;
  me!: Table<MyId, string>;

  constructor() {
    super(`dice-cricket-online${ALIAS}`);
    this.version(1).stores({ lineups: 'teamId' });
    this.version(2).stores({ matches: 'id, completedAt', pending: 'code', me: 'ownerId' });
  }
}

export const onlineDb = new OnlineDB();

/** The last lineup used for this team, if any. Remembering is a convenience, so storage trouble is ignored. */
export async function recallLineup(teamId: string): Promise<Lineup | null> {
  try {
    return (await onlineDb.lineups.get(teamId))?.lineup ?? null;
  } catch {
    return null;
  }
}

export async function rememberLineup(teamId: string, lineup: Lineup): Promise<void> {
  try {
    await onlineDb.lineups.put({ teamId, lineup });
  } catch {
    /* storage unavailable */
  }
}

/** A match has started in this room, so there will be a result to save. */
export async function expectResult(code: string, ownerId: string): Promise<void> {
  await onlineDb.transaction('rw', onlineDb.pending, onlineDb.me, async () => {
    await onlineDb.me.put({ ownerId });
    await onlineDb.pending.put({ code, since: Date.now() });
  });
}

/** Saves finished matches. Saving one again changes nothing, so each is only ever counted once. */
export async function saveFinished(ownerId: string, finished: FinishedMatch[]): Promise<void> {
  const mine = finished.filter((f) => f.match.result && (f.host.ownerId === ownerId || f.guest.ownerId === ownerId));
  if (!mine.length) return;
  await onlineDb.transaction('rw', onlineDb.matches, onlineDb.me, async () => {
    await onlineDb.me.put({ ownerId });
    await onlineDb.matches.bulkPut(
      mine.map(({ match, host, guest, end, completedAt }) => ({ id: match.id, match, host, guest, end, completedAt })),
    );
  });
}

/** Nothing more to wait for in this room. */
export async function resultSettled(code: string): Promise<void> {
  await onlineDb.pending.delete(code);
}

export const pendingRooms = async (): Promise<string[]> => (await onlineDb.pending.toArray()).map((p) => p.code);

/** Saved matches, oldest first. */
export const savedMatches = (): Promise<OnlineRecord[]> => onlineDb.matches.orderBy('completedAt').toArray();
