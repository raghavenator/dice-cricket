import 'fake-indexeddb/auto';
import { PRESET_TEAMS } from '../data/presets';
import { applyEvent } from './events';
import { defaultLineup, onlineSettings } from './lineup';
import { expectResult, onlineDb, pendingRooms, recallLineup, rememberLineup, resultSettled, saveFinished, savedMatches } from './onlineDb';
import type { FinishedMatch } from './protocol';
import { createOnlineMatch } from './rules';

const [hawks, rhinos] = PRESET_TEAMS;
const host = { ownerId: 'HHH', nickname: 'Raj' };
const guest = { ownerId: 'GGG', nickname: 'Sam' };

function finished(id: string, completedAt: number): FinishedMatch {
  const m = createOnlineMatch(
    id, { ...host, team: hawks }, { ...guest, team: rhinos }, onlineSettings(5), { winnerId: 'HHH', choice: 'bat' }, completedAt - 1,
  );
  return { match: applyEvent(m, { type: 'forfeit', teamId: 'GGG/p-rhinos' }), host, guest, end: { kind: 'forfeit', loser: 'guest' }, completedAt };
}

const clear = () => Promise.all([onlineDb.matches, onlineDb.pending, onlineDb.me, onlineDb.lineups].map((t) => t.clear()));

describe('saving online matches', () => {
  beforeEach(clear);

  it('saves each match once, however often it arrives', async () => {
    const a = finished('a', 200);
    await saveFinished('HHH', [a]);
    await saveFinished('HHH', [a, finished('b', 100)]);
    await saveFinished('HHH', [a]);
    const saved = await savedMatches();
    expect(saved.map((r) => r.id)).toEqual(['b', 'a']);
    expect(saved[1]).toEqual({ id: 'a', ...a });
    expect(await onlineDb.me.toArray()).toEqual([{ ownerId: 'HHH' }]);
  });

  it('ignores unfinished matches and other people\'s', async () => {
    const a = finished('a', 200);
    await saveFinished('XXX', [a]);
    await saveFinished('HHH', [{ ...a, match: { ...a.match, result: null } }]);
    expect(await savedMatches()).toEqual([]);
    expect(await onlineDb.me.count()).toBe(0);
  });

  it('remembers rooms with a result to come until it is settled', async () => {
    await expectResult('K7M4QP', 'HHH');
    await expectResult('K7M4QP', 'HHH');
    await expectResult('ABCDEF', 'HHH');
    expect((await pendingRooms()).sort()).toEqual(['ABCDEF', 'K7M4QP']);
    await resultSettled('K7M4QP');
    expect(await pendingRooms()).toEqual(['ABCDEF']);
  });

  it('remembers lineups by team', async () => {
    expect(await recallLineup('p-hawks')).toBeNull();
    await rememberLineup('p-hawks', defaultLineup(hawks));
    expect(await recallLineup('p-hawks')).toEqual(defaultLineup(hawks));
  });
});
