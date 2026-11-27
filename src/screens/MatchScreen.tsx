import { useCallback, useEffect, useRef, useState } from 'react';
import { Die } from '../components/Die';
import { BallChip, BattingCard, BowlingCard, InningsTabs } from '../components/Scorecard';
import { rollDice } from '../engine/dice';
import {
  BALLS_PER_OVER, applyBall, bowlerOptions, currentInnings, getTeam, matchTotal, needsBowler, oversLimit,
  pickAutoBowler, setBowler, simulate, type SimUntil,
} from '../engine/match';
import { battingCard, bowlingCard, formatOvers, ratio } from '../engine/stats';
import { MatchCharts } from '../components/Charts';
import { Commentary } from '../components/Commentary';
import { ScorecardOrderToggle } from '../components/ScorecardOrder';
import { MatchStage, usePrefersReducedMotion } from '../components/MatchStage';
import { GameplayPager, useMedia, type PagerSection } from '../components/GameplayPager';
import { useDeliveryTimeline } from '../components/useDeliveryTimeline';
import { deliveryFor, waitingFor } from '../match3d/fromMatch';
import type { Kits } from '../match3d/kits';
import type { Speed } from '../match3d/timing';

type FlashKind = 'four' | 'six' | 'wicket';
import type { Ball, MatchState, Rolls } from '../engine/types';
import { useGame, type RollSpeed } from '../store/useGameStore';

type Phase = 'idle' | 'roll1' | 'roll2';
type Scope = 'over' | 'innings' | 'match';

function describe(m: MatchState, b: Ball): string {
  const inn = m.innings.find((i) => i.balls.includes(b)) ?? currentInnings(m);
  const bat = getTeam(m, inn.battingTeamId).players.find((p) => p.id === b.batterId)?.name;
  const fld = getTeam(m, inn.bowlingTeamId);
  const bowl = fld.players.find((p) => p.id === b.bowlerId)?.name;
  const pre = `${bowl} to ${bat}: `;
  if (b.roll1 !== 5) {
    const words: Record<number, string> = { 1: '1 run', 2: '2 runs', 3: '3 runs', 4: 'FOUR!', 6: 'SIX!' };
    return pre + words[b.runs];
  }
  if (!b.wicket) return `${pre}wicket check… ${b.roll2} — survives! Dot ball.`;
  const how =
    b.how === 'caught'
      ? `caught by ${fld.players.find((p) => p.id === b.fielderId)?.name}`
      : b.how === 'lbw' ? 'LBW' : 'BOWLED';
  return `${pre}wicket check… ${b.roll2} — OUT! ${how}`;
}

export function MatchScreen() {
  const live = useGame((s) => s.live);
  const updateLive = useGame((s) => s.updateLive);
  const closeLive = useGame((s) => s.closeLive);
  const go = useGame((s) => s.go);
  const prefs = useGame((s) => s.prefs);
  const setPrefs = useGame((s) => s.setPrefs);
  const tablesFirst = prefs.scorecardOrder === 'tables-first';

  const m = live?.match ?? null;
  const mRef = useRef(m);
  mRef.current = m;

  const [phase, setPhase] = useState<Phase>('idle');
  const [d1, setD1] = useState<{ v: number | null; id: number }>({ v: null, id: 0 });
  const [d2, setD2] = useState<{ v: number | null; id: number }>({ v: null, id: 0 });
  const [showCheck, setShowCheck] = useState(false);
  const [commentary, setCommentary] = useState<string[]>([]);
  const [auto, setAuto] = useState(false);
  const [scope, setScope] = useState<Scope>('innings');
  const anchor = useRef({ inn: 0, over: 0 });
  const [viewIdx, setViewIdx] = useState<number | null>(null);
  // One clock per ball for the dice, the 3D clip and the result.
  const reduced = usePrefersReducedMotion();
  const wide = useMedia('(min-width: 900px)');
  const tl = useDeliveryTimeline();
  const [diceMs, setDiceMs] = useState({ d1: 0, d2: 0 });
  const [stageKits, setStageKits] = useState<Kits | null>(null);

  const [flash, setFlash] = useState<{ id: number; kind: FlashKind; sub: string } | null>(null);

  const pushComment = (lines: string[]) => {
    const newestFirst = [...lines].reverse();
    setCommentary((c) => [...newestFirst, ...c].slice(0, 30));
  };

  const commit = useCallback(
    (rolls: Rolls) => {
      const cur = mRef.current;
      if (!cur) return;
      const next = applyBall(cur, rolls);
      const prevInn = cur.innings.length - 1;
      const ball = next.innings[prevInn].balls[next.innings[prevInn].balls.length - 1];
      const lines = [describe(next, ball)];
      if (next.innings.length > cur.innings.length || next.innings[prevInn].done) {
        const done = next.innings[prevInn];
        lines.push(`End of innings — ${getTeam(next, done.battingTeamId).name} ${done.runs}/${done.wickets} (${formatOvers(done.legalBalls)} ov)`);
        const ni = next.innings[next.innings.length - 1];
        if (next.innings.length > cur.innings.length && ni.target !== null)
          lines.push(`${getTeam(next, ni.battingTeamId).name} need ${ni.target} to win`);
      }
      if (next.result) lines.push(`🏆 ${next.result.text}`);
      pushComment(lines);
      if (ball.wicket || ball.runs === 4 || ball.runs === 6) {
        const kind: FlashKind = ball.wicket ? 'wicket' : ball.runs === 6 ? 'six' : 'four';
        const row = battingCard(next, prevInn).find((r) => r.playerId === ball.batterId);
        const sub = row
          ? ball.wicket
            ? `${row.name} ${row.dismissal} · ${row.runs} (${row.balls})`
            : `${row.name} · ${row.runs}* (${row.balls})`
          : '';
        setFlash((f) => ({ id: (f?.id ?? 0) + 1, kind, sub }));
      }
      updateLive(next);
      setPhase('idle');
    },
    [updateLive],
  );

  const roll = useCallback(() => {
    const cur = mRef.current;
    if (!cur || cur.result || phase !== 'idle' || needsBowler(cur)) return;
    const r = rollDice(Math.random);
    // The 3D clip shows this exact ball: preview it (applyBall is pure; commit applies it for real).
    // Auto-roll: fit the clip to the roll-to-roll period. Manual rolls use the Dice speed setting.
    const speed: Speed | { fitMs: number } = reduced
      ? 'reduced'
      : auto && prefs.rollSpeed !== 'instant' ? { fitMs: prefs.autoDelay } : prefs.rollSpeed;
    const d = deliveryFor(cur, applyBall(cur, r), speed)!;
    const t = d.timeline;
    setPhase('roll1');
    setShowCheck(false);
    // Die 1 lands as the ball is released; die 2 (wicket check) lands at the bat.
    setDiceMs({ d1: t.die1At, d2: t.die2At !== null ? t.die2At - t.die1At : 0 });
    setD1((x) => ({ v: r.roll1, id: x.id + 1 }));
    setStageKits(d.kits);
    tl.start({
      key: d.key,
      plan: d.plan,
      timeline: t,
      numbers: d.numbers,
      onCheck: r.roll1 === 5 ? () => {
        setPhase('roll2');
        setShowCheck(true);
        setD2((x) => ({ v: r.roll2!, id: x.id + 1 }));
      } : undefined,
      onResult: () => commit(r),
    });
  }, [phase, prefs.rollSpeed, prefs.autoDelay, auto, reduced, commit, tl.start]);

  const skipBall = useCallback(() => {
    setDiceMs({ d1: 0, d2: 0 });
    tl.skip();
  }, [tl.skip]);

  // Auto-roll loop
  useEffect(() => {
    if (!auto || !m || phase !== 'idle') return;
    if (m.result) {
      setAuto(false);
      return;
    }
    const innIdx = m.innings.length - 1;
    const over = Math.floor(currentInnings(m).legalBalls / BALLS_PER_OVER);
    if ((scope === 'over' && (innIdx !== anchor.current.inn || over !== anchor.current.over)) ||
        (scope === 'innings' && innIdx !== anchor.current.inn)) {
      setAuto(false);
      return;
    }
    if (needsBowler(m)) return; // waits for a manual pick
    // One ball every autoDelay, roll to roll (the clip is fitted to that period).
    const since = tl.delivery ? performance.now() - tl.delivery.startedAt : Infinity;
    const wait = Math.min(prefs.autoDelay, Math.max(0, prefs.autoDelay - since));
    const t = window.setTimeout(roll, wait);
    return () => clearTimeout(t);
  }, [auto, m, phase, scope, prefs.autoDelay, roll, tl.delivery]);

  const toggleAuto = useCallback(() => {
    const cur = mRef.current;
    if (!cur) return;
    setAuto((a) => {
      if (!a) {
        anchor.current = {
          inn: cur.innings.length - 1,
          over: Math.floor(currentInnings(cur).legalBalls / BALLS_PER_OVER),
        };
      }
      return !a;
    });
  }, []);

  // Keyboard: Space = roll, A = auto
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || tag === 'BUTTON') return;
      if (e.code === 'Space') {
        e.preventDefault();
        roll();
      } else if (e.key === 'a' || e.key === 'A') toggleAuto();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [roll, toggleAuto]);

  if (!m || !live) {
    return (
      <div className="screen">
        <p>No match in progress.</p>
        <button className="btn" onClick={() => go({ name: 'home' })}>Home</button>
      </div>
    );
  }

  const inn = currentInnings(m);
  const curIdx = m.innings.length - 1;
  const shownIdx = viewIdx ?? curIdx;
  const batTeam = getTeam(m, inn.battingTeamId);
  const bowlTeam = getTeam(m, inn.bowlingTeamId);
  const limit = oversLimit(m.settings);
  const busy = phase !== 'idle';
  const pickNeeded = needsBowler(m);
  // Keep showing the over just completed until the first ball of the next one.
  const thisOverNo = Math.floor(Math.max(0, inn.legalBalls - 1) / BALLS_PER_OVER);
  const thisOver = inn.balls.filter((b) => b.over === thisOverNo);

  const sim = (until: SimUntil) => {
    if (busy) return;
    tl.cancel();
    const before = m;
    const next = simulate(m, Math.random, until);
    const lines: string[] = [];
    for (let i = before.innings.length - 1; i < next.innings.length; i++) {
      const x = next.innings[i];
      if (x.done) lines.push(`End of innings — ${getTeam(next, x.battingTeamId).name} ${x.runs}/${x.wickets} (${formatOvers(x.legalBalls)} ov)`);
    }
    lines.unshift(`Simulated ${until === 'over' ? 'to end of over' : until === 'innings' ? 'to end of innings' : 'rest of match'}`);
    if (next.result) lines.push(`🏆 ${next.result.text}`);
    pushComment(lines);
    setAuto(false);
    updateLive(next);
  };

  // Chase / lead info
  let situation = '';
  let chase: { main: string; rrr: string } | null = null;
  if (inn.target !== null && !inn.done) {
    const need = inn.target - inn.runs;
    const runsTxt = `${need} run${need === 1 ? '' : 's'} needed`;
    if (limit !== null) {
      const left = limit * BALLS_PER_OVER - inn.legalBalls;
      // Show overs until it's down to the last 30 balls, then count balls.
      const ov = formatOvers(left);
      const leftTxt = left > 30 ? `${ov} over${ov === '1' ? '' : 's'}` : `${left} ball${left === 1 ? '' : 's'}`;
      chase = { main: `${runsTxt} off ${leftTxt}`, rrr: `Req. RR ${ratio(need * 6, left)}` };
    } else {
      chase = { main: `${runsTxt} to win`, rrr: '' };
    }
  } else if (m.settings.format === 'test' && curIdx > 0 && !m.result) {
    const diff = matchTotal(m, inn.battingTeamId) - matchTotal(m, inn.bowlingTeamId);
    situation = diff === 0 ? 'Scores level' : diff > 0 ? `Lead by ${diff}` : `Trail by ${-diff}`;
  } else if (curIdx === 0 && !inn.balls.length) {
    situation = m.tossText;
  }

  const bowlRow = inn.bowlerId ? bowlingCard(m, curIdx).find((r) => r.playerId === inn.bowlerId) : undefined;
  const waiting = waitingFor(m);

  const leave = () => go(live.tournamentId ? { name: 'tourHub', id: live.tournamentId } : { name: 'home' });
  const rollLabel = busy ? 'Rolling…' : pickNeeded ? 'Choose a bowler' : '🎲 Roll';

  // Scoreboard (the big FOUR!/SIX!/OUT! label shows on the 3D stage)
  const scoreboard = (
      <section className="scoreboard" style={{ ['--team' as string]: batTeam.color }}>
        {flash && <span key={flash.id} className={`sb-glow sb-glow-${flash.kind}`} aria-hidden />}
        <div className="sb-main">
          <div className="sb-team">
            <span className="sb-swatch" />
            <span className="sb-name">{batTeam.name}</span>
            <span className="sb-vs muted">v {bowlTeam.short}</span>
          </div>
          <div className="sb-score">
            {inn.runs}/{inn.wickets}
            <span className="sb-overs">
              {formatOvers(inn.legalBalls)}
              {limit ? `/${limit}` : ''} ov
            </span>
          </div>
          <div className="sb-sub">
            <span>RR {ratio(inn.runs * 6, inn.legalBalls)}</span>
            {chase?.rrr && <span>{chase.rrr}</span>}
            {situation && <span className="sb-situation">{situation}</span>}
          </div>
          {chase && <div className="sb-chase" aria-live="polite">{chase.main}</div>}
        </div>
        <div className="sb-side">
          <div className="muted small">
            {m.settings.format === 'test' ? 'Test match' : `${m.settings.overs}-over match`} · Innings {curIdx + 1}
          </div>
          <div className="this-over">
            <span className="muted small">This over</span>
            <div className="chips">
              {thisOver.map((b, i) => <BallChip key={i} b={b} big />)}
              {Array.from({ length: Math.max(0, BALLS_PER_OVER - thisOver.length) }, (_, i) => (
                <span key={`e${i}`} className="chip chip-empty chip-big" />
              ))}
            </div>
          </div>
          {bowlRow && (
            <div className="small">
              <span className="muted">Bowling:</span> {bowlRow.name} {formatOvers(bowlRow.balls)}-{bowlRow.maidens}-{bowlRow.runs}-{bowlRow.wickets}
            </div>
          )}
        </div>
      </section>
  );

  const dice = (
    <div className="play-dice" title="1·2·3·4·6 = runs | 5 = wicket check (4+ out, 3 or less dot)">
      <div className="die-slot">
        <Die value={d1.v} rollId={d1.id} duration={diceMs.d1} size={wide ? 64 : 46} />
        {wide && <span className="small muted">Delivery</span>}
      </div>
      <div className={`die-slot ${showCheck ? '' : 'die-slot-off'}`}>
        <Die value={d2.v} rollId={d2.id} duration={diceMs.d2} size={wide ? 46 : 36} tone="check" dim={!showCheck} />
        {wide && <span className="small muted">Wicket check</span>}
      </div>
    </div>
  );

  const rollButton = (
    <button className="btn btn-primary btn-roll" onClick={roll} disabled={busy || pickNeeded} title="Space">{rollLabel}</button>
  );

  // Settings and less-used controls, folded away on phones.
  const more = (
    <>
      <div className="auto-row">
        <label className="small">
          Auto until end of{' '}
          <select value={scope} onChange={(e) => setScope(e.target.value as Scope)}>
            <option value="over">this over</option>
            <option value="innings">this innings</option>
            <option value="match">the match</option>
          </select>
        </label>
      </div>
      <div className="auto-row small">
        <label>
          Every {(prefs.autoDelay / 1000).toFixed(1)}s
          <input
            type="range" min={300} max={5000} step={100} value={prefs.autoDelay}
            onChange={(e) => setPrefs({ autoDelay: Number(e.target.value) })}
          />
        </label>
        <label>
          Dice{' '}
          <select value={prefs.rollSpeed} onChange={(e) => setPrefs({ rollSpeed: e.target.value as RollSpeed })}>
            <option value="normal">Normal</option>
            <option value="fast">Fast</option>
            <option value="instant">Instant</option>
          </select>
        </label>
      </div>
      <div className="sim-row">
        <span className="small muted">Simulate:</span>
        <button className="btn btn-sm" disabled={busy} onClick={() => sim('over')}>Over</button>
        <button className="btn btn-sm" disabled={busy} onClick={() => sim('innings')}>Innings</button>
        <button className="btn btn-sm" disabled={busy} onClick={() => sim('match')}>Match</button>
      </div>
      <div className="small muted">1·2·3·4·6 = runs · 5 = wicket check (4+ out, 3 or less dot) · Space = roll · A = auto · tap the field to skip</div>
    </>
  );

  const stageSection = (
    <div className="play">
      <MatchStage
        className="play-stage"
        delivery={tl.delivery}
        kits={(tl.delivery && stageKits) || waiting.kits}
        idleNumbers={waiting.numbers}
        onSkip={skipBall}
      />
      <div className="play-top">
        <div className="play-top-main">
          {scoreboard}
          <button className="btn btn-sm play-home" onClick={leave} title="The match is saved; resume any time">← Leave</button>
        </div>
      </div>
      <div className="play-dock">
        {m.result ? (
          <section className="result-banner">
            <div>
              <div className="result-title">🏆 {m.result.text}</div>
              <div className="muted small">{live.saved ? 'Saved to stats.' : 'Saving…'} Swipe down for the full scorecard.</div>
            </div>
            <button className="btn btn-primary" onClick={closeLive}>
              {live.tournamentId ? 'Back to tournament' : live.seriesId ? 'Back to series' : 'Finish'}
            </button>
          </section>
        ) : (
          <>
            {pickNeeded && !busy && <BowlerPicker m={m} onPick={(id) => updateLive(setBowler(m, id))} />}
            {wide && dice}
            <div className="play-row">
              {!wide && dice}
              {rollButton}
              <button className={`btn ${auto ? 'btn-on' : ''}`} onClick={toggleAuto} title="A" aria-pressed={auto}>
                {auto ? '⏸' : '▶'}{wide ? (auto ? ' Stop auto' : ' Auto-roll') : ''}
              </button>
            </div>
            {wide ? more : (
              <details className="play-more">
                <summary className="small">More: auto, speed, simulate</summary>
                {more}
              </details>
            )}
          </>
        )}
        <Commentary lines={commentary} empty={<p className="muted small">{m.tossText}. Press Roll (or Space) to bowl.</p>} />
      </div>
    </div>
  );

  const tabs = (
    <div className="pager-head">
      <InningsTabs m={m} value={shownIdx} onChange={(i) => setViewIdx(i === curIdx ? null : i)} />
      <ScorecardOrderToggle value={tablesFirst ? 'tables-first' : 'charts-first'} onChange={(v) => setPrefs({ scorecardOrder: v })} />
    </div>
  );
  const tables: PagerSection = {
    id: 'tables', label: 'Scorecard', scroll: true,
    content: <div className="pager-inner">{tabs}<BattingCard m={m} idx={shownIdx} /><BowlingCard m={m} idx={shownIdx} /></div>,
  };
  const graphs: PagerSection = {
    id: 'graphs', label: 'Graphs', scroll: true,
    content: <div className="pager-inner">{tabs}<MatchCharts m={m} idx={shownIdx} /></div>,
  };

  return (
    <GameplayPager
      sections={[{ id: 'play', label: 'Match', content: stageSection }, ...(tablesFirst ? [tables, graphs] : [graphs, tables])]}
      fab={!m.result && <button className="btn btn-primary btn-roll pager-roll" onClick={roll} disabled={busy || pickNeeded} title="Space">{rollLabel}</button>}
    />
  );
}

function BowlerPicker({ m, onPick }: { m: MatchState; onPick: (id: string) => void }) {
  const opts = bowlerOptions(m);
  const rows = bowlingCard(m, m.innings.length - 1);
  return (
    <div className="picker">
      <div className="picker-head">
        <b>Who bowls the next over?</b>
        <button className="btn btn-sm" onClick={() => onPick(pickAutoBowler(m))}>Auto-pick</button>
      </div>
      <div className="picker-list">
        {opts.map((o) => {
          const r = rows.find((x) => x.playerId === o.player.id);
          return (
            <button
              key={o.player.id}
              className={`picker-item ${o.player.bowler ? 'is-bowler' : ''}`}
              disabled={!o.eligible}
              onClick={() => onPick(o.player.id)}
              title={o.reason}
            >
              <span>{o.player.name}{o.player.bowler ? ' 🎯' : ''}</span>
              <span className="muted small">
                {r ? `${formatOvers(r.balls)}-${r.maidens}-${r.runs}-${r.wickets}` : '—'}
                {o.reason ? ` · ${o.reason}` : ''}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
