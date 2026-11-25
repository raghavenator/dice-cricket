import { getGuest } from './guest';
import { pendingRooms, resultSettled, saveFinished } from './onlineDb';
import { PROTOCOL_VERSION, type RoomResults } from './protocol';
import { serverUrl } from './useOnlineStore';

async function askRoom(code: string): Promise<RoomResults | null> {
  try {
    const res = await fetch(`${serverUrl()}/rooms/${code}/results`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ v: PROTOCOL_VERSION, token: getGuest().token }),
    });
    return res.ok ? ((await res.json()) as RoomResults) : null;
  } catch {
    return null;
  }
}

/**
 * Saves the results of matches that ended while this browser was closed or offline. Returns the rooms where a match
 * is still going on, so the player can go back to it. Rooms that cannot be reached are left for next time.
 */
export async function collectResults(): Promise<string[]> {
  if (!serverUrl()) return [];
  const live: string[] = [];
  for (const code of await pendingRooms()) {
    const reply = await askRoom(code);
    if (!reply) continue;
    await saveFinished(reply.ownerId, reply.results);
    if (reply.live) live.push(code);
    else await resultSettled(code);
  }
  return live;
}
