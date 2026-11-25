import { useState, type ReactNode } from 'react';
import { battingAverage, formatOvers, ratio, strikeRate, type CareerBat, type CareerBowl } from '../engine/stats';

export interface Col<T> {
  key: string;
  label: string;
  value: (r: T) => number | string;
  render?: (r: T) => ReactNode;
  left?: boolean;
  hideSm?: boolean;
}

export function SortTable<T>({ rows, cols, initial, rowKey }: {
  rows: T[]; cols: Col<T>[]; initial: string; rowKey: (r: T) => string;
}) {
  const [sort, setSort] = useState<{ key: string; desc: boolean }>({ key: initial, desc: true });
  const col = cols.find((c) => c.key === sort.key) ?? cols[0];
  const sorted = [...rows].sort((a, b) => {
    const x = col.value(a);
    const y = col.value(b);
    const c = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y));
    return sort.desc ? -c : c;
  });
  const sortBy = (c: Col<T>) => setSort((s) => ({ key: c.key, desc: s.key === c.key ? !s.desc : !c.left }));
  return (
    <div className="table-wrap">
      <table className="sc stats-table">
        <thead>
          <tr>
            <th>#</th>
            {cols.map((c) => (
              <th
                key={c.key}
                className={`sortable ${c.left ? 'l' : ''} ${c.hideSm ? 'hide-sm' : ''}`}
                onClick={() => sortBy(c)}
                aria-sort={sort.key === c.key ? (sort.desc ? 'descending' : 'ascending') : 'none'}
              >
                {c.label}
                {sort.key === c.key ? (sort.desc ? ' ▾' : ' ▴') : ''}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((r, i) => (
            <tr key={rowKey(r)}>
              <td className="num muted">{i + 1}</td>
              {cols.map((c) => (
                <td key={c.key} className={`${c.left ? 'l' : 'num'} ${c.hideSm ? 'hide-sm' : ''}`}>
                  {c.render ? c.render(r) : c.value(r)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// The same columns as the main game's Stats screen.

const num = (s: string) => (s === '-' ? -1 : Number(s));
const asc = (s: string) => (s === '-' ? -Infinity : -Number(s)); // lower is better → sort desc on negated

export const BAT_COLS: Col<CareerBat>[] = [
  { key: 'name', label: 'Player', value: (r) => r.name, left: true },
  { key: 'team', label: 'Team', value: (r) => r.team, left: true, hideSm: true },
  { key: 'm', label: 'M', value: (r) => r.matches, hideSm: true },
  { key: 'inn', label: 'Inn', value: (r) => r.innings },
  { key: 'no', label: 'NO', value: (r) => r.notOuts, hideSm: true },
  { key: 'runs', label: 'Runs', value: (r) => r.runs, render: (r) => <b>{r.runs}</b> },
  { key: 'hs', label: 'HS', value: (r) => r.high + (r.highNotOut ? 0.5 : 0), render: (r) => `${r.high}${r.highNotOut ? '*' : ''}` },
  { key: 'avg', label: 'Avg', value: (r) => num(battingAverage(r)), render: (r) => battingAverage(r) },
  { key: 'sr', label: 'SR', value: (r) => num(strikeRate(r.runs, r.balls)), render: (r) => strikeRate(r.runs, r.balls) },
  { key: '50', label: '50s', value: (r) => r.fifties, hideSm: true },
  { key: '100', label: '100s', value: (r) => r.hundreds, hideSm: true },
  { key: '4s', label: '4s', value: (r) => r.fours, hideSm: true },
  { key: '6s', label: '6s', value: (r) => r.sixes, hideSm: true },
];

export const BOWL_COLS: Col<CareerBowl>[] = [
  { key: 'name', label: 'Player', value: (r) => r.name, left: true },
  { key: 'team', label: 'Team', value: (r) => r.team, left: true, hideSm: true },
  { key: 'm', label: 'M', value: (r) => r.matches, hideSm: true },
  { key: 'ov', label: 'Overs', value: (r) => r.balls, render: (r) => formatOvers(r.balls) },
  { key: 'md', label: 'Mdns', value: (r) => r.maidens, hideSm: true },
  { key: 'runs', label: 'Runs', value: (r) => r.runs, hideSm: true },
  { key: 'wkts', label: 'Wkts', value: (r) => r.wickets + (r.balls ? 1 - r.runs / (r.runs + 1000) : 0), render: (r) => <b>{r.wickets}</b> },
  { key: 'best', label: 'Best', value: (r) => r.bestW * 1000 - r.bestR, render: (r) => `${r.bestW}/${r.bestR}` },
  { key: 'avg', label: 'Avg', value: (r) => asc(ratio(r.runs, r.wickets)), render: (r) => ratio(r.runs, r.wickets) },
  { key: 'econ', label: 'Econ', value: (r) => asc(ratio(r.runs * 6, r.balls)), render: (r) => ratio(r.runs * 6, r.balls) },
  { key: 'sr', label: 'SR', value: (r) => asc(ratio(r.balls, r.wickets, 1)), render: (r) => ratio(r.balls, r.wickets, 1), hideSm: true },
  { key: '5w', label: '5w', value: (r) => r.fiveFors, hideSm: true },
];
