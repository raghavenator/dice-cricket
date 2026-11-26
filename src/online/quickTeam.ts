import { PRESET_TEAMS } from '../data/presets';
import type { Team } from '../engine/types';
import { ALIAS } from './alias';

const KEY = `dice-cricket-online-quick-team${ALIAS}`;

/** The sample team to offer for a quick match: the last one used, or a random one the first time. */
export function preferredQuickTeam(): Team {
  let id: string | null = null;
  try {
    id = localStorage.getItem(KEY);
  } catch {
    // Storage is unavailable: fall through to a random team.
  }
  const team = PRESET_TEAMS.find((t) => t.id === id);
  if (team) return team;
  const random = PRESET_TEAMS[Math.floor(Math.random() * PRESET_TEAMS.length)];
  rememberQuickTeam(random.id);
  return random;
}

export function rememberQuickTeam(id: string) {
  try {
    localStorage.setItem(KEY, id);
  } catch {
    // Not remembered: the next visit picks again.
  }
}
