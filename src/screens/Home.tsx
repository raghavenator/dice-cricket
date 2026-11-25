import { getTeam, currentInnings } from '../engine/match';
import { formatOvers } from '../engine/stats';
import { useGame } from '../store/useGameStore';

export function Home() {
  const go = useGame((s) => s.go);
  const live = useGame((s) => s.live);
  const tournaments = useGame((s) => s.tournaments);
  const active = tournaments.filter((t) => t.status === 'active').length;
  const activeSeries = useGame((s) => s.series.filter((x) => x.status === 'active').length);
  const resumable = live && !live.match.result ? live.match : null;

  return (
    <div className="screen home">
      <div className="hero">
        <div className="hero-dice" aria-hidden>🎲</div>
        <h1>Dice Cricket</h1>
        <p className="muted">Eleven players a side, one die. 1–4 and 6 score runs, and a 5 means a wicket check.</p>
      </div>

      {resumable && (
        <button className="resume" onClick={() => go({ name: 'match' })}>
          <span className="resume-tag">Resume match</span>
          <span>
            {resumable.teams[0].name} v {resumable.teams[1].name}
          </span>
          <span className="muted small">
            {getTeam(resumable, currentInnings(resumable).battingTeamId).short} {currentInnings(resumable).runs}/
            {currentInnings(resumable).wickets} ({formatOvers(currentInnings(resumable).legalBalls)} ov)
          </span>
        </button>
      )}

      <div className="mode-grid">
        <button className="mode" onClick={() => go({ name: 'exTeams' })}>
          <span className="mode-icon">🏏</span>
          <span className="mode-title">Exhibition Match</span>
          <span className="mode-desc">Pick two teams and play a single match.</span>
        </button>
        <button className="mode" onClick={() => go({ name: 'tournaments' })}>
          <span className="mode-icon">🏆</span>
          <span className="mode-title">Tournament</span>
          <span className="mode-desc">
            League, league + playoffs, or knockout with saved stats.
            {active > 0 && <b> {active} in progress.</b>}
          </span>
        </button>
        <button className="mode" onClick={() => go({ name: 'seriesList' })}>
          <span className="mode-icon">🤝</span>
          <span className="mode-title">Bilateral Series</span>
          <span className="mode-desc">
            Two teams, a multi-match series across one or more formats.
            {activeSeries > 0 && <b> {activeSeries} in progress.</b>}
          </span>
        </button>
        {import.meta.env.VITE_ONLINE_URL && (
          <button className="mode" onClick={() => window.location.assign('./online.html')}>
            <span className="mode-icon">🌐</span>
            <span className="mode-title">Online 1v1</span>
            <span className="mode-desc">Play a friend on another computer.</span>
          </button>
        )}
        <button className="mode" onClick={() => go({ name: 'teams' })}>
          <span className="mode-icon">👥</span>
          <span className="mode-title">Teams</span>
          <span className="mode-desc">Edit squads, batting orders and bowlers.</span>
        </button>
        <button className="mode" onClick={() => go({ name: 'stats' })}>
          <span className="mode-icon">📊</span>
          <span className="mode-title">Stats & History</span>
          <span className="mode-desc">Batting and bowling leaderboards and past scorecards.</span>
        </button>
        <button className="mode" onClick={() => go({ name: 'backup' })}>
          <span className="mode-icon">💾</span>
          <span className="mode-title">Backup & Restore</span>
          <span className="mode-desc">Export your teams, matches and stats to a file, or import a backup.</span>
        </button>
      </div>
    </div>
  );
}
