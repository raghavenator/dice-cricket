import { useEffect, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react';
import { collectResults } from './collect';
import { getGuest, nicknameProblem, setNickname } from './guest';
import { goHome, goOpen, goPrivate, goRoom, goStats } from './nav';
import { CODE_LENGTH, normalizeCode } from './protocol';
import { OpenRooms } from './OpenRooms';
import { QuickMatchButton } from './QuickMatchButton';
import { createRoom, serverUrl } from './useOnlineStore';
import { MAX_NICKNAME } from './validate';

function NameField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <label className="field">
      <span>Your name</span>
      <input
        className="text"
        value={value}
        maxLength={MAX_NICKNAME}
        autoComplete="nickname"
        placeholder="What your opponent sees"
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

/** Asks for a name before joining from a link. */
export function NameForm({ action, onDone }: { action: string; onDone: () => void }) {
  const [name, setName] = useState(getGuest().nickname);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (nicknameProblem(name)) return;
    setNickname(name);
    onDone();
  };
  return (
    <form className="form" onSubmit={submit}>
      <NameField value={name} onChange={setName} />
      <button className="btn btn-primary" disabled={nicknameProblem(name) !== null}>{action}</button>
    </form>
  );
}

/** The name box at the top of a menu. */
function NameInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <input
      className="on-name-input"
      aria-label="Your name"
      value={value}
      maxLength={MAX_NICKNAME}
      autoComplete="nickname"
      placeholder="Choose a name"
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

/** Up and Down move between menu items, like the main home screen. */
function moveFocus(e: KeyboardEvent<HTMLElement>) {
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
  const items = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input, a[href]'));
  if (items.length === 0) return;
  e.preventDefault();
  const at = items.indexOf(document.activeElement as HTMLElement);
  const step = e.key === 'ArrowDown' ? 1 : -1;
  const next = at < 0 ? (step > 0 ? 0 : items.length - 1) : (at + step + items.length) % items.length;
  items[next].focus();
}

/** A title-screen page: a heading, an optional line under it, and a centred column of options. */
function MenuPage({ title, note, children }: { title: string; note?: ReactNode; children: ReactNode }) {
  return (
    <div className="screen on-title">
      <header className="title-head">
        <h1 className="title-logo on-title-logo">{title}</h1>
        {note && <p className="title-tagline">{note}</p>}
      </header>
      <nav className="title-menu" aria-label={title} onKeyDown={moveFocus}>
        {children}
      </nav>
    </div>
  );
}

/** The player's name, and the actions that need one. Shared by every online menu page. */
function useOnlineName(onNamed: () => void) {
  const [name, setName] = useState(getGuest().nickname);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nameBad = nicknameProblem(name) !== null;

  /** Remember the name, ready to play. */
  const named = () => {
    const nickname = setNickname(name);
    onNamed();
    return nickname;
  };

  const create = async (open: boolean) => {
    setBusy(true);
    setError(null);
    try {
      goRoom(await createRoom(named(), open));
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  const joinRoom = (code: string) => {
    if (nameBad) return;
    named();
    goRoom(code);
  };

  return { name, setName, nameBad, named, busy, error, create, joinRoom };
}

/** Shown at the top of a sub-page only when there is no usable saved name, such as after opening it from a link. */
function useAskName() {
  const [ask] = useState(() => nicknameProblem(getGuest().nickname) !== null);
  return ask;
}

function Footer({ nameBad, error }: { nameBad: boolean; error: string | null }) {
  return (
    <>
      {nameBad && <p className="on-hint">Choose a name to play.</p>}
      {error && <p className="on-error" role="alert">{error}</p>}
    </>
  );
}

export function OnlineHome({ onNamed }: { onNamed: () => void }) {
  const { name, setName, nameBad, named, error } = useOnlineName(onNamed);
  const [live, setLive] = useState<string[]>([]);

  // Pick up results from matches that ended without us, and offer the way back into any still going on.
  useEffect(() => {
    let here = true;
    const run = () => collectResults().then((l) => here && setLive(l)).catch(console.error);
    void run();
    const t = window.setInterval(run, 15_000);
    return () => {
      here = false;
      window.clearInterval(t);
    };
  }, []);

  if (!serverUrl()) {
    return (
      <MenuPage title="Online 1v1" note="Online play is not set up on this site yet.">
        <button className="title-item" onClick={goStats}>Online Stats</button>
        <a className="title-item on-link on-back" href="./index.html">← Back to Dice Cricket</a>
      </MenuPage>
    );
  }

  return (
    <MenuPage title="Online 1v1" note="Captain a team against someone on another computer.">
      {live.map((c) => (
        <button key={c} className="title-item" onClick={() => goRoom(c)}>
          Rejoin Match <span className="title-extra">Room {c}</span>
        </button>
      ))}
      <NameInput value={name} onChange={setName} />
      <QuickMatchButton className="title-item" label="Quick Match" disabled={nameBad} before={named} />
      <button
        className="title-item"
        disabled={nameBad}
        onClick={() => {
          named();
          goPrivate();
        }}
      >
        Private Match
      </button>
      <button className="title-item" onClick={goStats}>Online Stats</button>
      <a className="title-item on-link on-back" href="./index.html">← Back to Dice Cricket</a>
      <Footer nameBad={nameBad} error={error} />
    </MenuPage>
  );
}

export function PrivateMatch({ onNamed }: { onNamed: () => void }) {
  const { name, setName, nameBad, busy, error, create, joinRoom } = useOnlineName(onNamed);
  const askName = useAskName();
  const [joining, setJoining] = useState(false);
  const [code, setCode] = useState('');
  const roomCode = normalizeCode(code);

  const join = (e: FormEvent) => {
    e.preventDefault();
    if (roomCode) joinRoom(roomCode);
  };

  return (
    <MenuPage title="Private Match" note="Play a friend with a room code.">
      {askName && <NameInput value={name} onChange={setName} />}
      <button className="title-item" disabled={nameBad} onClick={() => setJoining((j) => !j)} aria-expanded={joining}>
        Join A Room
      </button>
      {joining && (
        <form className="on-join-row" onSubmit={join}>
          <input
            className="on-name-input on-code-input"
            aria-label="Room code"
            value={code}
            maxLength={CODE_LENGTH + 4}
            placeholder="Room code"
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
            autoFocus
            onChange={(e) => setCode(e.target.value)}
          />
          <button className="title-item on-join-go" disabled={!roomCode || nameBad}>Join</button>
        </form>
      )}
      <button className="title-item" disabled={nameBad || busy} onClick={() => void create(false)}>
        {busy ? 'Creating…' : 'Create A Room'}
      </button>
      <button className="title-item" onClick={goOpen}>Open Rooms</button>
      <button className="title-item on-back" onClick={goHome}>← Back</button>
      <Footer nameBad={nameBad} error={error} />
    </MenuPage>
  );
}

export function OpenRoomsPage({ onNamed }: { onNamed: () => void }) {
  const { name, setName, nameBad, busy, error, create, joinRoom } = useOnlineName(onNamed);
  const askName = useAskName();

  return (
    <MenuPage title="Open Rooms" note="Rooms anyone can join. You both play with one of the six sample teams.">
      {askName && <NameInput value={name} onChange={setName} />}
      <div className="on-open-list">
        <OpenRooms disabled={nameBad} onJoin={joinRoom} />
      </div>
      <button className="title-item" disabled={nameBad || busy} onClick={() => void create(true)}>
        {busy ? 'Creating…' : 'Make An Open Room'}
      </button>
      <button className="title-item on-back" onClick={goPrivate}>← Back</button>
      <Footer nameBad={nameBad} error={error} />
    </MenuPage>
  );
}
