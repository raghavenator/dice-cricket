import { useCallback, useEffect, useRef, useState } from 'react';
import { MatchCharts } from '../components/Charts';
import { Commentary } from '../components/Commentary';
import { Die } from '../components/Die';
import { ScorecardOrderToggle } from '../components/ScorecardOrder';
import { BallChip, BattingCard, BowlingCard, InningsTabs } from '../components/Scorecard';
import { BALLS_PER_OVER, bowlerOptions, currentInnings, getTeam, oversLimit } from '../engine/match';
import { battingCard, bowlingCard, formatOvers, ratio } from '../engine/stats';
import type { Ball, MatchState } from '../engine/types';
import { Presence } from './OnlineRoom';
import { AutoToggles } from './AutoToggles';
import type { Auto, MatchEvent } from './events';
import { goHome } from './nav';
import type { RoomView } from './protocol';
import { PICK_MS, ROLL_MS, suggestBowler } from './room';
import { nextBatterOptions } from './rules';
import { Countdown, secondsLeft, useServerNow } from './time';
import { useOnline } from './useOnlineStore';
import { useHoverCards } from './useRecords';
import { useScorecardOrder } from './scorecardOrder';

// Must fit inside BALL_GAP_MS and CHECK_GAP_MS in room.ts, or one player's dice would run behind.
const SPIN_MS = 800;
const SETTLE_MS = 350;

type FlashKind = 'four' | 'six' | 'wicket';
const FLASH_TITLE: Record<FlashKind, string> = { four: 'FOUR!', six: 'SIX!', wicket: 'WICKET!' };

const nameOf = (m: MatchState, playerId: string) =>
  m.teams.flatMap((t) => t.players).find((p) => p.id === playerId)?.name ?? '?';

function describe(m: MatchState, b: Ball): string {
  const pre = `${nameOf(m, b.bowlerId)} to ${nameOf(m, b.batterId)}: `;
  if (b.roll1 !== 5) {
    const words: Record<number, string> = { 1: '1 run', 2: '2 runs', 3: '3 runs', 4: 'FOUR!', 6: 'SIX!' };
    return pre + words[b.runs];
  }
  if (!b.wicket) return `${pre}wicket check… ${b.roll2} — survives! Dot ball.`;
  const how = b.how === 'caught' ? `caught by ${nameOf(m, b.fielderId!)}` : b.how === 'lbw' ? 'LBW' : 'BOWLED';
  return `${pre}wicket check… ${b.roll2} — OUT! ${how}`;
}

const autoNote = (a?: Auto) => (a === 'timeout' ? ' (time ran out)' : '');

function commentaryFor(before: MatchState, after: MatchState, e: MatchEvent): string[] {
  if (e.type === 'bowler') return [`${nameOf(after, e.playerId)} to bowl${autoNote(e.auto)}`];
  if (e.type === 'batter') return [`${nameOf(after, e.playerId)} comes in${autoNote(e.auto)}`];
  if (e.type === 'forfeit') return [`🏆 ${after.result?.text}`];
  const i = before.innings.length - 1;
  const inn = after.innings[i];
  const lines = [describe(after, inn.balls[inn.balls.length - 1])];
  if (inn.done) {
    lines.push(`End of innings — ${getTeam(after, inn.battingTeamId).name} ${inn.runs}/${inn.wickets} (${formatOvers(inn.legalBalls)} ov)`);
    const next = after.innings[i + 1];
    if (next?.target != null) lines.push(`${getTeam(after, next.battingTeamId).name} need ${next.target} to win`);
  }
  if (after.result) lines.push(`🏆 ${after.result.text}`);
  return lines;
}

export function OnlineMatch() {
  const view = useOnline((s) => s.view)!;
  const m = useOnline((s) => s.match)!;
  const queue = useOnline((s) => s.queue);
  const clock = useOnline((s) => s.clock)!;
  const shownSeq = useOnline((s) => s.shownSeq);
  const status = useOnline((s) => s.status);
  const toast = useOnline((s) => s.toast);
  const send = useOnline((s) => s.send);
  const saved = useOnline((s) => s.saved);
  const advance = useOnline((s) => s.advance);
  const now = useServerNow();

  const [d1, setD1] = useState<{ v: number | null; id: number }>({ v: null, id: 0 });
  const [d2, setD2] = useState<{ v: number | null; id: number }>({ v: null, id: 0 });
  const [showCheck, setShowCheck] = useState(false);
  const [spinMs, setSpinMs] = useState(SPIN_MS);
  const [commentary, setCommentary] = useState<string[]>([]);
  const [flash, setFlash] = useState<{ id: number; kind: FlashKind; sub: string } | null>(null);
  const [viewIdx, setViewIdx] = useState<number | null>(null);
  const [order, setOrder] = useScorecardOrder();

  // ---------- Playing out what the server sent ----------

  const head = queue[0];
  useEffect(() => {
    if (!head) return;
    const apply = () => {
      const before = useOnline.getState().match;
      advance();
      const after = useOnline.getState().match;
      if (head.kind !== 'event' || !before || !after || before === after) return;
      const newestFirst = commentaryFor(before, after, head.event).reverse();
      setCommentary((c) => [...newestFirst, ...c].slice(0, 30));
      if (head.event.type !== 'ball') return;
      const i = before.innings.length - 1;
      const ball = after.innings[i].balls[after.innings[i].balls.length - 1];
      if (!ball.wicket && ball.runs !== 4 && ball.runs !== 6) return;
      const row = battingCard(after, i).find((r) => r.playerId === ball.batterId);
      const sub = !row ? ''
        : ball.wicket ? `${row.name} ${row.dismissal} · ${row.runs} (${row.balls})`
        : `${row.name} · ${row.runs}* (${row.balls})`;
      setFlash((f) => ({ id: (f?.id ?? 0) + 1, kind: ball.wicket ? 'wicket' : ball.runs === 6 ? 'six' : 'four', sub }));
    };
    if (head.kind !== 'event' || head.event.type !== 'ball') {
      apply();
      return;
    }
    const { roll1, roll2 } = head.event.rolls;
    // Nobody is watching, or we have fallen behind: catch up without the animation.
    const behind = useOnline.getState().queue.filter((q) => q.kind === 'event' && q.event.type === 'ball').length > 2;
    const fast = document.hidden || behind;
    const spin = fast ? 0 : SPIN_MS;
    const settle = fast ? 0 : SETTLE_MS;
    const timers: number[] = [];
    const later = (fn: () => void, ms: number) => timers.push(window.setTimeout(fn, ms));
    setSpinMs(spin);
    setShowCheck(false);
    setD1((d) => ({ v: roll1, id: d.id + 1 }));
    if (roll2 === undefined) later(apply, spin + settle);
    else
      later(() => {
        setShowCheck(true);
        setD2((d) => ({ v: roll2, id: d.id + 1 }));
        later(apply, spin + settle * 2);
      }, spin + settle);
    return () => timers.forEach(clearTimeout);
  }, [head, advance]);

  // ---------- What I can do now ----------

  const busy = queue.length > 0;
  const me = view.you === 'host' ? view.host : view.guest!;
  const opponent = view.you === 'host' ? view.guest! : view.host;
  const live = view.phase === 'playing' && !m.result;
  const turn = live && !busy ? clock.turn : null;
  const mine = turn?.seat === view.you;
  // Picks are quick, so the list takes the place of the roll buttons.
  const picking =
    mine && !clock.paused && ((turn?.kind === 'bowler' && !me.auto.bowler) || (turn?.kind === 'batter' && !me.auto.batter));
  useHoverCards(me.ownerId, saved);
  // Block a second click until the server has answered the first.
  const [asked, setAsked] = useState<{ seq: number; at: number; toast?: number } | null>(null);
  const waiting = asked !== null && asked.seq === shownSeq && asked.toast === toast?.id && Date.now() - asked.at < 3000;
  const ask: typeof send = useCallback(
    (msg) => {
      setAsked({ seq: shownSeq, at: Date.now(), toast: toast?.id });
      send(msg);
    },
    [send, shownSeq, toast?.id],
  );
  const canRoll = mine && turn?.kind === 'roll' && !me.auto.roll && !clock.paused && status === 'open' && !waiting && now >= clock.nextBallAt;
  const rollRef = useRef(() => {});
  rollRef.current = () => {
    if (canRoll) ask({ t: 'roll' });
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (e.code !== 'Space' || ['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON', 'A'].includes(tag)) return;
      e.preventDefault();
      rollRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // ---------- Scoreboard ----------

  const inn = currentInnings(m);
  const curIdx = m.innings.length - 1;
  const shownIdx = viewIdx ?? curIdx;
  const batTeam = getTeam(m, inn.battingTeamId);
  const bowlTeam = getTeam(m, inn.bowlingTeamId);
  const limit = oversLimit(m.settings)!;
  const batting = batTeam.id.startsWith(`${me.ownerId}/`);
  const thisOverNo = Math.floor(Math.max(0, inn.legalBalls - 1) / BALLS_PER_OVER);
  const thisOver = inn.balls.filter((b) => b.over === thisOverNo);
  const bowlRow = inn.bowlerId ? bowlingCard(m, curIdx).find((r) => r.playerId === inn.bowlerId) : undefined;
  let chase: { main: string; rrr: string } | null = null;
  if (inn.target !== null && !inn.done && !m.result) {
    const need = inn.target - inn.runs;
    const left = limit * BALLS_PER_OVER - inn.legalBalls;
    const leftTxt = left > 30 ? `${formatOvers(left)} overs` : `${left} ball${left === 1 ? '' : 's'}`;
    chase = { main: `${need} run${need === 1 ? '' : 's'} needed off ${leftTxt}`, rrr: `Req. RR ${ratio(need * 6, left)}` };
  }

  const leave = () => {
    if (live && !confirm('Leave the match? Your opponent wins by forfeit.')) return;
    void useOnline.getState().leave().then(goHome);
  };

  return (
    <div className="screen match">
      {flash && (
        <div key={flash.id} className={`flash flash-${flash.kind}`} aria-live="assertive">
          <div className="flash-title">{FLASH_TITLE[flash.kind]}</div>
          {flash.sub && <div className="flash-sub">{flash.sub}</div>}
        </div>
      )}
      <section className="scoreboard" style={{ ['--team' as string]: batTeam.color }}>
        {flash && <span key={flash.id} className={`sb-glow sb-glow-${flash.kind}`} aria-hidden />}
        <div className="sb-main">
          <div className="sb-team">
            <span className="sb-swatch" />
            <span className="sb-name">{batTeam.name}</span>
            <span className="sb-vs muted">v {bowlTeam.short} · {batting ? 'you are batting' : 'you are bowling'}</span>
          </div>
          <div className="sb-score">
            {inn.runs}/{inn.wickets}
            <span className="sb-overs">{formatOvers(inn.legalBalls)}/{limit} ov</span>
          </div>
          <div className="sb-sub">
            <span>RR {ratio(inn.runs * 6, inn.legalBalls)}</span>
            {chase && <span>{chase.rrr}</span>}
            {curIdx === 0 && !inn.balls.length && <span className="sb-situation">{m.tossText}</span>}
          </div>
          {chase && <div className="sb-chase" aria-live="polite">{chase.main}</div>}
        </div>
        <div className="sb-side">
          <div className="muted small">{limit}-over match · Innings {curIdx + 1}</div>
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

      <div className="on-players small">
        <span><Presence seat={me} /> {me.nickname} (you)</span>
        <span><Presence seat={opponent} /> {opponent.nickname}{opponent.auto.roll ? ' · auto roll on' : ''}</span>
      </div>

      {m.result && !busy && <ResultBanner view={view} m={m} />}

      <div className="match-grid">
        <section className="dice-panel card">
          <div className="dice-row">
            <div className="die-slot">
              <Die value={d1.v} rollId={d1.id} duration={spinMs} size={104} />
              <span className="small muted">Delivery</span>
            </div>
            <div className={`die-slot ${showCheck ? '' : 'die-slot-off'}`}>
              <Die value={d2.v} rollId={d2.id} duration={spinMs} size={72} tone="check" dim={!showCheck} />
              <span className="small muted">Wicket check</span>
            </div>
          </div>
          <div className="dice-legend small muted">
            1·2·3·4·6 = runs &nbsp;|&nbsp; 5 = wicket check (4+ out, 3 or less dot)
          </div>

          {live && (
            <>
              <TurnBanner view={view} busy={busy} />
              {clock.paused && clock.claimAt !== null && (
                <button className="btn" disabled={now < clock.claimAt} onClick={() => ask({ t: 'claimWin' })}>
                  {now < clock.claimAt ? `Claim the win in ${secondsLeft(clock.claimAt, now)}s` : 'Claim the win'}
                </button>
              )}
              {batting && !picking && (
                <button className="btn btn-primary btn-roll" disabled={!canRoll} onClick={() => rollRef.current()} title="Space">
                  {me.auto.roll ? 'Auto roll is on' : busy ? 'Rolling…' : '🎲 Roll'}
                </button>
              )}
              {picking && turn?.kind === 'bowler' && (
                <BowlerPicker m={m} suggested={suggestBowler(m, me.ownerId, view.lineup)} disabled={waiting} onPick={(playerId) => ask({ t: 'chooseBowler', playerId })} />
              )}
              {picking && turn?.kind === 'batter' && (
                <BatterPicker m={m} disabled={waiting} onPick={(playerId) => ask({ t: 'chooseBatter', playerId })} />
              )}
              <AutoToggles auto={me.auto} show={['roll', 'batter', 'bowler']} />
            </>
          )}

          <Commentary lines={commentary} empty={<p className="muted small">{m.tossText}.</p>} />
        </section>

        <section className="sc-panel">
          <InningsTabs m={m} value={shownIdx} onChange={(i) => setViewIdx(i === curIdx ? null : i)} />
          <ScorecardOrderToggle value={order} onChange={setOrder} />
          {order === 'charts-first' && <MatchCharts m={m} idx={shownIdx} />}
          <BattingCard m={m} idx={shownIdx} />
          <BowlingCard m={m} idx={shownIdx} />
          {order === 'tables-first' && <MatchCharts m={m} idx={shownIdx} />}
        </section>
      </div>

      <div className="footer-row">
        <button className="btn btn-ghost" onClick={leave}>{live ? 'Leave (forfeit)' : '← Online home'}</button>
        {batting && live && !me.auto.roll && <span className="muted small">Space = roll</span>}
      </div>
    </div>
  );
}

function TurnBanner({ view, busy }: { view: RoomView; busy: boolean }) {
  const clock = useOnline((s) => s.clock)!;
  const status = useOnline((s) => s.status);
  const opponent = view.you === 'host' ? view.guest! : view.host;
  if (status !== 'open') return <div className="on-turn">Reconnecting…</div>;
  if (clock.paused) return <div className="on-turn">Paused. Waiting for {opponent.nickname} to reconnect…</div>;
  if (busy || !clock.turn) return <div className="on-turn">&nbsp;</div>;
  const mine = clock.turn.seat === view.you;
  const { kind } = clock.turn;
  const { auto } = mine ? (view.you === 'host' ? view.host : view.guest!) : opponent;
  // Left to the game, so it is about to happen: nothing to say and nothing to count.
  if ((kind === 'roll' || kind === 'batter' || kind === 'bowler') && auto[kind]) return <div className="on-turn">&nbsp;</div>;
  const doing: Record<string, [string, string]> = {
    bowler: ['Pick your bowler', 'Other player is picking a bowler'],
    batter: ['Pick your next batter', 'Other player is picking the next batter'],
    roll: ['Your roll', `${opponent.nickname} to roll`],
  };
  const [me, them] = doing[kind] ?? ['', ''];
  const picking = kind !== 'roll';
  return (
    <div className={`on-turn ${mine ? 'on-mine' : ''} ${picking ? 'on-picking' : ''}`}>
      <span aria-live="polite">{mine ? me : them}</span>
      <Countdown to={clock.deadline} max={(picking ? PICK_MS : ROLL_MS) / 1000} />
    </div>
  );
}

function ResultBanner({ view, m }: { view: RoomView; m: MatchState }) {
  const send = useOnline((s) => s.send);
  const fatal = useOnline((s) => s.fatal);
  const saved = useOnline((s) => s.saved);
  const me = view.you === 'host' ? view.host : view.guest!;
  const opponent = view.you === 'host' ? view.guest! : view.host;
  const won = m.result?.winnerId?.startsWith(`${me.ownerId}/`);
  const note =
    fatal || opponent.left ? `${opponent.nickname} has left.`
    : !opponent.connected ? `${opponent.nickname} is not connected.`
    : opponent.wantsRematch && !me.wantsRematch ? `${opponent.nickname} wants a rematch!`
    : me.wantsRematch ? `Waiting for ${opponent.nickname}…`
    : '';
  return (
    <section className="result-banner">
      <div>
        <div className="result-title">
          {m.result?.kind === 'tie' ? '🤝' : won ? '🏆' : '🏏'} {m.result?.text}
        </div>
        <div className="muted small">
          {m.result?.kind === 'tie' ? 'It was a tie.' : won ? 'You won!' : 'You lost.'} {note}{' '}
          {saved === 'yes' ? 'Saved to your online matches.' : saved === 'failed' ? 'Could not be saved in this browser.' : 'Saving…'}
        </div>
      </div>
      <button
        className="btn btn-primary"
        disabled={me.wantsRematch || opponent.left || !opponent.connected || fatal !== null}
        onClick={() => send({ t: 'rematch' })}
      >
        Rematch
      </button>
    </section>
  );
}

function BowlerPicker({ m, suggested, disabled, onPick }: {
  m: MatchState; suggested: string; disabled: boolean; onPick: (id: string) => void;
}) {
  const rows = bowlingCard(m, m.innings.length - 1);
  // Suggested first, then marked bowlers.
  const rank = (id: string, marked: boolean) => (id === suggested ? 0 : marked ? 1 : 2);
  const opts = [...bowlerOptions(m)].sort((a, b) => rank(a.player.id, a.player.bowler) - rank(b.player.id, b.player.bowler));
  return (
    <div className="picker">
      <div className="picker-head"><b>Who bowls this over?</b></div>
      <div className="picker-list">
        {opts.map((o) => {
          const r = rows.find((x) => x.playerId === o.player.id);
          const first = o.player.id === suggested;
          return (
            <button
              key={o.player.id}
              className={`picker-item ${first ? 'on-suggested' : ''}`}
              disabled={disabled || !o.eligible}
              onClick={() => onPick(o.player.id)}
              title={o.reason}
            >
              <span>{o.player.name}{o.player.bowler ? ' 🎯' : ''}{first ? ' · next' : ''}</span>
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

function BatterPicker({ m, disabled, onPick }: { m: MatchState; disabled: boolean; onPick: (id: string) => void }) {
  return (
    <div className="picker">
      <div className="picker-head"><b>Who bats next?</b></div>
      <div className="picker-list">
        {nextBatterOptions(m).map((p, i) => (
          <button key={p.id} className={`picker-item ${i === 0 ? 'on-suggested' : ''}`} disabled={disabled} onClick={() => onPick(p.id)}>
            <span>{p.name}{p.bowler ? ' 🎯' : ''}{i === 0 ? ' · next' : ''}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
