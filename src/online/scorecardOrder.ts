import { useState } from 'react';
import type { ScorecardOrder } from '../components/ScorecardOrder';
import { ALIAS } from './alias';

const KEY = `dice-cricket-online-scorecard-order${ALIAS}`;

function load(): ScorecardOrder {
  try {
    return localStorage.getItem(KEY) === 'charts-first' ? 'charts-first' : 'tables-first';
  } catch {
    return 'tables-first';
  }
}

/** The online match screen's graphs-or-tables-on-top choice, remembered in this browser. */
export function useScorecardOrder(): [ScorecardOrder, (v: ScorecardOrder) => void] {
  const [order, setOrder] = useState(load);
  const set = (v: ScorecardOrder) => {
    setOrder(v);
    try {
      localStorage.setItem(KEY, v);
    } catch {
      // Not remembered: the next visit starts with tables on top.
    }
  };
  return [order, set];
}
