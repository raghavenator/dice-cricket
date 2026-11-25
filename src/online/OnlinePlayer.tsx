import { useMemo } from 'react';
import { aggregate, battingAverage, formatOvers, playerMatches, ratio, strikeRate, type PlayerMatch } from '../engine/stats';
import { Tile } from './OnlineStats';
import { goBack, goMatch } from './nav';
import { useRecords } from './useRecords';

const batText = (b: PlayerMatch['bat'][number]) => `${b.runs}${b.out ? '' : '*'} (${b.balls})`;
const bowlText = (b: PlayerMatch['bowl'][number]) => `${b.wickets}/${b.runs} (${formatOvers(b.balls)})`;

/** A player's online career: figures and every match. */
export function OnlinePlayer({ playerId }: { playerId: string }) {
  const data = useRecords();
  const matches = useMemo(
    () => (data?.matches ?? []).filter((m) => m.match.teams.some((t) => t.players.some((p) => p.id === playerId))),
    [data, playerId],
  );
  const plain = useMemo(() => matches.map((m) => m.match), [matches]);
  const agg = useMemo(() => aggregate(plain), [plain]);
  const log = useMemo(() => playerMatches(plain, playerId), [plain, playerId]);
  const bat = agg.bat.find((c) => c.playerId === playerId);
  const bowl = agg.bowl.find((c) => c.playerId === playerId);
  const team = plain[plain.length - 1]?.teams.find((t) => t.players.some((p) => p.id === playerId));
  const name = team?.players.find((p) => p.id === playerId)?.name ?? 'Player';
  const date = new Map(matches.map((m) => [m.id, m.completedAt]));

  return (
    <div className="screen">
      <div className="title-row">
        <button className="btn btn-ghost" onClick={goBack}>← Back</button>
      </div>
      {!data ? (
        <p className="muted">Loading…</p>
      ) : !log.length ? (
        <p className="muted">No online matches for this player.</p>
      ) : (
        <>
          <div className="pl-head">
            {team && <span className="crest pl-crest" style={{ ['--team' as string]: team.color }}>{team.short}</span>}
            <div className="pl-id">
              <h2>{name}</h2>
              <div className="muted">{team?.name}</div>
              <span className="pl-scope" title="Only online matches are counted here">Online</span>
            </div>
          </div>

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
                    <th className="l">Opponent</th>
                    <th className="num">Batting</th>
                    <th className="num">Bowling</th>
                    <th className="num">Result</th>
                  </tr>
                </thead>
                <tbody>
                  {log.map((p) => (
                    <tr
                      key={p.matchId}
                      className="pl-row"
                      tabIndex={0}
                      onClick={() => goMatch(p.matchId)}
                      onKeyDown={(e) => e.key === 'Enter' && goMatch(p.matchId)}
                      title="Open scorecard"
                    >
                      <td className="l muted">{new Date(date.get(p.matchId) ?? p.date).toLocaleDateString()}</td>
                      <td className="l">v {p.vs}</td>
                      <td className="num" title={p.bat.map((b) => b.dismissal).join(' & ')}>
                        {p.bat.length ? p.bat.map(batText).join(' & ') : <span className="muted">dnb</span>}
                      </td>
                      <td className="num">{p.bowl.length ? p.bowl.map(bowlText).join(' & ') : <span className="muted">–</span>}</td>
                      <td className="num">
                        {p.result && <span className={`form-chip pl-chip form-${p.result.toLowerCase()}`}>{p.result}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
