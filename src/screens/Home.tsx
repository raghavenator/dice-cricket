import { useEffect, useState, type KeyboardEvent } from 'react';
import { Die } from '../components/Die';
import { getTeam, currentInnings } from '../engine/match';
import { formatOvers } from '../engine/stats';
import { useGame } from '../store/useGameStore';
import silhouette from '../assets/batter-silhouette.png';

/** Up and Down move between menu items, like a console title screen. */
function moveFocus(e: KeyboardEvent<HTMLElement>) {
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
  const items = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('button'));
  if (items.length === 0) return;
  e.preventDefault();
  const at = items.indexOf(document.activeElement as HTMLButtonElement);
  const step = e.key === 'ArrowDown' ? 1 : -1;
  const next = at < 0 ? (step > 0 ? 0 : items.length - 1) : (at + step + items.length) % items.length;
  items[next].focus();
}

/** Each menu item's place in the slide-in, one after another. */
const order = (i: number) => ({ ['--i' as string]: i });

const TITLE_ROLL_EVERY_MS = 5000;
const TITLE_ROLL_MS = 1000;
/** Rests at an angle like the dice emoji: its top and right side show beside the number facing you. */
const TITLE_TILT: [number, number] = [-24, -32];

/** The title's die: every few seconds it hops and rolls to a different number. Still for anyone who prefers less motion. */
function TitleDie() {
  const [roll, setRoll] = useState({ value: 6, id: 0 });

  useEffect(() => {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const next = () =>
      setRoll((r) => {
        // Never the same number twice in a row, so every roll visibly changes.
        const value = 1 + ((r.value + Math.floor(Math.random() * 5)) % 6);
        return { value, id: r.id + 1 };
      });
    const first = window.setTimeout(next, 1200);
    const every = window.setInterval(next, TITLE_ROLL_EVERY_MS);
    return () => {
      clearTimeout(first);
      clearInterval(every);
    };
  }, []);

  return (
    // Two identical hops taken in turn: changing the animation's name restarts it, while the die keeps its last face.
    <div className={`title-dice ${roll.id ? `title-dice-hop-${roll.id % 2}` : ''}`} aria-hidden>
      <Die value={roll.value} rollId={roll.id} duration={TITLE_ROLL_MS} size={52} tilt={TITLE_TILT} />
    </div>
  );
}

export function Home() {
  const go = useGame((s) => s.go);
  const live = useGame((s) => s.live);
  const tournaments = useGame((s) => s.tournaments);
  const active = tournaments.filter((t) => t.status === 'active').length;
  const activeSeries = useGame((s) => s.series.filter((x) => x.status === 'active').length);
  const resumable = live && !live.match.result ? live.match : null;
  const inProgress = active + activeSeries;

  return (
    <div className="screen home">
      <div className="title-screen">
        <img className="title-silhouette" src={silhouette} alt="" aria-hidden draggable={false} />
        <header className="title-head">
          <TitleDie />
          <h1 className="title-logo">
            D<span className="title-logo-red">i</span>ce Cr<span className="title-logo-red">i</span>cket
          </h1>
          <p className="title-tagline">One die. 1–4 and 6 score runs, and a 5 means a wicket check.</p>
        </header>

        <nav className="title-menu home-menu" aria-label="Main menu" onKeyDown={moveFocus}>
          {import.meta.env.VITE_ONLINE_URL && (
            <button className="title-item title-featured" style={order(0)} onClick={() => window.location.assign('./online.html')}>
              <span className="title-shine" aria-hidden />
              Online 1v1
            </button>
          )}
          {resumable && (
            <button className="title-item" style={order(1)} onClick={() => go({ name: 'match' })}>
              Resume Match
              <span className="title-extra">
                {getTeam(resumable, currentInnings(resumable).battingTeamId).short} {currentInnings(resumable).runs}/
                {currentInnings(resumable).wickets} ({formatOvers(currentInnings(resumable).legalBalls)})
              </span>
            </button>
          )}
          <button className="title-item" style={order(2)} onClick={() => go({ name: 'localSim' })}>
            Local Sim
            {inProgress > 0 && <span className="title-extra">{inProgress} in progress</span>}
          </button>
          <button className="title-item" style={order(3)} onClick={() => go({ name: 'teams' })}>Teams</button>
          <button className="title-item" style={order(4)} onClick={() => go({ name: 'stats' })}>Stats &amp; History</button>
          <button className="title-item" style={order(5)} onClick={() => go({ name: 'backup' })}>Backup &amp; Restore</button>
        </nav>
      </div>
    </div>
  );
}
