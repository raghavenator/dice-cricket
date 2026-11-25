import { useEffect, useState, type FormEvent } from 'react';
import { collectResults } from './collect';
import { getGuest, nicknameProblem, setNickname } from './guest';
import { goRoom, goStats } from './nav';
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

export function OnlineHome({ onNamed }: { onNamed: () => void }) {
  const [name, setName] = useState(getGuest().nickname);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState<string[]>([]);
  const roomCode = normalizeCode(code);
  const nameBad = nicknameProblem(name) !== null;

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

  const joinRoom = (c: string) => {
    if (nameBad) return;
    named();
    goRoom(c);
  };

  const join = (e: FormEvent) => {
    e.preventDefault();
    if (roomCode) joinRoom(roomCode);
  };

  if (!serverUrl()) {
    return (
      <div className="screen on-narrow">
        <h2>Online 1v1</h2>
        <p className="muted">Online play is not set up on this site yet.</p>
        <div className="btn-row">
          <a className="btn on-link" href="./index.html">← Back to Dice Cricket</a>
          <button className="btn" onClick={goStats}>Online Stats</button>
        </div>
      </div>
    );
  }

  return (
    <div className="screen on-narrow">
      <h2>Online 1v1</h2>
      <p className="muted">
        Captain a team against someone on another computer: a friend, with a room code, or anyone who is around.
      </p>
      {live.map((c) => (
        <button key={c} className="resume" onClick={() => goRoom(c)}>
          <span className="resume-tag">Rejoin match</span>
          <span>Room {c}</span>
          <span className="muted small">Your match is still going on.</span>
        </button>
      ))}
      <div className="form on-gap">
        <NameField value={name} onChange={setName} />
      </div>
      <h3>Play a friend</h3>
      <div className="on-two">
        <div className="form">
          <h3>Create a room</h3>
          <p className="muted small">You get a code and a link to send. Only people with it can join. Any team, including your own.</p>
          <button className="btn btn-primary" disabled={nameBad || busy} onClick={() => void create(false)}>
            {busy ? 'Creating…' : 'Create room'}
          </button>
        </div>
        <form className="form" onSubmit={join}>
          <h3>Join a room</h3>
          <label className="field">
            <span>Room code</span>
            <input
              className="text on-code-input"
              value={code}
              maxLength={CODE_LENGTH + 4}
              placeholder="K7M4QP"
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
              onChange={(e) => setCode(e.target.value)}
            />
          </label>
          <button className="btn btn-primary" disabled={!roomCode || nameBad}>Join room</button>
        </form>
      </div>
      <h3>Play anyone</h3>
      <p className="muted small">Against strangers you both play with one of the six sample teams.</p>
      <div className="on-two">
        <div className="form">
          <h3>Quick match</h3>
          <p className="muted small">5 overs against whoever is waiting. If nobody is, you wait for the next player.</p>
          <QuickMatchButton label="Find a match" disabled={nameBad} before={named} />
        </div>
        <div className="form">
          <h3>Open rooms</h3>
          <OpenRooms disabled={nameBad} onJoin={joinRoom} />
          <button className="btn" disabled={nameBad || busy} onClick={() => void create(true)}>Make an open room</button>
        </div>
      </div>
      <button className="mode on-stats-link" onClick={goStats}>
        <span className="mode-title">📊 Online Stats</span>
        <span className="mode-desc">Your results, head-to-heads, batting and bowling online. Separate from your offline stats.</span>
      </button>
      {nameBad && <p className="muted small">Enter your name to create or join a room.</p>}
      {error && <p className="on-error" role="alert">{error}</p>}
      <div className="nav-row">
        <a className="btn btn-ghost on-link" href="./index.html">← Back to Dice Cricket</a>
      </div>
    </div>
  );
}
