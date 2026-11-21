import { useEffect, useState } from 'react';
import { useGame } from './store/useGameStore';
import { Home } from './screens/Home';
import { ExhibitionSettings, ExhibitionTeams } from './screens/Exhibition';
import { MatchScreen } from './screens/MatchScreen';
import { TournamentHub, TournamentList, TournamentNew } from './screens/Tournaments';
import { TeamsScreen } from './screens/Teams';
import { MatchView, StatsScreen } from './screens/Stats';

export function App() {
  const ready = useGame((s) => s.ready);
  const screen = useGame((s) => s.screen);
  const init = useGame((s) => s.init);
  const go = useGame((s) => s.go);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    init().catch((e) => setError(String(e?.message ?? e)));
  }, [init]);

  let body: React.ReactNode;
  if (error) body = <div className="screen"><p>Could not open the game's storage: {error}</p></div>;
  else if (!ready) body = <div className="screen"><p className="muted">Loading…</p></div>;
  else {
    switch (screen.name) {
      case 'home': body = <Home />; break;
      case 'exTeams': body = <ExhibitionTeams />; break;
      case 'exSettings': body = <ExhibitionSettings />; break;
      case 'match': body = <MatchScreen />; break;
      case 'tournaments': body = <TournamentList />; break;
      case 'tourNew': body = <TournamentNew />; break;
      case 'tourHub': body = <TournamentHub key={screen.id} id={screen.id} />; break;
      case 'teams': body = <TeamsScreen />; break;
      case 'stats': body = <StatsScreen key={screen.tournamentId ?? 'all'} tournamentId={screen.tournamentId} />; break;
      case 'matchView': body = <MatchView key={screen.matchId} matchId={screen.matchId} back={screen.back} />; break;
    }
  }

  return (
    <div className="app">
      <header className="topbar">
        <button className="brand" onClick={() => go({ name: 'home' })}>
          <span aria-hidden>🎲</span> Dice Cricket
        </button>
        {ready && screen.name !== 'home' && (
          <nav className="topnav">
            <button onClick={() => go({ name: 'tournaments' })}>Tournaments</button>
            <button onClick={() => go({ name: 'teams' })}>Teams</button>
            <button onClick={() => go({ name: 'stats' })}>Stats</button>
          </nav>
        )}
      </header>
      <main>{body}</main>
    </div>
  );
}
