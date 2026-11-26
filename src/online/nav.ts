// The address after "#" says which online screen is showing, so links and the browser's Back button work.

let moves = 0;

function go(hash: string) {
  if (window.location.hash === hash) return;
  moves++;
  window.location.hash = hash;
}

export const goHome = () => go('');
export const goQuick = () => go('#/quick');
export const goPrivate = () => go('#/private');
export const goOpen = () => go('#/open');
export const goRoom = (code: string) => go(`#/join/${code}`);
export const goStats = () => go('#/stats');
export const goPlayer = (playerId: string) => go(`#/stats/player/${encodeURIComponent(playerId)}`);
export const goMatch = (matchId: string) => go(`#/stats/match/${encodeURIComponent(matchId)}`);

/** Back to the screen before, or to the stats if this screen was opened directly. */
export function goBack() {
  if (moves > 0) window.history.back();
  else goStats();
}

/** The link to send a friend. Leaves out anything after "?", which is only for testing. */
export const inviteLink = (code: string) => `${window.location.origin}${window.location.pathname}#/join/${code}`;

export type Route =
  | { name: 'home' }
  | { name: 'quick' }
  | { name: 'private' }
  | { name: 'open' }
  | { name: 'join'; code: string }
  | { name: 'stats' }
  | { name: 'player'; id: string }
  | { name: 'match'; id: string };

export function parseRoute(hash: string): Route {
  const [, page, a, b] = hash.split('/');
  const decode = (s: string) => {
    try {
      return decodeURIComponent(s);
    } catch {
      return s;
    }
  };
  if (page === 'quick') return { name: 'quick' };
  if (page === 'private') return { name: 'private' };
  if (page === 'open') return { name: 'open' };
  if (page === 'join' && a) return { name: 'join', code: decode(a) };
  if (page === 'stats' && a === 'player' && b) return { name: 'player', id: decode(b) };
  if (page === 'stats' && a === 'match' && b) return { name: 'match', id: decode(b) };
  return page === 'stats' ? { name: 'stats' } : { name: 'home' };
}
