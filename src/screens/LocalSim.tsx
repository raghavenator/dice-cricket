import { useGame } from '../store/useGameStore';

export function LocalSim() {
  const go = useGame((s) => s.go);
  const active = useGame((s) => s.tournaments.filter((t) => t.status === 'active').length);
  const activeSeries = useGame((s) => s.series.filter((x) => x.status === 'active').length);

  return (
    <div className="screen">
      <h2>Local Sim</h2>
      <p className="muted">Play on this device.</p>
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
      </div>
      <div className="nav-row">
        <button className="btn btn-ghost" onClick={() => go({ name: 'home' })}>← Home</button>
      </div>
    </div>
  );
}
