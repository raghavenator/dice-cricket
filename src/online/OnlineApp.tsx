import { useEffect, useState } from 'react';
import { NameForm, OnlineHome, OpenRoomsPage, PrivateMatch } from './OnlineHome';
import { OnlineMatchView } from './OnlineMatchView';
import { OnlinePlayer } from './OnlinePlayer';
import { OnlineRoom } from './OnlineRoom';
import { OnlineStats } from './OnlineStats';
import { QuickPick } from './QuickPick';
import { getGuest, nicknameProblem } from './guest';
import { goHome, parseRoute } from './nav';
import { normalizeCode } from './protocol';

export function OnlineApp() {
  const [hash, setHash] = useState(() => window.location.hash);
  const [named, setNamed] = useState(() => nicknameProblem(getGuest().nickname) === null);

  useEffect(() => {
    const onChange = () => {
      setHash(window.location.hash);
      window.scrollTo?.(0, 0);
    };
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);

  const route = parseRoute(hash);
  let body: React.ReactNode;
  switch (route.name) {
    case 'home': body = <OnlineHome onNamed={() => setNamed(true)} />; break;
    case 'quick': body = <QuickPick onNamed={() => setNamed(true)} />; break;
    case 'private': body = <PrivateMatch onNamed={() => setNamed(true)} />; break;
    case 'open': body = <OpenRoomsPage onNamed={() => setNamed(true)} />; break;
    case 'stats': body = <OnlineStats />; break;
    case 'player': body = <OnlinePlayer key={route.id} playerId={route.id} />; break;
    case 'match': body = <OnlineMatchView key={route.id} matchId={route.id} />; break;
    case 'join': {
      const code = normalizeCode(route.code);
      if (!code)
        body = (
          <div className="screen">
            <h2>Room not found</h2>
            <p className="muted">That link does not contain a room code. Ask your friend to send it again.</p>
            <button className="btn" onClick={goHome}>Online home</button>
          </div>
        );
      else if (!named)
        body = (
          <div className="screen on-narrow">
            <h2>Join room {code}</h2>
            <NameForm action="Join" onDone={() => setNamed(true)} />
          </div>
        );
      else body = <OnlineRoom key={code} code={code} />;
    }
  }

  return (
    <div className="app">
      <header className="topbar">
        <a className="brand on-link" href="./index.html">
          <span aria-hidden>🎲</span> Dice Cricket
        </a>
        <span className="on-badge">Online 1v1</span>
      </header>
      <main>{body}</main>
    </div>
  );
}
