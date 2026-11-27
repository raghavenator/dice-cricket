import { useMemo, useState } from 'react';
import { MatchCharts } from '../components/Charts';
import { BattingCard, BowlingCard, InningsTabs } from '../components/Scorecard';
import { ScorecardOrderToggle } from '../components/ScorecardOrder';
import { goBack } from './nav';
import { useScorecardOrder } from './scorecardOrder';
import { asMine, sideOf } from './statMatches';
import { useRecords } from './useRecords';

/** A saved match's full scorecard. */
export function OnlineMatchView({ matchId }: { matchId: string }) {
  const data = useRecords();
  const [idx, setIdx] = useState(0);
  const [order, setOrder] = useScorecardOrder();
  const rec = data?.records.find((r) => r.id === matchId);
  // Your side under one id, matching the hover cards. A match against yourself keeps both ids, or they would clash.
  const m = useMemo(
    () => rec && data && (sideOf(rec, data.mine) === 'both' ? rec.match : asMine(rec.match, data.mine)),
    [rec, data],
  );

  return (
    <div className="screen">
      <div className="title-row">
        <button className="btn btn-ghost" onClick={goBack}>← Back</button>
      </div>
      {!data && <p className="muted">Loading…</p>}
      {data && !m && <p>Match not found in this browser.</p>}
      {rec && m && (
        <>
          <h2>{m.teams[0].name} v {m.teams[1].name}</h2>
          <p className="muted small">
            {rec.host.nickname} v {rec.guest.nickname} · {new Date(rec.completedAt).toLocaleString()} · {m.tossText}
          </p>
          <div className="result-banner"><div className="result-title">🏆 {m.result?.text}</div></div>
          <InningsTabs m={m} value={idx} onChange={setIdx} />
          <ScorecardOrderToggle value={order} onChange={setOrder} />
          {order === 'charts-first' && <MatchCharts m={m} idx={idx} />}
          <BattingCard m={m} idx={idx} />
          <BowlingCard m={m} idx={idx} />
          {order === 'tables-first' && <MatchCharts m={m} idx={idx} />}
        </>
      )}
    </div>
  );
}
