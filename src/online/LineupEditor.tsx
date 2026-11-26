import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import type { Team } from '../engine/types';
import { defaultLineup, lineupProblem, minBowlers, type Lineup } from './lineup';

/** Online play has no bowling plan: bowlers are chosen over by over during the match. */
interface Draft {
  order: string[];
  bowlers: string[];
}

const toDraft = (l: Lineup): Draft => ({ order: l.battingOrder, bowlers: l.bowlers });
const toLineup = (d: Draft): Lineup => ({ battingOrder: d.order, bowlers: d.bowlers });
const problemOf = (team: Team, d: Draft, overs: number) => lineupProblem(team, toLineup(d), overs);

/** Section labels shown above these batting positions (0-based). */
const GROUPS: Record<number, string> = { 0: 'Openers', 2: 'Middle order', 7: 'Tail' };

interface Drag {
  from: number;
  over: number;
  dy: number;
}

/**
 * Edits a lineup for one match. Every legal change is passed up straight away; an illegal one stays here, with the
 * reason, until it is fixed. `onProblem` says whether the lineup on screen is the one that will be used.
 */
export function LineupEditor({
  team, lineup, overs, locked, onChange, onProblem,
}: {
  team: Team;
  lineup: Lineup;
  overs: number;
  locked: boolean;
  onChange: (l: Lineup) => void;
  onProblem: (problem: string | null) => void;
}) {
  const [draft, setDraft] = useState(() => toDraft(lineup));
  // Lineups we sent come back from the server; only adopt ones that came from somewhere else.
  const sent = useRef(new Set<string>([JSON.stringify(toLineup(toDraft(lineup)))]));
  const incoming = JSON.stringify(toLineup(toDraft(lineup)));
  useEffect(() => {
    if (sent.current.has(incoming)) return;
    sent.current = new Set([incoming]);
    setDraft(toDraft(JSON.parse(incoming) as Lineup));
  }, [incoming]);

  const problem = problemOf(team, draft, overs);
  useEffect(() => onProblem(problem), [problem, onProblem]);

  const edit = (change: (d: Draft) => void) => {
    if (locked) return;
    const d = structuredClone(draft);
    change(d);
    setDraft(d);
    if (!problemOf(team, d, overs)) {
      const l = toLineup(d);
      sent.current.add(JSON.stringify(l));
      onChange(l);
    }
  };

  const player = (id: string) => team.players.find((p) => p.id === id);
  const need = minBowlers(overs);
  const enough = draft.bowlers.length >= need;

  const reorder = (from: number, to: number) =>
    edit((d) => {
      if (to < 0 || to >= d.order.length || to === from) return;
      const [id] = d.order.splice(from, 1);
      d.order.splice(to, 0, id);
    });
  const toggle = (id: string) =>
    edit((d) => {
      d.bowlers = d.bowlers.includes(id) ? d.bowlers.filter((x) => x !== id) : [...d.bowlers, id];
    });

  // ---------- Dragging a player by the handle ----------
  // Rows are measured relative to the sheet (it is position: relative), so section labels are allowed for.
  const rows = useRef<(HTMLDivElement | null)[]>([]);
  const at = useRef<{ startY: number; tops: number[]; heights: number[] } | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);

  const startDrag = (e: PointerEvent<HTMLButtonElement>, i: number) => {
    if (locked || e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const els = rows.current.slice(0, draft.order.length);
    at.current = { startY: e.clientY, tops: els.map((r) => r?.offsetTop ?? 0), heights: els.map((r) => r?.offsetHeight ?? 0) };
    setDrag({ from: i, over: i, dy: 0 });
  };
  const moveDrag = (e: PointerEvent<HTMLButtonElement>) => {
    if (!drag || !at.current) return;
    const { startY, tops, heights } = at.current;
    const dy = e.clientY - startY;
    const centre = tops[drag.from] + heights[drag.from] / 2 + dy;
    let over = 0;
    tops.forEach((t, j) => {
      if (Math.abs(t + heights[j] / 2 - centre) < Math.abs(tops[over] + heights[over] / 2 - centre)) over = j;
    });
    setDrag({ ...drag, over, dy });
  };
  const endDrag = (commit: boolean) => {
    if (drag && commit) reorder(drag.from, drag.over);
    setDrag(null);
    at.current = null;
  };

  /** Where a row is drawn while another one is being dragged past it. */
  const shift = (i: number): CSSProperties | undefined => {
    if (!drag || !at.current) return undefined;
    const { tops } = at.current;
    if (i === drag.from) return { transform: `translateY(${drag.dy}px)` };
    if (drag.from < drag.over && i > drag.from && i <= drag.over) return { transform: `translateY(${tops[i - 1] - tops[i]}px)` };
    if (drag.over < drag.from && i >= drag.over && i < drag.from) return { transform: `translateY(${tops[i + 1] - tops[i]}px)` };
    return undefined;
  };

  return (
    <div className={`on-lineup on-sheet ${drag ? 'on-sheet-dragging' : ''}`} style={{ '--team': team.color } as CSSProperties}>
      <div className="on-sheet-head">
        <h3 className="on-sheet-title">Batting order</h3>
        <span className={`on-count ${enough ? 'on-count-ok' : 'on-count-short'}`} title={`At least ${need} bowlers for ${overs} overs`}>
          Bowlers {draft.bowlers.length}/{need} {enough ? '✓' : ''}
        </span>
        <button className="on-sheet-reset" disabled={locked} onClick={() => edit((d) => Object.assign(d, toDraft(defaultLineup(team))))}>
          Reset
        </button>
      </div>
      <p className="on-sheet-hint">Top two open · mark at least {need} bowlers · drag ⠿ or use the arrows to reorder</p>
      <ol className="on-sheet-list">
        {draft.order.map((id, i) => {
          const bowls = draft.bowlers.includes(id);
          const name = player(id)?.name ?? '';
          return (
            <li key={id} className="on-sheet-item">
              {GROUPS[i] && <div className="on-sheet-group">{GROUPS[i]}</div>}
              <div
                ref={(el) => {
                  rows.current[i] = el;
                }}
                className={`on-sheet-row ${drag?.from === i ? 'on-sheet-lifted' : ''}`}
                style={shift(i)}
              >
                <span className="on-sheet-pos">{i + 1}</span>
                <span className="on-sheet-name">{name}</span>
                <button
                  className={`on-bowl-pill ${bowls ? 'on' : ''}`}
                  aria-pressed={bowls}
                  aria-label={`${name} bowls`}
                  disabled={locked}
                  onClick={() => toggle(id)}
                >
                  <span className="on-ball" aria-hidden /> Bowls
                </button>
                <span className="on-sheet-moves">
                  <button className="on-move" aria-label={`Move ${name} up`} disabled={locked || i === 0} onClick={() => reorder(i, i - 1)}>▲</button>
                  <button className="on-move" aria-label={`Move ${name} down`} disabled={locked || i === draft.order.length - 1} onClick={() => reorder(i, i + 1)}>▼</button>
                </span>
                <button
                  className="on-drag"
                  aria-label={`Drag ${name} to a new position`}
                  disabled={locked}
                  onPointerDown={(e) => startDrag(e, i)}
                  onPointerMove={moveDrag}
                  onPointerUp={() => endDrag(true)}
                  onPointerCancel={() => endDrag(false)}
                >
                  ⠿
                </button>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
