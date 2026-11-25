import { useCallback, useEffect, useMemo, useState } from 'react';
import { useGame } from '../store/useGameStore';
import { onlineDb, savedMatches, type OnlineRecord } from './onlineDb';
import { ME, hoverHistory, statMatches, type StatMatch } from './statMatches';

interface Loaded {
  records: OnlineRecord[];
  mine: Set<string>;
}

async function load(): Promise<Loaded> {
  const [records, me] = await Promise.all([savedMatches(), onlineDb.me.toArray()]);
  return { records, mine: new Set(me.map((x) => x.ownerId)) };
}

/**
 * The shared scorecards show a career when you hover over a name, read from the main game's store. On this page that
 * store is given online matches instead. It is only this page's memory: nothing is saved, and the main game, on its
 * own page, never sees it.
 */
function fillHoverCards({ records, mine }: Loaded, me: string) {
  useGame.setState({ history: hoverHistory(records, mine, me) });
}

export interface Records extends Loaded {
  /** The player's own matches, ready for stats, oldest first. */
  matches: StatMatch[];
  reload(): void;
}

/** Everything saved in this browser, or null while loading. */
export function useRecords(): Records | null {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const reload = useCallback(() => {
    load()
      .then((l) => {
        fillHoverCards(l, ME);
        setLoaded(l);
      })
      .catch((e) => {
        console.error(e);
        setLoaded({ records: [], mine: new Set() });
      });
  }, []);
  useEffect(reload, [reload]);
  return useMemo(() => loaded && { ...loaded, matches: statMatches(loaded.records, loaded.mine), reload }, [loaded, reload]);
}

/** Hover cards for a match being played, where your side goes by your own public id. `version` changes when to look again. */
export function useHoverCards(ownerId: string, version: unknown) {
  useEffect(() => {
    load()
      .then((l) => fillHoverCards({ ...l, mine: new Set([...l.mine, ownerId]) }, ownerId))
      .catch(console.error);
  }, [ownerId, version]);
}
