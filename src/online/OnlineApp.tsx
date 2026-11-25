import { useEffect, useState } from 'react';
import { OnlineHome, NameForm } from './OnlineHome';
import { OnlineRoom } from './OnlineRoom';
import { getGuest, nicknameProblem } from './guest';
import { normalizeCode } from './protocol';

const readHash = () => window.location.hash;

export const goHome = () => {
  window.location.hash = '';
};
export const goRoom = (code: string) => {
  window.location.hash = `#/join/${code}`;
};
/** The link to send a friend. Leaves out anything after "?", which is only for testing. */
export const inviteLink = (code: string) => `${window.location.origin}${window.location.pathname}#/join/${code}`;

export function OnlineApp() {
  const [hash, setHash] = useState(readHash);
  const [named, setNamed] = useState(() => nicknameProblem(getGuest().nickname) === null);

  useEffect(() => {
    const onChange = () => {
      setHash(readHash());
      window.scrollTo?.(0, 0);
    };
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);

  const join = /^#\/join\/(.+)$/.exec(hash);
  const code = join ? normalizeCode(join[1]) : null;

  let body: React.ReactNode;
  if (!join) body = <OnlineHome onNamed={() => setNamed(true)} />;
  else if (!code)
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
