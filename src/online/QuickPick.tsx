import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { PRESET_TEAMS } from '../data/presets';
import { getGuest, nicknameProblem } from './guest';
import { LineupEditor } from './LineupEditor';
import { defaultLineup, lineupProblem, type Lineup } from './lineup';
import { goHome, goRoom } from './nav';
import { MenuPage, NameInput, useOnlineName } from './OnlineHome';
import { preferredQuickTeam, rememberQuickTeam } from './quickTeam';
import { TeamCrest } from './TeamCrest';
import { recallLineup, rememberLineup } from './onlineDb';
import { quickMatch } from './useOnlineStore';
import { DEFAULT_OVERS } from './validate';

/** Quick matches are always this long. */
const OVERS = DEFAULT_OVERS;

/** Choose a sample team for a quick match, then press Ready to look for an opponent. */
export function QuickPick({ onNamed }: { onNamed: () => void }) {
  const { name, setName, nameBad, named } = useOnlineName(onNamed);
  const [askName] = useState(() => nicknameProblem(getGuest().nickname) !== null);
  const [at, setAt] = useState(() => Math.max(0, PRESET_TEAMS.findIndex((t) => t.id === preferredQuickTeam().id)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const touchX = useRef<number | null>(null);
  const team = PRESET_TEAMS[at];
  const [lineup, setLineup] = useState<{ teamId: string; lineup: Lineup } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const saving = useRef<Promise<void>>(Promise.resolve());

  // Last time's lineup for this team, if it still fits; otherwise the default.
  useEffect(() => {
    let here = true;
    setLineup(null);
    setProblem(null);
    void recallLineup(team.id).then((saved) => {
      if (!here) return;
      const { bowlingPlan: _, ...noPlan } = saved ?? defaultLineup(team);
      const fits = lineupProblem(team, noPlan, OVERS) === null ? noPlan : null;
      setLineup({ teamId: team.id, lineup: fits ?? defaultLineup(team) });
    });
    return () => {
      here = false;
    };
  }, [team]);

  const changeLineup = (l: Lineup) => {
    setLineup({ teamId: team.id, lineup: l });
    saving.current = rememberLineup(team.id, l);
  };

  const show = (i: number) => {
    const next = (i + PRESET_TEAMS.length) % PRESET_TEAMS.length;
    setAt(next);
    rememberQuickTeam(PRESET_TEAMS[next].id);
  };

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (['INPUT', 'SELECT'].includes((e.target as HTMLElement).tagName)) return;
    if (e.key === 'ArrowLeft') show(at - 1);
    else if (e.key === 'ArrowRight') show(at + 1);
    else return;
    e.preventDefault();
  };

  const ready = async () => {
    setBusy(true);
    setError(null);
    try {
      rememberQuickTeam(team.id);
      await saving.current;
      goRoom(await quickMatch(named()));
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="on-quick" onKeyDown={onKey}>
      <MenuPage title="Quick Match" note="5 overs · sample teams · against anyone">
        {askName && <NameInput value={name} onChange={setName} />}
        <div
          className="on-carousel"
          role="group"
          aria-label="Choose your team"
          onTouchStart={(e) => (touchX.current = e.touches[0].clientX)}
          onTouchEnd={(e) => {
            const from = touchX.current;
            touchX.current = null;
            if (from === null) return;
            const dx = e.changedTouches[0].clientX - from;
            if (Math.abs(dx) > 40) show(dx < 0 ? at + 1 : at - 1);
          }}
        >
          <button className="on-arrow" aria-label="Previous team" onClick={() => show(at - 1)}>‹</button>
          <div className="on-crest-big" key={team.id}>
            <TeamCrest team={team} size={170} />
          </div>
          <button className="on-arrow" aria-label="Next team" onClick={() => show(at + 1)}>›</button>
        </div>
        <div className="on-team-name" aria-live="polite">{team.name}</div>
        <div className="on-crest-strip">
          {PRESET_TEAMS.map((t, i) => (
            <button
              key={t.id}
              className={`on-crest-pick ${i === at ? 'on-crest-on' : ''}`}
              aria-label={t.name}
              aria-pressed={i === at}
              onClick={() => show(i)}
            >
              <TeamCrest team={t} size={40} />
            </button>
          ))}
        </div>
        {lineup?.teamId === team.id && (
          <div className="on-quick-lineup">
            <LineupEditor
              key={team.id}
              team={team}
              lineup={lineup.lineup}
              overs={OVERS}
              locked={busy}
              onChange={changeLineup}
              onProblem={setProblem}
            />
            {problem && <p className="on-error" role="alert">{problem}</p>}
          </div>
        )}
        <button className="title-item" disabled={nameBad || busy || problem !== null || lineup?.teamId !== team.id} onClick={() => void ready()}>
          {busy ? 'Searching…' : 'Ready'}
        </button>
        <button className="title-item on-back" onClick={goHome}>← Back</button>
        {nameBad && <p className="on-hint">Choose a name to play.</p>}
        {error && <p className="on-error" role="alert">{error}</p>}
      </MenuPage>
    </div>
  );
}
