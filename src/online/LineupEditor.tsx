import { useEffect, useRef, useState } from 'react';
import type { Team } from '../engine/types';
import { autoPlan, bowlerCap, defaultLineup, lineupProblem, minBowlers, type Lineup } from './lineup';

interface Draft {
  order: string[];
  bowlers: string[];
  /** Null when there is no plan; an empty string is an over not filled in yet. */
  plan: string[] | null;
}

const toDraft = (l: Lineup): Draft => ({ order: l.battingOrder, bowlers: l.bowlers, plan: l.bowlingPlan ?? null });
const toLineup = (d: Draft): Lineup => ({
  battingOrder: d.order,
  bowlers: d.bowlers,
  ...(d.plan ? { bowlingPlan: d.plan } : {}),
});

const problemOf = (team: Team, d: Draft, overs: number) =>
  d.plan?.includes('') ? 'Choose a bowler for every over' : lineupProblem(team, toLineup(d), overs);

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
  const sent = useRef(new Set<string>([JSON.stringify(lineup)]));
  const incoming = JSON.stringify(lineup);
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
  const cap = bowlerCap(overs);
  const need = minBowlers(overs);

  const move = (i: number, by: number) =>
    edit((d) => {
      const j = i + by;
      if (j >= 0 && j < d.order.length) [d.order[i], d.order[j]] = [d.order[j], d.order[i]];
    });
  const toggle = (id: string) =>
    edit((d) => {
      if (d.bowlers.includes(id)) {
        d.bowlers = d.bowlers.filter((x) => x !== id);
        d.plan = d.plan && d.plan.map((x) => (x === id ? '' : x));
      } else d.bowlers = [...d.bowlers, id];
    });

  return (
    <div className="on-lineup">
      <div className="card on-pad">
        <div className="title-row">
          <h3>Batting order</h3>
          <button className="btn btn-sm" disabled={locked} onClick={() => edit((d) => Object.assign(d, toDraft(defaultLineup(team))))}>
            Reset
          </button>
        </div>
        <p className="hint">
          The top two open. 🎯 marks who bowls: at least {need} for {overs} over{overs === 1 ? '' : 's'} ({draft.bowlers.length} marked).
        </p>
        <ol className="squad">
          {draft.order.map((id, i) => {
            const bowls = draft.bowlers.includes(id);
            return (
              <li key={id}>
                <span className="pos">{i + 1}</span>
                <span className="on-player">{player(id)?.name}</span>
                <label className={`bowl-toggle ${bowls ? 'on' : ''}`} title="Bowler">
                  <input type="checkbox" checked={bowls} disabled={locked} onChange={() => toggle(id)} aria-label={`${player(id)?.name} bowls`} />
                  🎯
                </label>
                <button className="btn btn-sm btn-ghost" aria-label={`Move ${player(id)?.name} up`} disabled={locked || i === 0} onClick={() => move(i, -1)}>↑</button>
                <button className="btn btn-sm btn-ghost" aria-label={`Move ${player(id)?.name} down`} disabled={locked || i === draft.order.length - 1} onClick={() => move(i, 1)}>↓</button>
              </li>
            );
          })}
        </ol>
      </div>

      <div className="card on-pad">
        <div className="title-row">
          <h3>Bowling order <span className="muted small">(optional)</span></h3>
          <div className="btn-row">
            <button
              className="btn btn-sm"
              disabled={locked || draft.bowlers.length < need}
              onClick={() => edit((d) => { d.plan = autoPlan(d.bowlers, overs); })}
            >
              Fill automatically
            </button>
            {draft.plan && (
              <button className="btn btn-sm btn-ghost" disabled={locked} onClick={() => edit((d) => { d.plan = null; })}>
                Clear
              </button>
            )}
          </div>
        </div>
        <p className="hint">
          Each bowler can bowl {cap} over{cap === 1 ? '' : 's'}, never two in a row. You can still change your mind before
          each over. Your opponent never sees this.
        </p>
        {draft.plan ? (
          <ol className="on-plan">
            {draft.plan.map((id, over) => (
              <li key={over}>
                <span className="pos">{over + 1}</span>
                <select
                  value={id}
                  disabled={locked}
                  aria-label={`Bowler for over ${over + 1}`}
                  onChange={(e) => edit((d) => { d.plan![over] = e.target.value; })}
                >
                  <option value="">Choose…</option>
                  {draft.bowlers.map((b) => {
                    const elsewhere = draft.plan!.filter((x, i) => x === b && i !== over).length;
                    const inRow = draft.plan![over - 1] === b || draft.plan![over + 1] === b;
                    return (
                      <option key={b} value={b} disabled={b !== id && (elsewhere >= cap || inRow)}>
                        {player(b)?.name}
                      </option>
                    );
                  })}
                </select>
              </li>
            ))}
          </ol>
        ) : (
          <button className="btn" disabled={locked} onClick={() => edit((d) => { d.plan = Array<string>(overs).fill(''); })}>
            Choose who bowls each over
          </button>
        )}
      </div>
    </div>
  );
}
