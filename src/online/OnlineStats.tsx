import { useMemo, useState, type ReactNode } from 'react';
import { BattingCardHover, BowlingCardHover, HoverCard } from '../components/PlayerHover';
import { inningsTitle, scoreText } from '../components/Scorecard';
import { aggregate } from '../engine/stats';
import { OnlineBackupPanel } from './OnlineBackupPanel';
import { BAT_COLS, BOWL_COLS, SortTable, type Col } from './SortTable';
import { BotMark } from './BotMark';
import { goHome, goMatch, goPlayer } from './nav';
import type { OnlineRecord } from './onlineDb';
import {
  NO_FILTERS, filterMatches, filterOptions, headToHead, overview, sideOf, whoseRows, winPct,
  type Filters, type HeadToHead, type StatMatch, type Total,
} from './statMatches';
import { useRecords } from './useRecords';

type Tab = 'overview' | 'h2h' | 'bat' | 'bowl' | 'matches';

// Kept while the page is open, so coming back from a player or a match restores the view.
let lastTab: Tab = 'overview';
let lastFilters: Filters = NO_FILTERS;

export function Tile({ label, value, onClick }: { label: string; value: ReactNode; onClick?: () => void }) {
  return (
    <div className="pl-tile">
      <span>{label}</span>
      <b>{onClick ? <button className="link-btn" onClick={onClick}>{value}</button> : value}</b>
    </div>
  );
}

export function OnlineStats() {
  const data = useRecords();
  const [tab, setTabState] = useState<Tab>(lastTab);
  const [filters, setFiltersState] = useState<Filters>(lastFilters);
  const setTab = (t: Tab) => {
    lastTab = t;
    setTabState(t);
  };
  const setFilters = (f: Partial<Filters>) => {
    lastFilters = { ...filters, ...f };
    setFiltersState(lastFilters);
  };

  const all = useMemo(() => data?.matches ?? [], [data]);
  const options = useMemo(() => filterOptions(all), [all]);
  // Ignore a choice that no longer exists.
  const active = useMemo<Filters>(
    () => ({
      whose: filters.whose,
      team: options.teams.some(([id]) => id === filters.team) ? filters.team : '',
      opponent: options.opponents.some(([id]) => id === filters.opponent) ? filters.opponent : '',
      overs: options.overs.includes(filters.overs) ? filters.overs : 0,
    }),
    [filters, options],
  );
  const matches = useMemo(() => filterMatches(all, active), [all, active]);
  const plain = useMemo(() => matches.map((m) => m.match), [matches]);
  const agg = useMemo(() => aggregate(plain), [plain]);
  const others = useMemo(
    () => (data ? data.records.filter((r) => sideOf(r, data.mine) === 'both') : []),
    [data],
  );
  const filtered = active.team !== '' || active.opponent !== '' || active.overs !== 0;

  const named = <T extends { playerId: string; name: string }>(cols: Col<T>[], hover: (r: T) => ReactNode): Col<T>[] =>
    cols.map((c) =>
      c.key !== 'name' ? c : {
        ...c,
        render: (r) => (
          <HoverCard render={() => hover(r)}>
            <button className="link-btn" onClick={() => goPlayer(r.playerId)} title={`View ${r.name}'s online profile`}>{r.name}</button>
          </HoverCard>
        ),
      },
    );
  const batCols = named(BAT_COLS, (r) => <BattingCardHover name={r.name} playerId={r.playerId} matches={plain} format="limited" summary={false} />);
  const bowlCols = named(BOWL_COLS, (r) => <BowlingCardHover name={r.name} playerId={r.playerId} matches={plain} format="limited" summary={false} />);

  const tabs: [Tab, string][] = [
    ['overview', 'Overview'], ['h2h', 'Head-to-head'], ['bat', 'Batting'], ['bowl', 'Bowling'], ['matches', `Matches (${matches.length})`],
  ];

  return (
    <div className="screen">
      <div className="title-row">
        <h2>Online Stats</h2>
        <button className="btn btn-ghost" onClick={goHome}>← Online home</button>
      </div>

      {!data ? (
        <p className="muted">Loading…</p>
      ) : all.length === 0 && others.length === 0 ? (
        <p className="muted">No online matches yet. Every match you finish online is saved here, apart from your offline stats.</p>
      ) : (
        <>
          <div className="filters">
            {(tab === 'bat' || tab === 'bowl') && (
              <div className="seg">
                {([['mine', 'My players'], ['theirs', 'Opponents'], ['all', 'All']] as const).map(([v, label]) => (
                  <button key={v} className={`seg-btn ${active.whose === v ? 'seg-on' : ''}`} onClick={() => setFilters({ whose: v })}>{label}</button>
                ))}
              </div>
            )}
            <label>
              My team{' '}
              <select value={active.team} onChange={(e) => setFilters({ team: e.target.value })}>
                <option value="">All</option>
                {options.teams.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
              </select>
            </label>
            <label>
              Opponent{' '}
              <select value={active.opponent} onChange={(e) => setFilters({ opponent: e.target.value })}>
                <option value="">All</option>
                {options.opponents.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
              </select>
            </label>
            <label>
              Overs{' '}
              <select value={active.overs} onChange={(e) => setFilters({ overs: Number(e.target.value) })}>
                <option value={0}>All</option>
                {options.overs.map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
            {filtered && (
              <button className="btn btn-sm btn-ghost" onClick={() => setFilters({ team: '', opponent: '', overs: 0 })}>Clear filters</button>
            )}
          </div>

          <div className="tabs">
            {tabs.map(([t, label]) => (
              <button key={t} className={`tab ${tab === t ? 'tab-on' : ''}`} onClick={() => setTab(t)}>{label}</button>
            ))}
          </div>

          {matches.length === 0 && !(tab === 'matches' && others.length > 0 && !filtered) ? (
            <p className="muted">No matches for this selection.</p>
          ) : (
            <div className="card">
              {tab === 'overview' && <OverviewTab matches={matches} />}
              {tab === 'h2h' && <HeadToHeadTab matches={matches} />}
              {tab === 'bat' && (
                <SortTable rows={whoseRows(agg.bat, active.whose).filter((r) => r.innings > 0)} cols={batCols} initial="runs" rowKey={(r) => r.playerId} />
              )}
              {tab === 'bowl' && <SortTable rows={whoseRows(agg.bowl, active.whose)} cols={bowlCols} initial="wkts" rowKey={(r) => r.playerId} />}
              {tab === 'matches' && <MatchesTab matches={matches} records={data.records} others={filtered ? [] : others} />}
            </div>
          )}
        </>
      )}

      {data && <OnlineBackupPanel empty={data.records.length === 0} onImported={data.reload} />}
    </div>
  );
}

function OverviewTab({ matches }: { matches: StatMatch[] }) {
  const o = overview(matches);
  const total = (t: Total | null, label: string) => (
    <Tile label={label} value={t ? `${t.runs}/${t.wickets}` : '-'} onClick={t ? () => goMatch(t.matchId) : undefined} />
  );
  return (
    <div className="pl-stats">
      <Tile label="Played" value={o.played} />
      <Tile label="Won" value={o.won} />
      <Tile label="Lost" value={o.lost} />
      <Tile label="Tied" value={o.tied} />
      <Tile label="Win %" value={o.winPct} />
      <Tile label="Streak" value={o.streak || '-'} />
      {total(o.highest, 'Highest')}
      {total(o.lowest, 'Lowest')}
      <Tile label="Won by forfeit" value={o.forfeitWins} />
      <Tile label="Lost by forfeit" value={o.forfeitLosses} />
    </div>
  );
}

const H2H_COLS: Col<HeadToHead>[] = [
  { key: 'name', label: 'Opponent', value: (r) => r.opponent.nickname, left: true, render: (r) => <b>{r.opponent.nickname}<BotMark ownerId={r.opponent.ownerId} /></b> },
  { key: 'p', label: 'Played', value: (r) => r.played },
  { key: 'w', label: 'Won', value: (r) => r.won },
  { key: 'l', label: 'Lost', value: (r) => r.lost },
  { key: 't', label: 'Tied', value: (r) => r.tied, hideSm: true },
  { key: 'pct', label: 'Win %', value: (r) => r.won / r.played, render: (r) => winPct(r) },
  {
    key: 'form', label: 'Last 5', value: (r) => r.form.filter((f) => f === 'W').length, hideSm: true,
    render: (r) => (
      <span className="on-form">
        {r.form.map((f, i) => <span key={i} className={`form-chip pl-chip form-${f.toLowerCase()}`}>{f}</span>)}
      </span>
    ),
  },
  { key: 'last', label: 'Last played', value: (r) => r.lastPlayed, render: (r) => new Date(r.lastPlayed).toLocaleDateString(), hideSm: true },
];

function HeadToHeadTab({ matches }: { matches: StatMatch[] }) {
  return <SortTable rows={headToHead(matches)} cols={H2H_COLS} initial="p" rowKey={(r) => r.opponent.ownerId} />;
}

function MatchesTab({ matches, records, others }: { matches: StatMatch[]; records: OnlineRecord[]; others: OnlineRecord[] }) {
  const byId = new Map(records.map((r) => [r.id, r]));
  const row = (r: OnlineRecord, note: string, chip?: string, botId?: string) => (
    <button key={r.id} className="list-main match-row" onClick={() => goMatch(r.id)}>
      <span className="muted small">
        {new Date(r.completedAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })} · {note}
        {botId && <BotMark ownerId={botId} />} · {r.match.settings.overs} over{r.match.settings.overs === 1 ? '' : 's'}
        {r.end.kind === 'forfeit' && ' · forfeit'}
      </span>
      <span>{r.match.innings.map((_, i) => `${inningsTitle(r.match, i)} ${scoreText(r.match, i)}`).join('  ·  ')}</span>
      <span className="on-result">
        {chip && <span className={`form-chip pl-chip form-${chip.toLowerCase()}`}>{chip}</span>}
        <b className="small">{r.match.result?.text}</b>
      </span>
    </button>
  );
  return (
    <div className="list">
      {[...matches].reverse().map((m) => row(byId.get(m.id)!, `v ${m.opponent.nickname}`, m.outcome, m.opponent.ownerId))}
      {others.length > 0 && (
        <>
          <p className="muted small on-others">Matches you played against yourself from two browsers. They are not counted in any stats.</p>
          {[...others].reverse().map((r) => row(r, `${r.host.nickname} v ${r.guest.nickname}`))}
        </>
      )}
    </div>
  );
}
