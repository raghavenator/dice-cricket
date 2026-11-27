import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { BattingCard, BowlingCard, InningsTabs, scoreText, inningsTitle } from '../components/Scorecard';
import { MatchCharts } from '../components/Charts';
import { ScorecardOrderToggle } from '../components/ScorecardOrder';
import { BattingCardHover, BowlingCardHover, HoverCard } from '../components/PlayerHover';
import { db, type MatchRecord } from '../data/db';
import { aggregate, battingAverage, formatOvers, ratio, strikeRate, type CareerBat, type CareerBowl } from '../engine/stats';
import type { Series } from '../engine/series';
import type { Tournament } from '../engine/tournament';
import type { Format } from '../engine/types';
import { useGame, type Screen, type StatsView } from '../store/useGameStore';

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

interface TeamOpt { id: string; name: string; short: string; color: string }

function TeamFilter({ options, value, onChange }: { options: TeamOpt[]; value: string[]; onChange: (ids: string[]) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
    };
  }, [open]);
  const toggle = (id: string) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);
  const idx = value.length === 1 ? options.findIndex((o) => o.id === value[0]) : -1;
  const canStep = idx >= 0 && options.length > 1;
  const neighbour = (d: number) => options[(idx + d + options.length) % options.length];
  const stepTitle = (d: number, dir: string) =>
    canStep ? `${dir}: ${neighbour(d).name}` : 'Select a single team to step through teams';
  const label =
    value.length === 0 ? 'All teams'
    : value.length === 1 ? options.find((o) => o.id === value[0])?.name ?? '1 team'
    : `${value.length} teams`;
  return (
    <div className="multi" ref={ref}>
      Teams{' '}
      <button
        className="multi-step"
        aria-label="Previous team"
        title={stepTitle(-1, 'Previous')}
        disabled={!canStep}
        onClick={() => onChange([neighbour(-1).id])}
      >
        ‹
      </button>
      <button className="multi-btn" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {label} ▾
      </button>
      <button
        className="multi-step"
        aria-label="Next team"
        title={stepTitle(1, 'Next')}
        disabled={!canStep}
        onClick={() => onChange([neighbour(1).id])}
      >
        ›
      </button>
      {open && (
        <div className="multi-pop" role="listbox" aria-multiselectable>
          <label className="multi-opt">
            <input type="checkbox" checked={value.length === 0} onChange={() => onChange([])} />
            <b>All teams</b>
          </label>
          {options.map((o) => (
            <label key={o.id} className="multi-opt">
              <input type="checkbox" checked={value.includes(o.id)} onChange={() => toggle(o.id)} />
              <span className="tab-swatch" style={{ background: o.color }} />
              {o.name}
            </label>
          ))}
        </div>
      )}
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

/** Competition scope: 'all', 'exhibition', a tournament id, or `series:<id>`. */
export const inScope = (r: MatchRecord, scope: string) =>
  scope === 'all' ||
  (scope === 'exhibition'
    ? !r.tournamentId && !r.seriesId
    : scope.startsWith('series:')
      ? r.seriesId === scope.slice(7)
      : r.tournamentId === scope);

export const scopeName = (scope: string, tournaments: Tournament[], series: Series[]) =>
  scope === 'all' ? 'All matches'
  : scope === 'exhibition' ? 'Exhibitions'
  : scope.startsWith('series:') ? series.find((s) => s.id === scope.slice(7))?.name ?? 'Series'
  : tournaments.find((t) => t.id === scope)?.name ?? 'Tournament';

export const recordCompName = (r: MatchRecord, tournaments: Tournament[], series: Series[]) =>
  r.tournamentId
    ? tournaments.find((t) => t.id === r.tournamentId)?.name ?? 'Tournament'
    : r.seriesId
      ? series.find((s) => s.id === r.seriesId)?.name ?? 'Series'
      : 'Exhibition';

export function StatsScreen({ tournamentId, seriesId, view }: { tournamentId?: string; seriesId?: string; view?: StatsView }) {
  const go = useGame((s) => s.go);
  const tournaments = useGame((s) => s.tournaments);
  const [records, setRecords] = useState<MatchRecord[] | null>(null);
  const allSeries = useGame((s) => s.series);
  const [scope, setScope] = useState<string>(view?.scope ?? tournamentId ?? (seriesId ? `series:${seriesId}` : 'all'));
  const initialFormat: Format =
    view?.format ??
    tournaments.find((t) => t.id === tournamentId)?.settings.format ??
    allSeries.find((s) => s.id === seriesId)?.legs[0]?.settings.format ??
    'limited';
  const [format, setFormat] = useState<Format>(initialFormat);
  const [tab, setTab] = useState<'bat' | 'bowl' | 'matches'>(view?.tab ?? 'bat');

  useEffect(() => {
    void db.matches.orderBy('completedAt').reverse().toArray().then(setRecords);
  }, []);

  const filtered = useMemo(
    () => (records ?? []).filter((r) => r.match.settings.format === format && inScope(r, scope)),
    [records, scope, format],
  );
  const filteredMatches = useMemo(() => filtered.map((r) => r.match), [filtered]);
  const agg = useMemo(() => aggregate(filteredMatches), [filteredMatches]);
  const [teamSel, setTeamSel] = useState<string[]>(view?.teams ?? []);
  const self: Screen = { name: 'stats', tournamentId, seriesId, view: { scope, format, tab, teams: teamSel } };
  const openPlayer = (playerId: string) => go({ name: 'player', playerId, scope, format, back: self });
  const teamOpts = useMemo(() => {
    const byId = new Map<string, TeamOpt>();
    for (const m of filteredMatches) for (const t of m.teams) if (!byId.has(t.id)) byId.set(t.id, t);
    return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [filteredMatches]);
  // Ignore picks for teams not present under the current competition/format filter.
  const activeTeams = teamSel.filter((id) => teamOpts.some((o) => o.id === id));
  const byTeam = <T extends { teamId: string }>(rows: T[]) =>
    activeTeams.length ? rows.filter((r) => activeTeams.includes(r.teamId)) : rows;
  // Player names open the player page; hovering shows their last 5 innings in the current filter.
  const nameLink = (r: { name: string; playerId: string }) => (
    <button className="link-btn" onClick={() => openPlayer(r.playerId)} title={`View ${r.name}'s profile`}>
      {r.name}
    </button>
  );
  const batCols: Col<CareerBat>[] = BAT_COLS.map((c) =>
    c.key !== 'name' ? c : {
      ...c,
      render: (r) => (
        <HoverCard render={() => <BattingCardHover name={r.name} playerId={r.playerId} matches={filteredMatches} format={format} summary={false} />}>
          {nameLink(r)}
        </HoverCard>
      ),
    },
  );
  const bowlCols: Col<CareerBowl>[] = BOWL_COLS.map((c) =>
    c.key !== 'name' ? c : {
      ...c,
      render: (r) => (
        <HoverCard render={() => <BowlingCardHover name={r.name} playerId={r.playerId} matches={filteredMatches} format={format} summary={false} />}>
          {nameLink(r)}
        </HoverCard>
      ),
    },
  );
  const compName = (r: MatchRecord) => recordCompName(r, tournaments, allSeries);
  const back = self;

  return (
    <div className="screen">
      <div className="title-row">
        <h2>Stats & History</h2>
        {tournamentId && (
          <button className="btn" onClick={() => go({ name: 'tourHub', id: tournamentId })}>← Back to tournament</button>
        )}
        {seriesId && (
          <button className="btn" onClick={() => go({ name: 'seriesHub', id: seriesId })}>← Back to series</button>
        )}
      </div>

      <div className="filters">
        <label>
          Competition{' '}
          <select value={scope} onChange={(e) => setScope(e.target.value)}>
            <option value="all">All matches</option>
            <option value="exhibition">Exhibitions only</option>
            {tournaments.length > 0 && (
              <optgroup label="Tournaments">
                {tournaments.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </optgroup>
            )}
            {allSeries.length > 0 && (
              <optgroup label="Bilateral series">
                {allSeries.map((s) => (
                  <option key={s.id} value={`series:${s.id}`}>{s.name}</option>
                ))}
              </optgroup>
            )}
          </select>
        </label>
        {tab !== 'matches' && teamOpts.length > 0 && (
          <TeamFilter options={teamOpts} value={activeTeams} onChange={setTeamSel} />
        )}
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
            <SortTable rows={byTeam(agg.bat).filter((r) => r.innings > 0)} cols={batCols} initial="runs" rowKey={(r) => r.playerId} />
          )}
          {tab === 'bowl' && <SortTable rows={byTeam(agg.bowl)} cols={bowlCols} initial="wkts" rowKey={(r) => r.playerId} />}
          {tab === 'matches' && (
            <div className="list">
              {filtered.map((r) => (
                <button
                  key={r.id}
                  className="list-main match-row"
                  onClick={() => go({ name: 'matchView', matchId: r.id, back })}
                >
                  <span className="muted small">
                    {new Date(r.completedAt).toLocaleDateString()} · {compName(r)}
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

      <p className="muted small backup-hint">
        Your stats are saved only in this browser.{' '}
        <button className="link-btn" onClick={() => go({ name: 'backup' })}>Back up to a file</button>
      </p>

      <div className="nav-row">
        <button className="btn btn-ghost" onClick={() => go({ name: 'home' })}>← Home</button>
      </div>
    </div>
  );
}

export function MatchView({ matchId, back }: { matchId: string; back: Screen }) {
  const go = useGame((s) => s.go);
  const order = useGame((s) => s.prefs.scorecardOrder) ?? 'tables-first';
  const setPrefs = useGame((s) => s.setPrefs);
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
          <InningsTabs m={rec.match} value={idx} onChange={setIdx} />
          <ScorecardOrderToggle value={order} onChange={(v) => setPrefs({ scorecardOrder: v })} />
          {order === 'charts-first' && <MatchCharts m={rec.match} idx={idx} />}
          <BattingCard m={rec.match} idx={idx} />
          <BowlingCard m={rec.match} idx={idx} />
          {order === 'tables-first' && <MatchCharts m={rec.match} idx={idx} />}
        </>
      )}
    </div>
  );
}
