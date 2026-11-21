import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { FullScorecard, scoreText, inningsTitle } from '../components/Scorecard';
import { db, type MatchRecord } from '../data/db';
import { aggregate, battingAverage, formatOvers, ratio, strikeRate, type CareerBat, type CareerBowl } from '../engine/stats';
import type { Format } from '../engine/types';
import { useGame, type Screen } from '../store/useGameStore';

interface Col<T> {
  key: string;
  label: string;
  value: (r: T) => number | string;
  render?: (r: T) => ReactNode;
  left?: boolean;
  hideSm?: boolean;
}

function SortTable<T>({ rows, cols, initial, rowKey }: { rows: T[]; cols: Col<T>[]; initial: string; rowKey: (r: T) => string }) {
  const [sort, setSort] = useState<{ key: string; desc: boolean }>({ key: initial, desc: true });
  const col = cols.find((c) => c.key === sort.key) ?? cols[0];
  const sorted = [...rows].sort((a, b) => {
    const x = col.value(a);
    const y = col.value(b);
    const c = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y));
    return sort.desc ? -c : c;
  });
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
                onClick={() => setSort((s) => ({ key: c.key, desc: s.key === c.key ? !s.desc : !c.left }))}
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

const num = (s: string) => (s === '-' ? -1 : Number(s));
const asc = (s: string) => (s === '-' ? -Infinity : -Number(s)); // lower is better → sort desc on negated

const BAT_COLS: Col<CareerBat>[] = [
  { key: 'name', label: 'Player', value: (r) => r.name, left: true, render: (r) => <b>{r.name}</b> },
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

const BOWL_COLS: Col<CareerBowl>[] = [
  { key: 'name', label: 'Player', value: (r) => r.name, left: true, render: (r) => <b>{r.name}</b> },
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

export function StatsScreen({ tournamentId }: { tournamentId?: string }) {
  const go = useGame((s) => s.go);
  const tournaments = useGame((s) => s.tournaments);
  const [records, setRecords] = useState<MatchRecord[] | null>(null);
  const [scope, setScope] = useState<string>(tournamentId ?? 'all');
  const initialFormat: Format = tournaments.find((t) => t.id === tournamentId)?.settings.format ?? 'limited';
  const [format, setFormat] = useState<Format>(initialFormat);
  const [tab, setTab] = useState<'bat' | 'bowl' | 'matches'>('bat');

  useEffect(() => {
    void db.matches.orderBy('completedAt').reverse().toArray().then(setRecords);
  }, []);

  const filtered = useMemo(
    () =>
      (records ?? []).filter(
        (r) =>
          r.match.settings.format === format &&
          (scope === 'all' || (scope === 'exhibition' ? r.tournamentId === null : r.tournamentId === scope)),
      ),
    [records, scope, format],
  );
  const agg = useMemo(() => aggregate(filtered.map((r) => r.match)), [filtered]);
  const tName = (id: string | null) => (id ? tournaments.find((t) => t.id === id)?.name ?? 'Tournament' : 'Exhibition');
  const back: Screen = { name: 'stats', tournamentId: scope !== 'all' && scope !== 'exhibition' ? scope : undefined };

  return (
    <div className="screen">
      <div className="title-row">
        <h2>Stats & History</h2>
        {tournamentId && (
          <button className="btn" onClick={() => go({ name: 'tourHub', id: tournamentId })}>← Back to tournament</button>
        )}
      </div>

      <div className="filters">
        <label>
          Competition{' '}
          <select value={scope} onChange={(e) => setScope(e.target.value)}>
            <option value="all">All matches</option>
            <option value="exhibition">Exhibitions only</option>
            {tournaments.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        </label>
        <div className="seg">
          <button className={`seg-btn ${format === 'limited' ? 'seg-on' : ''}`} onClick={() => setFormat('limited')}>Limited overs</button>
          <button className={`seg-btn ${format === 'test' ? 'seg-on' : ''}`} onClick={() => setFormat('test')}>Test</button>
        </div>
      </div>

      <div className="tabs">
        <button className={`tab ${tab === 'bat' ? 'tab-on' : ''}`} onClick={() => setTab('bat')}>Batting</button>
        <button className={`tab ${tab === 'bowl' ? 'tab-on' : ''}`} onClick={() => setTab('bowl')}>Bowling</button>
        <button className={`tab ${tab === 'matches' ? 'tab-on' : ''}`} onClick={() => setTab('matches')}>Matches ({filtered.length})</button>
      </div>

      {records === null ? (
        <p className="muted">Loading…</p>
      ) : filtered.length === 0 ? (
        <p className="muted">No completed matches for this selection yet.</p>
      ) : (
        <div className="card">
          {tab === 'bat' && (
            <SortTable rows={agg.bat.filter((r) => r.innings > 0)} cols={BAT_COLS} initial="runs" rowKey={(r) => r.playerId} />
          )}
          {tab === 'bowl' && <SortTable rows={agg.bowl} cols={BOWL_COLS} initial="wkts" rowKey={(r) => r.playerId} />}
          {tab === 'matches' && (
            <div className="list">
              {filtered.map((r) => (
                <button
                  key={r.id}
                  className="list-main match-row"
                  onClick={() => go({ name: 'matchView', matchId: r.id, back })}
                >
                  <span className="muted small">
                    {new Date(r.completedAt).toLocaleDateString()} · {tName(r.tournamentId)}
                  </span>
                  <span>
                    {r.match.innings.map((_, i) => `${inningsTitle(r.match, i)} ${scoreText(r.match, i)}`).join('  ·  ')}
                  </span>
                  <b className="small">{r.match.result?.text}</b>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="nav-row">
        <button className="btn btn-ghost" onClick={() => go({ name: 'home' })}>← Home</button>
      </div>
    </div>
  );
}

export function MatchView({ matchId, back }: { matchId: string; back: Screen }) {
  const go = useGame((s) => s.go);
  const [rec, setRec] = useState<MatchRecord | null | undefined>(undefined);
  const [idx, setIdx] = useState(0);
  useEffect(() => {
    void db.matches.get(matchId).then((r) => setRec(r ?? null));
  }, [matchId]);

  return (
    <div className="screen">
      <div className="title-row">
        <button className="btn btn-ghost" onClick={() => go(back)}>← Back</button>
      </div>
      {rec === undefined && <p className="muted">Loading…</p>}
      {rec === null && <p>Match not found.</p>}
      {rec && (
        <>
          <h2>
            {rec.match.teams[0].name} v {rec.match.teams[1].name}
          </h2>
          <p className="muted small">
            {new Date(rec.completedAt).toLocaleString()} · {rec.match.tossText}
          </p>
          <div className="result-banner"><div className="result-title">🏆 {rec.match.result?.text}</div></div>
          <FullScorecard m={rec.match} idx={idx} onIdx={setIdx} />
        </>
      )}
    </div>
  );
}
