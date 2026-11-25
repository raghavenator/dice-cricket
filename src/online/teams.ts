import Dexie from 'dexie';
import { db } from '../data/db';
import { PRESET_TEAMS } from '../data/presets';
import type { Team } from '../engine/types';
import { parseTeam } from './validate';

export interface TeamChoice {
  team: Team;
  /** Why it cannot be used online, or null. */
  problem: string | null;
}

/** Your teams from the main game, only read. Falls back to the sample teams where the game has never been opened. */
export async function loadTeams(): Promise<TeamChoice[]> {
  let teams: Team[] = [];
  try {
    // Opening a database that does not exist would create it, so check first.
    if (await Dexie.exists('dice-cricket')) teams = await db.teams.toArray();
  } catch {
    /* storage unavailable */
  }
  return (teams.length ? teams : PRESET_TEAMS).map((team) => {
    try {
      return { team: parseTeam(team), problem: null };
    } catch (e) {
      return { team, problem: (e as Error).message };
    }
  });
}
