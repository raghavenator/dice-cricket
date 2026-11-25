import Dexie, { type Table } from 'dexie';
import type { Lineup } from './lineup';

interface SavedLineup {
  teamId: string;
  lineup: Lineup;
}

/** The online mode's own database. The main game's database is never written to from here. */
class OnlineDB extends Dexie {
  lineups!: Table<SavedLineup, string>;

  constructor() {
    super('dice-cricket-online');
    this.version(1).stores({ lineups: 'teamId' });
  }
}

const onlineDb = new OnlineDB();

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
