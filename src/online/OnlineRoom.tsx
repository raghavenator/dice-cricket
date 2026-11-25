import { useCallback, useEffect, useState } from 'react';
import { TeamCard } from '../components/SettingsForm';
import { AutoToggles } from './AutoToggles';
import { LineupEditor } from './LineupEditor';
import { OnlineMatch } from './OnlineMatch';
import { lineupProblem, type Lineup } from './lineup';
import { goHome, inviteLink } from './nav';
import { recallLineup, rememberLineup } from './onlineDb';
import type { RoomView, SeatView } from './protocol';
import { loadTeams, type TeamChoice } from './teams';
import { Countdown } from './time';
import { useOnline } from './useOnlineStore';
import { MAX_OVERS, MIN_OVERS } from './validate';

const OVERS = [1, 2, 5, 10, 20];

/** Connects to a room for as long as it is on screen, and shows whatever stage it is at. */
export function OnlineRoom({ code }: { code: string }) {
  const status = useOnline((s) => s.status);
  const view = useOnline((s) => s.view);
  const match = useOnline((s) => s.match);
  const fatal = useOnline((s) => s.fatal);
  const join = useOnline((s) => s.join);
  const quit = useOnline((s) => s.quit);

  useEffect(() => {
    join(code);
    return quit;
  }, [code, join, quit]);

  // A finished match stays on screen even if the room has since closed.
  const showMatch = view && match && (view.phase === 'playing' || view.phase === 'finished');

  let body: React.ReactNode;
  if (fatal && !showMatch)
    body = (
      <div className="screen on-narrow">
        <h2>{fatal}</h2>
        {fatal === 'Room not found' && (
          <p className="muted">Check the code with your friend. Rooms close after 30 minutes if nobody joins.</p>
        )}
        <button className="btn btn-primary" onClick={goHome}>Online home</button>
      </div>
    );
  else if (!view)
    body = (
      <div className="screen on-narrow">
        <p className="muted">Connecting to room {code}…</p>
        <button className="btn btn-ghost" onClick={goHome}>Cancel</button>
      </div>
    );
  else if (showMatch) body = <OnlineMatch />;
  else if (view.phase === 'toss') body = <Toss view={view} />;
  else body = <Setup view={view} />;

  return (
    <>
      {status === 'lost' && !fatal && <div className="on-banner" role="status">Connection lost. Reconnecting…</div>}
      {body}
      <Toast />
    </>
  );
}

function Toast() {
  const toast = useOnline((s) => s.toast);
  const [shown, setShown] = useState<string | null>(null);
  useEffect(() => {
    if (!toast) return;
    setShown(toast.text);
    const t = window.setTimeout(() => setShown(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);
  return shown ? <div className="on-toast" role="alert">{shown}</div> : null;
}

export function Presence({ seat }: { seat: SeatView }) {
  return (
    <span className={`on-dot ${seat.connected ? 'on-here' : ''}`} title={seat.connected ? 'Connected' : 'Not connected'} />
  );
}

// ---------- Before the match ----------

function Invite({ code }: { code: string }) {
  const [copied, setCopied] = useState<string | null>(null);
  const link = inviteLink(code);
  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
      window.setTimeout(() => setCopied(null), 2000);
    } catch {
      window.prompt('Copy this:', text);
    }
  };
  return (
    <div className="card on-pad on-invite">
      <div>
        <span className="muted small">Room code</span>
        <div className="on-code">{code}</div>
      </div>
      <div className="btn-row">
        <button className="btn" onClick={() => void copy(code, 'code')}>{copied === 'code' ? 'Copied ✓' : 'Copy code'}</button>
        <button className="btn btn-primary" onClick={() => void copy(link, 'link')}>{copied === 'link' ? 'Copied ✓' : 'Copy link'}</button>
      </div>
    </div>
  );
}

function SeatCard({ seat, label }: { seat: SeatView | null; label: string }) {
  if (!seat)
    return (
      <div className="card on-pad on-seat">
        <span className="muted small">{label}</span>
        <b className="muted">Waiting for opponent…</b>
      </div>
    );
  return (
    <div className="card on-pad on-seat">
      <span className="muted small">{label}</span>
      <b><Presence seat={seat} /> {seat.nickname}</b>
      <span>
        {seat.team ? (
          <><span className="on-swatch" style={{ background: seat.team.color }} /> {seat.team.name}</>
        ) : (
          <span className="muted">Choosing a team…</span>
        )}
      </span>
      <span className={seat.ready ? 'on-ready' : 'muted small'}>
        {!seat.connected ? 'Disconnected' : seat.ready ? '✓ Ready' : 'Not ready'}
      </span>
    </div>
  );
}

function Setup({ view }: { view: RoomView }) {
  const send = useOnline((s) => s.send);
  const [teams, setTeams] = useState<TeamChoice[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const isHost = view.you === 'host';
  const me = isHost ? view.host : view.guest!;
  const opponent = isHost ? view.guest : view.host;

  useEffect(() => {
    void loadTeams().then(setTeams);
  }, []);

  const pickTeam = async ({ team }: TeamChoice) => {
    if (me.ready || team.id === view.team?.id) return;
    const saved = await recallLineup(team.id);
    send({ t: 'setTeam', team });
    if (!saved) return;
    // Use as much of last time's lineup as still fits this team and these overs.
    const { bowlingPlan: _, ...noPlan } = saved;
    const fits = [saved, noPlan].find((l) => lineupProblem(team, l, view.overs) === null);
    if (fits) send({ t: 'setLineup', lineup: fits });
  };

  const changeLineup = useCallback(
    (lineup: Lineup) => {
      send({ t: 'setLineup', lineup });
      if (view.team) void rememberLineup(view.team.id, lineup);
    },
    [send, view.team],
  );

  const leave = () => void useOnline.getState().leave().then(goHome);

  const waitingOn = !opponent
    ? 'Waiting for your opponent to join. You can choose your team now.'
    : !view.team
      ? 'Choose your team.'
      : problem ?? (me.ready ? `Waiting for ${opponent.nickname} to get ready…` : opponent.ready ? `${opponent.nickname} is ready. Press Ready to start.` : 'Set your lineup, then press Ready.');

  return (
    <div className="screen">
      <div className="title-row">
        <h2>{opponent ? 'Match setup' : 'Invite a friend'}</h2>
        <div className="btn-row">
          {isHost && opponent && (
            <button
              className="btn btn-ghost danger"
              onClick={() => confirm(`Remove ${opponent.nickname} from the room? They won't be able to come back.`) && send({ t: 'removeGuest' })}
            >
              Remove {opponent.nickname}
            </button>
          )}
          <button className="btn btn-ghost" onClick={leave}>Leave room</button>
        </div>
      </div>

      {!opponent && <Invite code={view.code} />}

      <div className="on-two">
        <SeatCard seat={me} label={isHost ? 'You (host)' : 'You'} />
        <SeatCard seat={opponent} label={isHost ? 'Opponent' : 'Opponent (host)'} />
      </div>

      <div className="form">
        <div className="field">
          <label>Overs per side</label>
          {isHost ? (
            <div className="seg">
              {OVERS.map((n) => (
                <button key={n} className={`seg-btn ${n === view.overs ? 'seg-on' : ''}`} onClick={() => send({ t: 'setSettings', overs: n })}>
                  {n}
                </button>
              ))}
              <label className="inline small">
                <span className="muted">Other:</span>
                <input
                  type="number"
                  min={MIN_OVERS}
                  max={MAX_OVERS}
                  value={view.overs}
                  onChange={(e) => {
                    const n = Math.floor(Number(e.target.value));
                    if (n >= MIN_OVERS && n <= MAX_OVERS) send({ t: 'setSettings', overs: n });
                  }}
                />
              </label>
            </div>
          ) : (
            <div><b>{view.overs}</b> <span className="muted small">(the host decides)</span></div>
          )}
        </div>
      </div>

      <h3>Your team</h3>
      <div className="team-grid">
        {(teams ?? []).map((c) => (
          <div key={c.team.id} className="on-team">
            <TeamCard
              team={c.team}
              selected={c.team.id === view.team?.id}
              disabled={me.ready || c.problem !== null}
              onClick={() => void pickTeam(c)}
            />
            {c.problem && <span className="muted small">{c.problem}. Edit it in Teams to use it online.</span>}
          </div>
        ))}
      </div>
      <p className="hint">Make your own in <a href="./index.html">Teams</a> on the main game. Changes below are for this match only.</p>

      {view.team && view.lineup && (
        <LineupEditor
          key={`${view.team.id}-${view.overs}`}
          team={view.team}
          lineup={view.lineup}
          overs={view.overs}
          locked={me.ready}
          onChange={changeLineup}
          onProblem={setProblem}
        />
      )}

      {view.team && (
        <div className="card on-pad">
          <h3>During the match</h3>
          <AutoToggles auto={me.auto} show={['batter', 'bowler']} explain />
          <p className="hint">If off, you get 5 seconds to pick each time. You can switch these during the match too.</p>
        </div>
      )}

      <div className="on-ready-bar">
        <span className={problem && view.team ? 'on-error' : 'muted'}>{waitingOn}</span>
        {me.ready ? (
          <button className="btn" onClick={() => send({ t: 'unready' })}>Edit</button>
        ) : (
          <button className="btn btn-primary" disabled={!opponent || !view.team || problem !== null} onClick={() => send({ t: 'ready' })}>
            Ready
          </button>
        )}
      </div>
    </div>
  );
}

// ---------- Toss ----------

function Toss({ view }: { view: RoomView }) {
  const send = useOnline((s) => s.send);
  const { toss, clock } = view;
  const opponent = view.you === 'host' ? view.guest! : view.host;
  const mine = clock.turn?.seat === view.you;
  const caller = view.you === 'guest' ? 'You' : opponent.nickname;

  return (
    <div className="screen on-narrow on-toss">
      <h2>Toss</h2>
      <div className="on-coin" aria-hidden>🪙</div>
      {!toss?.winner ? (
        mine ? (
          <>
            <p>Call it.</p>
            <div className="btn-row on-center">
              <button className="btn btn-primary" onClick={() => send({ t: 'callToss', call: 'heads' })}>Heads</button>
              <button className="btn btn-primary" onClick={() => send({ t: 'callToss', call: 'tails' })}>Tails</button>
            </div>
          </>
        ) : (
          <p>{opponent.nickname} is calling…</p>
        )
      ) : (
        <>
          <p>{caller} called {toss.call}. It's <b>{toss.face}</b>.</p>
          {mine ? (
            <>
              <p><b>You won the toss.</b></p>
              <div className="btn-row on-center">
                <button className="btn btn-primary" onClick={() => send({ t: 'chooseInnings', choice: 'bat' })}>Bat first</button>
                <button className="btn btn-primary" onClick={() => send({ t: 'chooseInnings', choice: 'bowl' })}>Bowl first</button>
              </div>
            </>
          ) : (
            <p>{opponent.nickname} won the toss and is deciding…</p>
          )}
        </>
      )}
      <p className="muted">
        {clock.paused ? `Waiting for ${opponent.nickname} to reconnect…` : <Countdown to={clock.deadline} />}
      </p>
      <button className="btn btn-ghost" onClick={() => void useOnline.getState().leave().then(goHome)}>Leave room</button>
    </div>
  );
}
