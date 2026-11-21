import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { db, type MatchRecord } from '../data/db';
import {
  aggregate, battingAverage, formatOvers, playerMatches, ratio, strikeRate, type PlayerMatch,
} from '../engine/stats';
import type { Format } from '../engine/types';
import { useGame, type Screen } from '../store/useGameStore';
import { inScope, recordCompName, scopeName } from './Stats';

function Tile({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="pl-tile">
      <span>{label}</span>
      <b>{value}</b>
    </div>
  );
}

const batText = (b: PlayerMatch['bat'][number]) => `${b.runs}${b.out ? '' : '*'} (${b.balls})`;
const bowlText = (b: PlayerMatch['bowl'][number]) => `${b.wickets}/${b.runs} (${formatOvers(b.balls)})`;

export function PlayerScreen({ playerId, scope, format: initialFormat, back }: { playerId: string; scope: string; format: Format; back: Screen }) {
  const go = useGame((s) => s.go);
  const tournaments = useGame((s) => s.tournaments);
  const allSeries = useGame((s) => s.series);
  const [records, setRecords] = useState<MatchRecord[] | null>(null);
  const [format, setFormat] = useState<Format>(initialFormat);

  useEffect(() => {
    void db.matches.toArray().then((rs) => setRecords(rs.filter((r) => inScope(r, scope))));
  }, [scope]);

  // Only matches this player appeared in, split by format.
  const mine = useMemo(
    () => (records ?? []).filter((r) => r.match.teams.some((t) => t.players.some((p) => p.id === playerId))),
    [records, playerId],
  );
  const counts: Record<Format, number> = {
    limited: mine.filter((r) => r.match.settings.format === 'limited').length,
    test: mine.filter((r) => r.match.settings.format === 'test').length,
  };
  const inFormat = useMemo(() => mine.filter((r) => r.match.settings.format === format), [mine, format]);
  const matches = useMemo(() => inFormat.map((r) => r.match), [inFormat]);
  const agg = useMemo(() => aggregate(matches), [matches]);
  const bat = agg.bat.find((c) => c.playerId === playerId);
  const bowl = agg.bowl.find((c) => c.playerId === playerId);
  const log = useMemo(() => playerMatches(matches, playerId), [matches, playerId]);
  const recById = useMemo(() => new Map(inFormat.map((r) => [r.id, r])), [inFormat]);

  // Identity from the most recent appearance in any format.
  const latest = [...mine].sort((a, b) => b.completedAt - a.completedAt)[0];
  const team = latest?.match.teams.find((t) => t.players.some((p) => p.id === playerId));
  const name = team?.players.find((p) => p.id === playerId)?.name ?? 'Player';
  const self: Screen = { name: 'player', playerId, scope, format, back };
  const showComp = scope === 'all';

  return (
    <div className="screen">
      <div className="title-row">
        <button className="btn btn-ghost" onClick={() => go(back)}>← Back</button>
      </div>

      {records === null ? (
        <p className="muted">Loading…</p>
      ) : (
        <>
          <div className="pl-head">
            {team && (
              <span className="crest pl-crest" style={{ ['--team' as string]: team.color }}>{team.short}</span>
            )}
            <div className="pl-id">
              <h2>{name}</h2>
              <div className="muted">{team?.name}</div>
              <span className="pl-scope" title="Stats are limited to this competition">
                {scopeName(scope, tournaments, allSeries)}
              </span>
            </div>
          </div>

          <div className="filters">
            <div className="seg">
              {(['limited', 'test'] as Format[]).map((f) => (
                <button
                  key={f}
                  className={`seg-btn ${format === f ? 'seg-on' : ''}`}
                  disabled={counts[f] === 0 && format !== f}
                  onClick={() => setFormat(f)}
                >
                  {f === 'limited' ? 'Limited overs' : 'Test'} ({counts[f]})
                </button>
              ))}
            </div>
          </div>

          {log.length === 0 ? (
            <p className="muted">No completed {format === 'test' ? 'Test' : 'limited-overs'} matches for {name} here yet.</p>
          ) : (
            <>
              <div className="card">
                <div className="card-head"><h3>Batting</h3></div>
                {bat && bat.innings > 0 ? (
                  <div className="pl-stats">
                    <Tile label="M" value={bat.matches} />
                    <Tile label="Inn" value={bat.innings} />
                    <Tile label="NO" value={bat.notOuts} />
                    <Tile label="Runs" value={bat.runs} />
                    <Tile label="HS" value={`${bat.high}${bat.highNotOut ? '*' : ''}`} />
                    <Tile label="Avg" value={battingAverage(bat)} />
                    <Tile label="SR" value={strikeRate(bat.runs, bat.balls)} />
                    <Tile label="50s" value={bat.fifties} />
                    <Tile label="100s" value={bat.hundreds} />
                    <Tile label="4s" value={bat.fours} />
                    <Tile label="6s" value={bat.sixes} />
                  </div>
                ) : (
                  <p className="muted pl-empty">Hasn't batted yet.</p>
                )}
              </div>

              <div className="card">
                <div className="card-head"><h3>Bowling</h3></div>
                {bowl ? (
                  <div className="pl-stats">
                    <Tile label="M" value={bowl.matches} />
                    <Tile label="Overs" value={formatOvers(bowl.balls)} />
                    <Tile label="Mdns" value={bowl.maidens} />
                    <Tile label="Runs" value={bowl.runs} />
                    <Tile label="Wkts" value={bowl.wickets} />
                    <Tile label="Best" value={`${bowl.bestW}/${bowl.bestR}`} />
                    <Tile label="Avg" value={ratio(bowl.runs, bowl.wickets)} />
                    <Tile label="Econ" value={ratio(bowl.runs * 6, bowl.balls)} />
                    <Tile label="SR" value={ratio(bowl.balls, bowl.wickets, 1)} />
                    <Tile label="5w" value={bowl.fiveFors} />
                  </div>
                ) : (
                  <p className="muted pl-empty">Hasn't bowled yet.</p>
                )}
              </div>

              <div className="card">
                <div className="card-head">
                  <h3>Performances</h3>
                  <span className="muted small">{log.length} match{log.length === 1 ? '' : 'es'} · newest first</span>
                </div>
                <div className="table-wrap">
                  <table className="sc pl-perf">
                    <thead>
                      <tr>
                        <th className="l">Date</th>
                        {showComp && <th className="l hide-sm">Competition</th>}
                        <th className="l">Opponent</th>
                        <th className="num">Batting</th>
                        <th className="num">Bowling</th>
                        <th className="num">Result</th>
                      </tr>
                    </thead>
                    <tbody>
                      {log.map((p) => {
                        const rec = recById.get(p.matchId);
                        return (
                          <tr
                            key={p.matchId}
                            className="pl-row"
                            tabIndex={0}
                            onClick={() => go({ name: 'matchView', matchId: p.matchId, back: self })}
                            onKeyDown={(e) => e.key === 'Enter' && go({ name: 'matchView', matchId: p.matchId, back: self })}
                            title="Open scorecard"
                          >
                            <td className="l muted">{new Date(rec?.completedAt ?? p.date).toLocaleDateString()}</td>
                            {showComp && <td className="l hide-sm">{rec ? recordCompName(rec, tournaments, allSeries) : ''}</td>}
                            <td className="l">v {p.vsShort}</td>
                            <td className="num" title={p.bat.map((b) => b.dismissal).join(' & ')}>
                              {p.bat.length ? p.bat.map(batText).join(' & ') : <span className="muted">dnb</span>}
                            </td>
                            <td className="num">
                              {p.bowl.length ? p.bowl.map(bowlText).join(' & ') : <span className="muted">–</span>}
                            </td>
                            <td className="num">
                              {p.result && <span className={`form-chip pl-chip form-${p.result.toLowerCase()}`}>{p.result}</span>}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
