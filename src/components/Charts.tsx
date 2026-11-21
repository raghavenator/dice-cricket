import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { BALLS_PER_OVER, getTeam, oversLimit } from '../engine/match';
import { formatOvers } from '../engine/stats';
import type { Innings, MatchState } from '../engine/types';
import { inningsTitle } from './Scorecard';

/** Track an element's width so the SVG is drawn at real pixels (crisp text, no scaling). */
function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [w, setW] = useState(320);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(220, Math.floor(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

/** Colour follows the team: slot 1 for the side batting first, slot 2 for the other. */
const seriesColor = (m: MatchState, teamId: string) => (teamId === m.order[0] ? 'var(--series-1)' : 'var(--series-2)');

/** Second innings of the same team in a Test is drawn dashed. */
const isRepeatInnings = (m: MatchState, idx: number) =>
  m.innings.slice(0, idx).some((i) => i.battingTeamId === m.innings[idx].battingTeamId);

function niceScale(max: number, maxTicks = 5) {
  const steps = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000];
  const step = steps.find((s) => max / s <= maxTicks) ?? 1000;
  const top = Math.max(step, Math.ceil(max / step) * step);
  const ticks: number[] = [];
  for (let v = 0; v <= top; v += step) ticks.push(v);
  return { top, ticks };
}

interface OverSummary {
  over: number;
  runs: number;
  wickets: number;
  bowlerId: string;
  balls: number;
}

function overSummaries(inn: Innings): OverSummary[] {
  const out: OverSummary[] = [];
  for (const b of inn.balls) {
    let o = out[b.over];
    if (!o) o = out[b.over] = { over: b.over, runs: 0, wickets: 0, bowlerId: b.bowlerId, balls: 0 };
    o.runs += b.runs;
    o.balls++;
    if (b.wicket) o.wickets++;
  }
  return out.filter(Boolean);
}

/** Cumulative [balls, runs, wickets] after each delivery, starting at 0. */
function cumulative(inn: Innings) {
  const pts: { balls: number; runs: number; wkts: number }[] = [{ balls: 0, runs: 0, wkts: 0 }];
  let runs = 0;
  let wkts = 0;
  inn.balls.forEach((b, i) => {
    runs += b.runs;
    if (b.wicket) wkts++;
    pts.push({ balls: i + 1, runs, wkts });
  });
  return pts;
}

const PAD = { l: 38, r: 44, t: 10, b: 36 };

function Tooltip({ x, width, children }: { x: number; width: number; children: React.ReactNode }) {
  const left = Math.min(Math.max(x + 12, 4), width - 190);
  return (
    <div className="viz-tip" style={{ left }} role="status">
      {children}
    </div>
  );
}

// ---------------------------------------------------------------- Worm

export function WormChart({ m }: { m: MatchState }) {
  const [ref, w] = useWidth<HTMLDivElement>();
  const [hoverBalls, setHoverBalls] = useState<number | null>(null);
  const [hoverX, setHoverX] = useState(0);
  const h = 210;
  const plotW = w - PAD.l - PAD.r;
  const plotH = h - PAD.t - PAD.b;

  const limit = oversLimit(m.settings);
  const maxBalls = Math.max(limit ? limit * BALLS_PER_OVER : 0, ...m.innings.map((i) => i.legalBalls), BALLS_PER_OVER);
  const maxRuns = Math.max(10, ...m.innings.map((i) => i.runs), ...m.innings.map((i) => (i.target ?? 0)));
  const y = niceScale(maxRuns);
  const xOvers = niceScale(maxBalls / BALLS_PER_OVER, 8);
  const xMaxBalls = limit ? limit * BALLS_PER_OVER : xOvers.top * BALLS_PER_OVER;

  const sx = (balls: number) => PAD.l + (balls / xMaxBalls) * plotW;
  const sy = (runs: number) => PAD.t + plotH - (runs / y.top) * plotH;

  const series = m.innings.map((inn, idx) => {
    const pts = cumulative(inn);
    return {
      idx,
      inn,
      pts,
      color: seriesColor(m, inn.battingTeamId),
      dash: isRepeatInnings(m, idx) ? '6 4' : undefined,
      label: inningsTitle(m, idx),
      short: getTeam(m, inn.battingTeamId).short,
      d: pts.map((p, i) => `${i ? 'L' : 'M'}${sx(p.balls).toFixed(1)},${sy(p.runs).toFixed(1)}`).join(''),
    };
  });

  // Direct end labels, nudged apart so they never collide.
  const ends = series
    .filter((s) => s.inn.legalBalls > 0)
    .map((s) => ({ s, x: sx(s.inn.legalBalls), y: sy(s.inn.runs) }))
    .sort((a, b) => a.y - b.y);
  for (let i = 1; i < ends.length; i++) if (ends[i].y - ends[i - 1].y < 13) ends[i].y = ends[i - 1].y + 13;

  const target = m.settings.format === 'limited' ? m.innings[1]?.target ?? null : null;

  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const overs = Math.round(((px - PAD.l) / plotW) * (xMaxBalls / BALLS_PER_OVER));
    const balls = Math.min(Math.max(0, overs * BALLS_PER_OVER), maxBalls);
    setHoverBalls(balls);
    setHoverX(sx(balls));
  };

  const at = (pts: { balls: number; runs: number; wkts: number }[], balls: number) => pts[Math.min(balls, pts.length - 1)];

  return (
    <div className="viz card">
      <div className="viz-head">
        <h3>Worm</h3>
        <div className="viz-legend">
          {series.map((s) => (
            <span key={s.idx} className="viz-key">
              <svg width="18" height="8" aria-hidden>
                <line x1="1" y1="4" x2="17" y2="4" stroke={s.color} strokeWidth="2" strokeDasharray={s.dash} strokeLinecap="round" />
              </svg>
              {s.label}
            </span>
          ))}
        </div>
      </div>
      <div className="viz-body" ref={ref}>
        <svg
          width={w}
          height={h}
          role="img"
          aria-label={`Worm chart: ${series.map((s) => `${s.label} ${s.inn.runs}/${s.inn.wickets} in ${formatOvers(s.inn.legalBalls)} overs`).join('; ')}`}
          onPointerMove={onMove}
          onPointerLeave={() => setHoverBalls(null)}
        >
          {y.ticks.map((t) => (
            <g key={t}>
              <line className="viz-grid" x1={PAD.l} x2={w - PAD.r} y1={sy(t)} y2={sy(t)} />
              <text className="viz-tick" x={PAD.l - 6} y={sy(t)} dy="0.32em" textAnchor="end">{t}</text>
            </g>
          ))}
          {xOvers.ticks.filter((t) => t * BALLS_PER_OVER <= xMaxBalls).map((t) => (
            <text key={t} className="viz-tick" x={sx(t * BALLS_PER_OVER)} y={h - 20} textAnchor="middle">{t}</text>
          ))}
          <line className="viz-axis" x1={PAD.l} x2={w - PAD.r} y1={sy(0)} y2={sy(0)} />

          {target !== null && (
            <g>
              <line className="viz-target" x1={PAD.l} x2={w - PAD.r} y1={sy(target)} y2={sy(target)} />
              <text className="viz-tick" x={PAD.l + 4} y={sy(target) - 4}>Target {target}</text>
            </g>
          )}

          {series.map((s) => (
            <path key={s.idx} d={s.d} fill="none" stroke={s.color} strokeWidth="2" strokeDasharray={s.dash} strokeLinejoin="round" strokeLinecap="round" />
          ))}
          {series.map((s) =>
            s.pts.slice(1).map((p, i) =>
              s.inn.balls[i].wicket ? (
                <circle key={`${s.idx}-${i}`} cx={sx(p.balls)} cy={sy(p.runs)} r="4" fill={s.color} className="viz-ring" />
              ) : null,
            ),
          )}
          {ends.map(({ s, x, y: ly }) => (
            <text key={s.idx} className="viz-end" x={x + 6} y={ly} dy="0.32em">{s.short}</text>
          ))}

          {hoverBalls !== null && (
            <line className="viz-cross" x1={hoverX} x2={hoverX} y1={PAD.t} y2={PAD.t + plotH} />
          )}
          <rect x={PAD.l} y={PAD.t} width={plotW} height={plotH} fill="transparent" />
        </svg>
        {hoverBalls !== null && (
          <Tooltip x={hoverX} width={w}>
            <div className="viz-tip-title">After {formatOvers(hoverBalls)} overs</div>
            {series.map((s) => {
              const reached = s.inn.legalBalls >= hoverBalls;
              const p = at(s.pts, hoverBalls);
              return (
                <div key={s.idx} className="viz-tip-row">
                  <span className="viz-swatch" style={{ background: s.color }} />
                  <span>{s.label}</span>
                  <b>{reached || s.inn.done ? `${p.runs}/${p.wkts}` : '—'}</b>
                </div>
              );
            })}
          </Tooltip>
        )}
        <div className="viz-axis-label">Overs</div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Manhattan (runs per over)

export function ManhattanChart({ m, idx }: { m: MatchState; idx: number }) {
  const [ref, w] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const inn = m.innings[idx];
  const overs = overSummaries(inn);
  const limit = oversLimit(m.settings);
  const nOvers = Math.max(limit ?? 0, overs.length, 5);
  const h = 210;
  const pad = { ...PAD, r: 12 };
  const plotW = w - pad.l - pad.r;
  const plotH = h - pad.t - pad.b;
  const maxRuns = Math.max(6, ...overs.map((o) => o.runs));
  const y = niceScale(maxRuns, 4);
  const band = plotW / nOvers;
  const barW = Math.max(1, band - 2); // 2px surface gap between bars
  const r = Math.min(4, barW / 2);
  const sy = (runs: number) => pad.t + plotH - (runs / y.top) * plotH;
  const color = seriesColor(m, inn.battingTeamId);
  const fielding = getTeam(m, inn.bowlingTeamId);
  const xStep = niceScale(nOvers, 10).ticks[1] ?? 1;

  const barPath = (x: number, top: number, bottom: number) => {
    const hgt = bottom - top;
    if (hgt <= 0) return '';
    const rr = Math.min(r, hgt);
    return `M${x},${bottom}V${top + rr}Q${x},${top} ${x + rr},${top}H${x + barW - rr}Q${x + barW},${top} ${x + barW},${top + rr}V${bottom}Z`;
  };

  const hov = hover !== null ? overs.find((o) => o.over === hover) : undefined;

  return (
    <div className="viz card">
      <div className="viz-head">
        <h3>Runs per over</h3>
        <div className="viz-legend">
          <span className="viz-key">
            <span className="viz-swatch" style={{ background: color }} />
            {inningsTitle(m, idx)}
          </span>
          <span className="viz-key">
            <svg width="10" height="10" aria-hidden><circle cx="5" cy="5" r="4" className="viz-wkt" /></svg>
            Wicket
          </span>
        </div>
      </div>
      <div className="viz-body" ref={ref}>
        <svg
          width={w}
          height={h}
          role="img"
          aria-label={`Runs per over for ${inningsTitle(m, idx)}: ${overs.map((o) => `over ${o.over + 1} ${o.runs}`).join(', ') || 'no overs yet'}`}
          onPointerLeave={() => setHover(null)}
        >
          {y.ticks.map((t) => (
            <g key={t}>
              <line className="viz-grid" x1={pad.l} x2={w - pad.r} y1={sy(t)} y2={sy(t)} />
              <text className="viz-tick" x={pad.l - 6} y={sy(t)} dy="0.32em" textAnchor="end">{t}</text>
            </g>
          ))}
          {Array.from({ length: nOvers }, (_, i) => i + 1)
            .filter((o) => o === 1 || o % xStep === 0)
            .map((o) => (
              <text key={o} className="viz-tick" x={pad.l + (o - 0.5) * band} y={h - 20} textAnchor="middle">{o}</text>
            ))}
          {overs.map((o) => {
            const x = pad.l + o.over * band + 1;
            const top = sy(o.runs);
            return (
              <g key={o.over} opacity={hover === null || hover === o.over ? 1 : 0.55}>
                <path d={barPath(x, top, sy(0))} fill={color} />
                {Array.from({ length: o.wickets }, (_, k) => (
                  <circle key={k} cx={x + barW / 2} cy={top - 7 - k * 10} r="4" className="viz-wkt viz-ring" />
                ))}
              </g>
            );
          })}
          <line className="viz-axis" x1={pad.l} x2={w - pad.r} y1={sy(0)} y2={sy(0)} />
          {/* Hit targets: the full column, bigger than the bar */}
          {overs.map((o) => (
            <rect
              key={`hit${o.over}`}
              x={pad.l + o.over * band}
              y={pad.t}
              width={band}
              height={plotH}
              fill="transparent"
              onPointerEnter={() => setHover(o.over)}
            />
          ))}
        </svg>
        {hov && (
          <Tooltip x={pad.l + (hov.over + 0.5) * band} width={w}>
            <div className="viz-tip-title">Over {hov.over + 1}{hov.balls < BALLS_PER_OVER ? ` (${hov.balls} balls)` : ''}</div>
            <div className="viz-tip-row"><span>Runs</span><b>{hov.runs}</b></div>
            <div className="viz-tip-row"><span>Wickets</span><b>{hov.wickets}</b></div>
            <div className="viz-tip-row"><span>Bowler</span><b>{fielding.players.find((p) => p.id === hov.bowlerId)?.name}</b></div>
          </Tooltip>
        )}
        <div className="viz-axis-label">Over</div>
      </div>
    </div>
  );
}

/** Worm + per-over bars, with a table view for accessibility. */
export function MatchCharts({ m, idx }: { m: MatchState; idx: number }) {
  const inn = m.innings[idx];
  const overs = overSummaries(inn);
  return (
    <div className="viz-wrap">
      <div className="viz-grid-2">
        <WormChart m={m} />
        <ManhattanChart m={m} idx={idx} />
      </div>
      <details className="viz-table">
        <summary className="small muted">Show runs per over as a table</summary>
        <div className="table-wrap">
          <table className="sc">
            <thead>
              <tr><th className="l">Over</th><th>Runs</th><th>Wkts</th><th>Total</th></tr>
            </thead>
            <tbody>
              {overs.map((o, i) => (
                <tr key={o.over}>
                  <td className="l">{o.over + 1}</td>
                  <td className="num">{o.runs}</td>
                  <td className="num">{o.wickets}</td>
                  <td className="num">
                    {overs.slice(0, i + 1).reduce((s, x) => s + x.runs, 0)}/{overs.slice(0, i + 1).reduce((s, x) => s + x.wickets, 0)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
