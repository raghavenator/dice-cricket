import { getTeam, oversLimit } from '../engine/match';
import { battingCard, bowlingCard, formatOvers, ratio, strikeRate } from '../engine/stats';
import type { Ball, MatchState } from '../engine/types';
import { PlayerName } from './PlayerHover';

export function ballLabel(b: Ball) {
  return b.wicket ? 'W' : b.runs === 0 ? '•' : String(b.runs);
}

function ballTitle(b: Ball) {
  const dice = b.roll2 !== undefined ? `Rolled 5, then ${b.roll2}` : `Rolled ${b.roll1}`;
  return `${b.over}.${b.ball} — ${dice}${b.wicket ? ` — OUT (${b.how})` : ''}`;
}

export function BallChip({ b, big }: { b: Ball; big?: boolean }) {
  const kind = b.wicket ? 'w' : b.runs === 0 ? 'dot' : b.runs === 4 ? 'four' : b.runs === 6 ? 'six' : 'run';
  return (
    <span className={`chip chip-${kind} ${big ? 'chip-big' : ''}`} title={ballTitle(b)}>
      {ballLabel(b)}
    </span>
  );
}

const ordinal = (n: number) => ['1st', '2nd', '3rd', '4th'][n] ?? `${n + 1}th`;

export function inningsTitle(m: MatchState, idx: number) {
  const inn = m.innings[idx];
  const team = getTeam(m, inn.battingTeamId);
  const n = m.innings.slice(0, idx).filter((i) => i.battingTeamId === inn.battingTeamId).length;
  return m.settings.format === 'test' ? `${team.short} ${ordinal(n)} inns` : team.short;
}

export function scoreText(m: MatchState, idx: number) {
  const inn = m.innings[idx];
  return `${inn.runs}/${inn.wickets}`;
}

export function InningsTabs({ m, value, onChange }: { m: MatchState; value: number; onChange: (i: number) => void }) {
  return (
    <div className="tabs" role="tablist">
      {m.innings.map((inn, i) => (
        <button
          key={i}
          role="tab"
          aria-selected={value === i}
          className={`tab ${value === i ? 'tab-on' : ''}`}
          onClick={() => onChange(i)}
        >
          <span className="tab-swatch" style={{ background: getTeam(m, inn.battingTeamId).color }} />
          {inningsTitle(m, i)} <b>{scoreText(m, i)}</b> <small>({formatOvers(inn.legalBalls)})</small>
        </button>
      ))}
    </div>
  );
}

export function BattingCard({ m, idx }: { m: MatchState; idx: number }) {
  const rows = battingCard(m, idx);
  const inn = m.innings[idx];
  const team = getTeam(m, inn.battingTeamId);
  const yetToBat = rows.filter((r) => !r.batted);
  const limit = oversLimit(m.settings);
  return (
    <div className="card">
      <div className="card-head" style={{ borderColor: team.color }}>
        <h3>{team.name} — Batting</h3>
        <span className="muted">
          {inn.runs}/{inn.wickets} ({formatOvers(inn.legalBalls)}
          {limit ? `/${limit}` : ''} ov) · RR {ratio(inn.runs * 6, inn.legalBalls)}
        </span>
      </div>
      <div className="table-wrap">
        <table className="sc">
          <thead>
            <tr>
              <th className="l">Batter</th>
              <th className="l hide-sm">Dismissal</th>
              <th className="l balls-col">Balls</th>
              <th>R</th>
              <th>B</th>
              <th className="hide-sm">4s</th>
              <th className="hide-sm">6s</th>
              <th>SR</th>
            </tr>
          </thead>
          <tbody>
            {rows
              .filter((r) => r.batted)
              .map((r) => (
                <tr key={r.playerId} className={r.atCrease ? 'row-live' : r.out ? 'row-out' : ''}>
                  <td className="l name">
                    <PlayerName name={r.name} playerId={r.playerId} format={m.settings.format} role="bat" />
                    {r.onStrike && <span className="strike" title="On strike">*</span>}
                    <div className="show-sm muted small">{r.dismissal}</div>
                  </td>
                  <td className="l muted hide-sm dismissal">{r.dismissal}</td>
                  <td className="l balls-col">
                    <div className="chips">
                      {r.faced.map((b, i) => (
                        <BallChip key={i} b={b} />
                      ))}
                    </div>
                  </td>
                  <td className="num strong">{r.runs}</td>
                  <td className="num">{r.balls}</td>
                  <td className="num hide-sm">{r.fours}</td>
                  <td className="num hide-sm">{r.sixes}</td>
                  <td className="num">{strikeRate(r.runs, r.balls)}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
      {yetToBat.length > 0 && (
        <p className="ytb">
          <span className="muted">{inn.done ? 'Did not bat: ' : 'Yet to bat: '}</span>
          {yetToBat.map((r) => r.name).join(', ')}
        </p>
      )}
    </div>
  );
}

export function BowlingCard({ m, idx }: { m: MatchState; idx: number }) {
  const rows = bowlingCard(m, idx);
  const team = getTeam(m, m.innings[idx].bowlingTeamId);
  return (
    <div className="card">
      <div className="card-head" style={{ borderColor: team.color }}>
        <h3>{team.name} — Bowling</h3>
      </div>
      <div className="table-wrap">
        <table className="sc">
          <thead>
            <tr>
              <th className="l">Bowler</th>
              <th className="l balls-col">Overs</th>
              <th>O</th>
              <th className="hide-sm">M</th>
              <th>R</th>
              <th>W</th>
              <th>Econ</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="muted l">No overs bowled yet</td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={r.playerId} className={r.current ? 'row-live' : ''}>
                <td className="l name">
                  <PlayerName name={r.name} playerId={r.playerId} format={m.settings.format} role="bowl" />
                </td>
                <td className="l balls-col">
                  <div className="chips">
                    {r.overs.map((o, oi) => (
                      <span key={oi} className="over-group">
                        {o.map((b, bi) => (
                          <BallChip key={bi} b={b} />
                        ))}
                      </span>
                    ))}
                  </div>
                </td>
                <td className="num">{formatOvers(r.balls)}</td>
                <td className="num hide-sm">{r.maidens}</td>
                <td className="num">{r.runs}</td>
                <td className="num strong">{r.wickets}</td>
                <td className="num">{ratio(r.runs * 6, r.balls)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Full read-only scorecard for any match (used for history). */
export function FullScorecard({ m, idx, onIdx }: { m: MatchState; idx: number; onIdx: (i: number) => void }) {
  return (
    <>
      <InningsTabs m={m} value={idx} onChange={onIdx} />
      <BattingCard m={m} idx={idx} />
      <BowlingCard m={m} idx={idx} />
    </>
  );
}
