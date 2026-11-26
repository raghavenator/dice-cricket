import type { KeyboardEvent } from 'react';
import { getTeam, currentInnings } from '../engine/match';
import { formatOvers } from '../engine/stats';
import { useGame } from '../store/useGameStore';

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
        <header className="title-head">
          <div className="title-dice" aria-hidden>🎲</div>
          <h1 className="title-logo">Dice Cricket</h1>
          <p className="title-tagline">Eleven players a side, one die. 1–4 and 6 score runs, and a 5 means a wicket check.</p>
        </header>

        <nav className="title-menu" aria-label="Main menu" onKeyDown={moveFocus}>
          {import.meta.env.VITE_ONLINE_URL && (
            <button className="title-item" onClick={() => window.location.assign('./online.html')}>
              Online 1v1
            </button>
          )}
          {resumable && (
            <button className="title-item" onClick={() => go({ name: 'match' })}>
              Resume Match
              <span className="title-extra">
                {getTeam(resumable, currentInnings(resumable).battingTeamId).short} {currentInnings(resumable).runs}/
                {currentInnings(resumable).wickets} ({formatOvers(currentInnings(resumable).legalBalls)})
              </span>
            </button>
          )}
          <button className="title-item" onClick={() => go({ name: 'localSim' })}>
            Local Sim
            {inProgress > 0 && <span className="title-extra">{inProgress} in progress</span>}
          </button>
          <button className="title-item" onClick={() => go({ name: 'teams' })}>Teams</button>
          <button className="title-item" onClick={() => go({ name: 'stats' })}>Stats &amp; History</button>
          <button className="title-item" onClick={() => go({ name: 'backup' })}>Backup &amp; Restore</button>
        </nav>
      </div>
    </div>
  );
}
