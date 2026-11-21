import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
  aggregate, battingAverage, formatOvers, ratio, recentBatting, recentBowling, strikeRate,
} from '../engine/stats';
import type { Format, MatchState } from '../engine/types';
import { useGame } from '../store/useGameStore';

const CARD_W = 290;

/** Shows `render()` in a floating card after the pointer rests on `children` for `delay` ms. */
export function HoverCard({ children, render, delay = 500 }: { children: ReactNode; render: () => ReactNode; delay?: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const timer = useRef<number>();
  const [pos, setPos] = useState<{ x: number; y: number; above: boolean } | null>(null);

  const hide = () => {
    window.clearTimeout(timer.current);
    setPos(null);
  };
  const show = () => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      const el = ref.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const above = r.bottom + 280 > window.innerHeight && r.top > 280;
      setPos({
        x: Math.max(8, Math.min(r.left, window.innerWidth - CARD_W - 8)),
        y: above ? r.top - 6 : r.bottom + 6,
        above,
      });
    }, delay);
  };

  useEffect(() => {
    if (!pos) return;
    window.addEventListener('scroll', hide, true);
    return () => window.removeEventListener('scroll', hide, true);
  }, [pos]);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  return (
    <span
      ref={ref}
      className="hc-anchor"
      tabIndex={0}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      {children}
      {pos &&
        createPortal(
          <div
            className="hovercard"
            role="tooltip"
            style={{ left: pos.x, top: pos.y, width: CARD_W, transform: pos.above ? 'translateY(-100%)' : undefined }}
          >
            {render()}
          </div>,
          document.body,
        )}
    </span>
  );
}

const FORMAT_LABEL: Record<Format, string> = { limited: 'Limited overs', test: 'Test' };

/** Completed matches of one format from the saved history. */
export function useHistory(format: Format): MatchState[] {
  const history = useGame((s) => s.history);
  return useMemo(() => history.filter((r) => r.match.settings.format === format).map((r) => r.match), [history, format]);
}

function Stat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="hc-stat">
      <span>{label}</span>
      <b>{value}</b>
    </div>
  );
}

export function BattingCardHover({
  name, playerId, matches, format, summary,
}: { name: string; playerId: string; matches: MatchState[]; format: Format; summary: boolean }) {
  const recent = recentBatting(matches, playerId, 5);
  const c = summary ? aggregate(matches).bat.find((x) => x.playerId === playerId && x.innings > 0) : undefined;
  return (
    <>
      <div className="hc-head">
        <b>{name}</b>
        <span className="muted small">Batting · {FORMAT_LABEL[format]}</span>
      </div>
      {summary && (
        c ? (
          <div className="hc-stats">
            <Stat label="Inn" value={c.innings} />
            <Stat label="Runs" value={c.runs} />
            <Stat label="Avg" value={battingAverage(c)} />
            <Stat label="SR" value={strikeRate(c.runs, c.balls)} />
            <Stat label="HS" value={`${c.high}${c.highNotOut ? '*' : ''}`} />
            <Stat label="50/100" value={`${c.fifties}/${c.hundreds}`} />
          </div>
        ) : (
          <p className="muted small hc-empty">No completed innings yet.</p>
        )
      )}
      <div className="hc-sub">Last {recent.length || 5} innings</div>
      {recent.length === 0 ? (
        <p className="muted small hc-empty">None yet.</p>
      ) : (
        <ul className="hc-recent">
          {recent.map((p, i) => (
            <li key={i}>
              <b>{p.runs}{p.out ? '' : '*'} ({p.balls})</b>
              <span className="muted">v {p.vs}</span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

export function BowlingCardHover({
  name, playerId, matches, format, summary,
}: { name: string; playerId: string; matches: MatchState[]; format: Format; summary: boolean }) {
  const recent = recentBowling(matches, playerId, 5);
  const c = summary ? aggregate(matches).bowl.find((x) => x.playerId === playerId) : undefined;
  return (
    <>
      <div className="hc-head">
        <b>{name}</b>
        <span className="muted small">Bowling · {FORMAT_LABEL[format]}</span>
      </div>
      {summary && (
        c ? (
          <div className="hc-stats">
            <Stat label="Overs" value={formatOvers(c.balls)} />
            <Stat label="Wkts" value={c.wickets} />
            <Stat label="Avg" value={ratio(c.runs, c.wickets)} />
            <Stat label="Econ" value={ratio(c.runs * 6, c.balls)} />
            <Stat label="Best" value={`${c.bestW}-${c.bestR}`} />
            <Stat label="5w" value={c.fiveFors} />
          </div>
        ) : (
          <p className="muted small hc-empty">No completed bowling yet.</p>
        )
      )}
      <div className="hc-sub">Last {recent.length || 5} bowling innings</div>
      {recent.length === 0 ? (
        <p className="muted small hc-empty">None yet.</p>
      ) : (
        <ul className="hc-recent">
          {recent.map((p, i) => (
            <li key={i}>
              <b>{p.wickets}-{p.runs}</b>
              <span className="muted">{formatOvers(p.balls)} ov · v {p.vs}</span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

/** Scorecard name with a career tooltip (completed matches of the same format). */
export function PlayerName({ name, playerId, format, role }: { name: string; playerId: string; format: Format; role: 'bat' | 'bowl' }) {
  const matches = useHistory(format);
  return (
    <HoverCard
      render={() =>
        role === 'bat' ? (
          <BattingCardHover name={name} playerId={playerId} matches={matches} format={format} summary />
        ) : (
          <BowlingCardHover name={name} playerId={playerId} matches={matches} format={format} summary />
        )
      }
    >
      {name}
    </HoverCard>
  );
}
