import { useEffect, useState } from 'react';
import type { LobbyRoom } from './protocol';
import { openRooms } from './useOnlineStore';

const REFRESH_MS = 10_000;

/** Rooms anyone can join. Refreshes itself while the page is being looked at. */
export function OpenRooms({ disabled, onJoin }: { disabled: boolean; onJoin: (code: string) => void }) {
  const [rooms, setRooms] = useState<LobbyRoom[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let here = true;
    const load = () => {
      if (document.hidden) return;
      openRooms()
        .then((r) => {
          if (!here) return;
          setRooms(r);
          setError(null);
        })
        .catch((e: Error) => here && setError(e.message));
    };
    load();
    const t = window.setInterval(load, REFRESH_MS);
    document.addEventListener('visibilitychange', load);
    return () => {
      here = false;
      window.clearInterval(t);
      document.removeEventListener('visibilitychange', load);
    };
  }, []);

  if (error) return <p className="on-error">{error}</p>;
  if (!rooms) return <p className="muted small">Loading…</p>;
  if (!rooms.length) return <p className="muted small">No open rooms right now. Make one, or try Quick match.</p>;
  return (
    <div className="list">
      {rooms.map((r) => (
        <div key={r.code} className="list-item on-open-room">
          <span className="on-player"><b>{r.nickname}</b></span>
          <span className="muted small">{r.overs} over{r.overs === 1 ? '' : 's'}</span>
          <button className="btn btn-sm" disabled={disabled} onClick={() => onJoin(r.code)}>Join</button>
        </div>
      ))}
    </div>
  );
}
